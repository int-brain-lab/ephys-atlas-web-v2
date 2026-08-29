from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal, localcontext
from pathlib import Path

import numpy as np

from .io import json_resource, write_array, write_json
from .statistics import SUMMARY_FIELDS, describe, histogram, summary_matrix

DEFAULT_PARCELLATIONS = ("allen", "beryl", "cosmos")
BIN_RULE = "left-closed-right-open-last-closed"
REGIONAL_COUNT_LAYOUT = "underflow-bins-overflow"


def linear_full_display(
    *, colormap: str | None = None, value_range: Sequence[float] | None = None
) -> dict:
    """Return the mandatory non-inferred scalar presentation baseline."""
    return {
        **({"colormap": colormap} if colormap else {}),
        **(
            {"range": [float(value_range[0]), float(value_range[1])]}
            if value_range is not None
            else {}
        ),
        "scales": [{"kind": "linear"}],
        "preferred_scale": "linear",
        "distribution_domains": [{"kind": "full"}],
        "preferred_distribution_domain": "full",
    }


def linear_log_full_display(
    *,
    preferred_scale: str = "log",
    colormap: str | None = None,
    value_range: Sequence[float] | None = None,
) -> dict:
    """Translate an already-reviewed positive-feature Linear/Log selection."""
    if preferred_scale not in {"linear", "log"}:
        raise ValueError("preferred Linear/Log scale must be linear or log")
    display = linear_full_display(colormap=colormap, value_range=value_range)
    display["scales"] = [{"kind": "linear"}, {"kind": "log"}]
    display["preferred_scale"] = preferred_scale
    return display


def validate_scalar_display(display: Mapping, values: np.ndarray) -> dict:
    """Validate one explicit representation-owned presentation selection."""
    allowed_fields = {
        "colormap",
        "range",
        "scales",
        "preferred_scale",
        "distribution_domains",
        "preferred_distribution_domain",
    }
    unknown_fields = sorted(set(display) - allowed_fields)
    if unknown_fields:
        raise ValueError(
            "scalar display contains unsupported fields: "
            + ", ".join(unknown_fields)
        )
    scales = list(display.get("scales", ()))
    domains = list(display.get("distribution_domains", ()))
    if not scales or not domains:
        raise ValueError("scalar display must declare nonempty scales and distribution domains")
    scale_kinds = [spec.get("kind") for spec in scales if isinstance(spec, Mapping)]
    domain_kinds = [spec.get("kind") for spec in domains if isinstance(spec, Mapping)]
    if len(scale_kinds) != len(scales) or len(set(scale_kinds)) != len(scale_kinds):
        raise ValueError("scalar display scales must have unique kinds")
    if len(domain_kinds) != len(domains) or len(set(domain_kinds)) != len(domain_kinds):
        raise ValueError("scalar display domains must have unique kinds")
    if scale_kinds[0] != "linear" or "linear" not in scale_kinds:
        raise ValueError("scalar display must include Linear first")
    if domain_kinds[0] != "full" or "full" not in domain_kinds:
        raise ValueError("scalar display must include Full first")
    if display.get("preferred_scale") not in scale_kinds:
        raise ValueError("preferred scalar display scale is unavailable")
    if display.get("preferred_distribution_domain") not in domain_kinds:
        raise ValueError("preferred scalar distribution domain is unavailable")

    finite = np.asarray(values, dtype=np.float64)
    finite = finite[np.isfinite(finite)]
    normalized_scales = []
    for spec in scales:
        kind = spec.get("kind")
        if kind == "linear" and set(spec) == {"kind"}:
            normalized_scales.append({"kind": "linear"})
        elif kind == "log" and set(spec) == {"kind"}:
            if finite.size and np.any(finite <= 0):
                raise ValueError("log scale requires every finite observation to be positive")
            normalized_scales.append({"kind": "log"})
        elif kind == "symlog" and set(spec) == {"kind", "linear_threshold"}:
            threshold = spec.get("linear_threshold")
            if isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not np.isfinite(threshold) or threshold <= 0:
                raise ValueError("symlog scale requires a finite positive linear threshold")
            normalized_scales.append({"kind": "symlog", "linear_threshold": float(threshold)})
        else:
            raise ValueError(f"invalid scalar display scale specification: {spec!r}")

    normalized_domains = []
    for spec in domains:
        kind = spec.get("kind")
        if kind == "full" and set(spec) == {"kind"}:
            normalized_domains.append({"kind": "full"})
        elif kind == "focused" and set(spec) == {"kind", "bounds"}:
            bounds = spec.get("bounds")
            if (
                not isinstance(bounds, Sequence)
                or isinstance(bounds, (str, bytes))
                or len(bounds) != 2
                or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not np.isfinite(value) for value in bounds)
                or not bounds[0] < bounds[1]
            ):
                raise ValueError("focused distribution requires finite increasing raw-value bounds")
            normalized_domains.append({"kind": "focused", "bounds": [float(bounds[0]), float(bounds[1])]})
        else:
            raise ValueError(f"invalid scalar distribution domain specification: {spec!r}")

    result = {
        "scales": normalized_scales,
        "preferred_scale": display["preferred_scale"],
        "distribution_domains": normalized_domains,
        "preferred_distribution_domain": display["preferred_distribution_domain"],
    }
    colormap = display.get("colormap")
    if colormap is not None:
        if not isinstance(colormap, str) or not colormap:
            raise ValueError("display colormap must be a nonempty string")
        result["colormap"] = colormap
    value_range = display.get("range")
    if value_range is not None:
        if (
            not isinstance(value_range, Sequence)
            or isinstance(value_range, (str, bytes))
            or len(value_range) != 2
            or any(
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not np.isfinite(value)
                for value in value_range
            )
            or not value_range[0] < value_range[1]
        ):
            raise ValueError("display range must contain two finite increasing values")
        if "log" in scale_kinds and value_range[0] <= 0:
            raise ValueError("a display range shared with Log must be strictly positive")
        result["range"] = [float(value_range[0]), float(value_range[1])]
    return result


