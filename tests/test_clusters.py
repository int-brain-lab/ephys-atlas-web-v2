from dataclasses import replace
import hashlib
import json
from pathlib import Path
import shlex

import numpy as np
import pytest

from ephys_atlas_builder.channels import RegionInfo
from ephys_atlas_builder.clusters import (
    ClusterBuildConfig,
    _verify_approved_cluster_table,
    apply_cluster_catalog_selection,
    build_clusters_release_from_arrays,
    discover_cluster_project_dir,
    load_cluster_catalog_selection,
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


def test_cluster_manifest_records_complete_builder_command(tmp_path):
    features, ids, metadata = _inputs()
    config = ClusterBuildConfig(
        release_id="sha256-command-v1",
        source_release_id="sha256-source",
        created_at="2026-08-20T00:00:00Z",
        project="explicit-test-project",
        parcellations=("allen", "cosmos"),
        histogram_bins=19,
        paper_snapshot=True,
        ibleatools_commit="1111111",
        iblatlas_commit="2222222",
        builder_commit="3333333",
        catalog_selection=Path("docs/data/CLUSTERS_CATALOG_SELECTION.json"),
        distribution_selection=Path("docs/data/CLUSTERS_DISTRIBUTION_SELECTION.json"),
    )
    release = build_clusters_release_from_arrays(
        tmp_path / "release",
        config,
        features,
        ids,
        metadata,
        [{"role": "canonical-data", "description": "synthetic command test"}],
    )
    manifest = json.loads((release / "manifest.json").read_text())
    command = shlex.split(manifest["provenance"]["builder"]["command"])

    assert command == [
        "ephys-atlas-data", "build-clusters", "sha256-source",
        "--release-id", "sha256-command-v1",
        "--project", "explicit-test-project", "--population", "all",
        "--created-at", "2026-08-20T00:00:00Z",
        "--catalog-selection", "docs/data/CLUSTERS_CATALOG_SELECTION.json",
        "--distribution-selection", "docs/data/CLUSTERS_DISTRIBUTION_SELECTION.json",
        "--histogram-bins", "19",
        "--parcellation", "allen", "--parcellation", "cosmos",
        "--paper-snapshot",
        "--ibleatools-commit", "1111111",
        "--iblatlas-commit", "2222222",
        "--builder-commit", "3333333",
    ]
def test_cluster_recipe_is_deterministic(tmp_path):
    a = _build(tmp_path / "a")
    b = _build(tmp_path / "b")
    paths_a = sorted(path.relative_to(a) for path in a.rglob("*") if path.is_file())
    paths_b = sorted(path.relative_to(b) for path in b.rglob("*") if path.is_file())
    assert paths_a == paths_b
    for rel in paths_a:
        assert (a / rel).read_bytes() == (b / rel).read_bytes(), rel


def test_cluster_recipe_emits_explicit_reviewed_log_distribution(tmp_path):
    features, ids, metadata = _inputs()
    config = ClusterBuildConfig(
        release_id="sha256-1234567890abcdef",
        created_at="2026-08-20T00:00:00Z",
        project="explicit-test-project",
    )
    display = {
        "scales": [{"kind": "linear"}, {"kind": "log"}],
        "preferred_scale": "log",
        "distribution_domains": [{"kind": "full"}],
        "preferred_distribution_domain": "full",
    }
    release = build_clusters_release_from_arrays(
        tmp_path / "release",
        config,
        features,
        ids,
        metadata,
        [{"role": "canonical-data", "description": "display metadata test"}],
        feature_display={"firing_rate": display},
    )
    validate_release(release, ROOT / "schema" / "v1")
    firing_rate = json.loads(
        (release / "features/firing_rate/feature.json").read_text()
    )
    amplitude = json.loads((release / "features/amp_median/feature.json").read_text())
    assert firing_rate["display"]["regional"]["preferred_scale"] == "log"
    assert amplitude["display"]["regional"]["preferred_scale"] == "linear"
    statistics = json.loads(
        (release / "features/firing_rate/allen.statistics.json").read_text()
    )
    binnings = {
        item["id"]: item for item in statistics["distribution"]["binnings"]
    }
    assert set(binnings) == {"linear-full", "log-full"}
    np.testing.assert_allclose(
        binnings["log-full"]["edges"],
        np.geomspace(1.0, 100.0, 51),
    )
    assert sum(binnings["log-full"]["global_counts"]) == 4
    assert (
        release / "features/firing_rate/allen.distribution.log-full.u32"
    ).is_file()


def test_cluster_recipe_rejects_reviewed_log_with_zero_values(tmp_path):
    features, ids, metadata = _inputs()
    features["firing_rate"][0] = 0
    display = {
        "scales": [{"kind": "linear"}, {"kind": "log"}],
        "preferred_scale": "log",
        "distribution_domains": [{"kind": "full"}],
        "preferred_distribution_domain": "full",
    }
    with pytest.raises(ValueError, match="strictly-positive|positive"):
        build_clusters_release_from_arrays(
            tmp_path / "release",
            _config(),
            features,
            ids,
            metadata,
            [{"role": "canonical-data", "description": "invalid log histogram"}],
            feature_display={"firing_rate": display},
        )


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


def test_approved_cluster_catalog_is_machine_consumable():
    selection = load_cluster_catalog_selection(
        ROOT / "docs/data/CLUSTERS_CATALOG_SELECTION_FIRING_RATE_DEFAULTS.json"
    )
    assert selection.source_release_id == "sha256-9b5e55215b306f26"
    assert selection.project == "ibl_neuropixel_brainwide_01"
    assert [feature.source_column for feature in selection.features] == [
        "amp_max",
        "amp_min",
        "amp_median",
        "amp_std_dB",
        "contamination",
        "contamination_alt",
        "drift",
        "missed_spikes_est",
        "noise_cutoff",
        "presence_ratio",
        "presence_ratio_std",
        "slidingRP_viol",
        "spike_count",
        "firing_rate",
    ]
    assert {feature.source_column: feature.unit for feature in selection.features}[
        "drift"
    ] == "um/h"
    assert not hasattr(selection, "display")
    assert not hasattr(selection, "log_histogram_features")


def test_cluster_catalog_selection_fails_closed_on_mismatch(tmp_path):
    selection_path = ROOT / "docs/data/CLUSTERS_CATALOG_SELECTION_FIRING_RATE_DEFAULTS.json"
    selection = load_cluster_catalog_selection(selection_path)
    config = ClusterBuildConfig(
        release_id=selection.source_release_id,
        created_at="2026-08-24T00:00:00Z",
        project=selection.project,
        features=("firing_rate",),
        catalog_selection=selection_path,
    )
    with pytest.raises(ValueError, match="exactly match"):
        apply_cluster_catalog_selection(config, selection)

    document = json.loads(selection_path.read_text())
    document["scientific_owner_confirmation"] = False
    bad_path = tmp_path / "selection.json"
    bad_path.write_text(json.dumps(document))
    with pytest.raises(ValueError, match="scientific-owner confirmation"):
        load_cluster_catalog_selection(bad_path)


def test_cluster_output_identity_is_independent_from_pinned_source_identity():
    selection = load_cluster_catalog_selection(
        ROOT / "docs/data/CLUSTERS_CATALOG_SELECTION_FIRING_RATE_DEFAULTS.json"
    )
    config = apply_cluster_catalog_selection(
        ClusterBuildConfig(
            release_id="sha256-9b5e55215b306f26-firing-defaults-v1",
            source_release_id=selection.source_release_id,
            created_at="2026-08-26T00:00:00Z",
            project=selection.project,
            catalog_selection=Path(
                "docs/data/CLUSTERS_CATALOG_SELECTION_FIRING_RATE_DEFAULTS.json"
            ),
        ),
        selection,
    )
    assert config.release_id == "sha256-9b5e55215b306f26-firing-defaults-v1"
    assert config.source_release_id == selection.source_release_id
    assert config.catalog_selection == Path(
        "docs/data/CLUSTERS_CATALOG_SELECTION_FIRING_RATE_DEFAULTS.json"
    )


def test_approved_cluster_table_is_verified_before_decode(tmp_path):
    project_dir = tmp_path / "ibl_neuropixel_brainwide_01"
    table = project_dir / "cells_aggregates/clusters.table.pqt"
    table.parent.mkdir(parents=True)
    table.write_bytes(b"approved")
    selection = replace(
        load_cluster_catalog_selection(
            ROOT / "docs/data/CLUSTERS_CATALOG_SELECTION.json"
        ),
        table_path=str(table.relative_to(tmp_path)),
        table_bytes=table.stat().st_size,
        table_sha256=hashlib.sha256(table.read_bytes()).hexdigest(),
    )
    assert _verify_approved_cluster_table(tmp_path, project_dir, selection) == table
    table.write_bytes(b"corrupt!")
    with pytest.raises(RuntimeError, match="SHA-256"):
        _verify_approved_cluster_table(tmp_path, project_dir, selection)


def test_discover_cluster_project_dir(tmp_path):
    aggregates = tmp_path / "project" / "cells_aggregates"
    aggregates.mkdir(parents=True)
    (aggregates / "clusters.table.pqt").write_bytes(b"")
    (aggregates / "clusters_good.table.pqt").write_bytes(b"")
    assert discover_cluster_project_dir(tmp_path) == tmp_path / "project"
