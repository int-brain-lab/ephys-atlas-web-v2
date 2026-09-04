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


def _fields(
    value: dict[str, Any],
    required: set[str],
    optional: set[str],
    context: str,
) -> None:
    missing = required - value.keys()
    unsupported = value.keys() - required - optional
    if missing:
        raise ValidationError(f"{context} is missing {sorted(missing)[0]}")
    if unsupported:
        raise ValidationError(f"{context} contains unsupported {sorted(unsupported)[0]}")


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
        validator_timeout_seconds: float = 300,
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
        if validator_timeout_seconds <= 0:
            raise ValueError("validator timeout must be positive")
        self.validator_timeout_seconds = validator_timeout_seconds
        self._lock = threading.RLock()
        for path, mode in ((self.public, 0o755), (self.state, 0o700), (self.staging, 0o700)):
            path.mkdir(parents=True, exist_ok=True)
            os.chmod(path, mode)
        if self.public.stat().st_dev != self.staging.stat().st_dev:
            raise RuntimeError("staging and public must share a filesystem for atomic publication")
        # Public discovery begins only with an explicit curator promotion.
        # There is no schema-valid empty catalog because every public dataset
        # and default must resolve through a project.

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
        # The offset check and append must be one operation. The documented
        # threaded deployment otherwise allows two same-offset requests to both
        # pass the check before either append becomes visible.
        with self._lock:
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

    def _validate_manifest_identity(
        self,
        release_root: Path,
        *,
        dataset_id: str,
        release_id: str,
    ) -> None:
        manifest_path = release_root / "manifest.json"
        if not manifest_path.is_file():
            raise ValidationError("release must contain manifest.json")
        try:
            manifest = load_json(manifest_path)
        except (OSError, json.JSONDecodeError) as exc:
            raise ValidationError(f"invalid manifest.json: {exc}") from exc
        if manifest.get("dataset_id") != dataset_id:
            raise ValidationError("manifest dataset_id does not match upload dataset")
        if manifest.get("schema_version") != "1.0":
            raise ValidationError("manifest schema_version must be 1.0")
        release = manifest.get("release")
        if not isinstance(release, dict) or release.get("release_id") != release_id:
            raise ValidationError("manifest release_id does not match upload release")

    def _record_publication(
        self,
        publication: dict[str, Any],
        aliases: list[str],
    ) -> None:
        dataset_id = publication["dataset_id"]
        release_id = publication["release_id"]
        index = self.get_dataset(dataset_id)
        known = {item["release_id"] for item in index["releases"]}
        if release_id not in known:
            index["releases"].append({
                "release_id": release_id,
                "published_at": publication["published_at"],
            })
        for alias in aliases:
            index["aliases"][_id(alias, "alias")] = release_id
        atomic_json(self._dataset_index(dataset_id), index)

    def _cleanup_upload(self, upload: Path) -> None:
        try:
            (upload / "upload.json").unlink()
            upload.rmdir()
        except OSError:
            pass

    def publish_upload(self, upload_id: str, aliases: list[str], credential_id: str) -> dict[str, Any]:
        with self._lock:
            upload, state = self._upload(upload_id)
            dataset_id = state["dataset_id"]
            release_id = state["release_id"]
            release_dir = self._dataset(dataset_id) / "releases" / release_id
            aliases = [_id(alias, "alias") for alias in aliases]
            if release_dir.exists():
                # A process may have stopped after the atomic directory rename
                # but before updating the dataset index/catalog. Retrying the
                # same upload completes that publication idempotently.
                publication_path = release_dir / "_publication.json"
                if not publication_path.is_file():
                    raise Conflict("release already exists")
                publication = load_json(publication_path)
                if (
                    publication.get("dataset_id") != dataset_id
                    or publication.get("release_id") != release_id
                ):
                    raise Conflict("release already exists with different identity")
                self._validate_manifest_identity(
                    release_dir, dataset_id=dataset_id, release_id=release_id
                )
                self._make_read_only(release_dir)
                self._record_publication(publication, aliases)
                self._cleanup_upload(upload)
                return publication

            for artifact in state["artifacts"]:
                path = upload / "files" / artifact["path"]
                if not path.is_file() or path.stat().st_size != artifact["size"]:
                    raise ValidationError(f"incomplete artifact: {artifact['path']}")
                if sha256_file(path) != artifact["sha256"]:
                    raise ValidationError(f"sha256 mismatch: {artifact['path']}")

            self._validate_manifest_identity(
                upload / "files", dataset_id=dataset_id, release_id=release_id
            )

            if self.validator_command:
                command = [
                    part.replace("{release_dir}", str(upload / "files"))
                    for part in self.validator_command
                ]
                try:
                    result = subprocess.run(
                        command,
                        capture_output=True,
                        text=True,
                        timeout=self.validator_timeout_seconds,
                    )
                except subprocess.TimeoutExpired as exc:
                    raise ValidationError(
                        f"validator timed out after {self.validator_timeout_seconds:g} seconds"
                    ) from exc
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
            self._record_publication(publication, aliases)
            self._cleanup_upload(upload)
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

    def _manifest_resource(self, dataset_id: str, release_id: str) -> dict[str, Any]:
        path = self._dataset(dataset_id) / "releases" / release_id / "manifest.json"
        size = path.stat().st_size
        return {
            "path": f"./datasets/{dataset_id}/releases/{release_id}/manifest.json",
            "media_type": "application/json",
            "bytes": size,
            "sha256": sha256_file(path),
            "codec": {"name": "none", "decoded_bytes": size},
        }

    def _edition_history(self) -> dict[str, Any]:
        path = self.state / "edition-history.json"
        history: dict[str, Any] = {}
        if path.exists():
            value = load_json(path)
            editions = value.get("editions")
            if not isinstance(editions, dict):
                raise ValidationError("edition history is invalid")
            for key, mapping in editions.items():
                if not isinstance(key, str) or key.count("/") != 1:
                    raise ValidationError("edition history identity is invalid")
                project_id, edition_id = key.split("/", 1)
                _id(project_id, "project id")
                _id(edition_id, "edition id")
                if not isinstance(mapping, dict) or not mapping:
                    raise ValidationError("edition history mapping is invalid")
                normalized: dict[str, str] = {}
                for dataset_id, release_id in mapping.items():
                    normalized[_id(dataset_id, "dataset id")] = _id(release_id, "release id")
                history[key] = normalized
        # Catalogs written by an older publisher are already exposed identities.
        # Seed them in-memory so the first curator promotion cannot remap one.
        catalog_path = self.public / "catalog.json"
        if catalog_path.exists():
            catalog = load_json(catalog_path)
            for project in catalog.get("projects", []):
                if not isinstance(project, dict):
                    raise ValidationError("existing catalog project is invalid")
                pid = _id(project.get("project_id"), "project id")
                editions = project.get("editions")
                if not isinstance(editions, list):
                    raise ValidationError("existing catalog editions are invalid")
                for edition in editions:
                    if not isinstance(edition, dict):
                        raise ValidationError("existing catalog edition is invalid")
                    edition_id = _id(edition.get("edition_id"), "edition id")
                    mapping = edition.get("dataset_releases")
                    if not isinstance(mapping, list):
                        raise ValidationError("existing catalog edition mapping is invalid")
                    history.setdefault(f"{pid}/{edition_id}", self._mapping_identity(mapping))
        return history

    @staticmethod
    def _mapping_identity(mapping: list[dict[str, Any]]) -> dict[str, str]:
        identity: dict[str, str] = {}
        for pair in mapping:
            if not isinstance(pair, dict):
                raise ValidationError("edition mapping entry must be an object")
            _fields(pair, {"dataset_id", "release_id"}, set(), "edition mapping")
            dataset_id = _id(pair.get("dataset_id"), "dataset id")
            release_id = _id(pair.get("release_id"), "release id")
            if dataset_id in identity:
                raise ValidationError("edition dataset mapping must be unique")
            identity[dataset_id] = release_id
        if not identity:
            raise ValidationError("edition dataset mapping must not be empty")
        return identity

    def compile_catalog(self, config: dict[str, Any]) -> dict[str, Any]:
        """Compile curator configuration against the immutable publication inventory.

        ``config`` has the public catalog shape, except release ``manifest`` fields
        are omitted. No filesystem state is changed by this method.
        """
        if not isinstance(config, dict) or config.get("schema_version") != "1.0":
            raise ValidationError("catalog schema_version must be 1.0")
        _fields(
            config,
            {"schema_version", "default_project", "projects", "datasets"},
            set(),
            "catalog config",
        )
        projects = config.get("projects")
        datasets = config.get("datasets")
        if not isinstance(projects, list) or not isinstance(datasets, list):
            raise ValidationError("catalog requires projects and datasets")
        if "local" in {d.get("dataset_id") for d in datasets if isinstance(d, dict)}:
            raise ValidationError("reserved local dataset identity")
        by_id: dict[str, dict[str, Any]] = {}
        for raw in datasets:
            if not isinstance(raw, dict):
                raise ValidationError("dataset entry must be an object")
            _fields(
                raw,
                {"dataset_id", "title", "default_release", "releases"},
                {"description"},
                "dataset config",
            )
            dataset_id = _id(raw.get("dataset_id"), "dataset id")
            if dataset_id in by_id:
                raise ValidationError(f"duplicate dataset {dataset_id}")
            index = self.get_dataset(dataset_id)
            if index.get("archived"):
                raise ValidationError(f"dataset {dataset_id} is archived")
            releases = raw.get("releases")
            if not isinstance(releases, list) or not releases:
                raise ValidationError(f"dataset {dataset_id} requires releases")
            published = {r["release_id"] for r in index.get("releases", [])}
            out = {"dataset_id": dataset_id, "title": raw.get("title")}
            if not isinstance(out["title"], str) or not out["title"]:
                raise ValidationError(f"dataset {dataset_id} requires title")
            if "description" in raw:
                if not isinstance(raw["description"], str):
                    raise ValidationError("invalid dataset description")
                out["description"] = raw["description"]
            built: list[dict[str, Any]] = []
            seen: set[str] = set()
            for item in releases:
                if not isinstance(item, dict):
                    raise ValidationError("release entry must be an object")
                _fields(
                    item,
                    {"release_id", "label"},
                    {"status", "description"},
                    "release config",
                )
                rid = _id(item.get("release_id"), "release id")
                if rid in seen:
                    raise ValidationError(f"duplicate release {rid}")
                if rid not in published or not (self._dataset(dataset_id) / "releases" / rid).is_dir():
                    raise ValidationError(f"release {dataset_id}/{rid} is not published")
                label = item.get("label")
                if not isinstance(label, str) or not label or label == rid:
                    raise ValidationError(f"release {dataset_id}/{rid} requires a distinct label")
                descriptor = {"release_id": rid, "label": label, "manifest": self._manifest_resource(dataset_id, rid)}
                for field in ("status", "description"):
                    if field in item:
                        if field == "status" and item[field] not in ("legacy", "development"):
                            raise ValidationError("invalid release status")
                        if field == "description" and not isinstance(item[field], str):
                            raise ValidationError("invalid release description")
                        descriptor[field] = item[field]
                built.append(descriptor)
                seen.add(rid)
            default = raw.get("default_release")
            if default not in seen: raise ValidationError(f"dataset {dataset_id} default_release is missing")
            out["releases"] = built
            out["default_release"] = default
            by_id[dataset_id] = out

        project_ids: set[str] = set()
        built_projects: list[dict[str, Any]] = []
        history = self._edition_history()
        for raw in projects:
            if not isinstance(raw, dict):
                raise ValidationError("project entry must be an object")
            _fields(
                raw,
                {"project_id", "title", "dataset_ids", "default_dataset", "editions"},
                {"description", "default_edition"},
                "project config",
            )
            pid = _id(raw.get("project_id"), "project id")
            if pid == "local":
                raise ValidationError("reserved local project identity")
            if pid in project_ids:
                raise ValidationError(f"duplicate project {pid}")
            ids = raw.get("dataset_ids")
            if (
                not isinstance(ids, list)
                or not ids
                or any(not isinstance(dataset_id, str) for dataset_id in ids)
                or len(ids) != len(set(ids))
            ):
                raise ValidationError(f"invalid datasets for project {pid}")
            if any(dataset_id not in by_id for dataset_id in ids):
                raise ValidationError(f"project {pid} references missing dataset")
            if raw.get("default_dataset") not in ids:
                raise ValidationError(f"project {pid} default_dataset is missing")
            p = {"project_id": pid, "title": raw.get("title"), "dataset_ids": ids, "default_dataset": raw["default_dataset"], "editions": []}
            if not isinstance(p["title"], str) or not p["title"]:
                raise ValidationError(f"project {pid} requires title")
            if "description" in raw:
                if not isinstance(raw["description"], str):
                    raise ValidationError("invalid project description")
                p["description"] = raw["description"]
            editions = raw.get("editions", [])
            if not isinstance(editions, list):
                raise ValidationError("editions must be a list")
            eids: set[str] = set()
            for e in editions:
                if not isinstance(e, dict):
                    raise ValidationError("edition entry must be an object")
                _fields(
                    e,
                    {"edition_id", "label", "dataset_releases"},
                    {"description"},
                    "edition config",
                )
                eid = _id(e.get("edition_id"), "edition id")
                if eid in eids:
                    raise ValidationError(f"duplicate edition {eid}")
                pairs = e.get("dataset_releases")
                if not isinstance(pairs, list):
                    raise ValidationError(f"invalid edition scope {pid}/{eid}")
                mapping_identity = self._mapping_identity(pairs)
                mapping: list[dict[str, str]] = []
                for pair in pairs:
                    dataset_id = pair["dataset_id"]
                    release_id = pair["release_id"]
                    if dataset_id not in ids or release_id not in {
                        release["release_id"] for release in by_id[dataset_id]["releases"]
                    }:
                        raise ValidationError(f"edition {pid}/{eid} references missing release")
                    mapping.append({"dataset_id": dataset_id, "release_id": release_id})
                key = f"{pid}/{eid}"
                old = history.get(key)
                if old is not None and old != mapping_identity:
                    raise Conflict(f"edition identity cannot be remapped: {key}")
                item = {"edition_id": eid, "label": e.get("label"), "dataset_releases": mapping}
                if not isinstance(item["label"], str) or not item["label"]:
                    raise ValidationError(f"edition {key} requires label")
                if "description" in e:
                    if not isinstance(e["description"], str):
                        raise ValidationError("invalid edition description")
                    item["description"] = e["description"]
                p["editions"].append(item)
                eids.add(eid)
            if raw.get("default_edition") is not None and raw["default_edition"] not in eids:
                raise ValidationError(f"project {pid} default_edition is missing")
            if raw.get("default_edition") is not None:
                p["default_edition"] = raw["default_edition"]
            built_projects.append(p)
            project_ids.add(pid)
        if not built_projects or config.get("default_project") not in project_ids:
            raise ValidationError("default_project is missing")
        membership = [dataset_id for project in built_projects for dataset_id in project["dataset_ids"]]
        if len(membership) != len(by_id) or len(set(membership)) != len(membership):
            raise ValidationError("every dataset must belong to exactly one project")
        return {"schema_version": "1.0", "default_project": config["default_project"], "projects": built_projects, "datasets": [by_id[d["dataset_id"]] for d in datasets]}

    def promote_catalog(self, config: dict[str, Any], credential_id: str) -> dict[str, Any]:
        with self._lock:
            catalog = self.compile_catalog(config)
            history = self._edition_history()
            for project in catalog["projects"]:
                for edition in project["editions"]:
                    history[f'{project["project_id"]}/{edition["edition_id"]}'] = self._mapping_identity(
                        edition["dataset_releases"]
                    )
            # The exposed catalog is the recovery authority. If the history
            # write fails, the next promotion seeds the same identities from
            # this catalog instead of reserving identities that were unseen.
            atomic_json(self.public / "catalog.json", catalog)
            atomic_json(self.state / "edition-history.json", {"editions": history}, 0o600)
            self._audit(credential_id, "catalog.promote")
            return catalog

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