@dataclass(frozen=True)
class RegionInfo:
    atlas_id: int
    acronym: str
    name: str


@dataclass(frozen=True)
class FeatureInfo:
    source_column: str
    label: str
    description: str
    unit: str | None = None
    variant: str | None = None


def fold_region_ids_left(region_ids: np.ndarray) -> np.ndarray:
    """Validate atlas identifiers and fold both hemispheres onto the left."""
    ids = np.asarray(region_ids, dtype=np.float64)
    finite = np.isfinite(ids)
    finite_ids = ids[finite]
    if np.any(finite_ids != np.trunc(finite_ids)):
        raise ValueError("region ids must be integral numbers")
    if np.any(np.abs(finite_ids) > np.iinfo(np.int32).max):
        raise ValueError("region ids must fit in signed int32 after hemisphere folding")
    folded = ids.copy()
    folded[finite] = -np.abs(finite_ids)
    return folded


def histogram_edges(
    values: np.ndarray,
    bins: int,
    axis_scale: str = "linear",
    *,
    linear_threshold: float | None = None,
    bounds: Sequence[float] | None = None,
) -> np.ndarray:
    finite = np.asarray(values, dtype=np.float64)
    finite = finite[np.isfinite(finite)]
    if axis_scale not in {"linear", "log", "symlog"}:
        raise ValueError(f"unsupported histogram axis scale: {axis_scale}")
    if axis_scale == "symlog" and (
        linear_threshold is None
        or not np.isfinite(linear_threshold)
        or linear_threshold <= 0
    ):
        raise ValueError("symlog histogram requires a finite positive linear threshold")
    if finite.size == 0:
        if axis_scale == "log":
            raise ValueError("log histogram requires finite strictly-positive values")
        return np.linspace(0.0, 1.0, bins + 1, dtype=np.float64)
    lo, hi = (
        (float(bounds[0]), float(bounds[1]))
        if bounds is not None
        else (float(finite.min()), float(finite.max()))
    )
    if not np.isfinite(lo) or not np.isfinite(hi) or not lo < hi:
        if bounds is not None:
            raise ValueError("histogram bounds must be finite and increasing")
        pad = max(abs(lo) * 1e-9, 1e-12)
        lo = (
            max(float(np.nextafter(0.0, 1.0)), lo - pad)
            if axis_scale == "log"
            else lo - pad
        )
        hi += pad
    if axis_scale == "log":
        if not lo > 0:
            raise ValueError("log histogram requires all finite values to be positive")
        return np.geomspace(lo, hi, bins + 1, dtype=np.float64)
    if axis_scale == "symlog":
        assert linear_threshold is not None
        with localcontext() as context:
            # Python's platform libm may differ by one ULP for log/exp results.
            # Decimal's correctly rounded transcendental operations make these
            # serialized release edges independent of that implementation.
            context.prec = 80
            threshold = Decimal.from_float(linear_threshold)
            one = Decimal(1)
            maximum = Decimal.from_float(float(np.finfo(np.float64).max))

            def transform(value: float) -> float:
                if value == 0:
                    return 0.0
                magnitude = Decimal.from_float(abs(value))
                ratio = magnitude / threshold
                with localcontext(context) as operation_context:
                    operation_context.prec = max(80, 40 - ratio.adjusted())
                    result = (one + ratio).ln(context=operation_context)
                return float(result.copy_sign(Decimal.from_float(value)))

            def inverse(value: float) -> float:
                if value == 0:
                    return 0.0
                magnitude = Decimal.from_float(abs(value))
                with localcontext(context) as operation_context:
                    operation_context.prec = max(80, 40 - magnitude.adjusted())
                    result = threshold * (
                        magnitude.exp(context=operation_context) - one
                    )
                if result > maximum:
                    raise ValueError("symlog histogram inverse exceeds finite float64")
                return float(result.copy_sign(Decimal.from_float(value)))

            transformed_bounds = (transform(lo), transform(hi))
            if not all(np.isfinite(value) for value in transformed_bounds):
                raise ValueError("symlog histogram transform is not finite")
            transformed = np.linspace(
                transformed_bounds[0], transformed_bounds[1], bins + 1, dtype=np.float64
            )
            edges = np.asarray(
                [inverse(float(value)) for value in transformed], dtype=np.float64
            )
        edges[0], edges[-1] = lo, hi
        if not np.isfinite(edges).all() or not np.all(np.diff(edges) > 0):
            raise ValueError("symlog histogram edges are not finite and strictly increasing")
        return edges
    return np.linspace(lo, hi, bins + 1, dtype=np.float64)


