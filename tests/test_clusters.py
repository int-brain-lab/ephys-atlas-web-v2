import json
from pathlib import Path

import numpy as np
import pytest

from ephys_atlas_builder.channels import RegionInfo
from ephys_atlas_builder.clusters import (
    ClusterBuildConfig,
    build_clusters_release_from_arrays,
    discover_cluster_project_dir,
)
from ephys_atlas_builder.statistics import SUMMARY_FIELDS
from ephys_atlas_builder.validate import validate_release


ROOT = Path(__file__).resolve().parents[1]


def _inputs():
    features = {
        "firing_rate": np.array([1.0, 100.0, np.nan, 4.0, 8.0]),
        "amp_median": np.array([10.0, 20.0, 30.0, 40.0, 50.0]),
    }
    ids = {
        # Positive and negative ids intentionally pool into the same left region.
        "allen": np.array([10, -10, 10, 20, -20], dtype=float),
        "beryl": np.array([1, -1, 1, 2, -2], dtype=float),
        "cosmos": np.array([100, -100, 100, 200, -200], dtype=float),
    }
    metadata = {
        "allen": {
            10: RegionInfo(10, "A10", "Allen 10"),
            20: RegionInfo(20, "A20", "Allen 20"),
        },
        "beryl": {
            1: RegionInfo(1, "B1", "Beryl 1"),
            2: RegionInfo(2, "B2", "Beryl 2"),
        },
        "cosmos": {
            100: RegionInfo(100, "C100", "Cosmos 100"),
            200: RegionInfo(200, "C200", "Cosmos 200"),
        },
    }
    return features, ids, metadata


def _config():
    return ClusterBuildConfig(
        release_id="sha256-1234567890abcdef",
        created_at="2026-08-20T00:00:00Z",
        project="explicit-test-project",
        population="all",
        histogram_bins=8,
    )


def _build(path: Path) -> Path:
    features, ids, metadata = _inputs()
    return build_clusters_release_from_arrays(
        path,
        _config(),
        features,
        ids,
        metadata,
        [{"role": "canonical-data", "description": "synthetic cluster recipe test"}],
    )


def test_cluster_recipe_builds_schema_valid_equal_weight_release(tmp_path):
    release = _build(tmp_path / "release")
    validate_release(release, ROOT / "schema" / "v1")

    manifest = json.loads((release / "manifest.json").read_text())
    assert manifest["dataset_id"] == "ephys_atlas_clusters"
    recipe = manifest["provenance"]["recipe"]
    assert recipe["population"] == "all"
    assert recipe["weighting"].startswith(
        "one equal-weight observation per finite cluster"
    )
    assert recipe["qc_filter"] == "none; clusters_good.table.pqt is not used"

    # Sorted folded ids are -20 then -10. Every finite cluster has equal weight,
    # irrespective of insertion identity (which is deliberately not an input).
    values = np.fromfile(release / "features/firing_rate/allen.values.f32", dtype="<f4")
    np.testing.assert_allclose(values, [6.0, 50.5])

    summary = np.fromfile(
        release / "features/firing_rate/allen.summary.f64", dtype="<f8"
    ).reshape(2, len(SUMMARY_FIELDS))
    count = SUMMARY_FIELDS.index("count")
    missing = SUMMARY_FIELDS.index("missing_count")
    median = SUMMARY_FIELDS.index("median")
    std = SUMMARY_FIELDS.index("std")
    minimum = SUMMARY_FIELDS.index("min")
    maximum = SUMMARY_FIELDS.index("max")
    assert summary[1, count] == 2
    assert summary[1, missing] == 1
    assert summary[1, median] == pytest.approx(50.5)
    assert summary[1, std] == pytest.approx(49.5)
    assert summary[1, minimum] == 1
    assert summary[1, maximum] == 100

    feature = json.loads((release / "features/firing_rate/feature.json").read_text())
    # Pure-array inputs make no unsupported unit claim. Snapshot builds use only
    # unit metadata exposed by the pinned upstream schema.
    assert feature["unit"] is None
    assert feature["value_semantics"]["qc_filter"] == "none (all clusters)"


def test_cluster_recipe_is_deterministic(tmp_path):
    a = _build(tmp_path / "a")
    b = _build(tmp_path / "b")
    paths_a = sorted(path.relative_to(a) for path in a.rglob("*") if path.is_file())
    paths_b = sorted(path.relative_to(b) for path in b.rglob("*") if path.is_file())
    assert paths_a == paths_b
    for rel in paths_a:
        assert (a / rel).read_bytes() == (b / rel).read_bytes(), rel


def test_cluster_recipe_emits_explicit_log_color_defaults(tmp_path):
    features, ids, metadata = _inputs()
    config = ClusterBuildConfig(
        release_id="sha256-1234567890abcdef",
        created_at="2026-08-20T00:00:00Z",
        project="explicit-test-project",
        log_color_features=("firing_rate",),
    )
    release = build_clusters_release_from_arrays(
        tmp_path / "release",
        config,
        features,
        ids,
        metadata,
        [{"role": "canonical-data", "description": "display metadata test"}],
    )
    validate_release(release, ROOT / "schema" / "v1")
    firing_rate = json.loads((release / "features/firing_rate/feature.json").read_text())
    amplitude = json.loads((release / "features/amp_median/feature.json").read_text())
    assert firing_rate["display"] == {"scale": "log"}
    assert "display" not in amplitude


def test_cluster_recipe_rejects_implicit_qc_population():
    config = ClusterBuildConfig(
        release_id="release",
        created_at="2026-08-20T00:00:00Z",
        project="project",
        population="good",
    )
    with pytest.raises(ValueError, match="no implicit good-unit"):
        config.validate()


def test_cluster_snapshot_build_requires_code_pins():
    with pytest.raises(ValueError, match="reproducibility pins"):
        _config().require_scientific_pins()


def test_cluster_snapshot_build_requires_explicit_feature_catalog():
    with pytest.raises(ValueError, match="explicit nonempty"):
        _config().require_feature_catalog()

    config = ClusterBuildConfig(
        release_id="release",
        created_at="2026-08-20T00:00:00Z",
        project="project",
        features=("firing_rate",),
    )
    config.require_feature_catalog()


def test_discover_cluster_project_dir(tmp_path):
    aggregates = tmp_path / "project" / "cells_aggregates"
    aggregates.mkdir(parents=True)
    (aggregates / "clusters.table.pqt").write_bytes(b"")
    (aggregates / "clusters_good.table.pqt").write_bytes(b"")
    assert discover_cluster_project_dir(tmp_path) == tmp_path / "project"
