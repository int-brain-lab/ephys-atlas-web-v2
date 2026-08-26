from __future__ import annotations

import gzip
import json
import math
import re
from datetime import date
from itertools import product
from pathlib import Path
from typing import Any

import numpy as np
from jsonschema import FormatChecker

from .io import DTYPES, sha256_file


class ValidationError(RuntimeError):
    pass


_RFC3339_DATE_TIME = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d"
    r"(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$"
)
FORMAT_CHECKER = FormatChecker()


@FORMAT_CHECKER.checks("date-time")
def _is_rfc3339_date_time(value: object) -> bool:
    if not isinstance(value, str):
        return True
    match = _RFC3339_DATE_TIME.fullmatch(value)
    if match is None:
        return False
    try:
        date(*(int(part) for part in match.groups()))
    except ValueError:
        return False
    return True


def _load_json(path: Path, description: str) -> Any:
    if not path.is_file():
        raise ValidationError(f"missing {description}: {path}")
    try:
        return json.loads(path.read_text())
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValidationError(f"invalid {description}: {path}: {exc}") from exc


def _unique(values: list[Any], description: str) -> None:
    normalized = [json.dumps(value, sort_keys=True) for value in values]
    if len(normalized) != len(set(normalized)):
        raise ValidationError(f"duplicate {description}")


def _resource_path(root: Path, resource: dict[str, Any]) -> Path:
    path = (root / resource["path"]).resolve()
    try:
        path.relative_to(root.resolve())
    except ValueError as exc:
        raise ValidationError(f"resource escapes release root: {resource['path']}") from exc
    return path


def _check_resource(root: Path, resource: dict[str, Any]) -> Path:
    path = _resource_path(root, resource)
    if not path.is_file():
        raise ValidationError(f"missing resource: {path}")
    size = path.stat().st_size
    if size != resource["bytes"]:
        raise ValidationError(f"declared resource byte size mismatch for {path}")
    if sha256_file(path) != resource["sha256"]:
        raise ValidationError(f"resource sha256 mismatch for {path}")
    codec = resource["codec"]
    if codec["name"] == "none":
        decoded_size = size
    elif codec["name"] == "gzip":
        try:
            with gzip.open(path, "rb") as stream:
                decoded_size = len(stream.read())
        except (OSError, EOFError) as exc:
            raise ValidationError(f"invalid gzip resource: {path}: {exc}") from exc
    else:
        raise ValidationError(f"unsupported resource codec: {codec['name']}")
    if decoded_size != codec["decoded_bytes"]:
        raise ValidationError(f"decoded resource byte size mismatch for {path}")
    return path


def _check_json_resource(
    root: Path,
    descriptor: dict[str, Any],
    description: str,
) -> tuple[Path, Any]:
    path = _check_resource(root, descriptor["resource"])
    return path, _load_json(path, description)


def _check_binary(root: Path, descriptor: dict[str, Any]) -> Path:
    path = _check_resource(root, descriptor["resource"])
    expected = math.prod(descriptor["shape"]) * DTYPES[descriptor["dtype"]].itemsize
    if descriptor["resource"]["codec"]["decoded_bytes"] != expected:
        raise ValidationError(f"binary decoded byte size mismatch for {path}")
    return path


def _read_binary(root: Path, descriptor: dict[str, Any]) -> np.ndarray:
    path = _check_binary(root, descriptor)
    codec = descriptor["resource"]["codec"]["name"]
    raw = path.read_bytes() if codec == "none" else gzip.decompress(path.read_bytes())
    return np.frombuffer(raw, dtype=DTYPES[descriptor["dtype"]]).reshape(
        descriptor["shape"]
    )


def _check_region_table(release_dir: Path, parcellation: dict[str, Any]) -> int:
    descriptor = parcellation["region_index"]
    if len(descriptor["shape"]) != 1 or not descriptor["dtype"].startswith(
        ("int", "uint")
    ):
        raise ValidationError(
            f"parcellation {parcellation['id']} region index must be one-dimensional integers"
        )
    region_ids = _read_binary(release_dir, descriptor)
    _, metadata = _check_json_resource(
        release_dir, parcellation["metadata"], "parcellation metadata"
    )
    if not isinstance(metadata, list) or len(metadata) != len(region_ids):
        raise ValidationError(
            f"parcellation {parcellation['id']} metadata does not match region index"
        )
    atlas_ids: list[int] = []
    for position, region in enumerate(metadata):
        if (
            not isinstance(region, dict)
            or type(region.get("index")) is not int
            or region["index"] != position
        ):
            raise ValidationError(
                f"parcellation {parcellation['id']} metadata index mismatch at row {position}"
            )
        atlas_id = region.get("atlas_id")
        if type(atlas_id) is not int or atlas_id != int(region_ids[position]):
            raise ValidationError(
                f"parcellation {parcellation['id']} atlas_id mismatch at row {position}"
            )
        atlas_ids.append(atlas_id)
    _unique(atlas_ids, f"atlas id in {parcellation['id']}")
    return len(region_ids)


def _check_statistics(
    feature_root: Path,
    descriptor: dict[str, Any],
    region_count: int,
) -> dict[str, Any]:
    from .schema_v1 import validate_schema_v1_document

    path, statistics = _check_json_resource(
        feature_root, descriptor, "regional statistics"
    )
    validate_schema_v1_document(statistics, "statistics.schema.json")
    summary = statistics["regional_summary"]
    _check_binary(path.parent, summary["values"])
    if summary["values"]["shape"] != [region_count, len(summary["fields"])]:
        raise ValidationError(
            f"regional summary shape does not match parcellation: {path}"
        )
    histogram = statistics.get("histogram")
    if histogram:
        variants = [("linear", histogram), *histogram.get("variants", {}).items()]
        for axis_scale, variant in variants:
            counts = variant["regional_counts"]
            _check_binary(path.parent, counts)
            if counts["shape"] != [region_count, len(variant["edges"]) - 1]:
                raise ValidationError(
                    f"regional {axis_scale} histogram shape does not match parcellation: {path}"
                )
    return statistics


