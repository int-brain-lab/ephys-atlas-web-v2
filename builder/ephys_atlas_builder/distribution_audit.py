"""Read-only evidence for selecting distribution presentations.

This module deliberately has no dependency on release builders.  It operates on
the source scalar population, because an existing linear histogram cannot be
re-binned exactly into signed-log or focused domains.  Its output is evidence
only: callers must record any eventual presentation choices separately in an
owner-reviewed selection document.
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import numpy as np

from .io import sha256_file, write_json


AUDIT_ID = "ephys-atlas-distribution-audit-v1"
BIN_RULE = "left-closed-right-open-last-closed"
_QUANTILES = (0.0, 0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99, 1.0)


def _key(quantile: float) -> str:
    return f"q{int(round(quantile * 100)):02d}"


def _edges(values: np.ndarray, bins: int, scale: str, threshold: float | None = None) -> np.ndarray:
    """Return deterministic raw-value edges for an exact source-value binning."""
    lo, hi = float(values.min()), float(values.max())
    if scale == "linear":
        if lo == hi:
            pad = max(abs(lo) * 1e-9, 1e-12)
            lo, hi = lo - pad, hi + pad
        return np.linspace(lo, hi, bins + 1, dtype=np.float64)
    if scale == "log":
        if lo <= 0:
            raise ValueError("log histogram requires strictly-positive finite values")
        if lo == hi:
            pad = max(abs(lo) * 1e-9, 1e-12)
            lo, hi = max(np.nextafter(0.0, 1.0), lo - pad), hi + pad
        return np.geomspace(lo, hi, bins + 1, dtype=np.float64)
    if scale != "symlog" or threshold is None or not math.isfinite(threshold) or threshold <= 0:
        raise ValueError("symlog histogram requires a finite positive threshold")
    transform = lambda value: math.copysign(math.log1p(abs(value) / threshold), value)
    inverse = lambda value: math.copysign(threshold * math.expm1(abs(value)), value)
    transformed = np.asarray([transform(lo), transform(hi)], dtype=np.float64)
    if transformed[0] == transformed[1]:
        transformed += (-1e-9, 1e-9)
    edges = np.asarray(
        [inverse(value) for value in np.linspace(*transformed, bins + 1)], dtype=np.float64
    )
    # Round-trip arithmetic can move an endpoint by one ULP and silently lose
    # the global minimum/maximum under numpy's half-open bin rule.
    edges[0], edges[-1] = lo, hi
    return edges


def _bounded_edges(
    lower: float, upper: float, bins: int, scale: str, threshold: float | None = None
) -> np.ndarray:
    """Exact domain-bounded edges for focused candidates (never data-snapped)."""
    if not upper > lower:
        raise ValueError("focused histogram requires non-degenerate bounds")
    if scale == "linear":
        return np.linspace(lower, upper, bins + 1, dtype=np.float64)
    if scale == "log":
        if lower <= 0:
            raise ValueError("focused log histogram requires strictly-positive bounds")
        return np.geomspace(lower, upper, bins + 1, dtype=np.float64)
    if scale != "symlog" or threshold is None or not math.isfinite(threshold) or threshold <= 0:
        raise ValueError("focused symlog histogram requires a finite positive threshold")
    transform = lambda value: math.copysign(math.log1p(abs(value) / threshold), value)
    inverse = lambda value: math.copysign(threshold * math.expm1(abs(value)), value)
    transformed = np.linspace(transform(lower), transform(upper), bins + 1)
    edges = np.asarray([inverse(value) for value in transformed], dtype=np.float64)
    edges[0], edges[-1] = lower, upper
    return edges


def _histogram(values: np.ndarray, edges: np.ndarray) -> dict[str, Any]:
    counts = np.histogram(values, bins=edges)[0]
    nonempty = counts[counts > 0]
    return {
        "edges": edges.tolist(),
        "counts": counts.astype(int).tolist(),
        "bin_rule": BIN_RULE,
        "occupancy": {
            "bin_count": int(counts.size),
            "nonempty_bin_count": int(nonempty.size),
            "empty_bin_count": int(counts.size - nonempty.size),
            "largest_bin_count": int(counts.max(initial=0)),
            "largest_bin_fraction": float(counts.max(initial=0) / values.size),
        },
    }


def _focused_histogram(
    inside: np.ndarray, *, lower: float, upper: float, bins: int, scale: str, threshold: float | None = None
) -> dict[str, Any]:
    return _histogram(inside, _bounded_edges(lower, upper, bins, scale, threshold))


def _focus(values: np.ndarray, lower: float, upper: float, bins: int, thresholds: list[float]) -> dict[str, Any]:
    inside = values[(values >= lower) & (values <= upper)]
    base = {
        "bounds": {"lower": lower, "upper": upper},
        "whole_population_count": int(values.size),
        "underflow_count": int((values < lower).sum()),
        "overflow_count": int((values > upper).sum()),
        "inside_count": int(inside.size),
    }
    if not upper > lower:
        return {
            **base,
            "variants": {
                name: {"availability": "unavailable", "reason": "focused quantile bounds are degenerate"}
                for name in ("linear", "log", "symlog")
            },
        }
    log = (
        {"availability": "available", "histogram": _focused_histogram(inside, lower=lower, upper=upper, bins=bins, scale="log")}
        if inside.size and np.all(values > 0)
        else {"availability": "unavailable", "reason": "complete finite source population is not strictly positive"}
    )
    return {
        **base,
        "variants": {
            "linear": {
                "availability": "available" if inside.size else "unavailable",
                **({"histogram": _focused_histogram(inside, lower=lower, upper=upper, bins=bins, scale="linear")} if inside.size else {}),
            },
            "log": log,
            "symlog": {
                "availability": "candidate-only",
                "threshold_candidates": [
                    {
                        "linear_threshold": threshold,
                        "histogram": _focused_histogram(
                            inside, lower=lower, upper=upper, bins=bins, scale="symlog", threshold=threshold
                        ),
                    }
                    for threshold in thresholds
                ] if inside.size else [],
                "non_authoritative_reason": "threshold selection requires explicit scientific and presentation review",
            },
        },
    }


def _artifact_estimate(bins: int, regional_count_rows: int | None) -> dict[str, int]:
    """Conservative uncompressed payload estimate; never a release-size promise."""
    global_counts = bins * 4
    edges = (bins + 1) * 8
    regional = 0 if regional_count_rows is None else regional_count_rows * bins * 4
    return {
        "global_counts_bytes": global_counts,
        "edges_bytes": edges,
        "regional_counts_bytes": regional,
        "estimated_binary_bytes": global_counts + edges + regional,
    }


def audit_distribution(
    values: np.ndarray,
    *,
    bins: int = 50,
    focus_quantiles: tuple[float, float] = (0.01, 0.99),
    regional_count_rows: int | None = None,
) -> dict[str, Any]:
    """Produce deterministic exact-binning evidence for one source population.

    ``values`` must be the actual observation population, not existing histogram
    bin centres/counts.  Non-finite values are counted as missing.  Candidate
    signed-log thresholds are deliberately plural and non-authoritative.
    """
    if bins < 2:
        raise ValueError("bins must be >= 2")
    lower_q, upper_q = focus_quantiles
    if not 0 <= lower_q < upper_q <= 1:
        raise ValueError("focus quantiles must satisfy 0 <= lower < upper <= 1")
    raw = np.asarray(values, dtype=np.float64).reshape(-1)
    finite = raw[np.isfinite(raw)]
    counts: dict[str, int] = {
        "total_count": int(raw.size),
        "finite_count": int(finite.size),
        "missing_count": int(raw.size - finite.size),
        "nan_count": int(np.isnan(raw).sum()),
        "positive_infinity_count": int(np.isposinf(raw).sum()),
        "negative_infinity_count": int(np.isneginf(raw).sum()),
        "positive_count": int((finite > 0).sum()),
        "negative_count": int((finite < 0).sum()),
        "zero_count": int((finite == 0).sum()),
    }
    if not finite.size:
        return {"value_counts": counts, "summary": None, "diagnostics": None, "candidates": None}

    quantiles = np.quantile(finite, _QUANTILES)
    summary = {
        "min": float(finite.min()), "max": float(finite.max()),
        "mean": float(finite.mean()), "std": float(finite.std()),
        **{_key(q): float(value) for q, value in zip(_QUANTILES, quantiles, strict=True)},
    }
    abs_nonzero = np.abs(finite[finite != 0])
    thresholds = []
    if abs_nonzero.size:
        for q in (0.05, 0.25, 0.5):
            value = float(np.quantile(abs_nonzero, q))
            if value > 0 and value not in thresholds:
                thresholds.append(value)
    full_linear = _histogram(finite, _edges(finite, bins, "linear"))
    log = (
        {"availability": "available", "histogram": _histogram(finite, _edges(finite, bins, "log"))}
        if counts["positive_count"] == finite.size
        else {"availability": "unavailable", "reason": "finite population is not strictly positive"}
    )
    symlog = {
        "availability": "candidate-only",
        "threshold_candidates": [
            {
                "linear_threshold": threshold,
                "histogram": _histogram(finite, _edges(finite, bins, "symlog", threshold)),
            }
            for threshold in thresholds
        ],
        "non_authoritative_reason": "threshold selection requires explicit scientific and presentation review",
    }
    focus_bounds = np.quantile(finite, (lower_q, upper_q))
    focus = _focus(
        finite, float(focus_bounds[0]), float(focus_bounds[1]), bins, thresholds
    )
    q95 = max(abs(summary["q95"]), np.finfo(np.float64).tiny)
    return {
        "value_counts": counts,
        "summary": summary,
        "diagnostics": {
            "max_abs_to_q95_abs_ratio": float(max(abs(summary["min"]), abs(summary["max"])) / q95),
            "full_linear_largest_bin_fraction": full_linear["occupancy"]["largest_bin_fraction"],
            "note": "Diagnostics describe display concentration; they do not select a scale or scientific transform.",
        },
        "candidates": {
            "full": {"linear": {"availability": "available", "histogram": full_linear}, "log": log, "symlog": symlog},
            "focused": {
                "availability": "candidate-only",
                "quantile_rule": {"lower": lower_q, "upper": upper_q},
                **focus,
                "non_authoritative_reason": "focus bounds and tail treatment require explicit review",
            },
        },
        "artifact_size_estimates": {
            "per_full_binning": _artifact_estimate(bins, regional_count_rows),
            "note": "Uncompressed typed-binary estimate only; JSON and transport compression are intentionally excluded.",
        },
    }


def audit_feature_arrays(
    features: Mapping[str, np.ndarray],
    output: Path,
    *,
    dataset_id: str,
    release_id: str,
    representation: str,
    population: str,
    observation_unit: str,
    bins: int = 50,
    regional_count_rows: int | None = None,
    validity_note: str | None = None,
) -> Path:
    """Write a canonical, read-only multi-feature audit report."""
    if not features:
        raise ValueError("distribution audit requires at least one feature")
    report = {
        "schema_version": "1.0",
        "audit_id": AUDIT_ID,
        "dataset_id": dataset_id,
        "release_id": release_id,
        "representation": representation,
        "population": population,
        "observation_unit": observation_unit,
        "read_only": True,
        "defaults_selected": False,
        "parameters": {"histogram_bins": bins, "focused_quantiles": [0.01, 0.99]},
        "features": [
            {"id": identifier, **audit_distribution(values, bins=bins, regional_count_rows=regional_count_rows)}
            for identifier, values in sorted(features.items())
        ],
        "notes": [
            "All candidate histograms are computed directly from supplied source values; no existing histogram is stretched or rebinned.",
            "Candidate scales, thresholds, and focused bounds are evidence only and must not be copied into a release without separate owner review.",
            *([validity_note] if validity_note else []),
        ],
    }
    write_json(output, report)
    return output


def audit_volume_feature_arrays(
    features: Mapping[str, np.ndarray],
    output: Path,
    *,
    dataset_id: str,
    release_id: str,
    outside_value: float,
    bins: int = 50,
) -> Path:
    """Audit volumes using the schema-v1 sentinel classification order.

    Outside is classified before non-finite missingness, matching the release
    contract.  Distribution fields are computed only from valid finite voxels;
    callers must not interpret their count as independent observations.
    """
    if not math.isfinite(outside_value):
        raise ValueError("outside_value must be finite")
    if not features:
        raise ValueError("distribution audit requires at least one feature")
    audited = []
    for identifier, values in sorted(features.items()):
        raw = np.asarray(values, dtype=np.float64).reshape(-1)
        outside = raw == outside_value
        missing = ~outside & ~np.isfinite(raw)
        valid = ~outside & ~missing
        evidence = audit_distribution(raw[valid], bins=bins)
        evidence["validity_counts"] = {
            "total_voxel_count": int(raw.size),
            "valid_voxel_count": int(valid.sum()),
            "outside_voxel_count": int(outside.sum()),
            "missing_voxel_count": int(missing.sum()),
        }
        audited.append({"id": identifier, **evidence})
    report = {
        "schema_version": "1.0",
        "audit_id": AUDIT_ID,
        "dataset_id": dataset_id,
        "release_id": release_id,
        "representation": "volume",
        "population": "valid finite voxels classified by the release-owned sentinel policy",
        "observation_unit": "valid voxels (spatially correlated; not independent scientific samples)",
        "read_only": True,
        "defaults_selected": False,
        "parameters": {"histogram_bins": bins, "focused_quantiles": [0.01, 0.99]},
        "features": audited,
        "notes": [
            "Outside voxels are classified before non-finite missing voxels; only valid finite voxels enter distribution candidates.",
            "Candidate scales, thresholds, and focused bounds are evidence only and must not be copied into a release without separate owner review.",
        ],
    }
    write_json(output, report)
    return output


def audit_npz_arrays(
    npz_path: Path,
    output: Path,
    *,
    dataset_id: str,
    release_id: str,
    representation: str,
    population: str,
    observation_unit: str,
    outside_value: float | None = None,
    bins: int = 50,
) -> Path:
    """Explicit source-array adapter for a pinned NPZ of named scalar arrays.

    The archive contains one array per feature.  It intentionally does not
    accept histogram edges/counts: supplying accumulated bins would defeat the
    exactness guarantee of this audit.
    """
    if representation not in {"regional", "volume"}:
        raise ValueError("representation must be regional or volume")
    with np.load(npz_path, allow_pickle=False) as archive:
        arrays = {name: np.asarray(archive[name]) for name in archive.files}
    if representation == "volume":
        if outside_value is None:
            raise ValueError("volume source-array audit requires outside_value")
        result = audit_volume_feature_arrays(
            arrays, output, dataset_id=dataset_id, release_id=release_id,
            outside_value=outside_value, bins=bins,
        )
    else:
        result = audit_feature_arrays(
            arrays, output, dataset_id=dataset_id, release_id=release_id,
            representation="regional", population=population,
            observation_unit=observation_unit, bins=bins,
        )
    report = json.loads(output.read_text())
    report["source_array_evidence"] = {
        "path": str(npz_path.resolve()),
        "bytes": npz_path.stat().st_size,
        "sha256": sha256_file(npz_path),
    }
    write_json(output, report)
    return result
