import base64

import numpy as np

from tools.volume_geometry_review.build import build_review_report


def _unpack(payload: str, shape: tuple[int, int, int]) -> np.ndarray:
    packed = np.frombuffer(base64.b64decode(payload), dtype=np.uint8)
    return np.unpackbits(packed, bitorder="little")[: np.prod(shape)].reshape(shape).astype(bool)


def test_review_report_ranks_exact_flip_without_selecting_production_geometry():
    atlas = np.zeros((3, 4, 2), dtype=bool)
    atlas[0, 0, 0] = True
    atlas[0, 1, 1] = True
    atlas[1, 3, 0] = True
    source = np.flip(atlas, axis=0)
    provenance = {
        "volume": {"sha256": "a" * 64},
        "annotation": {"sha256": "b" * 64},
    }

    report = build_review_report(
        source,
        atlas,
        origin_um=(-200.0, 300.0, 50.0),
        step_um=(50.0, -50.0, -50.0),
        provenance=provenance,
    )

    assert report["candidate_count"] == 8
    assert report["status"].startswith("frozen visual-review evidence")
    assert "D043" in report["status"]
    best = report["candidates"][0]
    assert best["id"] == "ml-reverse_ap-forward_dv-forward"
    assert best["metrics"]["dice"] == 1
    assert best["metrics"]["iou"] == 1
    assert best["index_to_world_um"]["voxel_centers"][:4] == [
        -50.0, 0.0, 0.0, -100.0,
    ]
    assert best["index_to_world_um"]["edge_shifted"][:4] == [
        -50.0, 0.0, 0.0, -125.0,
    ]
    assert np.array_equal(_unpack(report["source_mask"], source.shape), source)
    assert np.array_equal(_unpack(report["atlas_mask"], atlas.shape), atlas)


def test_review_report_rejects_shape_inference_across_different_grids():
    with np.testing.assert_raises_regex(ValueError, "same 3-D shape"):
        build_review_report(
            np.zeros((2, 3, 4), dtype=bool),
            np.zeros((3, 2, 4), dtype=bool),
            origin_um=(0.0, 0.0, 0.0),
            step_um=(50.0, -50.0, -50.0),
            provenance={
                "volume": {"sha256": "a" * 64},
                "annotation": {"sha256": "b" * 64},
            },
        )
