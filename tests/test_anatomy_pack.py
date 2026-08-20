from __future__ import annotations

import gzip
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from jsonschema import Draft202012Validator
from shapely import coverage_is_valid

from tools.anatomy_pack.build import (
    PROJECTIONS,
    _sentinels,
    _slice_paths,
    _write_pack,
    atlas_ids_for_row,
    canonical_json,
    plane_for_projection,
)
from tools.anatomy_pack.geometry import (
    geometry_path,
    raster_label_geometries,
    simplify_coverage,
)


def fake_regions() -> SimpleNamespace:
    return SimpleNamespace(
        id=np.asarray([0, 10, -10, 20, -20]),
        mappings={
            "Allen": np.asarray([0, 1, 2, 3, 4]),
            "Beryl": np.asarray([0, 1, 1, 3, 3]),
            "Cosmos": np.asarray([0, 1, 1, 1, 1]),
        },
    )


def test_raster_polygonization_is_valid_exact_coverage_at_junctions() -> None:
    plane = np.asarray(
        [
            [2, 2, 3, 3],
            [2, 3, 3, 3],
            [4, 4, 3, 3],
            [4, 0, 0, 3],
        ],
        dtype=np.uint16,
    )
    geometries = raster_label_geometries(plane)

    assert sorted(geometries) == [2, 3, 4]
    assert coverage_is_valid(list(geometries.values()))
    assert sum(geometry.area for geometry in geometries.values()) == 14


def test_coverage_simplification_preserves_topology_and_has_bounded_error() -> None:
    plane = np.zeros((12, 12), dtype=np.uint16)
    plane[1:11, 1:6] = 2
    plane[1:11, 6:11] = 3
    plane[4:8, 4:8] = 4
    exact = raster_label_geometries(plane)

    candidate, validation = simplify_coverage(
        exact,
        tolerance_um=10,
        resolution_um=25,
        maximum_error_um=10,
        minimum_iou=1,
        minimum_iou_area_um2=10_000,
    )

    assert coverage_is_valid(list(candidate.values()))
    assert validation.coverage_valid_after
    assert validation.adjacency_preserved
    assert validation.components_before == validation.components_after
    assert validation.holes_before == validation.holes_after
    assert validation.minimum_eligible_region_iou == 1
    assert validation.maximum_boundary_error_upper_bound_um == pytest.approx(3.125)
    assert validation.vertices_after <= validation.vertices_before


def test_geometry_path_is_canonical_and_uses_half_integer_cell_edges() -> None:
    geometry = raster_label_geometries(np.asarray([[2, 2]], dtype=np.uint16))[2]
    first = geometry_path(geometry)
    second = geometry_path(geometry)

    assert first == second
    assert first.startswith("M-0.5 -0.5")
    assert first.endswith("Z")
    assert "<" not in first


def test_region_rows_map_directly_to_left_folded_stable_ids() -> None:
    assert atlas_ids_for_row(fake_regions(), 2) == {
        "allen": -10,
        "beryl": -10,
        "cosmos": -10,
    }
    assert atlas_ids_for_row(fake_regions(), 4) == {
        "allen": -20,
        "beryl": -20,
        "cosmos": -10,
    }


def test_slice_paths_exclude_background_and_fold_source_rows_left() -> None:
    plane = np.asarray([[0, 2, 2], [0, 4, 4]], dtype=np.uint16)
    paths, validation = _slice_paths(
        plane,
        fake_regions(),
        tolerance_um=0,
        maximum_error_um=10,
        minimum_iou=1,
    )
    assert [path["atlas_ids"]["allen"] for path in paths] == [-10, -20]
    assert validation.region_count == 2

    right_source, _ = _slice_paths(
        np.asarray([[1]], dtype=np.uint16),
        fake_regions(),
        tolerance_um=0,
        maximum_error_um=10,
        minimum_iou=1,
    )
    assert right_source[0]["atlas_ids"]["allen"] == -10


def test_projection_planes_are_left_only_and_sagittal_ap_is_display_flipped() -> None:
    label = np.zeros((528, 456, 320), dtype=np.uint16)
    label[0, 0, 0] = 2
    label[527, 0, 0] = 4
    label[0, 229, 0] = 3

    coronal = plane_for_projection(label, "coronal", 0)
    sagittal = plane_for_projection(label, "sagittal", 0)
    horizontal = plane_for_projection(label, "horizontal", 0)

    assert coronal.shape == (320, 230)
    assert horizontal.shape == (528, 230)
    assert coronal[0, 0] == 2
    assert coronal[0, 229] == 3
    assert sagittal.shape == (320, 528)
    assert sagittal[0, 0] == 4
    assert sagittal[0, 527] == 2


def test_affines_and_sentinels_share_slice_u_v_world_coordinates() -> None:
    for sentinel in _sentinels():
        expected = np.asarray([*sentinel["world_um"], 1.0])
        for projection, indices in sentinel["projection_indices"].items():
            matrix = np.asarray(PROJECTIONS[projection].matrix).reshape(4, 4)
            actual = matrix @ np.asarray([*indices, 1.0])
            np.testing.assert_allclose(actual, expected)
            np.testing.assert_allclose(np.linalg.inv(matrix) @ expected, [*indices, 1])


def test_gzip_slice_pack_is_deterministic_and_matches_schema(tmp_path: Path) -> None:
    slices = [
        {
            "slice_index": 0,
            "world_coordinate_um": 5400,
            "paths": [
                {
                    "atlas_ids": {"allen": -10, "beryl": -10, "cosmos": -10},
                    "d": "M-0.5 -0.5L0.5 -0.5 0.5 0.5Z",
                }
            ],
        }
    ]
    first = _write_pack(
        tmp_path,
        pack_id="synthetic-test-v1",
        projection="coronal",
        depth=16,
        pack_index=0,
        slices=slices,
    )
    payload = (tmp_path / first["path"]).read_bytes()
    second_root = tmp_path / "second"
    second = _write_pack(
        second_root,
        pack_id="synthetic-test-v1",
        projection="coronal",
        depth=16,
        pack_index=0,
        slices=slices,
    )

    assert payload == (second_root / second["path"]).read_bytes()
    decoded = json.loads(gzip.decompress(payload))
    schema = json.loads(
        Path("schema/anatomy-pack-v1/slice-pack.schema.json").read_text()
    )
    Draft202012Validator(schema).validate(decoded)
    assert gzip.decompress(payload) == canonical_json(decoded)
