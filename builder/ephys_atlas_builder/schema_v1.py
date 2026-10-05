"""Active schema-v1 JSON and semantic contract validation.

The builder, publisher, and browser share this contract and its parity corpus.
It is the sole release schema, not a compatibility adapter.
"""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from .validate import FORMAT_CHECKER, ValidationError
from ._schema_v1_common import _fail, _resource_semantics, _unique
from ._schema_v1_distributions import _display_semantics, _statistics_semantics, _summary_semantics
from ._schema_v1_volume import _resource_index_semantics, _volume_semantics
from ._schema_v1_projections import (
    _projection_pack_semantics,
    _registered_resource_index_semantics,
    _registered_semantics,
    _static_semantics,
)
from ._schema_v1_mesh import _mesh_pack_semantics

SCHEMA_DIR = Path(__file__).resolve().parents[1] / "ibl_ephys_atlas" / "_schema" / "v1"


def _schema_inventory(schema_dir: Path) -> dict[str, str]:
    if not schema_dir.is_dir():
        return {}
    return {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(schema_dir.iterdir())
        if path.is_file()
    }


def resolve_schema_v1_directory(schema_dir: Path | None = None) -> Path:
    """Resolve only the bundled schema-v1 contract or an exact byte copy."""
    resolved = (schema_dir or SCHEMA_DIR).resolve()
    bundled = SCHEMA_DIR.resolve()
    expected = _schema_inventory(bundled)
    if not expected or (resolved != bundled and _schema_inventory(resolved) != expected):
        raise ValidationError(
            f"schema v1 is the only supported release contract: {resolved}"
        )
    return resolved


def load_schema_v1(
    schema_dir: Path | None = None,
) -> tuple[Registry, dict[str, dict[str, Any]]]:
    schema_dir = resolve_schema_v1_directory(schema_dir)
    registry = Registry()
    schemas: dict[str, dict[str, Any]] = {}
    for path in sorted(schema_dir.glob("*.schema.json")):
        schema = json.loads(path.read_text())
        schemas[path.name] = schema
        registry = registry.with_resource(schema["$id"], Resource.from_contents(schema))
    return registry, schemas


