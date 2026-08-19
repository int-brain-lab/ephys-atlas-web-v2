from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shlex
import subprocess
import threading
from typing import Any

ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")


class PublishingError(Exception): status = 400
class NotFound(PublishingError): status = 404
class Forbidden(PublishingError): status = 403
class Conflict(PublishingError): status = 409
class ValidationError(PublishingError): status = 422


class OffsetConflict(Conflict):
    def __init__(self, expected_offset: int):
        self.expected_offset = expected_offset
        super().__init__(f"unexpected upload offset; expected {expected_offset}")


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _id(value: str, kind: str) -> str:
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        raise ValidationError(f"invalid {kind}")
    return value


def _relpath(value: str) -> str:
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise ValidationError("invalid artifact path")
    p = PurePosixPath(value)
    if p.is_absolute() or any(x in ("", ".", "..") for x in p.parts) or p.as_posix() != value:
        raise ValidationError("artifact path must be normalized and relative")
    if value == "_publication.json":
        raise ValidationError("reserved artifact path")
    return value


def atomic_json(path: Path, value: Any, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{secrets.token_hex(8)}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(value, f, indent=2, sort_keys=True)
            f.write("\n")
            f.flush(); os.fsync(f.fileno())
        os.replace(tmp, path); os.chmod(path, mode)
    finally:
        if tmp.exists(): tmp.unlink()


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text())
    if not isinstance(value, dict): raise ValidationError("expected JSON object")
    return value


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(4 * 1024 * 1024): h.update(chunk)
    return h.hexdigest()


