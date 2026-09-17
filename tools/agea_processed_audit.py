"""Audit the pinned processed AGEA product against its original source.

This tool records source and transformation evidence.  It does not reproduce
the upstream PPCA, bilateral averaging, or curtaining correction.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

from tools.agea_benchmark import SHAPE

PROCESSED_NAME = "gene-expression-processed.bin"
PROCESSED_SHA256 = "2c3cabd41a422a449f9ced791ccfc5e0f3b3ff8db328ff970086685aec96d41e"
PROCESSING_COMMIT = "52083adf44825d0622a503705e095699a5957587"
PROCESSING_SCRIPT_SHA256 = "d7ce788b67a74af33e098dc734d53374892b79e91757198582e0803d1478d23c"
DEFAULT_SAMPLES = ("74658173", "71247618", "858", "75081210", "70436317")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _counts(values: np.ndarray) -> dict[str, int | float]:
    finite = np.isfinite(values)
    return {
        "voxels": int(values.size),
        "finite": int(finite.sum()),
        "nonfinite": int((~finite).sum()),
        "negative": int((values < 0).sum()),
        "minus_one": int((values == -1).sum()),
        "zero": int((values == 0).sum()),
        "positive": int((values > 0).sum()),
        "min": float(np.min(values)) if values.size else 0.0,
        "max": float(np.max(values)) if values.size else 0.0,
    }


def audit(
    source: Path,
    *,
    shape: tuple[int, int, int, int] = SHAPE,
    expected_sha256: str = PROCESSED_SHA256,
    sample_ids: tuple[str, ...] = DEFAULT_SAMPLES,
) -> dict:
    """Return full-catalog processed/original comparison evidence."""
    processed_path = source / PROCESSED_NAME
    original_path = source / "gene-expression.bin"
    expected_bytes = int(np.prod(shape)) * np.dtype("<f2").itemsize
    if processed_path.stat().st_size != expected_bytes:
        raise ValueError("unexpected processed AGEA byte length")
    digest = sha256(processed_path)
    if digest != expected_sha256:
        raise ValueError(
            f"processed AGEA SHA-256 mismatch: expected {expected_sha256}, got {digest}"
        )
    if original_path.stat().st_size != expected_bytes:
        raise ValueError("unexpected original AGEA byte length")

    labels = np.load(source / "label.npy")
    if labels.shape != shape[1:]:
        raise ValueError("AGEA label shape does not match expression volumes")
    inside = labels != 0
    outside = ~inside
    rows = pd.read_parquet(source / "gene-expression.pqt")
    if len(rows) != shape[0]:
        raise ValueError("AGEA catalog length does not match expression volumes")
    ids = rows["id"].astype(str).tolist()
    id_to_index = {experiment_id: index for index, experiment_id in enumerate(ids)}
    missing_samples = sorted(set(sample_ids) - set(id_to_index))
    if missing_samples:
        raise ValueError(f"sample experiments are absent: {missing_samples}")

    processed = np.memmap(processed_path, dtype="<f2", mode="r", shape=shape)
    original = np.memmap(original_path, dtype="<f2", mode="r", shape=shape)
    totals = {
        scope: {key: 0 for key in ("voxels", "finite", "nonfinite", "negative", "minus_one", "zero", "positive")}
        for scope in ("inside_label", "outside_label")
    }
    extrema = {
        "inside_label": {"min": float("inf"), "max": float("-inf")},
        "outside_label": {"min": float("inf"), "max": float("-inf")},
    }
    symmetric_experiments = 0
    symmetry_mismatches = 0
    original_missing_inside = 0
    original_measured_inside = 0
    changed_original_measurements = 0
    absolute_difference_sum = 0.0
    absolute_difference_max = 0.0
    samples: dict[str, dict] = {}

    for index, experiment_id in enumerate(ids):
        processed_volume = np.asarray(processed[index])
        original_volume = np.asarray(original[index])
        mismatch_count = int(
            np.count_nonzero(processed_volume != np.flip(processed_volume, axis=0))
        )
        symmetry_mismatches += mismatch_count
        symmetric_experiments += mismatch_count == 0

        for scope, mask in (("inside_label", inside), ("outside_label", outside)):
            counts = _counts(processed_volume[mask])
            for key in totals[scope]:
                totals[scope][key] += int(counts[key])
            extrema[scope]["min"] = min(extrema[scope]["min"], float(counts["min"]))
            extrema[scope]["max"] = max(extrema[scope]["max"], float(counts["max"]))

        measured = inside & (original_volume >= 0)
        missing = inside & (original_volume == -1)
        differences = np.abs(
            processed_volume[measured].astype(np.float64)
            - original_volume[measured].astype(np.float64)
        )
        original_missing_inside += int(missing.sum())
        original_measured_inside += int(measured.sum())
        changed_original_measurements += int(np.count_nonzero(differences))
        absolute_difference_sum += float(differences.sum(dtype=np.float64))
        absolute_difference_max = max(
            absolute_difference_max,
            float(differences.max(initial=0.0)),
        )

        if experiment_id in sample_ids:
            sample = {
                "index": index,
                "gene": str(rows.iloc[index]["gene"]),
                "original_missing_inside": int(missing.sum()),
                "original_measured_inside": int(measured.sum()),
                "changed_original_measurements": int(np.count_nonzero(differences)),
                "measured_inside_mean_absolute_difference": (
                    float(differences.mean()) if differences.size else 0.0
                ),
                "processed_inside": _counts(processed_volume[inside]),
                "processed_outside": _counts(processed_volume[outside]),
                "processed_exact_bilateral_symmetry": mismatch_count == 0,
            }
            samples[experiment_id] = sample

    for scope in totals:
        totals[scope].update(extrema[scope])
    report = {
        "format": "agea-processed-source-audit-v1",
        "scientific_release": False,
        "source": {
            "path": PROCESSED_NAME,
            "bytes": expected_bytes,
            "sha256": digest,
            "last_modified": "2025-03-18T14:03:46Z",
            "catalog_experiments": shape[0],
            "shape": list(shape),
            "dtype": "little-endian float16",
        },
        "upstream_processing": {
            "repository": "int-brain-lab/iblatlas",
            "commit": PROCESSING_COMMIT,
            "script": "iblatlas/genomics/gene_expression_scrapping/06-denoise-impute.py",
            "script_sha256": PROCESSING_SCRIPT_SHA256,
            "published_intermediate": "ppca_dual_curtain.bin",
            "steps": [
                "50-component PPCA reconstruction on nonzero-label voxels",
                "ML-reflected bilateral nanmean",
                "per-experiment coronal slice weighting within [0.5, 2] using Cosmos-region medians",
            ],
        },
        "anatomical_domain": {
            "rule": "label.npy != 0",
            "voxels_per_experiment": int(inside.sum()),
            "outside_voxels_per_experiment": int(outside.sum()),
            "basis": "the upstream PPCA reconstruction is assigned only to nonzero-label voxels",
        },
        "processed_counts": totals,
        "bilateral_symmetry": {
            "symmetric_experiments": symmetric_experiments,
            "experiment_count": shape[0],
            "voxel_mismatches_against_ml_flip": symmetry_mismatches,
        },
        "comparison_to_original_inside_label": {
            "original_missing": original_missing_inside,
            "original_measured": original_measured_inside,
            "changed_original_measurements": changed_original_measurements,
            "changed_fraction": (
                changed_original_measurements / original_measured_inside
                if original_measured_inside
                else 0.0
            ),
            "mean_absolute_difference": (
                absolute_difference_sum / original_measured_inside
                if original_measured_inside
                else 0.0
            ),
            "maximum_absolute_difference": absolute_difference_max,
        },
        "samples": samples,
        "interpretation": {
            "audit_selects_release_input": False,
            "outside_values_have_no_missing-sentinel_semantics": True,
            "negative_inside_values_are_retained_processing_output": True,
            "registration_status": "unchanged and provisional",
        },
    }
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = audit(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"source": report["source"], "processed_counts": report["processed_counts"]}, indent=2))


if __name__ == "__main__":
    main()
