from __future__ import annotations

import json

import numpy as np

from ephys_atlas_builder.distribution_audit import (
    audit_distribution,
    audit_feature_arrays,
    audit_volume_feature_arrays,
    audit_npz_arrays,
    audit_volume_source_npz,
    write_audit_review_table,
)
from ephys_atlas_builder.io import sha256_file


def test_distribution_audit_keeps_exact_counts_and_offers_no_default(tmp_path):
    values = np.array([-100.0, -2.0, 0.0, 1.0, 2.0, 1000.0, np.nan, np.inf])
    result = audit_distribution(values, bins=4, regional_count_rows=3)

    assert result["value_counts"] == {
        "total_count": 8, "finite_count": 6, "missing_count": 2,
        "nan_count": 1, "positive_infinity_count": 1, "negative_infinity_count": 0,
        "positive_count": 3, "negative_count": 2, "zero_count": 1,
    }
    assert sum(result["candidates"]["full"]["linear"]["histogram"]["counts"]) == 6
    assert result["candidates"]["full"]["log"]["availability"] == "unavailable"
    symlog = result["candidates"]["full"]["symlog"]
    assert symlog["availability"] == "candidate-only"
    assert sum(symlog["threshold_candidates"][0]["histogram"]["counts"]) == 6
    focused = result["candidates"]["focused"]
    assert focused["underflow_count"] + focused["inside_count"] + focused["overflow_count"] == 6
    assert sum(focused["variants"]["linear"]["histogram"]["counts"]) == focused["inside_count"]
    assert sum(focused["variants"]["symlog"]["threshold_candidates"][0]["histogram"]["counts"]) == focused["inside_count"]
    assert focused["whole_population_count"] == 6
    for variant in (focused["variants"]["linear"], focused["variants"]["symlog"]["threshold_candidates"][0]):
        histogram = variant["histogram"]
        assert histogram["edges"][0] == focused["bounds"]["lower"]
        assert histogram["edges"][-1] == focused["bounds"]["upper"]
    assert result["artifact_size_estimates"]["per_full_binning"]["regional_counts_bytes"] == 48

    output = tmp_path / "audit.json"
    audit_feature_arrays(
        {"mixed": values}, output, dataset_id="synthetic", release_id="r1",
        representation="regional", population="synthetic rows", observation_unit="rows",
    )
    report = json.loads(output.read_text())
    assert report["read_only"] is True
    assert report["defaults_selected"] is False
    assert report["features"][0]["id"] == "mixed"


def test_distribution_audit_provides_exact_log_only_for_strictly_positive_values():
    result = audit_distribution(np.array([0.25, 1.0, 4.0, 16.0]), bins=3)
    log = result["candidates"]["full"]["log"]
    assert log["availability"] == "available"
    assert sum(log["histogram"]["counts"]) == 4
    assert all(edge > 0 for edge in log["histogram"]["edges"])
    focused_log = result["candidates"]["focused"]["variants"]["log"]
    assert focused_log["availability"] == "available"
    assert sum(focused_log["histogram"]["counts"]) == result["candidates"]["focused"]["inside_count"]


def test_focused_log_does_not_hide_negative_tail_or_snap_edges_to_observations():
    result = audit_distribution(np.array([-1.0, 1.0, 2.0, 3.0, 4.0, 100.0]), bins=4)
    focused = result["candidates"]["focused"]
    assert focused["variants"]["log"]["availability"] == "unavailable"
    edges = focused["variants"]["linear"]["histogram"]["edges"]
    assert edges[0] == focused["bounds"]["lower"]
    assert edges[-1] == focused["bounds"]["upper"]
    assert edges[0] != 1.0
    assert edges[-1] != 4.0


def test_volume_audit_uses_validity_classification_before_distribution(tmp_path):
    output = tmp_path / "volume-audit.json"
    audit_volume_feature_arrays(
        {"feature": np.array([0.0, 1.0, -1.0, np.nan, np.inf])}, output,
        dataset_id="ephys_atlas_volumes", release_id="candidate", outside_value=0.0,
        bins=2,
    )
    feature = json.loads(output.read_text())["features"][0]
    assert feature["validity_counts"] == {
        "total_voxel_count": 5, "valid_voxel_count": 2,
        "outside_voxel_count": 1, "missing_voxel_count": 2,
    }
    assert feature["value_counts"]["finite_count"] == 2


