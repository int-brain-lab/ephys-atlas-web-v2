"""Curator catalog compilation and local catalog/history promotion."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .errors import Conflict, NotFound, ValidationError, _fields, _id
from .storage import atomic_json, load_json, sha256_file


class CatalogManager:
    """Compile and promote the public catalog from immutable local releases."""

    def __init__(self, public_root: Path, state_root: Path):
        self.public = public_root
        self.state = state_root

    def _dataset(self, dataset_id: str) -> Path:
        return self.public / "datasets" / _id(dataset_id, "dataset id")

    def get_dataset(self, dataset_id: str) -> dict[str, Any]:
        path = self._dataset(dataset_id) / "index.json"
        if not path.exists():
            raise NotFound("dataset not found")
        return load_json(path)

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

    def promote(self, config: dict[str, Any]) -> dict[str, Any]:
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
        return catalog