def _check_volume(feature_root: Path, volume: dict[str, Any]) -> None:
    from .schema_v1 import validate_schema_v1_document

    summary_path, summary = _check_json_resource(
        feature_root, volume["summary"], "volume summary"
    )
    validate_schema_v1_document(summary, "volume-summary.schema.json")
    grid = volume["grid"]
    if summary["grid_id"] != grid["grid_id"] or summary["grid_shape"] != grid["shape"]:
        raise ValidationError(
            f"volume summary grid does not match feature descriptor: {summary_path}"
        )

    index_path, index = _check_json_resource(
        feature_root,
        volume["encoding"]["resource_index"],
        "volume resource index",
    )
    validate_schema_v1_document(index, "volume-resource-index.schema.json")
    if (
        index["grid_id"] != grid["grid_id"]
        or index["layout"] != volume["encoding"]["layout"]
    ):
        raise ValidationError(
            f"volume resource index does not match feature descriptor: {index_path}"
        )
    entries = index["chunks"] if index["layout"] == "chunks3d" else index["packs"]
    for entry in entries:
        _check_resource(feature_root, entry["resource"])
        if entry["decoded"]["dtype"] != volume["array"]["dtype"]:
            raise ValidationError("volume resource dtype differs from feature descriptor")

    shape = grid["shape"]
    if index["layout"] == "chunks3d":
        chunk_shape = index["chunk_shape"]
        expected_origins = {
            origin
            for origin in product(
                *(range(0, shape[dimension], chunk_shape[dimension]) for dimension in range(3))
            )
        }
        by_origin = {tuple(entry["origin"]): entry for entry in entries}
        if set(by_origin) != expected_origins:
            raise ValidationError("volume chunks do not cover the grid exactly")
        for origin, entry in by_origin.items():
            raw_shape = [
                min(chunk_shape[dimension], shape[dimension] - origin[dimension])
                for dimension in range(3)
            ]
            expected_shape = [
                raw_shape[int(axis[1])] for axis in entry["decoded"]["storage_axes"]
            ]
            if entry["decoded"]["shape"] != expected_shape:
                raise ValidationError("volume chunk decoded shape is inconsistent")
    else:
        pack_depth = index["pack_depth"]
        for dimension in range(3):
            axis = f"i{dimension}"
            expected_starts = set(range(0, shape[dimension], pack_depth))
            axis_entries = {
                entry["first_slice"]: entry
                for entry in entries
                if entry["axis"] == axis
            }
            if set(axis_entries) != expected_starts:
                raise ValidationError(f"volume slice packs do not cover {axis} exactly")
            for first_slice, entry in axis_entries.items():
                expected_count = min(pack_depth, shape[dimension] - first_slice)
                decoded = entry["decoded"]
                expected_shape = [
                    expected_count if storage_axis == axis else shape[int(storage_axis[1])]
                    for storage_axis in decoded["storage_axes"]
                ]
                if (
                    entry["slice_count"] != expected_count
                    or decoded["storage_axes"][0] != axis
                    or decoded["shape"] != expected_shape
                ):
                    raise ValidationError(f"volume {axis} slice pack is inconsistent")

    validity = volume["validity"]
    if validity["kind"] == "mask":
        _check_binary(feature_root, validity["mask"])


def validate_release(release_dir: Path, schema_dir: Path) -> None:
    from .schema_v1 import validate_schema_v1_document

    release_dir = release_dir.resolve()
    expected_schema_dir = Path(__file__).resolve().parents[2] / "schema" / "v1"
    if schema_dir.resolve() != expected_schema_dir.resolve():
        raise ValidationError(
            f"schema v1 is the only supported release contract: {schema_dir}"
        )

    manifest = _load_json(release_dir / "manifest.json", "release manifest")
    validate_schema_v1_document(manifest, "dataset.schema.json", schema_dir)

    parcellations = manifest["parcellations"]
    region_counts = {
        item["id"]: _check_region_table(release_dir, item)
        for item in parcellations
    }
    for artifact in manifest["artifacts"]:
        _check_resource(release_dir, artifact["resource"])

    for feature_ref in manifest["features"]:
        feature_path, feature = _check_json_resource(
            release_dir, feature_ref["descriptor"], "feature descriptor"
        )
        validate_schema_v1_document(feature, "feature.schema.json", schema_dir)
        if feature["id"] != feature_ref["id"]:
            raise ValidationError(f"feature id mismatch: {feature_path}")
        feature_root = feature_path.parent

        regional = feature["representations"].get("regional")
        if regional:
            for item in regional["parcellations"]:
                parcellation_id = item["parcellation_id"]
                if parcellation_id not in region_counts:
                    raise ValidationError(
                        f"feature {feature['id']} references unknown parcellation {parcellation_id}"
                    )
                _check_binary(feature_root, item["values"])
                if item["values"]["shape"] != [region_counts[parcellation_id]]:
                    raise ValidationError(
                        f"regional values shape does not match {parcellation_id}: {feature_path}"
                    )
                statistics = _check_statistics(
                    feature_root,
                    item["statistics"],
                    region_counts[parcellation_id],
                )
                if item["summary"] not in statistics["regional_summary"]["fields"]:
                    raise ValidationError(
                        f"regional summary {item['summary']} is not declared by statistics"
                    )

        volume = feature["representations"].get("volume")
        if volume:
            _check_volume(feature_root, volume)
        for artifact in feature["artifacts"]:
            _check_resource(feature_root, artifact["resource"])
