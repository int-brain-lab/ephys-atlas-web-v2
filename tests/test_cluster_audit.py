import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from ephys_atlas_builder.cluster_audit import audit_cluster_snapshot
from ephys_atlas_builder.io import canonical_json, sha256_file, write_json


def _snapshot(tmp_path: Path) -> Path:
    project = "ibl_neuropixel_brainwide_01"
    staging = tmp_path / "staging"
    table = staging / project / "cells_aggregates/clusters.table.pqt"
    table.parent.mkdir(parents=True)
    pd.DataFrame(
        {
            "finite": np.array([1.0, 2.0, 3.0, 4.0]),
            "mixed": np.array([0.0, -2.0, np.nan, np.inf]),
        }
    ).to_parquet(table)
    files = [{
        "path": table.relative_to(staging).as_posix(),
        "bytes": table.stat().st_size,
        "sha256": sha256_file(table),
    }]
    release = "sha256-" + hashlib.sha256(canonical_json(files)).hexdigest()[:16]
    snapshot = tmp_path / release
    staging.rename(snapshot)
    write_json(snapshot / "source.json", {
        "schema_version": "1.0",
        "dataset_id": "ephys_atlas_clusters",
        "requested_release": "latest",
        "resolved_release": release,
        "project": project,
        "canonical_source": {"uri": "s3://example/project/"},
        "files": files,
    })
    return snapshot


def test_cluster_audit_records_integrity_schema_units_and_distributions(tmp_path):
    snapshot = _snapshot(tmp_path)
    output = tmp_path / "audit.json"
    audit_cluster_snapshot(
        snapshot,
        output,
        project="ibl_neuropixel_brainwide_01",
        features=("finite", "mixed"),
        histogram_bins=4,
        upstream_metadata={
            "finite": {"unit": "V", "description": "Finite values"},
            "mixed": {"unit": None, "description": None},
        },
    )

    report = json.loads(output.read_text())
    assert report["release_id"] == snapshot.name
    assert report["source"]["row_count"] == 4
    finite, mixed = report["features"]
    assert finite["source_dtype"] == "double"
    assert finite["unit"] == "V"
    assert finite["finite_count"] == 4
    assert sum(finite["histogram"]["counts"]) == 4
    assert mixed["finite_count"] == 2
    assert mixed["missing_count"] == 2
    assert mixed["nan_count"] == 1
    assert mixed["positive_infinity_count"] == 1
    assert mixed["negative_count"] == 1


def test_cluster_audit_fails_closed_on_missing_candidate(tmp_path):
    with pytest.raises(RuntimeError, match="candidate cluster features are missing"):
        audit_cluster_snapshot(
            _snapshot(tmp_path),
            tmp_path / "audit.json",
            project="ibl_neuropixel_brainwide_01",
            features=("absent",),
            upstream_metadata={"absent": {}},
        )


def test_cluster_audit_fails_before_decode_on_table_integrity_mismatch(tmp_path):
    snapshot = _snapshot(tmp_path)
    table = snapshot / "ibl_neuropixel_brainwide_01/cells_aggregates/clusters.table.pqt"
    table.write_bytes(table.read_bytes() + b"corrupt")
    with pytest.raises(RuntimeError, match="source table integrity mismatch"):
        audit_cluster_snapshot(
            snapshot,
            tmp_path / "audit.json",
            project="ibl_neuropixel_brainwide_01",
            features=("finite",),
            upstream_metadata={"finite": {}},
        )
