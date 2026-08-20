from __future__ import annotations

import gzip
import json
from pathlib import Path

import numpy as np
from iblatlas.regions import BrainRegions
from jsonschema import Draft202012Validator

from tools.anatomy_pack.build_v2 import (
    LABEL_SHAPE,
    PROJECTIONS,
    _sentinels,
    _write_pack,
    atlas_ids_for_row,
    map_annotation_block,
    plane_for_projection,
    slice_paths,
)
from tools.anatomy_pack.geometry import (
    geometry_path,
    geometry_path_relative,
    raster_label_geometries,
)


def test_raw_annotation_mapping_uses_physical_midline_and_both_signs() -> None:
    regions = BrainRegions()
    raw = np.full((1, 575, 1), 8, dtype=np.uint32)
    mapped = map_annotation_block(raw, regions)

    assert int(regions.id[mapped[0, 0, 0]]) == -8
    assert int(regions.id[mapped[0, 573, 0]]) == -8
    assert int(regions.id[mapped[0, 574, 0]]) == 8


def test_bilateral_ids_preserve_source_hemisphere_for_every_mapping() -> None:
    regions = BrainRegions()
    positive = atlas_ids_for_row(regions, 2)
    negative = atlas_ids_for_row(regions, 1329)
    assert all(value > 0 for value in positive.values())
    assert all(value < 0 for value in negative.values())
    assert {name: abs(value) for name, value in negative.items()} == positive


def test_projection_planes_cover_full_real_10um_grid() -> None:
    scalar = np.zeros(1, dtype=np.uint16)
    label = np.lib.stride_tricks.as_strided(
        scalar, shape=LABEL_SHAPE, strides=(0, 0, 0), writeable=False
    )
    assert plane_for_projection(label, "coronal", 0).shape == (800, 1140)
    assert plane_for_projection(label, "sagittal", 0).shape == (800, 1320)
    assert plane_for_projection(label, "horizontal", 0).shape == (1320, 1140)


def test_real_affines_round_trip_bilateral_sentinels() -> None:
    for sentinel in _sentinels():
        expected = np.asarray([*sentinel["world_um"], 1.0])
        for projection, indices in sentinel["projection_indices"].items():
            matrix = np.asarray(PROJECTIONS[projection].matrix).reshape(4, 4)
            np.testing.assert_allclose(matrix @ [*indices, 1], expected)
            np.testing.assert_allclose(np.linalg.inv(matrix) @ expected, [*indices, 1])


def test_bilateral_paths_declare_evenodd_and_keep_internal_background() -> None:
    regions = BrainRegions()
    plane = np.full((7, 7), 2, dtype=np.uint16)
    plane[2:5, 2:5] = 0
    paths, validation = slice_paths(plane, regions)
    assert paths[0]["fill_rule"] == "evenodd"
    assert paths[0]["d"].count("M") == 2
    assert validation.background_topology_valid
    assert validation.internal_background_components_before == 1
    assert validation.maximum_boundary_error_upper_bound_um == 0


def test_compact_path_is_deterministic_exact_and_keeps_hole_subpaths() -> None:
    regions = BrainRegions()
    plane = np.full((7, 7), 2, dtype=np.uint16)
    plane[2:5, 2:5] = 0
    paths, validation = slice_paths(plane, regions)
    compact = paths[0]["d"]

    assert compact == slice_paths(plane, regions)[0][0]["d"]
    assert compact == "M-.5 -.5v7h7v-7zM1.5 1.5v3h3v-3z"
    assert compact.count("M") == 2
    assert "h" in compact and "v" in compact
    assert "L" not in compact
    assert validation.vertices_after < validation.vertices_before

    geometry = raster_label_geometries(plane)[2]
    assert compact == geometry_path_relative(geometry)
    assert len(compact) < len(geometry_path(geometry))


def test_v2_gzip_pack_is_deterministic_and_schema_valid(tmp_path: Path) -> None:
    slices = [
        {
            "slice_index": 0,
            "world_coordinate_um": 5400,
            "paths": [
                {
                    "atlas_ids": {"allen": -8, "beryl": -997, "cosmos": -997},
                    "fill_rule": "evenodd",
                    "d": "M-0.5 -0.5L0.5 -0.5 0.5 0.5Z",
                },
                {
                    "atlas_ids": {"allen": 8, "beryl": 997, "cosmos": 997},
                    "fill_rule": "evenodd",
                    "d": "M0.5 -0.5L1.5 -0.5 1.5 0.5Z",
                },
            ],
        }
    ]
    artifact = _write_pack(
        tmp_path,
        pack_id="synthetic-bilateral-v2",
        projection="coronal",
        depth=16,
        pack_index=0,
        slices=slices,
    )
    compressed = (tmp_path / artifact["path"]).read_bytes()
    decoded = json.loads(gzip.decompress(compressed))
    schema = json.loads(
        Path("schema/anatomy-pack-v2/slice-pack.schema.json").read_text()
    )
    Draft202012Validator(schema).validate(decoded)
