"""Synthetic coordinate checks for AGEA alignment evidence."""
import copy

import pytest

from tools.agea_alignment_evidence import derive_alignment_evidence


SOURCE = [
    200, 0, 0, -5739,
    0, 0, -200, 5400,
    0, -200, 0, 332,
    0, 0, 0, 1,
]


def native_manifest():
    return {
        "reference_space_id": "allen-ccf-2017",
        "projections": [{
            "id": "coronal", "kind": "registered-slice-stack",
            "reference_space_id": "allen-ccf-2017",
            "slice_shape": [1140, 800], "slice_count": 1320,
            "plane_index_to_world_um": [
                0, 10, 0, -5739,
                -10, 0, 0, 5400,
                0, 0, -10, 332,
                0, 0, 0, 1,
            ],
        }],
    }


def test_exact_origin_scale_and_unclamped_extent_are_reported():
    evidence = derive_alignment_evidence(SOURCE, [58, 41, 67], native_manifest())
    assert evidence["native_indices_per_source_index"] == [20, 20, 20]
    assert evidence["native_index_offset"] == [0, 0, 0]
    assert evidence["in_bounds_source_index_max"] == [56, 39, 65]
    assert evidence["in_bounds_voxel_centres"] == 57 * 40 * 66
    assert evidence["source_voxel_centres"] == 58 * 41 * 67
    assert evidence["extent_mismatch"] == [
        {"axis": "ML", "source_last_native_index": 1140, "native_last_index": 1139},
        {"axis": "DV", "source_last_native_index": 800, "native_last_index": 799},
        {"axis": "AP", "source_last_native_index": 1320, "native_last_index": 1319},
    ]
    assert evidence["clamping_permitted"] is False
    assert "zero biological" in evidence["status"]


@pytest.mark.parametrize("position", [0, 6])
def test_axis_sign_or_order_error_is_rejected(position):
    affine = SOURCE.copy()
    affine[position] *= -1
    with pytest.raises(ValueError, match="axis signs or order"):
        derive_alignment_evidence(affine, [58, 41, 67], native_manifest())


def test_axis_order_error_is_rejected():
    affine = SOURCE.copy()
    for row in range(4):
        affine[row * 4], affine[row * 4 + 1] = affine[row * 4 + 1], affine[row * 4]
    with pytest.raises(ValueError, match="axis signs or order"):
        derive_alignment_evidence(affine, [58, 41, 67], native_manifest())


def test_half_voxel_origin_is_rejected():
    affine = SOURCE.copy()
    affine[3] += 5
    with pytest.raises(ValueError, match="voxel centre"):
        derive_alignment_evidence(affine, [58, 41, 67], native_manifest())


def test_candidate_frame_mismatch_is_rejected():
    with pytest.raises(ValueError, match="candidate reference space"):
        derive_alignment_evidence(
            SOURCE, [58, 41, 67], native_manifest(),
            candidate_reference_space_id="allen-reference-9",
        )


def test_projection_frame_mismatch_is_rejected():
    manifest = copy.deepcopy(native_manifest())
    manifest["projections"][0]["reference_space_id"] = "some-other-frame"
    with pytest.raises(ValueError, match="projection reference space"):
        derive_alignment_evidence(SOURCE, [58, 41, 67], manifest)