def test_npz_source_array_adapter_requires_explicit_volume_validity(tmp_path):
    source = tmp_path / "source.npz"
    np.savez(source, feature=np.array([0.0, 2.0]))
    output = tmp_path / "audit.json"
    try:
        audit_npz_arrays(
            source, output, dataset_id="volumes", release_id="r1",
            representation="volume", population="ignored", observation_unit="ignored",
        )
    except ValueError as error:
        assert "outside_value" in str(error)
    else:
        raise AssertionError("volume audit accepted implicit validity semantics")


def test_npz_source_array_adapter_records_exact_input_evidence(tmp_path):
    source = tmp_path / "source.npz"
    np.savez(source, feature=np.array([1.0, 2.0]))
    output = tmp_path / "audit.json"
    audit_npz_arrays(
        source, output, dataset_id="channels", release_id="r1",
        representation="regional", population="pinned rows", observation_unit="rows",
    )
    evidence = json.loads(output.read_text())["source_array_evidence"]
    assert evidence["path"] == str(source.resolve())
    assert evidence["bytes"] == source.stat().st_size
    assert len(evidence["sha256"]) == 64


def test_verified_last_axis_volume_source_adapter(tmp_path):
    source = tmp_path / "canonical-volume.npz"
    values = np.array(
        [[[[0.0, 0.0], [1.0, -2.0]], [[2.0, np.nan], [3.0, 4.0]]]],
        dtype=np.float32,
    )
    np.savez(source, ephys_atlas_vol=values, feature_names=np.array(["one", "two"]))
    output = tmp_path / "audit.json"

    audit_volume_source_npz(
        source,
        output,
        dataset_id="volumes",
        release_id="source-v1",
        outside_value=0.0,
        expected_bytes=source.stat().st_size,
        expected_sha256=sha256_file(source),
        bins=2,
    )

    report = json.loads(output.read_text())
    assert [feature["id"] for feature in report["features"]] == ["one", "two"]
    assert report["features"][0]["validity_counts"] == {
        "total_voxel_count": 4,
        "valid_voxel_count": 3,
        "outside_voxel_count": 1,
        "missing_voxel_count": 0,
    }
    assert report["features"][1]["validity_counts"] == {
        "total_voxel_count": 4,
        "valid_voxel_count": 2,
        "outside_voxel_count": 1,
        "missing_voxel_count": 1,
    }
    assert report["source_array_evidence"]["sha256"] == sha256_file(source)


def test_last_axis_volume_source_adapter_rejects_unverified_bytes(tmp_path):
    source = tmp_path / "canonical-volume.npz"
    np.savez(source, ephys_atlas_vol=np.zeros((1, 1, 1, 1)), feature_names=np.array(["one"]))

    try:
        audit_volume_source_npz(
            source,
            tmp_path / "audit.json",
            dataset_id="volumes",
            release_id="source-v1",
            outside_value=0.0,
            expected_bytes=source.stat().st_size,
            expected_sha256="0" * 64,
        )
    except ValueError as error:
        assert "SHA-256" in str(error)
    else:
        raise AssertionError("volume audit accepted an unverified source")


def test_review_table_ranks_display_concentration_without_selecting_defaults(tmp_path):
    report = tmp_path / "audit.json"
    audit_feature_arrays(
        {
            "readable": np.array([1.0, 2.0, 3.0, 4.0]),
            "collapsed": np.array([1.0, 1.0, 1.0, 1000.0]),
        },
        report,
        dataset_id="synthetic",
        release_id="r1",
        representation="regional",
        population="rows",
        observation_unit="rows",
        bins=4,
    )
    table = tmp_path / "review.md"
    write_audit_review_table(report, table)

    text = table.read_text()
    assert text.index("`collapsed`") < text.index("`readable`")
    assert "selects no scale, threshold, focused bounds, or default" in text
    assert "| 1 |" in text
