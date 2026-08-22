"""Staged schema-v1 JSON and semantic contract validation.

The current release runtime remains on v0.1 until the atomic cutover. This
module is intentionally side-by-side only for contract development and parity
testing; it is not a compatibility adapter.
"""

from __future__ import annotations

import json
import math
from copy import deepcopy
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from .validate import FORMAT_CHECKER, ValidationError

SCHEMA_DIR = Path(__file__).resolve().parents[2] / "schema" / "v1"
_DTYPE_BYTES = {
    "uint8": 1,
    "int16": 2,
    "uint16": 2,
    "float16": 2,
    "int32": 4,
    "uint32": 4,
    "float32": 4,
    "float64": 8,
}
_PROJECTION_AXES = {"coronal": "ap", "sagittal": "ml", "horizontal": "dv"}
_STATIC_PATH_COUNTS = {"top": 114, "swanson": 808}


def load_schema_v1(schema_dir: Path = SCHEMA_DIR) -> tuple[Registry, dict[str, dict[str, Any]]]:
    registry = Registry()
    schemas: dict[str, dict[str, Any]] = {}
    for path in sorted(schema_dir.glob("*.schema.json")):
        schema = json.loads(path.read_text())
        schemas[path.name] = schema
        registry = registry.with_resource(schema["$id"], Resource.from_contents(schema))
    return registry, schemas


def _fail(message: str) -> None:
    raise ValidationError(f"schema v1: {message}")


def _resource_semantics(value: Any) -> None:
    if isinstance(value, list):
        for item in value:
            _resource_semantics(item)
        return
    if not isinstance(value, dict):
        return

    if {"path", "media_type", "bytes", "sha256", "codec"} <= value.keys():
        codec = value["codec"]
        if codec["name"] == "none":
            if codec["decoded_bytes"] != value["bytes"]:
                _fail(f"uncompressed resource {value['path']} has unequal encoded and decoded lengths")
            if "level" in codec:
                _fail(f"uncompressed resource {value['path']} cannot declare a compression level")

    if value.get("format") == "raw-binary-array-v1":
        dtype = value["dtype"]
        expected = math.prod(value["shape"]) * _DTYPE_BYTES[dtype]
        if value["resource"]["codec"]["decoded_bytes"] != expected:
            _fail(f"binary array {value['resource']['path']} decoded length does not match dtype and shape")
        expected_endianness = "not-applicable" if dtype == "uint8" else "little"
        if value["endianness"] != expected_endianness:
            _fail(f"binary dtype {dtype} requires {expected_endianness} endianness")

    for child in value.values():
        _resource_semantics(child)


def _unique(items: list[Any], description: str) -> None:
    normalized = [json.dumps(item, sort_keys=True) for item in items]
    if len(normalized) != len(set(normalized)):
        _fail(f"duplicate {description}")


def _summary_semantics(document: dict[str, Any]) -> None:
    total = document["total_voxel_count"]
    valid = document["valid_voxel_count"]
    if total != math.prod(document["grid_shape"]):
        _fail("volume summary total does not match the grid shape")
    if total != valid + document["outside_voxel_count"] + document["missing_voxel_count"]:
        _fail("volume summary counts are not mutually exhaustive")
    stats = document["valid_statistics"]
    if valid == 0 and any(value is not None for value in stats.values()):
        _fail("zero-valid-voxel summary statistics must all be null")
    if valid > 0 and any(value is None for value in stats.values()):
        _fail("nonempty valid-voxel summary statistics cannot be null")
    histogram = document.get("histogram")
    if histogram:
        if valid == 0:
            _fail("zero-valid-voxel summary cannot contain a histogram")
        if len(histogram["counts"]) != len(histogram["edges"]) - 1:
            _fail("volume histogram counts length does not match edges")
        if sum(histogram["counts"]) != valid:
            _fail("volume histogram counts do not sum to valid voxels")
        _increasing(histogram["edges"], "volume histogram edges")


def _increasing(values: list[float], description: str) -> None:
    if not all(math.isfinite(value) for value in values):
        _fail(f"{description} must be finite")
    if not all(left < right for left, right in zip(values, values[1:])):
        _fail(f"{description} must be strictly increasing")


