"""Deterministic mechanics for the processed AGEA source audit."""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from tools.agea_processed_audit import audit


def _source(tmp_path: Path) -> tuple[Path, str]:
    source = tmp_path / "source"
    source.mkdir()
    original = np.array(
        [[[[1, -1], [3, 4]], [[5, 6], [7, 8]]]], dtype="<f2"
    )
    processed = np.array(
        [[[[2, 2], [-0.5, 5]], [[2, 2], [-0.5, 5]]]], dtype="<f2"
    )
    (source / "gene-expression.bin").write_bytes(original.tobytes())
    path = source / "gene-expression-processed.bin"
    path.write_bytes(processed.tobytes())
    pd.DataFrame([{"id": "101", "gene": "GeneA"}]).to_parquet(
        source / "gene-expression.pqt", index=False
    )
    np.save(source / "label.npy", np.array([[[1, 1], [0, 0]], [[1, 1], [0, 0]]]))
    return source, hashlib.sha256(path.read_bytes()).hexdigest()


def test_audits_domain_symmetry_and_changed_measurements(tmp_path: Path) -> None:
    source, digest = _source(tmp_path)
    report = audit(
        source,
        shape=(1, 2, 2, 2),
        expected_sha256=digest,
        sample_ids=("101",),
    )
    assert report["processed_counts"]["inside_label"] == {
        "voxels": 4,
        "finite": 4,
        "nonfinite": 0,
        "negative": 0,
        "minus_one": 0,
        "zero": 0,
        "positive": 4,
        "min": 2.0,
        "max": 2.0,
    }
    assert report["processed_counts"]["outside_label"]["negative"] == 2
    assert report["bilateral_symmetry"] == {
        "symmetric_experiments": 1,
        "experiment_count": 1,
        "voxel_mismatches_against_ml_flip": 0,
    }
    comparison = report["comparison_to_original_inside_label"]
    assert comparison["original_missing"] == 1
    assert comparison["original_measured"] == 3
    assert comparison["changed_original_measurements"] == 3
    assert report["samples"]["101"]["processed_exact_bilateral_symmetry"] is True


def test_rejects_hash_shape_and_catalog_mismatches(tmp_path: Path) -> None:
    source, digest = _source(tmp_path)
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        audit(source, shape=(1, 2, 2, 2), expected_sha256="0" * 64, sample_ids=("101",))
    with pytest.raises(ValueError, match="sample experiments are absent"):
        audit(source, shape=(1, 2, 2, 2), expected_sha256=digest, sample_ids=("999",))

    np.save(source / "label.npy", np.zeros((1, 1, 1), dtype="u1"))
    with pytest.raises(ValueError, match="label shape"):
        audit(source, shape=(1, 2, 2, 2), expected_sha256=digest, sample_ids=("101",))
