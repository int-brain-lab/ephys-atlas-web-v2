"""Schema-v1 projections semantic checks; no alternate release contract."""

from __future__ import annotations
from typing import Any

from ._schema_v1_common import _fail, _unique
from ._schema_v1_volume import _affine_semantics


_PROJECTION_AXES = {"coronal": "ap", "sagittal": "ml", "horizontal": "dv"}

_STATIC_PATH_COUNTS = {"top": 114, "swanson": 808}


def _registered_semantics(document: dict[str, Any]) -> None:
    shape = [document["slice_count"], *document["slice_shape"]]
    matrix = document["plane_index_to_world_um"]
    _affine_semantics(matrix, shape, document["voxel_edge_extent_um"], document.get("world_to_plane_index"))
    expected_axis = _PROJECTION_AXES[document["id"]]
    if document["world_slice_axis"] != expected_axis:
        _fail(f"{document['id']} must slice the {expected_axis} world axis")
    world_row = {"ml": 0, "ap": 1, "dv": 2}[expected_axis]
    if matrix[world_row * 4] == 0:
        _fail("registered plane slice coordinate does not map to its declared world axis")
    slices = document["display_slices"]
    if slices != sorted(slices) or any(index >= document["slice_count"] for index in slices):
        _fail("registered display slices must be increasing and inside the native domain")


def _registered_resource_index_semantics(document: dict[str, Any]) -> None:
    resources = document["resources"]
    _unique([entry["pack_id"] for entry in resources], "registered SVG pack id")
    _unique([entry["resource"]["path"] for entry in resources], "registered SVG resource path")
    slices: list[int] = []
    for entry in resources:
        entry_slices = entry["slice_indices"]
        if entry_slices != sorted(entry_slices):
            _fail("registered SVG resource slices must be increasing")
        resource = entry["resource"]
        if resource["media_type"] != "application/vnd.ibl.indexed-svg":
            _fail("registered SVG packs must use the indexed-SVG media type")
        if resource["codec"]["name"] != "gzip":
            _fail("registered SVG packs must be gzip-compressed")
        slices.extend(entry_slices)
    if slices != sorted(slices) or len(slices) != len(set(slices)):
        _fail("registered SVG resource index slices must be globally increasing and unique")


def _static_semantics(document: dict[str, Any]) -> None:
    if document["view_box"] != [60, 20, 340, 300]:
        _fail("static projection view box does not match pinned source evidence")
    if document["path_count"] != _STATIC_PATH_COUNTS[document["id"]]:
        _fail("static projection path count does not match pinned source evidence")
    resource = document["fragment"]["resource"]
    if resource["media_type"] != "image/svg+xml" or resource["codec"]["name"] != "gzip":
        _fail("static projection fragment must be gzip-compressed UTF-8 SVG")


def _projection_pack_semantics(document: dict[str, Any]) -> None:
    if set(document["mappings"]) != {"allen", "beryl", "cosmos"}:
        _fail("projection pack must declare the complete Allen/Beryl/Cosmos mappings")
    projections = document["projections"]
    ids = [projection["id"] for projection in projections]
    if set(ids) != {"coronal", "sagittal", "horizontal", "top", "swanson"} or len(set(ids)) != 5:
        _fail("projection pack must contain each projection exactly once")
    for projection in projections:
        if projection["kind"] == "registered-slice-stack":
            if projection["reference_space_id"] != document["reference_space_id"]:
                _fail("registered projection reference space differs from its pack")
            _registered_semantics(projection)
        else:
            _static_semantics(projection)