def _derive_inverse(matrix: list[float]) -> list[float]:
    inverse = [0.0] * 16
    inverse[15] = 1.0
    for world_row in range(3):
        nonzero = [column for column in range(3) if matrix[world_row * 4 + column] != 0]
        if len(nonzero) != 1:
            _fail("affine spatial rows must each have exactly one nonzero term")
        index_column = nonzero[0]
        scale = matrix[world_row * 4 + index_column]
        translation = matrix[world_row * 4 + 3]
        inverse[index_column * 4 + world_row] = 1.0 / scale
        inverse[index_column * 4 + 3] = -translation / scale
    return inverse


def _close(left: float, right: float) -> bool:
    return math.isclose(left, right, rel_tol=1e-10, abs_tol=1e-9)


def _affine_semantics(
    matrix: list[float],
    shape: list[int],
    extent: list[float],
    inverse: list[float] | None,
) -> None:
    if not all(math.isfinite(value) for value in [*matrix, *extent]):
        _fail("affine and extent values must be finite")
    if matrix[12:] != [0, 0, 0, 1]:
        _fail("affine homogeneous row must be [0, 0, 0, 1]")
    for column in range(3):
        if sum(matrix[row * 4 + column] != 0 for row in range(3)) != 1:
            _fail("affine spatial columns must each have exactly one nonzero term")

    derived = _derive_inverse(matrix)
    if inverse is not None:
        if not all(math.isfinite(value) for value in inverse):
            _fail("inverse affine values must be finite")
        if not all(_close(actual, expected) for actual, expected in zip(inverse, derived)):
            _fail("declared inverse does not match the index-to-world affine")

    derived_extent: list[float] = []
    for world_row in range(3):
        index_column = next(column for column in range(3) if matrix[world_row * 4 + column] != 0)
        scale = matrix[world_row * 4 + index_column]
        translation = matrix[world_row * 4 + 3]
        edges = [translation + scale * -0.5, translation + scale * (shape[index_column] - 0.5)]
        derived_extent.extend([min(edges), max(edges)])
    if not all(_close(actual, expected) for actual, expected in zip(extent, derived_extent)):
        _fail("voxel-edge extent does not match affine and shape")


def _volume_semantics(document: dict[str, Any]) -> None:
    grid = document["grid"]
    _affine_semantics(
        grid["index_to_world_um"],
        grid["shape"],
        grid["voxel_edge_extent_um"],
        grid.get("world_to_index"),
    )
    validity = document["validity"]
    if validity["kind"] == "mask":
        mask = validity["mask"]
        if mask["dtype"] != "uint8" or mask["shape"] != grid["shape"]:
            _fail("validity mask must be uint8 with the volume grid shape")
        if len(set(validity["codes"].values())) != 3:
            _fail("validity mask codes must be distinct")


def _resource_index_semantics(document: dict[str, Any]) -> None:
    entries = document["chunks"] if document["layout"] == "chunks3d" else document["packs"]
    _unique([entry["resource"]["path"] for entry in entries], "volume resource path")
    for entry in entries:
        decoded = entry["decoded"]
        expected = math.prod(decoded["shape"]) * _DTYPE_BYTES[decoded["dtype"]]
        if entry["resource"]["codec"]["decoded_bytes"] != expected:
            _fail("volume resource decoded length does not match its decoded block")
    if document["layout"] == "chunks3d":
        _unique([entry["origin"] for entry in entries], "volume chunk origin")
        for entry in entries:
            if any(size > limit for size, limit in zip(entry["decoded"]["shape"], document["chunk_shape"])):
                _fail("decoded chunk shape exceeds declared chunk shape")
    else:
        axes = [entry["axis"] for entry in entries]
        if set(axes) != {"i0", "i1", "i2"}:
            _fail("orthogonal slice packs must cover i0, i1, and i2")
        _unique([[entry["axis"], entry["first_slice"]] for entry in entries], "slice-pack position")
        for entry in entries:
            if entry["decoded"]["storage_axes"][0] != entry["axis"]:
                _fail("slice-pack decoded leading axis must match its slice axis")
            if entry["decoded"]["shape"][0] != entry["slice_count"]:
                _fail("slice-pack decoded leading size must match slice_count")
            if entry["slice_count"] > document["pack_depth"]:
                _fail("slice-pack slice_count exceeds pack_depth")


