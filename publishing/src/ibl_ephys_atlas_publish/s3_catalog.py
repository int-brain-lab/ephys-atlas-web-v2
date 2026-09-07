"""Curator-only catalog promotion with atomic generation/history identity."""
from __future__ import annotations

from copy import deepcopy
import hashlib
from pathlib import Path
import re
import tempfile
import uuid

from .client import file_info
from .core import PublicationStore, ValidationError, atomic_json
from .s3 import (Destination, ObjectStore, IMMUTABLE_CACHE, MUTABLE_CACHE,
                 _create_verified, _verify_head, json_bytes)


def compile_catalog(config: dict, releases: list[tuple[Path, dict]], *,
                    indexes: dict | None = None, history: dict | None = None,
                    previous: dict | None = None) -> tuple[dict, dict]:
    """Use the same compiler as the filesystem publisher, not a second schema.

    Inputs are private, fully validated snapshots held alive by the caller.
    Only this temporary compiler view uses symlinks; no links are uploaded.
    """
    with tempfile.TemporaryDirectory(prefix="atlas-catalog-compile-") as temporary:
        store = PublicationStore(temporary)
        for root, plan in releases:
            dataset, release = plan["dataset_id"], plan["release_id"]
            directory = store.public / "datasets" / dataset
            (directory / "releases").mkdir(parents=True, exist_ok=True)
            (directory / "releases" / release).symlink_to(root.resolve(), target_is_directory=True)
            index_path = directory / "index.json"
            if indexes is not None:
                if dataset not in indexes:
                    raise ValidationError(f"dataset is not published: {dataset}")
                index = indexes[dataset]
            else:
                index = store.get_dataset(dataset) if index_path.exists() else {
                    "dataset_id": dataset, "metadata": {}, "archived": False, "aliases": {}, "releases": [],
                }
                index["releases"].append({"release_id": release})
            atomic_json(index_path, index)
        atomic_json(store.state / "edition-history.json", {"editions": history or {}})
        if previous is not None:
            atomic_json(store.public / "catalog.json", previous)
        catalog = store.compile_catalog(config)
        updated = store._edition_history()
        for project in catalog["projects"]:
            for edition in project["editions"]:
                updated[f'{project["project_id"]}/{edition["edition_id"]}'] = store._mapping_identity(edition["dataset_releases"])
        return catalog, updated


def promote_catalog(config: dict, releases: list[tuple[Path, dict]], destination: Destination,
                    store: ObjectStore, validate_catalog) -> dict:
    """Verify published dependencies, write immutable history, CAS catalog last.

    Every promotion gets a fresh public publication_id. It prevents an ABA
    race when the curator restores an older catalog's scientific contents.
    Omitted editions remain in the private history linked by that exact ID.
    """
    current = store.get_json(destination.key("catalog.json"))
    previous, etag = current if current is not None else (None, None)
    history = {}
    if previous is not None:
        validate_catalog(previous)
        generation = previous.get("publication_id", "")
        if not isinstance(generation, str) or not re.fullmatch("[0-9a-f]{32}", generation):
            raise ValidationError("existing catalog lacks publication history; explicit migration required")
        record = store.get_json(destination.key(f"_staging/catalog-history/{generation}.json"))
        if record is None or record[0].get("catalog_sha256") != hashlib.sha256(json_bytes(previous)).hexdigest():
            raise ValidationError("catalog history is absent or does not match the public generation")
        history = record[0].get("editions")
        if not isinstance(history, dict):
            raise ValidationError("invalid catalog edition history")
    indexes = {}
    for root, plan in releases:
        dataset, release = plan["dataset_id"], plan["release_id"]
        if plan["root"] != destination.root:
            raise ValidationError("release plan belongs to another environment")
        if dataset not in indexes:
            index = store.get_json(destination.key(f"datasets/{dataset}/index.json"))
            if index is None or index[0].get("dataset_id") != dataset:
                raise ValidationError(f"dataset is not published: {dataset}")
            indexes[dataset] = index[0]
        prefix = f"datasets/{dataset}/releases/{release}/"
        publication = store.get_json(destination.key(prefix + "_publication.json"))
        expected = {"dataset_id": dataset, "release_id": release,
                    "transaction_id": plan["transaction_id"], "artifacts": plan["artifacts"]}
        if publication is None or publication[0] != expected:
            raise ValidationError(f"release is incomplete or differs from local snapshot: {dataset}/{release}")
        for artifact in plan["artifacts"]:
            if file_info(root / artifact["path"]) != {k: artifact[k] for k in ("size", "sha256")}:
                raise ValidationError("local release changed during catalog promotion")
            key = destination.key(prefix + artifact["path"])
            head = store.head(key)
            if head is None:
                raise ValidationError(f"published dependency is absent: {key}")
            _verify_head(head, artifact, IMMUTABLE_CACHE, key)
    catalog, updated_history = compile_catalog(config, releases, indexes=indexes, history=history, previous=previous)
    catalog["publication_id"] = uuid.uuid4().hex
    validate_catalog(catalog)
    record = {"catalog_sha256": hashlib.sha256(json_bytes(catalog)).hexdigest(),
              "editions": deepcopy(updated_history)}
    with tempfile.TemporaryDirectory(prefix="atlas-catalog-promote-") as temporary:
        path = Path(temporary) / "document.json"
        path.write_bytes(json_bytes(record))
        _create_verified(store, destination.key(f"_staging/catalog-history/{catalog['publication_id']}.json"),
                         path, {**file_info(path), "content_type": "application/json"}, IMMUTABLE_CACHE)
        path.write_bytes(json_bytes(catalog))
        store.put(destination.key("catalog.json"), path, sha256=file_info(path)["sha256"],
                  content_type="application/json", cache_control=MUTABLE_CACHE, expected_etag=etag)
    return catalog
