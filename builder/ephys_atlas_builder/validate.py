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
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

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


def _schema_registry(schema_dir: Path) -> tuple[Registry, dict[str, dict]]:
    schemas = {}
    registry = Registry()
    for path in sorted(schema_dir.glob("*.schema.json")):
        schema = json.loads(path.read_text())
        schemas[path.name] = schema
        registry = registry.with_resource(schema["$id"], Resource.from_contents(schema))
    return registry, schemas


def _validate_json(instance: Any, schema_name: str, schemas: dict[str, dict], registry: Registry) -> None:
    validator = Draft202012Validator(
        schemas[schema_name], registry=registry, format_checker=FORMAT_CHECKER
    )
    errors = sorted(validator.iter_errors(instance), key=lambda error: list(error.absolute_path))
    if errors:
        lines = [f"{schema_name}: {'.'.join(map(str, error.absolute_path))}: {error.message}" for error in errors]
        raise ValidationError("\n".join(lines))


def _load_json(path: Path, description: str) -> Any:
    if not path.is_file():
        raise ValidationError(f"missing {description}: {path}")
    try:
        return json.loads(path.read_text())
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValidationError(f"invalid {description}: {path}: {exc}") from exc


def _unique(values: list[str], description: str) -> None:
    seen: set[str] = set()
    for value in values:
        if value in seen:
            raise ValidationError(f"duplicate {description}: {value}")
        seen.add(value)


def _check_binary(root: Path, meta: dict) -> Path:
    path = root / meta["path"]
    if not path.is_file():
        raise ValidationError(f"missing binary payload: {path}")
    expected = math.prod(meta["shape"]) * DTYPES[meta["dtype"]].itemsize
    if path.stat().st_size != expected:
        raise ValidationError(f"wrong byte size for {path}: {path.stat().st_size} != {expected}")
    if meta.get("bytes") is not None and path.stat().st_size != meta["bytes"]:
        raise ValidationError(f"declared byte size mismatch for {path}")
    if meta.get("sha256") and sha256_file(path) != meta["sha256"]:
        raise ValidationError(f"sha256 mismatch for {path}")
    return path


def _read_binary(root: Path, meta: dict) -> np.ndarray:
    path = _check_binary(root, meta)
    return np.fromfile(path, dtype=DTYPES[meta["dtype"]]).reshape(meta["shape"])


def _check_artifact(root: Path, artifact: dict) -> None:
    path = root / artifact["path"]
    if not path.is_file():
        raise ValidationError(f"missing artifact: {path}")
    if path.stat().st_size != artifact["bytes"]:
        raise ValidationError(f"declared artifact byte size mismatch for {path}")
    if sha256_file(path) != artifact["sha256"]:
        raise ValidationError(f"artifact sha256 mismatch for {path}")


def _decoded_size(path: Path, codec: str, description: str) -> int:
    if not path.is_file():
        raise ValidationError(f"missing {description}: {path}")
    if codec == "none":
        return path.stat().st_size
    if codec == "gzip":
        try:
            with gzip.open(path, "rb") as stream:
                return len(stream.read())
        except (OSError, EOFError) as exc:
            raise ValidationError(f"invalid gzip {description}: {path}: {exc}") from exc
    raise ValidationError(f"unsupported volume codec: {codec}")


def _format_resource_path(root: Path, template: str, description: str, **values: int) -> Path:
    try:
        rendered = template.format(**values)
    except (KeyError, IndexError, ValueError) as exc:
        raise ValidationError(f"invalid {description} path template: {template}: {exc}") from exc
    return root / rendered


def _check_distinct_paths(paths: list[Path], description: str) -> None:
    normalized = [path.resolve() for path in paths]
    if len(normalized) != len(set(normalized)):
        raise ValidationError(f"{description} path template does not produce unique paths")


def _check_geometry_numbers(grid: dict) -> None:
    matrix = grid["index_to_world_um"]
    values = [*matrix, *grid["origin_um"], *grid["voxel_size_um"]]
    if not all(math.isfinite(value) for value in values):
        raise ValidationError("volume grid geometry must contain only finite numbers")


