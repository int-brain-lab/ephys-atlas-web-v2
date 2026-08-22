from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .io import json_resource, write_array, write_json
from .statistics import SUMMARY_FIELDS, describe, histogram, summary_matrix

DEFAULT_PARCELLATIONS = ("allen", "beryl", "cosmos")


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


def histogram_edges(values: np.ndarray, bins: int) -> np.ndarray:
    finite = np.asarray(values, dtype=np.float64)
    finite = finite[np.isfinite(finite)]
    if finite.size == 0:
        return np.linspace(0.0, 1.0, bins + 1, dtype=np.float64)
    lo = float(finite.min())
    hi = float(finite.max())
    if not hi > lo:
        pad = max(abs(lo) * 1e-9, 1e-12)
        lo -= pad
        hi += pad
    return np.linspace(lo, hi, bins + 1, dtype=np.float64)


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
    edges: np.ndarray,
    population_description: str,
) -> dict:
    grouped_values = [values[rows] for rows in groups]
    matrix = summary_matrix(grouped_values)
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
    regional_histogram = np.stack([histogram(group, edges) for group in grouped_values])
    histogram_meta = write_array(
        feature_root / f"{parcellation}.hist.u32", regional_histogram, "uint32"
    )

    stats = {
        "schema_version": "1.0",
        "format": "ephys-atlas-regional-statistics-v1",
        "population": population_description,
        "global": describe(values),
        "regional_summary": {"fields": SUMMARY_FIELDS, "values": summary_meta},
        "histogram": {
            "edges": edges.tolist(),
            "global_counts": histogram(values, edges).astype(int).tolist(),
            "regional_counts": histogram_meta,
            "bin_rule": "left-closed-right-open-last-closed",
        },
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
