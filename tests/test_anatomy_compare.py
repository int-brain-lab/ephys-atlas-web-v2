from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from tools.anatomy_compare.build import (
    atlas_index,
    coordinate_um,
    nearest_legacy_fragment,
    parse_args,
    plane_for_axis,
    point_to_polyline_distances,
    simplify_ring,
    vectorize_plane,
    write_report,
)


def test_closed_ring_simplification_is_deterministic_and_bounded():
    ring = np.array(
        [
            [0, 0],
            [0, 1],
            [0, 2],
            [0, 3],
            [1, 3],
            [2, 3],
            [3, 3],
            [3, 2],
            [3, 1],
            [3, 0],
            [0, 0],
        ],
        dtype=float,
    )
    simplified = simplify_ring(ring, 0.6)
    assert np.array_equal(simplified, simplify_ring(ring, 0.6))
    assert np.array_equal(simplified[0], simplified[-1])
    assert len(simplified) < len(ring)
    assert np.max(point_to_polyline_distances(ring[:-1], simplified)) <= 0.6


def test_slice_coordinates_map_to_atlas_resolution():
    assert coordinate_um("coronal", 660) == -1200
    assert coordinate_um("sagittal", 570) == -39
    assert coordinate_um("horizontal", 400) == -3668
    assert atlas_index("coronal", 660, 25, 528) == 264
    assert atlas_index("sagittal", 570, 25, 456) == 228
    assert atlas_index("horizontal", 400, 25, 320) == 160


def test_nearest_legacy_slice_prefers_lower_index_on_tie():
    index, fragment = nearest_legacy_fragment({"2": "two", "4": "four"}, 3)
    assert (index, fragment) == (2, "two")


def test_vectorization_reduces_a_synthetic_label_plane_with_bounded_error():
    pytest.importorskip("skimage")
    plane = np.zeros((32, 36), dtype=np.uint16)
    plane[3:28, 4:31] = 1
    plane[10:18, 12:22] = 2
    plane[5:8, 6:9] = 3
    plane[22:25, 25:29] = 3

    exact_fragment, exact = vectorize_plane(plane, resolution_um=10, tolerance_um=0)
    candidate_fragment, candidate = vectorize_plane(
        plane, resolution_um=10, tolerance_um=10
    )

    assert exact.regions == candidate.regions == 3
    assert candidate.rings == exact.rings
    assert candidate.vertices_after < exact.vertices_after
    assert candidate.max_error_um <= 10
    assert candidate.raw_bytes < exact.raw_bytes
    assert 'fill-rule="evenodd"' in exact_fragment
    assert "allen_region_3" in candidate_fragment
    assert candidate.topology_validated is False


def test_vectorization_closes_regions_at_plane_edges_without_a_diagonal_cut():
    pytest.importorskip("skimage")
    plane = np.zeros((8, 8), dtype=np.uint16)
    plane[:4, :5] = 1

    _fragment, metrics = vectorize_plane(plane, resolution_um=10, tolerance_um=0)

    assert metrics.regions == 1
    assert metrics.rings == 1
    assert metrics.vertices_before > 10


def test_projection_orientation_is_explicit():
    label = np.arange(3 * 4 * 2).reshape(3, 4, 2)
    assert np.array_equal(plane_for_axis(label, "coronal", 1), label[1, :, :].T)
    assert np.array_equal(
        plane_for_axis(label, "sagittal", 2), np.flip(label[:, 2, :].T, axis=1)
    )
    assert np.array_equal(plane_for_axis(label, "horizontal", 1), label[:, :, 1])


def test_report_writer_inlines_data_without_external_resources(tmp_path: Path):
    template = tmp_path / "template.html"
    output = tmp_path / "report.html"
    template.write_text(
        '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'">'
        '<script type="application/json">__ANATOMY_COMPARISON_DATA__</script>'
    )
    data = {"schema": "test", "unsafe": "</script><script>alert(1)</script>"}
    write_report(data, template, output)
    text = output.read_text()
    assert "__ANATOMY_COMPARISON_DATA__" not in text
    assert "<\\/script>" in text
    assert '"schema":"test"' in text  # compact serialization is used
    assert "http://" not in text and "https://" not in text


def test_tolerance_cli_requires_an_unsimplified_reference():
    args = parse_args(["--tolerances-um", "0,10,20"])
    assert args.tolerances_um == (0.0, 10.0, 20.0)
    with pytest.raises(SystemExit):
        parse_args(["--tolerances-um", "10,20"])
