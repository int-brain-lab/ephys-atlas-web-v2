from __future__ import annotations

import numpy as np
import pytest
import hashlib

from tools.projection_pack.build_region_navigation import compute_anchors, nearest_indices, validate_deployment_inputs


def test_generation_checks_explicit_deployment_target_before_loading_native_lut(tmp_path):
    (tmp_path / "manifest.json").write_bytes(b"projection")
    regions = tmp_path / "regions.json"
    regions.write_bytes(b"regions")
    descriptor = lambda raw: {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    config = {"projection": descriptor(b"projection"), "atlas_regions": descriptor(b"regions")}
    validate_deployment_inputs(tmp_path, regions, config)
    config["projection"] = descriptor(b"other projection")
    with pytest.raises(ValueError, match="projection differs"):
        validate_deployment_inputs(tmp_path, regions, config)


def fixture(label, inventories=None):
    inventories = inventories or dict(coronal=list(range(label.shape[0])), sagittal=list(range(label.shape[1])), horizontal=list(range(label.shape[2])))
    lookup = {m: np.array([0, -10, 10, -20], dtype=np.int32) for m in ("allen", "beryl", "cosmos")}
    presence = {m: {a: {i: {-10, 10, -20} for i in indices} for a, indices in inventories.items()} for m in lookup}
    return lookup, inventories, presence


def anchor(rows, region_id):
    return rows[rows[:, 0] == region_id][0, 1:]


def test_signed_centers_remain_inside_each_hemisphere_and_deterministic():
    label = np.zeros((5, 9, 5), dtype=np.uint16)
    label[1:4, 1:4, 1:4] = 1
    label[1:4, 5:8, 1:4] = 2
    params = fixture(label)
    arrays, audit = compute_anchors(label, *params)
    assert anchor(arrays["allen"], -10).tolist() == [2, 2, 2]
    assert anchor(arrays["allen"], 10).tolist() == [2, 6, 2]
    assert anchor(arrays["allen"], -20).tolist() == [-1, -1, -1]
    assert audit["allen"]["no_native_voxels"] == 1
    again, _ = compute_anchors(label, *params)
    assert arrays["allen"].tobytes() == again["allen"].tobytes()


def test_hollow_and_disconnected_region_does_not_return_mean_in_empty_space():
    label = np.ones((5, 5, 5), dtype=np.uint16)
    label[1:4, 1:4, 1:4] = 0
    arrays, _ = compute_anchors(label, *fixture(label))
    point = anchor(arrays["allen"], -10)
    assert label[tuple(point)] == 1
    assert point.tolist() == [0, 2, 2]  # centroid projection, lexicographic tie


def test_sparse_display_crosshairs_gate_an_occupied_native_centroid():
    label = np.zeros((5, 5, 5), dtype=np.uint16)
    label[1:4, 1:4, 1:4] = 1
    params = fixture(label, dict(coronal=[0, 4], sagittal=[0, 4], horizontal=[0, 4]))
    arrays, audit = compute_anchors(label, *params)
    assert anchor(arrays["allen"], -10).tolist() == [-1, -1, -1]
    assert audit["allen"]["no_display_anchor"] == 1
    label[0:4, 0:4, 0:4] = 1
    arrays, _ = compute_anchors(label, *params)
    point = anchor(arrays["allen"], -10)
    assert label[tuple(point)] == 1
    for axis in range(3):
        displayed = point.copy()
        displayed[axis] = nearest_indices([0, 4], 5)[point[axis]]
        assert label[tuple(displayed)] == 1


def test_missing_svg_identity_cannot_claim_display_coverage():
    label = np.ones((3, 3, 3), dtype=np.uint16)
    lookup, inventories, presence = fixture(label)
    for mapping in presence:
        for ids in presence[mapping]["horizontal"].values():
            ids.remove(-10)
    arrays, _ = compute_anchors(label, lookup, inventories, presence)
    assert anchor(arrays["allen"], -10).tolist() == [-1, -1, -1]


def test_nearest_display_tie_matches_browser_lower_rule_and_bad_lut_rejected():
    assert nearest_indices([0, 4, 8], 9).tolist() == [0, 0, 0, 4, 4, 4, 4, 8, 8]
    label = np.full((1, 1, 1), 9, dtype=np.uint16)
    with pytest.raises(ValueError, match="absent"):
        compute_anchors(label, *fixture(label))