class PublicationStore:
    def __init__(self, root: str | Path, *, validator_command: str | list[str] | None = None,
                 max_artifacts: int = 100000, max_release_bytes: int = 100 * 1024**3):
        self.root = Path(root)
        self.public = self.root / "public"
        self.state = self.root / "state"
        self.staging = self.root / "staging"
        self.max_artifacts = max_artifacts
        self.max_release_bytes = max_release_bytes
        self.validator_command = shlex.split(validator_command) if isinstance(validator_command, str) else list(validator_command or [])
        self._lock = threading.RLock()
        for p, mode in ((self.public, 0o755), (self.state, 0o700), (self.staging, 0o700)):
            p.mkdir(parents=True, exist_ok=True); os.chmod(p, mode)
        if self.public.stat().st_dev != self.staging.stat().st_dev:
            raise RuntimeError("staging and public must share a filesystem for atomic publication")
        if not (self.public / "catalog.json").exists(): self._catalog()

    def _dataset(self, dataset_id: str) -> Path:
        return self.public / "datasets" / _id(dataset_id, "dataset id")

    def _dataset_index(self, dataset_id: str) -> Path:
        return self._dataset(dataset_id) / "index.json"

    def _owner_path(self, dataset_id: str) -> Path:
        return self.state / "datasets" / f"{_id(dataset_id, 'dataset id')}.json"

    def dataset_owner(self, dataset_id: str) -> str | None:
        p = self._owner_path(dataset_id)
        return load_json(p).get("creator_credential_id") if p.exists() else None

    def create_dataset(self, dataset_id: str, metadata: dict[str, Any], credential_id: str) -> dict[str, Any]:
        dataset_id = _id(dataset_id, "dataset id")
        if not isinstance(metadata, dict): raise ValidationError("metadata must be an object")
        with self._lock:
            d = self._dataset(dataset_id)
            if d.exists(): raise Conflict("dataset already exists")
            d.mkdir(parents=True)
            index = {"dataset_id": dataset_id, "metadata": metadata, "archived": False, "releases": [], "aliases": {}}
            atomic_json(d / "index.json", index)
            atomic_json(self._owner_path(dataset_id), {"creator_credential_id": credential_id, "created_at": now()}, 0o600)
            self._catalog(); self._audit(credential_id, "dataset.create", dataset_id=dataset_id)
            return index

    def list_datasets(self) -> dict[str, Any]:
        return load_json(self.public / "catalog.json")

    def get_dataset(self, dataset_id: str) -> dict[str, Any]:
        p = self._dataset_index(dataset_id)
        if not p.exists(): raise NotFound("dataset not found")
        return load_json(p)

    def archive_dataset(self, dataset_id: str, credential_id: str) -> dict[str, Any]:
        with self._lock:
            index = self.get_dataset(dataset_id); index["archived"] = True
            atomic_json(self._dataset_index(dataset_id), index); self._catalog()
            self._audit(credential_id, "dataset.archive", dataset_id=dataset_id)
            return index

    def create_upload(self, dataset_id: str, release_id: str, artifacts: list[dict[str, Any]],
                      metadata: dict[str, Any], credential_id: str) -> dict[str, Any]:
        dataset = self.get_dataset(dataset_id)
        if dataset["archived"]: raise Conflict("dataset is archived")
        release_id = _id(release_id, "release id")
        if (self._dataset(dataset_id) / "releases" / release_id).exists(): raise Conflict("release already exists")
        if not artifacts or len(artifacts) > self.max_artifacts: raise ValidationError("invalid artifact count")
        seen, normalized, total = set(), [], 0
        for a in artifacts:
            path = _relpath(a.get("path")); size = int(a.get("size", -1)); sha = str(a.get("sha256", ""))
            if path in seen or size < 0 or not SHA_RE.fullmatch(sha): raise ValidationError("invalid artifact descriptor")
            seen.add(path); total += size; normalized.append({"path": path, "size": size, "sha256": sha})
        if total > self.max_release_bytes: raise ValidationError("release too large")
        upload_id = secrets.token_hex(16); u = self.staging / upload_id; (u / "files").mkdir(parents=True)
        state = {"upload_id": upload_id, "dataset_id": dataset_id, "release_id": release_id,
                 "artifacts": normalized, "metadata": metadata or {}, "created_by": credential_id, "created_at": now()}
        atomic_json(u / "upload.json", state, 0o600)
        return self.upload_status(upload_id)

    def _upload(self, upload_id: str) -> tuple[Path, dict[str, Any]]:
        u = self.staging / _id(upload_id, "upload id")
        if not (u / "upload.json").exists(): raise NotFound("upload not found")
        return u, load_json(u / "upload.json")

    def _artifact(self, state: dict[str, Any], path: str) -> dict[str, Any]:
        path = _relpath(path)
        for a in state["artifacts"]:
            if a["path"] == path: return a
        raise NotFound("artifact not declared")

    def upload_status(self, upload_id: str) -> dict[str, Any]:
        u, state = self._upload(upload_id); out = dict(state); items = []
        for a in state["artifacts"]:
            p = u / "files" / a["path"]; items.append({**a, "offset": p.stat().st_size if p.exists() else 0})
        out["artifacts"] = items; return out

    def append_artifact(self, upload_id: str, path: str, offset: int, body: bytes) -> dict[str, Any]:
        u, state = self._upload(upload_id); a = self._artifact(state, path); p = u / "files" / a["path"]
        p.parent.mkdir(parents=True, exist_ok=True); current = p.stat().st_size if p.exists() else 0
        if int(offset) != current: raise OffsetConflict(current)
        if current + len(body) > a["size"]: raise ValidationError("artifact exceeds declared size")
        with p.open("ab") as f: f.write(body); f.flush(); os.fsync(f.fileno())
        return {"offset": current + len(body), "size": a["size"]}

    def publish_upload(self, upload_id: str, aliases: list[str], credential_id: str) -> dict[str, Any]:
        with self._lock:
            u, state = self._upload(upload_id); dataset_id = state["dataset_id"]; release_id = state["release_id"]
            release_dir = self._dataset(dataset_id) / "releases" / release_id
            if release_dir.exists(): raise Conflict("release already exists")
            for a in state["artifacts"]:
                p = u / "files" / a["path"]
                if not p.is_file() or p.stat().st_size != a["size"]: raise ValidationError(f"incomplete artifact: {a['path']}")
                if sha256_file(p) != a["sha256"]: raise ValidationError(f"sha256 mismatch: {a['path']}")
            if self.validator_command:
                cmd = [part.replace("{release_dir}", str(u / "files")) for part in self.validator_command]
                result = subprocess.run(cmd, capture_output=True, text=True)
                if result.returncode: raise ValidationError((result.stderr or result.stdout or "validation failed").strip())
            publication = {"dataset_id": dataset_id, "release_id": release_id, "published_at": now(),
                           "metadata": state["metadata"], "artifacts": state["artifacts"]}
            atomic_json(u / "files" / "_publication.json", publication)
            release_dir.parent.mkdir(parents=True, exist_ok=True)
            os.replace(u / "files", release_dir)
            self._make_read_only(release_dir)
            index = self.get_dataset(dataset_id); index["releases"].append({"release_id": release_id, "published_at": publication["published_at"]})
            for alias in aliases: index["aliases"][_id(alias, "alias")] = release_id
            atomic_json(self._dataset_index(dataset_id), index); self._catalog()
            try: (u / "upload.json").unlink(); u.rmdir()
            except OSError: pass
            self._audit(credential_id, "release.publish", dataset_id=dataset_id, release_id=release_id, aliases=aliases)
            return publication

    def set_alias(self, dataset_id: str, alias: str, release_id: str, credential_id: str) -> dict[str, Any]:
        with self._lock:
            index = self.get_dataset(dataset_id); alias = _id(alias, "alias"); release_id = _id(release_id, "release id")
            if not (self._dataset(dataset_id) / "releases" / release_id).is_dir(): raise NotFound("release not found")
            index["aliases"][alias] = release_id; atomic_json(self._dataset_index(dataset_id), index); self._catalog()
            self._audit(credential_id, "alias.set", dataset_id=dataset_id, alias=alias, release_id=release_id)
            return index

    def _make_read_only(self, root: Path) -> None:
        for p in root.rglob("*"): os.chmod(p, 0o555 if p.is_dir() else 0o444)
        os.chmod(root, 0o555)

    def _catalog(self) -> None:
        active, archived = [], []
        root = self.public / "datasets"
        if root.exists():
            for d in sorted(root.iterdir()):
                p = d / "index.json"
                if not p.exists(): continue
                i = load_json(p); e = {"dataset_id": i["dataset_id"], "metadata": i["metadata"], "releases": i["releases"], "aliases": i["aliases"]}
                (archived if i["archived"] else active).append(e)
        atomic_json(self.public / "catalog.json", {"generated_at": now(), "datasets": active, "archived_datasets": archived})

    def _audit(self, credential_id: str, action: str, **fields: Any) -> None:
        p = self.state / "audit.jsonl"; p.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "a", encoding="utf-8") as f: f.write(json.dumps({"at": now(), "credential_id": credential_id, "action": action, **fields}, sort_keys=True) + "\n")
        os.chmod(p, 0o600)
