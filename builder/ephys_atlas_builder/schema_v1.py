"""Active schema-v1 JSON and semantic contract validation.

The builder, publisher, and browser share this contract and its parity corpus.
It is the sole release schema, not a compatibility adapter.
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
    if valid > 0 and any(not math.isfinite(value) for value in stats.values()):
        _fail("nonempty valid-voxel summary statistics must be finite")
    distribution = document.get("distribution")
    if valid == 0 and distribution is not None:
        _fail("zero-valid-voxel summary cannot contain a distribution")
    if valid > 0 and distribution is None:
        _fail("nonempty valid-voxel summary requires a distribution")
    if distribution:
        _distribution_semantics(
            distribution["binnings"],
            valid,
            "volume",
            minimum=stats["min"],
            maximum=stats["max"],
        )


def _increasing(values: list[float], description: str) -> None:
    if not all(math.isfinite(value) for value in values):
        _fail(f"{description} must be finite")
    if not all(left < right for left, right in zip(values, values[1:])):
        _fail(f"{description} must be strictly increasing")


def _distribution_semantics(
    binnings: list[dict[str, Any]],
    denominator: int,
    description: str,
    *,
    minimum: float | None,
    maximum: float | None,
    regional_rows: int | None = None,
) -> None:
    ids = [binning["id"] for binning in binnings]
    _unique(ids, f"{description} distribution binning id")
    scales: dict[str, dict[str, Any]] = {}
    domains: dict[str, dict[str, Any]] = {}
    domain_endpoints: dict[str, tuple[float, float]] = {}
    combinations: set[tuple[str, str]] = set()
    for binning in binnings:
        scale = binning["scale"]
        domain = binning["domain"]
        scale_kind = scale["kind"]
        domain_kind = domain["kind"]
        if binning["id"] != f"{scale_kind}-{domain_kind}":
            _fail(f"{description} distribution binning id is not canonical")
        if scale_kind in scales and scale != scales[scale_kind]:
            _fail(f"{description} {scale_kind} scale specification is inconsistent")
        if domain_kind in domains and domain != domains[domain_kind]:
            _fail(f"{description} {domain_kind} domain specification is inconsistent")
        scales[scale_kind] = scale
        domains[domain_kind] = domain
        if (scale_kind, domain_kind) in combinations:
            _fail(f"duplicate {description} scale/domain binning")
        combinations.add((scale_kind, domain_kind))

        edges = binning["edges"]
        if scale_kind == "symlog" and not math.isfinite(scale["linear_threshold"]):
            _fail(f"{description} Signed-log threshold must be finite")
        _increasing(edges, f"{description} {binning['id']} distribution edges")
        endpoints = (edges[0], edges[-1])
        if domain_kind in domain_endpoints and endpoints != domain_endpoints[domain_kind]:
            _fail(f"{description} distribution raw domain endpoints differ across scales")
        domain_endpoints[domain_kind] = endpoints
        if scale_kind == "log":
            if any(edge <= 0 for edge in edges):
                _fail(f"{description} Log distribution edges must be positive")
            if minimum is not None and minimum <= 0:
                _fail(f"{description} Log distribution requires a strictly-positive population")
        if domain_kind == "focused":
            bounds = domain["bounds"]
            if not bounds[0] < bounds[1]:
                _fail(f"{description} Focused distribution bounds must be increasing")
            if edges[0] != bounds[0] or edges[-1] != bounds[1]:
                _fail(f"{description} Focused distribution edges must equal its raw-value bounds")
        elif binning["global_underflow_count"] or binning["global_overflow_count"]:
            _fail(f"{description} Full distribution tails must be zero")
        if len(binning["global_counts"]) != len(edges) - 1:
            _fail(f"{description} distribution counts length does not match edges")
        if (
            binning["global_underflow_count"]
            + sum(binning["global_counts"])
            + binning["global_overflow_count"]
            != denominator
        ):
            _fail(f"{description} distribution counts and tails do not conserve the population")
        if regional_rows is not None:
            regional = binning["regional_counts"]
            if regional["dtype"] != "uint32":
                _fail("regional distribution count matrix must use uint32")
            expected_shape = [regional_rows, len(edges) + 1]
            if regional["shape"] != expected_shape:
                _fail("regional distribution count matrix must use underflow-bins-overflow columns")
        elif "regional_counts" in binning or "regional_count_layout" in binning:
            _fail("volume distributions must remain global-only")

    if "linear" not in scales or "full" not in domains or ("linear", "full") not in combinations:
        _fail(f"{description} distribution requires Linear/Full")
    expected = {(scale, domain) for scale in scales for domain in domains}
    if combinations != expected:
        _fail(f"{description} distribution binnings must form a rectangular scale/domain cross-product")
    if "focused" in domain_endpoints:
        full_lower, full_upper = domain_endpoints["full"]
        focused_lower, focused_upper = domain_endpoints["focused"]
        if focused_lower < full_lower or focused_upper > full_upper:
            _fail(f"{description} Focused distribution must lie inside the Full domain")
    if minimum is not None:
        full_lower, full_upper = domain_endpoints["full"]
        if full_lower > minimum:
            _fail(f"{description} Full distribution does not enclose the declared minimum")
        if maximum is None or full_upper < maximum:
            _fail(f"{description} Full distribution does not enclose the declared maximum")


def _display_semantics(document: dict[str, Any]) -> None:
    representations = set(document["representations"])
    display = document["display"]
    if set(display) != representations:
        _fail("feature display keys must exactly match scalar representations")
    for representation, presentation in display.items():
        scales = presentation["scales"]
        domains = presentation["distribution_domains"]
        scale_kinds = [spec["kind"] for spec in scales]
        domain_kinds = [spec["kind"] for spec in domains]
        if len(scale_kinds) != len(set(scale_kinds)):
            _fail(f"duplicate {representation} display scale")
        if len(domain_kinds) != len(set(domain_kinds)):
            _fail(f"duplicate {representation} display distribution domain")
        if not scale_kinds or scale_kinds[0] != "linear":
            _fail(f"{representation} display must declare Linear first")
        if not domain_kinds or domain_kinds[0] != "full":
            _fail(f"{representation} display must declare Full first")
        if presentation["preferred_scale"] not in scale_kinds:
            _fail(f"preferred {representation} display scale is unavailable")
        if presentation["preferred_distribution_domain"] not in domain_kinds:
            _fail(f"preferred {representation} distribution domain is unavailable")
        for scale in scales:
            if scale["kind"] == "symlog" and not math.isfinite(scale["linear_threshold"]):
                _fail(f"{representation} Signed-log threshold must be finite")
        value_range = presentation.get("range")
        if value_range is not None and (
            not all(math.isfinite(value) for value in value_range)
            or not value_range[0] < value_range[1]
        ):
            _fail(f"{representation} display range must be finite and increasing")
        if value_range is not None and "log" in scale_kinds and value_range[0] <= 0:
            _fail(f"{representation} display range shared with Log must be positive")
        focused = [spec for spec in domains if spec["kind"] == "focused"]
        if focused and (
            not all(math.isfinite(value) for value in focused[0]["bounds"])
            or not focused[0]["bounds"][0] < focused[0]["bounds"][1]
        ):
            _fail(f"{representation} Focused bounds must be finite and increasing")


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
    count = document["global"]["count"]
    global_summary = document["global"]
    descriptive_fields = ("min", "max", "mean", "std", "median")
    reported_statistics = [
        value
        for field, value in global_summary.items()
        if field not in {"count", "missing_count"}
    ]
    if count == 0 and any(value is not None for value in reported_statistics):
        _fail("empty regional population descriptive statistics must be null")
    if count > 0 and any(global_summary[field] is None for field in descriptive_fields):
        _fail("nonempty regional population descriptive statistics cannot be null")
    if count > 0 and any(
        value is not None and not math.isfinite(value)
        for value in reported_statistics
    ):
        _fail("nonempty regional population descriptive statistics must be finite")
    distribution = document.get("distribution")
    if count == 0 and distribution is not None:
        _fail("empty regional population must omit its distribution")
    if count > 0 and distribution is None:
        _fail("nonempty regional population requires a distribution")
    if distribution:
        _distribution_semantics(
            distribution["binnings"],
            count,
            "regional",
            minimum=document["global"]["min"],
            maximum=document["global"]["max"],
            regional_rows=summary["values"]["shape"][0],
        )


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


def _registered_resource_index_semantics(document: dict[str, Any]) -> None:
    resources = document["resources"]
    _unique([entry["pack_id"] for entry in resources], "registered SVG pack id")
    _unique([entry["resource"]["path"] for entry in resources], "registered SVG resource path")
    slices: list[int] = []
    for entry in resources:
        entry_slices = entry["slice_indices"]
        if entry_slices != sorted(entry_slices):
            _fail("registered SVG resource slices must be increasing")
        resource = entry["resource"]
        if resource["media_type"] != "application/vnd.ibl.indexed-svg":
            _fail("registered SVG packs must use the indexed-SVG media type")
        if resource["codec"]["name"] != "gzip":
            _fail("registered SVG packs must be gzip-compressed")
        slices.extend(entry_slices)
    if slices != sorted(slices) or len(slices) != len(set(slices)):
        _fail("registered SVG resource index slices must be globally increasing and unique")


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


def _mesh_pack_semantics(document: dict[str, Any]) -> None:
    coordinate = document["coordinate_system"]
    transform = coordinate["source_to_world_um"]
    if not all(math.isfinite(value) for value in transform):
        _fail("mesh source-to-world transform must be finite")
    if transform[12:] != [0, 0, 0, 1]:
        _fail("mesh source-to-world transform must be affine")
    determinant = (
        transform[0] * (transform[5] * transform[10] - transform[6] * transform[9])
        - transform[1] * (transform[4] * transform[10] - transform[6] * transform[8])
        + transform[2] * (transform[4] * transform[9] - transform[5] * transform[8])
    )
    if math.isclose(determinant, 0):
        _fail("mesh source-to-world transform must be invertible")

    scope = document["geometry_scope"]
    active = scope["active_allen_ids"]
    excluded = scope["excluded_allen_ids"]
    inventory = document["sources"]["source_glb"]["inventory_allen_ids"]
    for values, label in ((active, "active Allen IDs"), (excluded, "excluded Allen IDs"), (inventory, "source inventory")):
        if values != sorted(values):
            _fail(f"mesh {label} must be sorted")
    if set(active) & set(excluded):
        _fail("mesh active and excluded Allen IDs overlap")

    groups = document["explode_groups"]
    _unique([group["signed_group_id"] for group in groups], "mesh explode group id")
    group_by_id = {group["signed_group_id"]: group for group in groups}
    regions = document["regions"]
    _unique([region["feature_id"] for region in regions], "mesh feature id")
    _unique([region["signed_allen_id"] for region in regions], "mesh signed Allen id")
    if [region["feature_id"] for region in regions] != list(range(len(regions))):
        _fail("mesh feature IDs must be contiguous in manifest order")
    signed_by_source: dict[int, set[int]] = {}
    for region in regions:
        source_id = region["source_allen_id"]
        signed_id = region["signed_allen_id"]
        sign = -1 if region["hemisphere"] == "left" else 1
        if signed_id != sign * source_id:
            _fail(f"mesh signed Allen identity is inconsistent for feature {region['feature_id']}")
        if source_id not in active or source_id not in inventory or source_id in excluded:
            _fail(f"mesh region {source_id} is outside the declared source scope")
        mappings = region["mappings"]
        if mappings["allen"] != signed_id:
            _fail(f"mesh Allen mapping differs from signed identity {signed_id}")
        for name in ("beryl", "cosmos"):
            mapped = mappings[name]
            if mapped is not None and (mapped == sign * 997 or (mapped < 0) != (sign < 0)):
                _fail(f"mesh {name} mapping is invalid for signed identity {signed_id}")
        group_id = region["signed_explode_group_id"]
        group = group_by_id.get(group_id)
        if group is None or group["hemisphere"] != region["hemisphere"] or (group_id < 0) != (sign < 0):
            _fail(f"mesh explode group is inconsistent for signed identity {signed_id}")
        minimum = region["bounds"]["minimum_um"]
        maximum = region["bounds"]["maximum_um"]
        centroid = region["centroid_um"]
        if any(not math.isfinite(value) for value in [*minimum, *maximum, *centroid]):
            _fail("mesh bounds and centroids must be finite")
        if any(low > high or center < low or center > high for low, high, center in zip(minimum, maximum, centroid)):
            _fail(f"mesh centroid or bounds are invalid for signed identity {signed_id}")
        signed_by_source.setdefault(source_id, set()).add(sign)
    if set(signed_by_source) != set(active):
        _fail("mesh region coverage differs from active Allen scope")

    lods = document["lods"]
    lod_ids = [lod["id"] for lod in lods]
    _unique(lod_ids, "mesh LOD id")
    if document["default_lod_id"] not in lod_ids:
        _fail("mesh default LOD is absent")
    upgrade = document["upgrade_lod_id"]
    if upgrade is not None and (upgrade not in lod_ids or upgrade == document["default_lod_id"]):
        _fail("mesh upgrade LOD is absent or duplicates the default")
    _unique([lod["resource"]["path"] for lod in lods] + [document["validation"]["report"]["path"]], "mesh resource path")
    source_triangles = sum(region["triangle_count"] for region in regions)
    for lod in lods:
        if lod["triangle_count"] > source_triangles:
            _fail(f"mesh LOD {lod['id']} exceeds source triangle count")
        if not math.isclose(lod["actual_triangle_ratio"], lod["triangle_count"] / source_triangles, rel_tol=1e-9):
            _fail(f"mesh LOD {lod['id']} triangle ratio is inconsistent")
        decoder = lod["decoder"]
        if decoder["encoding"] == "raw-v1" and (decoder["position_bits"] != 0 or decoder["normal_bits"] != 0):
            _fail("raw mesh LOD cannot declare quantization bits")
        if decoder["encoding"] == "meshopt-quantized-v1" and (decoder["position_bits"] != 14 or decoder["normal_bits"] != 8):
            _fail("meshopt mesh LOD must use the reviewed 14/8-bit quantization")


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