def _statistics_semantics(document: dict[str, Any]) -> None:
    summary = document["regional_summary"]
    if len(summary["values"]["shape"]) != 2 or summary["values"]["shape"][1] != len(summary["fields"]):
        _fail("regional summary shape does not match fields")
    histogram = document.get("histogram")
    if histogram:
        _increasing(histogram["edges"], "regional histogram edges")
        bins = len(histogram["edges"]) - 1
        if len(histogram["global_counts"]) != bins:
            _fail("regional histogram counts length does not match edges")
        if sum(histogram["global_counts"]) != document["global"]["count"]:
            _fail("regional histogram counts do not sum to global count")
        shape = histogram["regional_counts"]["shape"]
        if len(shape) != 2 or shape[1] != bins:
            _fail("regional histogram binary shape does not match edges")


def _registered_semantics(document: dict[str, Any]) -> None:
    shape = [document["slice_count"], *document["slice_shape"]]
    matrix = document["plane_index_to_world_um"]
    _affine_semantics(matrix, shape, document["voxel_edge_extent_um"], document.get("world_to_plane_index"))
    expected_axis = _PROJECTION_AXES[document["id"]]
    if document["world_slice_axis"] != expected_axis:
        _fail(f"{document['id']} must slice the {expected_axis} world axis")
    world_row = {"ml": 0, "ap": 1, "dv": 2}[expected_axis]
    if matrix[world_row * 4] == 0:
        _fail("registered plane slice coordinate does not map to its declared world axis")
    slices = document["display_slices"]
    if slices != sorted(slices) or any(index >= document["slice_count"] for index in slices):
        _fail("registered display slices must be increasing and inside the native domain")


def _static_semantics(document: dict[str, Any]) -> None:
    if document["view_box"] != [60, 20, 340, 300]:
        _fail("static projection view box does not match pinned source evidence")
    if document["path_count"] != _STATIC_PATH_COUNTS[document["id"]]:
        _fail("static projection path count does not match pinned source evidence")
    resource = document["fragment"]["resource"]
    if resource["media_type"] != "image/svg+xml" or resource["codec"]["name"] != "gzip":
        _fail("static projection fragment must be gzip-compressed UTF-8 SVG")


def _projection_pack_semantics(document: dict[str, Any]) -> None:
    if set(document["mappings"]) != {"allen", "beryl", "cosmos"}:
        _fail("projection pack must declare the complete Allen/Beryl/Cosmos mappings")
    projections = document["projections"]
    ids = [projection["id"] for projection in projections]
    if set(ids) != {"coronal", "sagittal", "horizontal", "top", "swanson"} or len(set(ids)) != 5:
        _fail("projection pack must contain each projection exactly once")
    for projection in projections:
        if projection["kind"] == "registered-slice-stack":
            if projection["reference_space_id"] != document["reference_space_id"]:
                _fail("registered projection reference space differs from its pack")
            _registered_semantics(projection)
        else:
            _static_semantics(projection)


def _document_semantics(document: dict[str, Any], schema_name: str) -> None:
    _resource_semantics(document)
    if schema_name == "catalog.schema.json":
        _unique([item["dataset_id"] for item in document["datasets"]], "catalog dataset id")
        for dataset in document["datasets"]:
            release_ids = [item["release_id"] for item in dataset["releases"]]
            _unique(release_ids, "catalog release id")
            if dataset.get("default_release") not in (None, *release_ids):
                _fail("catalog default release is not present in releases")
    elif schema_name == "dataset.schema.json":
        _unique([item["id"] for item in document["parcellations"]], "parcellation id")
        _unique([item["id"] for item in document["features"]], "feature id")
        _unique([item["descriptor"]["resource"]["path"] for item in document["features"]], "feature descriptor path")
        _unique([item["id"] for item in document["artifacts"]], "artifact id")
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
        regional = document["representations"].get("regional")
        volume = document["representations"].get("volume")
        if regional:
            _document_semantics(regional, "regional.schema.json")
        if volume:
            _document_semantics(volume, "volume.schema.json")
    elif schema_name == "registered-projection.schema.json":
        _registered_semantics(document)
    elif schema_name == "static-projection.schema.json":
        _static_semantics(document)
    elif schema_name == "projection-pack.schema.json":
        _projection_pack_semantics(document)


def validate_schema_v1_document(
    document: dict[str, Any],
    schema_name: str,
    schema_dir: Path = SCHEMA_DIR,
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
