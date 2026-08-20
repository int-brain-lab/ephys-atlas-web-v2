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


class PublishingError(Exception):
    status = 400


class NotFound(PublishingError):
    status = 404


class Forbidden(PublishingError):
    status = 403


class Conflict(PublishingError):
    status = 409


class ValidationError(PublishingError):
    status = 422


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
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts) or path.as_posix() != value:
        raise ValidationError("artifact path must be normalized and relative")
    if value == "_publication.json":
        raise ValidationError("reserved artifact path")
    return value


def atomic_json(path: Path, value: Any, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{secrets.token_hex(8)}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        os.chmod(path, mode)
    finally:
        if tmp.exists():
            tmp.unlink()


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValidationError("expected JSON object")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(4 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


class PublicationStore:
    def __init__(
        self,
        root: str | Path,
        *,
        validator_command: str | list[str] | None = None,
        max_artifacts: int = 100000,
        max_release_bytes: int = 100 * 1024**3,
    ):
        self.root = Path(root)
        self.public = self.root / "public"
        self.state = self.root / "state"
        self.staging = self.root / "staging"
        self.max_artifacts = max_artifacts
        self.max_release_bytes = max_release_bytes
        self.validator_command = (
            shlex.split(validator_command)
            if isinstance(validator_command, str)
            else list(validator_command or [])
        )
        self._lock = threading.RLock()
        for path, mode in ((self.public, 0o755), (self.state, 0o700), (self.staging, 0o700)):
            path.mkdir(parents=True, exist_ok=True)
            os.chmod(path, mode)
        if self.public.stat().st_dev != self.staging.stat().st_dev:
            raise RuntimeError("staging and public must share a filesystem for atomic publication")
        if not (self.public / "catalog.json").exists():
            self._catalog()

    def _dataset(self, dataset_id: str) -> Path:
        return self.public / "datasets" / _id(dataset_id, "dataset id")

    def _dataset_index(self, dataset_id: str) -> Path:
        return self._dataset(dataset_id) / "index.json"

    def _owner_path(self, dataset_id: str) -> Path:
        return self.state / "datasets" / f"{_id(dataset_id, 'dataset id')}.json"

    def dataset_owner(self, dataset_id: str) -> str | None:
        path = self._owner_path(dataset_id)
        return load_json(path).get("creator_credential_id") if path.exists() else None

    def create_dataset(self, dataset_id: str, metadata: dict[str, Any], credential_id: str) -> dict[str, Any]:
        dataset_id = _id(dataset_id, "dataset id")
        if not isinstance(metadata, dict):
            raise ValidationError("metadata must be an object")
        with self._lock:
            dataset = self._dataset(dataset_id)
            if dataset.exists():
                raise Conflict("dataset already exists")
            dataset.mkdir(parents=True)
            index = {
                "dataset_id": dataset_id,
                "metadata": metadata,
                "archived": False,
                "releases": [],
                "aliases": {},
            }
            atomic_json(dataset / "index.json", index)
            atomic_json(
                self._owner_path(dataset_id),
                {"creator_credential_id": credential_id, "created_at": now()},
                0o600,
            )
            self._catalog()
            self._audit(credential_id, "dataset.create", dataset_id=dataset_id)
            return index

    def list_datasets(self) -> dict[str, Any]:
        """Return the administrative dataset inventory used by the mutation API."""
        active: list[dict[str, Any]] = []
        archived: list[dict[str, Any]] = []
        root = self.public / "datasets"
        if root.exists():
            for dataset in sorted(root.iterdir()):
                index_path = dataset / "index.json"
                if not index_path.exists():
                    continue
                index = load_json(index_path)
                entry = {
                    "dataset_id": index["dataset_id"],
                    "metadata": index["metadata"],
                    "releases": index["releases"],
                    "aliases": index["aliases"],
                }
                (archived if index["archived"] else active).append(entry)
        return {
            "generated_at": now(),
            "datasets": active,
            "archived_datasets": archived,
        }

    def get_dataset(self, dataset_id: str) -> dict[str, Any]:
        path = self._dataset_index(dataset_id)
        if not path.exists():
            raise NotFound("dataset not found")
        return load_json(path)

    def archive_dataset(self, dataset_id: str, credential_id: str) -> dict[str, Any]:
        with self._lock:
            index = self.get_dataset(dataset_id)
            index["archived"] = True
            atomic_json(self._dataset_index(dataset_id), index)
            self._catalog()
            self._audit(credential_id, "dataset.archive", dataset_id=dataset_id)
            return index

    def create_upload(
        self,
        dataset_id: str,
        release_id: str,
        artifacts: list[dict[str, Any]],
        metadata: dict[str, Any],
        credential_id: str,
    ) -> dict[str, Any]:
        dataset = self.get_dataset(dataset_id)
        if dataset["archived"]:
            raise Conflict("dataset is archived")
        release_id = _id(release_id, "release id")
        if (self._dataset(dataset_id) / "releases" / release_id).exists():
            raise Conflict("release already exists")
        if not artifacts or len(artifacts) > self.max_artifacts:
            raise ValidationError("invalid artifact count")

        seen: set[str] = set()
        normalized: list[dict[str, Any]] = []
        total = 0
        for artifact in artifacts:
            path = _relpath(artifact.get("path"))
            size = int(artifact.get("size", -1))
            sha = str(artifact.get("sha256", ""))
            if path in seen or size < 0 or not SHA_RE.fullmatch(sha):
                raise ValidationError("invalid artifact descriptor")
            seen.add(path)
            total += size
            normalized.append({"path": path, "size": size, "sha256": sha})
        if total > self.max_release_bytes:
            raise ValidationError("release too large")

        upload_id = secrets.token_hex(16)
        upload = self.staging / upload_id
        (upload / "files").mkdir(parents=True)
        state = {
            "upload_id": upload_id,
            "dataset_id": dataset_id,
            "release_id": release_id,
            "artifacts": normalized,
            "metadata": metadata or {},
            "created_by": credential_id,
            "created_at": now(),
        }
        atomic_json(upload / "upload.json", state, 0o600)
        return self.upload_status(upload_id)

    def _upload(self, upload_id: str) -> tuple[Path, dict[str, Any]]:
        upload = self.staging / _id(upload_id, "upload id")
        if not (upload / "upload.json").exists():
            raise NotFound("upload not found")
        return upload, load_json(upload / "upload.json")

    def _artifact(self, state: dict[str, Any], path: str) -> dict[str, Any]:
        path = _relpath(path)
        for artifact in state["artifacts"]:
            if artifact["path"] == path:
                return artifact
        raise NotFound("artifact not declared")

    def upload_status(self, upload_id: str) -> dict[str, Any]:
        upload, state = self._upload(upload_id)
        result = dict(state)
        items = []
        for artifact in state["artifacts"]:
            path = upload / "files" / artifact["path"]
            items.append({
                **artifact,
                "offset": path.stat().st_size if path.exists() else 0,
            })
        result["artifacts"] = items
        return result

    def append_artifact(self, upload_id: str, path: str, offset: int, body: bytes) -> dict[str, Any]:
        upload, state = self._upload(upload_id)
        artifact = self._artifact(state, path)
        destination = upload / "files" / artifact["path"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        current = destination.stat().st_size if destination.exists() else 0
        if int(offset) != current:
            raise OffsetConflict(current)
        if current + len(body) > artifact["size"]:
            raise ValidationError("artifact exceeds declared size")
        with destination.open("ab") as handle:
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        return {"offset": current + len(body), "size": artifact["size"]}

    def publish_upload(self, upload_id: str, aliases: list[str], credential_id: str) -> dict[str, Any]:
        with self._lock:
            upload, state = self._upload(upload_id)
            dataset_id = state["dataset_id"]
            release_id = state["release_id"]
            release_dir = self._dataset(dataset_id) / "releases" / release_id
            if release_dir.exists():
                raise Conflict("release already exists")

            for artifact in state["artifacts"]:
                path = upload / "files" / artifact["path"]
                if not path.is_file() or path.stat().st_size != artifact["size"]:
                    raise ValidationError(f"incomplete artifact: {artifact['path']}")
                if sha256_file(path) != artifact["sha256"]:
                    raise ValidationError(f"sha256 mismatch: {artifact['path']}")

            if self.validator_command:
                command = [
                    part.replace("{release_dir}", str(upload / "files"))
                    for part in self.validator_command
                ]
                result = subprocess.run(command, capture_output=True, text=True)
                if result.returncode:
                    raise ValidationError(
                        (result.stderr or result.stdout or "validation failed").strip()
                    )

            publication = {
                "dataset_id": dataset_id,
                "release_id": release_id,
                "published_at": now(),
                "metadata": state["metadata"],
                "artifacts": state["artifacts"],
            }
            atomic_json(upload / "files" / "_publication.json", publication)
            release_dir.parent.mkdir(parents=True, exist_ok=True)
            os.replace(upload / "files", release_dir)
            self._make_read_only(release_dir)

            index = self.get_dataset(dataset_id)
            index["releases"].append({
                "release_id": release_id,
                "published_at": publication["published_at"],
            })
            for alias in aliases:
                index["aliases"][_id(alias, "alias")] = release_id
            atomic_json(self._dataset_index(dataset_id), index)
            self._catalog()
            try:
                (upload / "upload.json").unlink()
                upload.rmdir()
            except OSError:
                pass
            self._audit(
                credential_id,
                "release.publish",
                dataset_id=dataset_id,
                release_id=release_id,
                aliases=aliases,
            )
            return publication

    def set_alias(self, dataset_id: str, alias: str, release_id: str, credential_id: str) -> dict[str, Any]:
        with self._lock:
            index = self.get_dataset(dataset_id)
            alias = _id(alias, "alias")
            release_id = _id(release_id, "release id")
            if not (self._dataset(dataset_id) / "releases" / release_id).is_dir():
                raise NotFound("release not found")
            index["aliases"][alias] = release_id
            atomic_json(self._dataset_index(dataset_id), index)
            self._catalog()
            self._audit(
                credential_id,
                "alias.set",
                dataset_id=dataset_id,
                alias=alias,
                release_id=release_id,
            )
            return index

    def _make_read_only(self, root: Path) -> None:
        for path in root.rglob("*"):
            os.chmod(path, 0o555 if path.is_dir() else 0o444)
        os.chmod(root, 0o555)

    def _public_dataset_entry(self, index: dict[str, Any]) -> dict[str, Any] | None:
        if index.get("archived") or not index.get("releases"):
            return None

        dataset_id = index["dataset_id"]
        releases = [item["release_id"] for item in index["releases"]]
        aliases = index.get("aliases") or {}
        default_release = aliases.get("paper") or aliases.get("latest") or releases[-1]
        if default_release not in releases:
            raise ValidationError(
                f"dataset {dataset_id} default alias points to unknown release {default_release}"
            )

        metadata = index.get("metadata") or {}
        title = metadata.get("title")
        description = metadata.get("description")
        entry: dict[str, Any] = {
            "id": dataset_id,
            "title": title if isinstance(title, str) and title else dataset_id,
            "releases": [
                {
                    "id": release_id,
                    "label": release_id,
                    "manifest": f"./datasets/{dataset_id}/releases/{release_id}/manifest.json",
                    "immutable": True,
                }
                for release_id in releases
            ],
            "defaultRelease": default_release,
        }
        if isinstance(description, str) and description:
            entry["description"] = description
        return entry

    def _catalog(self) -> None:
        """Regenerate the public browser catalog from authoritative dataset indexes.

        Administrative aliases and archived datasets remain in per-dataset indexes
        and are exposed through the authenticated mutation API. The static file is
        intentionally the browser's schema-v0.1 catalog contract only.
        """
        datasets: list[dict[str, Any]] = []
        root = self.public / "datasets"
        if root.exists():
            for dataset in sorted(root.iterdir()):
                index_path = dataset / "index.json"
                if not index_path.exists():
                    continue
                entry = self._public_dataset_entry(load_json(index_path))
                if entry is not None:
                    datasets.append(entry)
        atomic_json(
            self.public / "catalog.json",
            {"schemaVersion": "0.1", "datasets": datasets},
        )

    def _audit(self, credential_id: str, action: str, **fields: Any) -> None:
        path = self.state / "audit.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "a", encoding="utf-8") as handle:
            handle.write(json.dumps({
                "at": now(),
                "credential_id": credential_id,
                "action": action,
                **fields,
            }, sort_keys=True) + "\n")
        os.chmod(path, 0o600)