def _check_volume(root: Path, meta: dict) -> None:
    shape = meta["grid"]["shape"]
    axis_order = [name.casefold() for name in meta["grid"]["axis_order"]]
    if len(set(axis_order)) != 3 or set(axis_order) != {"ap", "ml", "dv"}:
        raise ValidationError("volume axis_order must contain unique ap, ml, and dv axes")
    _check_geometry_numbers(meta["grid"])
    dtype = DTYPES[meta["array"]["dtype"]]
    paths: list[Path] = []

    if meta["layout"] == "chunks3d":
        chunks = meta["chunks"]
        chunk_shape = chunks["shape"]
        nchunks = [(shape[d] + chunk_shape[d] - 1) // chunk_shape[d] for d in range(3)]
        for i0, i1, i2 in product(*(range(count) for count in nchunks)):
            path = _format_resource_path(
                root, chunks["path_template"], "volume chunk", i0=i0, i1=i1, i2=i2
            )
            paths.append(path)
            starts = [i0 * chunk_shape[0], i1 * chunk_shape[1], i2 * chunk_shape[2]]
            actual_shape = [min(chunk_shape[d], shape[d] - starts[d]) for d in range(3)]
            expected = dtype.itemsize * math.prod(actual_shape)
            actual = _decoded_size(path, chunks["codec"]["name"], "volume chunk")
            if actual != expected:
                raise ValidationError(f"wrong decoded chunk size for {path}: {actual} != {expected}")
    elif meta["layout"] == "orthogonal_slice_packs":
        slice_packs = meta["slice_packs"]
        pack_depth = slice_packs["pack_depth"]
        axis_dimension = {
            "coronal": axis_order.index("ap"),
            "sagittal": axis_order.index("ml"),
            "horizontal": axis_order.index("dv"),
        }
        for axis, dimension in axis_dimension.items():
            descriptor = slice_packs["axes"][axis]
            expected_slice_shape = [shape[index] for index in range(3) if index != dimension]
            if descriptor["slice_shape"] != expected_slice_shape:
                raise ValidationError(
                    f"volume {axis} slice_shape {descriptor['slice_shape']} != {expected_slice_shape}"
                )
            pack_count = (shape[dimension] + pack_depth - 1) // pack_depth
            for pack in range(pack_count):
                path = _format_resource_path(root, descriptor["path_template"], f"{axis} slice pack", pack=pack)
                paths.append(path)
                slices = min(pack_depth, shape[dimension] - pack * pack_depth)
                expected = dtype.itemsize * slices * math.prod(expected_slice_shape)
                actual = _decoded_size(path, descriptor["codec"]["name"], f"{axis} slice pack")
                if actual != expected:
                    raise ValidationError(f"wrong decoded slice pack size for {path}: {actual} != {expected}")
    else:
        raise ValidationError(f"unsupported volume layout: {meta['layout']}")
    _check_distinct_paths(paths, "volume resource")


def _check_region_table(release_dir: Path, parcellation: dict) -> int:
    descriptor = parcellation["region_index"]
    if len(descriptor["shape"]) != 1:
        raise ValidationError(f"parcellation {parcellation['id']} region_index must be one-dimensional")
    if not descriptor["dtype"].startswith(("int", "uint")):
        raise ValidationError(f"parcellation {parcellation['id']} region_index must use an integer dtype")
    region_ids = _read_binary(release_dir, descriptor)
    metadata_ref = parcellation.get("metadata")
    if not metadata_ref:
        raise ValidationError(f"parcellation {parcellation['id']} must declare metadata")
    metadata_path = release_dir / metadata_ref
    metadata = _load_json(metadata_path, "parcellation metadata")
    if not isinstance(metadata, list):
        raise ValidationError(f"parcellation metadata must be an array: {metadata_path}")
    if len(metadata) != len(region_ids):
        raise ValidationError(
            f"parcellation {parcellation['id']} metadata length {len(metadata)} "
            f"!= region index length {len(region_ids)}"
        )
    atlas_ids: list[int] = []
    for position, region in enumerate(metadata):
        if not isinstance(region, dict):
            raise ValidationError(f"parcellation {parcellation['id']} metadata row {position} must be an object")
        if type(region.get("index")) is not int or region["index"] != position:
            raise ValidationError(f"parcellation {parcellation['id']} metadata index mismatch at row {position}")
        atlas_id = region.get("atlas_id")
        if type(atlas_id) is not int:
            raise ValidationError(f"parcellation {parcellation['id']} atlas_id at row {position} must be an integer")
        if atlas_id != int(region_ids[position]):
            raise ValidationError(f"parcellation {parcellation['id']} atlas_id mismatch at row {position}")
        atlas_ids.append(atlas_id)
    if len(set(atlas_ids)) != len(atlas_ids):
        raise ValidationError(f"parcellation {parcellation['id']} contains duplicate atlas_id values")
    return len(region_ids)


def _check_statistics(
    path: Path,
    schemas: dict[str, dict],
    registry: Registry,
    region_count: int | None,
) -> dict:
    stats = _load_json(path, "statistics metadata")
    _validate_json(stats, "statistics.schema.json", schemas, registry)
    summary = stats["regional_summary"]
    summary_values = summary["values"]
    _check_binary(path.parent, summary_values)
    if len(summary_values["shape"]) != 2 or summary_values["shape"][1] != len(summary["fields"]):
        raise ValidationError(f"regional summary shape does not match fields: {path}")
    if region_count is not None and summary_values["shape"][0] != region_count:
        raise ValidationError(f"regional summary row count does not match parcellation: {path}")

    histogram = stats.get("histogram")
    if histogram:
        edges = histogram["edges"]
        if not all(math.isfinite(edge) for edge in edges) or not all(
            left < right for left, right in zip(edges, edges[1:])
        ):
            raise ValidationError(f"histogram edges must be finite and strictly increasing: {path}")
        bin_count = len(edges) - 1
        if len(histogram["global_counts"]) != bin_count:
            raise ValidationError(f"histogram global_counts length does not match edges: {path}")
        if sum(histogram["global_counts"]) != stats["global"]["count"]:
            raise ValidationError(f"histogram global_counts do not sum to global count: {path}")
        counts = histogram["regional_counts"]
        _check_binary(path.parent, counts)
        if len(counts["shape"]) != 2 or counts["shape"][1] != bin_count:
            raise ValidationError(f"regional histogram shape does not match edges: {path}")
        expected_rows = region_count if region_count is not None else summary_values["shape"][0]
        if counts["shape"][0] != expected_rows:
            raise ValidationError(f"regional histogram row count does not match summary/parcellation: {path}")
    return stats


def validate_release(release_dir: Path, schema_dir: Path) -> None:
    release_dir = release_dir.resolve()
    registry, schemas = _schema_registry(schema_dir)
    manifest = _load_json(release_dir / "manifest.json", "release manifest")
    _validate_json(manifest, "dataset.schema.json", schemas, registry)
    if not manifest["release"]["immutable"]:
        raise ValidationError("manifest release must be immutable")

    parcellations = manifest["parcellations"]
    _unique([item["id"] for item in parcellations], "parcellation id")
    _unique([item["region_index"]["path"] for item in parcellations], "parcellation region_index path")
    _unique([item["metadata"] for item in parcellations if item.get("metadata")], "parcellation metadata path")
    region_counts = {item["id"]: _check_region_table(release_dir, item) for item in parcellations}

    artifacts = manifest["artifacts"]
    _unique([item["id"] for item in artifacts], "manifest artifact id")
    _unique([item["path"] for item in artifacts], "manifest artifact path")
    for artifact in artifacts:
        _check_artifact(release_dir, artifact)

    feature_refs = manifest["features"]
    _unique([item["id"] for item in feature_refs], "feature id")
    _unique([item["path"] for item in feature_refs], "feature path")
    for feature_ref in feature_refs:
        feature_path = release_dir / feature_ref["path"]
        feature = _load_json(feature_path, "feature metadata")
        _validate_json(feature, "feature.schema.json", schemas, registry)
        if feature["id"] != feature_ref["id"]:
            raise ValidationError(f"feature id mismatch: {feature_path}")
        feature_root = feature_path.parent
        feature_artifacts = feature["artifacts"]
        _unique([item["id"] for item in feature_artifacts], f"artifact id in feature {feature['id']}")
        _unique([item["path"] for item in feature_artifacts], f"artifact path in feature {feature['id']}")

        validated_statistics: dict[Path, dict] = {}
        regional = feature["representations"].get("regional")
        if regional:
            regional_parcellations = regional["parcellations"]
            _unique(
                [item["parcellation_id"] for item in regional_parcellations],
                f"regional parcellation id in feature {feature['id']}",
            )
            _unique(
                [item["values"]["path"] for item in regional_parcellations],
                f"regional values path in feature {feature['id']}",
            )
            _unique(
                [item["statistics"] for item in regional_parcellations],
                f"regional statistics path in feature {feature['id']}",
            )
            for parc in regional_parcellations:
                parcellation_id = parc["parcellation_id"]
                if parcellation_id not in region_counts:
                    raise ValidationError(
                        f"feature {feature['id']} references unknown parcellation {parcellation_id}"
                    )
                values = parc["values"]
                _check_binary(feature_root, values)
                if values["shape"] != [region_counts[parcellation_id]]:
                    raise ValidationError(
                        f"regional values shape does not match parcellation {parcellation_id}: {feature_path}"
                    )
                stats_path = (feature_root / parc["statistics"]).resolve()
                stats = _check_statistics(stats_path, schemas, registry, region_counts[parcellation_id])
                validated_statistics[stats_path] = stats
                if parc["summary"] not in stats["regional_summary"]["fields"]:
                    raise ValidationError(
                        f"regional summary {parc['summary']} is not declared by statistics: {stats_path}"
                    )

        for artifact in feature_artifacts:
            _check_artifact(feature_root, artifact)

        volume = feature["representations"].get("volume")
        if volume:
            statistics_ref = volume.get("statistics")
            if statistics_ref:
                stats_path = (feature_root / statistics_ref).resolve()
                if stats_path not in validated_statistics:
                    _check_statistics(stats_path, schemas, registry, None)
            _check_volume(feature_root, volume)