def histogram_counts_and_tails(values: np.ndarray, edges: np.ndarray) -> tuple[np.ndarray, int, int]:
    finite = np.asarray(values, dtype=np.float64)
    finite = finite[np.isfinite(finite)]
    underflow = int(np.count_nonzero(finite < edges[0]))
    overflow = int(np.count_nonzero(finite > edges[-1]))
    visible = finite[(finite >= edges[0]) & (finite <= edges[-1])]
    return histogram(visible, edges), underflow, overflow


def build_global_distribution_binnings(
    values: np.ndarray, bins: int, display: Mapping
) -> list[dict]:
    display = validate_scalar_display(display, values)
    finite = np.asarray(values, dtype=np.float64)
    finite = finite[np.isfinite(finite)]
    if finite.size:
        full_lower = float(finite.min())
        full_upper = float(finite.max())
        if not full_lower < full_upper:
            pad = max(abs(full_lower) * 1e-9, 1e-12)
            if any(scale["kind"] == "log" for scale in display["scales"]):
                full_lower = max(float(np.nextafter(0.0, 1.0)), full_lower - pad)
            else:
                full_lower -= pad
            full_upper += pad
        full_bounds: Sequence[float] | None = (full_lower, full_upper)
    else:
        full_bounds = None
    focused = next(
        (
            domain["bounds"]
            for domain in display["distribution_domains"]
            if domain["kind"] == "focused"
        ),
        None,
    )
    if full_bounds is not None and focused is not None and (
        focused[0] < full_bounds[0] or focused[1] > full_bounds[1]
    ):
        raise ValueError("focused distribution bounds must lie inside the full finite domain")
    result = []
    for scale in display["scales"]:
        for domain in display["distribution_domains"]:
            bounds = domain.get("bounds", full_bounds)
            edges = histogram_edges(
                values,
                bins,
                scale["kind"],
                linear_threshold=scale.get("linear_threshold"),
                bounds=bounds,
            )
            counts, underflow, overflow = histogram_counts_and_tails(values, edges)
            result.append(
                {
                    "id": f"{scale['kind']}-{domain['kind']}",
                    "scale": scale,
                    "domain": domain,
                    "edges": edges.tolist(),
                    "global_counts": counts.astype(int).tolist(),
                    "global_underflow_count": underflow,
                    "global_overflow_count": overflow,
                    "bin_rule": BIN_RULE,
                }
            )
    return result


def _group_indices(region_ids: np.ndarray) -> tuple[np.ndarray, list[np.ndarray]]:
    ids = fold_region_ids_left(region_ids)
    valid_rows = np.flatnonzero(np.isfinite(ids))
    if valid_rows.size == 0:
        return np.array([], dtype=np.int32), []
    valid_ids = ids[valid_rows].astype(np.int64)
    order = np.argsort(valid_ids, kind="stable")
    sorted_ids = valid_ids[order]
    sorted_rows = valid_rows[order]
    unique, starts = np.unique(sorted_ids, return_index=True)
    groups: list[np.ndarray] = []
    for index, start in enumerate(starts):
        stop = int(starts[index + 1]) if index + 1 < len(starts) else len(sorted_rows)
        groups.append(sorted_rows[int(start):stop])
    return unique.astype(np.int32), groups


def _region_info(metadata: Mapping[int, RegionInfo], region_id: int) -> RegionInfo | None:
    return metadata.get(region_id) or metadata.get(abs(region_id)) or metadata.get(-abs(region_id))


