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
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import numpy as np

from .io import sha256_file, write_json
from .npz import extract_last_axis_features, inspect_volume_npz


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


def audit_volume_source_npz(
    npz_path: Path,
    output: Path,
    *,
    dataset_id: str,
    release_id: str,
    outside_value: float,
    expected_bytes: int,
    expected_sha256: str,
    bins: int = 50,
    member: str = "ephys_atlas_vol.npy",
    feature_names_member: str = "feature_names",
) -> Path:
    """Audit a verified canonical last-axis encoding-volume source NPZ.

    The source identity is checked before metadata that may use NumPy's object
    encoding is loaded. Feature planes are then extracted with bounded memory;
    no intermediate source-array archive needs to be created or treated as a
    new provenance authority.
    """
    npz_path = npz_path.resolve()
    if expected_bytes < 1:
        raise ValueError("expected_bytes must be positive")
    if npz_path.stat().st_size != expected_bytes:
        raise ValueError("volume source byte size does not match expected identity")
    actual_sha256 = sha256_file(npz_path)
    if actual_sha256 != expected_sha256:
        raise ValueError("volume source SHA-256 does not match expected identity")

    inspection = inspect_volume_npz(npz_path)
    source_member = next(
        (entry for entry in inspection["members"] if entry["path"] == member),
        None,
    )
    if source_member is None or source_member["fortran_order"]:
        raise ValueError(f"volume source must contain C-order member {member}")
    if len(source_member["shape"]) != 4:
        raise ValueError("volume source member must have three spatial axes and one feature axis")

    with np.load(npz_path, allow_pickle=True) as archive:
        if feature_names_member not in archive:
            raise ValueError(f"volume source is missing {feature_names_member}")
        feature_names = tuple(
            str(value) for value in np.asarray(archive[feature_names_member]).tolist()
        )
    if len(feature_names) != source_member["shape"][-1]:
        raise ValueError("volume feature-name count does not match the source feature axis")
    if len(set(feature_names)) != len(feature_names) or any(not name for name in feature_names):
        raise ValueError("volume feature names must be unique and non-empty")

    with tempfile.TemporaryDirectory(prefix="ephys-atlas-volume-audit-") as temporary:
        outputs = {
            index: Path(temporary) / f"feature-{index}.npy"
            for index in range(len(feature_names))
        }
        extract_last_axis_features(npz_path, outputs, member=member)
        arrays = {
            name: np.load(outputs[index], mmap_mode="r")
            for index, name in enumerate(feature_names)
        }
        result = audit_volume_feature_arrays(
            arrays,
            output,
            dataset_id=dataset_id,
            release_id=release_id,
            outside_value=outside_value,
            bins=bins,
        )

    report = json.loads(output.read_text())
    report["source_array_evidence"] = {
        "path": str(npz_path),
        "bytes": expected_bytes,
        "sha256": actual_sha256,
        "member": member,
        "member_shape": source_member["shape"],
        "member_dtype": source_member["dtype_descriptor"],
        "feature_names_member": feature_names_member,
    }
    write_json(output, report)
    return result


def write_audit_review_table(report_path: Path, output: Path) -> Path:
    """Write a compact, non-authoritative Markdown view of audit evidence."""
    report = json.loads(report_path.read_text())
    if report.get("audit_id") != AUDIT_ID or not isinstance(report.get("features"), list):
        raise ValueError("input is not a distribution audit report")

    def number(value: Any) -> str:
        return format(float(value), ".17g")

    ranked = sorted(
        report["features"],
        key=lambda feature: (
            -float(feature.get("diagnostics", {}).get("full_linear_largest_bin_fraction", -1)),
            str(feature.get("id", "")),
        ),
    )
    lines = [
        f"# {report.get('dataset_id', 'dataset')} distribution audit review",
        "",
        "Candidate evidence only. This table selects no scale, threshold, focused bounds, or default.",
        "",
        "Ranking is descending Full linear largest-bin fraction, a display-concentration diagnostic only.",
        "",
        "| Rank | Feature | Population | Sign (-/0/+) | Min / q01 / q99 / max | Full max bin | Focused bounds | Focus tails (low/high) | Log | Signed-log threshold candidates |",
        "| ---: | --- | --- | --- | --- | ---: | --- | --- | --- | --- |",
    ]
    for rank, feature in enumerate(ranked, 1):
        counts = feature["value_counts"]
        validity = feature.get("validity_counts")
        population = (
            f"{validity['valid_voxel_count']}/{validity['total_voxel_count']} valid; "
            f"{validity['outside_voxel_count']} outside; {validity['missing_voxel_count']} missing"
            if validity
            else f"{counts['finite_count']}/{counts['total_count']} finite; {counts['missing_count']} missing"
        )
        summary = feature.get("summary")
        diagnostics = feature.get("diagnostics")
        candidates = feature.get("candidates")
        if summary is None or diagnostics is None or candidates is None:
            range_summary = full_fraction = focused_bounds = tails = log = thresholds = "unavailable"
        else:
            range_summary = " / ".join(
                number(summary[key]) for key in ("min", "q01", "q99", "max")
            )
            full_fraction = number(diagnostics["full_linear_largest_bin_fraction"])
            focused = candidates["focused"]
            focused_bounds = (
                f"[{number(focused['bounds']['lower'])}, {number(focused['bounds']['upper'])}]"
            )
            tails = f"{focused['underflow_count']}/{focused['overflow_count']}"
            log = candidates["full"]["log"]["availability"]
            threshold_items = candidates["full"]["symlog"]["threshold_candidates"]
            thresholds = ", ".join(number(item["linear_threshold"]) for item in threshold_items) or "none"
        sign = f"{counts['negative_count']}/{counts['zero_count']}/{counts['positive_count']}"
        identifier = str(feature.get("id", "")).replace("|", "\\|")
        lines.append(
            f"| {rank} | `{identifier}` | {population} | {sign} | {range_summary} | "
            f"{full_fraction} | {focused_bounds} | {tails} | {log} | {thresholds} |"
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return output