def _document_semantics(document: dict[str, Any], schema_name: str) -> None:
    _resource_semantics(document)
    if schema_name == "catalog.schema.json":
        datasets = document["datasets"]
        _unique([item["dataset_id"] for item in datasets], "catalog dataset id")
        dataset_by_id = {item["dataset_id"]: item for item in datasets}
        if "local" in dataset_by_id:
            _fail("reserved local dataset id cannot be published")
        for dataset in datasets:
            release_ids = [item["release_id"] for item in dataset["releases"]]
            _unique(release_ids, "catalog release id")
            if dataset["default_release"] not in release_ids:
                _fail("catalog default release is not present in releases")
            for release in dataset["releases"]:
                if release["label"] == release["release_id"]:
                    _fail("catalog release label must differ from immutable release id")

        projects = document["projects"]
        _unique([project["project_id"] for project in projects], "catalog project id")
        project_by_id = {project["project_id"]: project for project in projects}
        if "local" in project_by_id:
            _fail("reserved local project id cannot be published")
        if document["default_project"] not in project_by_id:
            _fail("catalog default project is not present in projects")
        memberships: dict[str, list[str]] = {dataset_id: [] for dataset_id in dataset_by_id}
        for project in projects:
            project_id = project["project_id"]
            for dataset_id in project["dataset_ids"]:
                if dataset_id not in dataset_by_id:
                    _fail(f"catalog project {project_id} references unknown dataset {dataset_id}")
                memberships[dataset_id].append(project_id)
            if project["default_dataset"] not in project["dataset_ids"]:
                _fail(f"catalog project {project_id} default dataset is outside project")
            editions = project["editions"]
            _unique([edition["edition_id"] for edition in editions], "catalog edition id")
            edition_ids = {edition["edition_id"] for edition in editions}
            if project.get("default_edition") is not None and project["default_edition"] not in edition_ids:
                _fail(f"catalog project {project_id} default edition is not present")
            project_dataset_ids = set(project["dataset_ids"])
            for edition in editions:
                mapped_ids = [mapping["dataset_id"] for mapping in edition["dataset_releases"]]
                _unique(mapped_ids, "catalog edition dataset mapping")
                for mapping in edition["dataset_releases"]:
                    dataset_id = mapping["dataset_id"]
                    if dataset_id not in project_dataset_ids:
                        _fail(f"catalog edition {edition['edition_id']} references dataset outside project")
                    release_ids = {release["release_id"] for release in dataset_by_id[dataset_id]["releases"]}
                    if mapping["release_id"] not in release_ids:
                        _fail(f"catalog edition {edition['edition_id']} references unknown release")
        for dataset_id, owners in memberships.items():
            if len(owners) != 1:
                _fail(f"catalog dataset {dataset_id} must belong to exactly one project")
    elif schema_name == "dataset.schema.json":
        _unique([item["id"] for item in document["parcellations"]], "parcellation id")
        _unique([item["id"] for item in document["features"]], "feature id")
        _unique([item["descriptor"]["resource"]["path"] for item in document["features"]], "feature descriptor path")
        _unique([item["id"] for item in document["artifacts"]], "artifact id")
        bundle = document.get("metadata_bundle")
        if bundle and (
            bundle["path"] != "metadata-bundle.json.gz"
            or bundle["media_type"] != "application/json"
            or bundle["codec"]["name"] != "gzip"
            or bundle["bytes"] > 64 * 1024 * 1024
            or bundle["codec"]["decoded_bytes"] > 64 * 1024 * 1024
        ):
            _fail("dataset metadata bundle encoding is invalid")
    elif schema_name == "metadata-bundle.schema.json":
        _unique([item["path"] for item in document["resources"]], "metadata bundle path")
        for item in document["resources"]:
            try:
                json.loads(item["text"])
            except json.JSONDecodeError:
                _fail(f"metadata bundle text is not valid JSON: {item['path']}")
    elif schema_name == "regional.schema.json":
        _unique([item["parcellation_id"] for item in document["parcellations"]], "regional parcellation id")
    elif schema_name == "statistics.schema.json":
        _statistics_semantics(document)
    elif schema_name == "volume-summary.schema.json":
        _summary_semantics(document)
    elif schema_name == "volume-resource-index.schema.json":
        _resource_index_semantics(document)
    elif schema_name == "volume.schema.json":
        _volume_semantics(document)
    elif schema_name == "feature.schema.json":
        _display_semantics(document)
        regional = document["representations"].get("regional")
        volume = document["representations"].get("volume")
        if regional:
            _document_semantics(regional, "regional.schema.json")
        if volume:
            _document_semantics(volume, "volume.schema.json")
    elif schema_name == "registered-projection.schema.json":
        _registered_semantics(document)
    elif schema_name == "registered-svg-resource-index.schema.json":
        _registered_resource_index_semantics(document)
    elif schema_name == "static-projection.schema.json":
        _static_semantics(document)
    elif schema_name == "projection-pack.schema.json":
        _projection_pack_semantics(document)
    elif schema_name == "mesh-pack.schema.json":
        _mesh_pack_semantics(document)


def validate_schema_v1_document(
    document: dict[str, Any],
    schema_name: str,
    schema_dir: Path | None = None,
) -> None:
    registry, schemas = load_schema_v1(schema_dir)
    if schema_name not in schemas:
        _fail(f"unknown schema {schema_name}")
    validator = Draft202012Validator(
        schemas[schema_name], registry=registry, format_checker=FORMAT_CHECKER
    )
    errors = sorted(validator.iter_errors(document), key=lambda error: list(error.absolute_path))
    if errors:
        error = errors[0]
        location = "/".join(map(str, error.absolute_path))
        _fail(f"{schema_name} at {location or '<root>'}: {error.message}")
    _document_semantics(deepcopy(document), schema_name)