def write_parcellation(
    release_dir: Path,
    parcellation: str,
    region_ids: np.ndarray,
    metadata: Mapping[int, RegionInfo],
) -> tuple[dict, list[np.ndarray]]:
    ids, groups = _group_indices(region_ids)
    if ids.size == 0:
        raise ValueError(f"{parcellation} has no finite region ids in the selected population")

    missing = [
        int(region_id)
        for region_id in ids
        if _region_info(metadata, int(region_id)) is None
    ]
    if missing:
        preview = ", ".join(map(str, missing[:8]))
        raise ValueError(f"{parcellation} metadata is missing region ids: {preview}")

    root = release_dir / "parcellations" / parcellation
    index_meta = write_array(
        root / "region_ids.i32", ids, "int32", root=release_dir
    )
    regions = []
    for index, region_id in enumerate(ids):
        info = _region_info(metadata, int(region_id))
        assert info is not None
        regions.append(
            {
                "index": index,
                "atlas_id": int(region_id),
                "acronym": info.acronym,
                "name": info.name,
            }
        )
    metadata_path = root / "regions.json"
    write_json(metadata_path, regions)
    return {
        "id": parcellation,
        "region_index": index_meta,
        "metadata": json_resource(
            metadata_path, release_dir, "ephys-atlas-region-metadata-v1"
        ),
    }, groups


def write_feature_parcellation(
    feature_root: Path,
    parcellation: str,
    values: np.ndarray,
    groups: Sequence[np.ndarray],
    histogram_bins: int,
    population_description: str,
    numeric_transform: Callable[[float], float] | None = None,
    distribution_display: Mapping | None = None,
) -> dict:
    grouped_values = [values[rows] for rows in groups]
    matrix = summary_matrix(grouped_values)
    if numeric_transform is not None:
        finite = np.isfinite(matrix)
        matrix[finite] = [numeric_transform(value) for value in matrix[finite]]
    mean_index = SUMMARY_FIELDS.index("mean")
    regional_means = matrix[:, mean_index]
    finite_means = regional_means[np.isfinite(regional_means)]
    float32_max = np.finfo(np.float32).max
    values_dtype = (
        "float64"
        if finite_means.size and np.any(np.abs(finite_means) > float32_max)
        else "float32"
    )
    regional_values = regional_means.astype(
        np.float64 if values_dtype == "float64" else np.float32
    )
    suffix = "f64" if values_dtype == "float64" else "f32"
    values_meta = write_array(
        feature_root / f"{parcellation}.values.{suffix}",
        regional_values,
        values_dtype,
    )

    summary_meta = write_array(
        feature_root / f"{parcellation}.summary.f64", matrix, "float64"
    )
    global_statistics = describe(values)
    distribution_values = np.asarray(values, dtype=np.float64)
    if numeric_transform is not None:
        global_statistics = {
            key: (
                numeric_transform(value)
                if isinstance(value, float) and value is not None
                else value
            )
            for key, value in global_statistics.items()
        }
        distribution_values = distribution_values.copy()
        finite_distribution = np.isfinite(distribution_values)
        distribution_values[finite_distribution] = [
            numeric_transform(value)
            for value in distribution_values[finite_distribution]
        ]
    display = validate_scalar_display(
        distribution_display or linear_full_display(), distribution_values
    )
    binnings = (
        build_global_distribution_binnings(
            distribution_values, histogram_bins, display
        )
        if global_statistics["count"] > 0
        else []
    )
    for binning in binnings:
        edges = np.asarray(binning["edges"], dtype=np.float64)
        count_rows = []
        for group_rows in groups:
            group = distribution_values[group_rows]
            counts, underflow, overflow = histogram_counts_and_tails(group, edges)
            count_rows.append(np.concatenate(([underflow], counts, [overflow])))
        matrix_counts = np.asarray(count_rows, dtype=np.uint32)
        count_meta = write_array(
            feature_root / f"{parcellation}.distribution.{binning['id']}.u32",
            matrix_counts,
            "uint32",
        )
        binning["regional_counts"] = count_meta
        binning["regional_count_layout"] = REGIONAL_COUNT_LAYOUT

    stats = {
        "schema_version": "1.0",
        "format": "ephys-atlas-regional-statistics-v1",
        "population": population_description,
        "global": global_statistics,
        "regional_summary": {"fields": SUMMARY_FIELDS, "values": summary_meta},
        **({"distribution": {"binnings": binnings}} if binnings else {}),
    }
    statistics_path = feature_root / f"{parcellation}.statistics.json"
    write_json(statistics_path, stats)
    return {
        "parcellation_id": parcellation,
        "summary": "mean",
        "values": values_meta,
        "statistics": json_resource(
            statistics_path,
            feature_root,
            "ephys-atlas-regional-statistics-v1",
        ),
    }
