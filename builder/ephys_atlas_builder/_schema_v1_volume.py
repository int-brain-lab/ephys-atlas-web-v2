"""Schema-v1 volume semantic checks; no alternate release contract."""

from __future__ import annotations
import math
from typing import Any

from ._schema_v1_common import _DTYPE_BYTES, _fail, _unique


def _derive_inverse(matrix: list[float]) -> list[float]:
    inverse = [0.0] * 16
    inverse[15] = 1.0
    for world_row in range(3):
        nonzero = [column for column in range(3) if matrix[world_row * 4 + column] != 0]
        if len(nonzero) != 1:
            _fail("affine spatial rows must each have exactly one nonzero term")
        index_column = nonzero[0]
        scale = matrix[world_row * 4 + index_column]
        translation = matrix[world_row * 4 + 3]
        inverse[index_column * 4 + world_row] = 1.0 / scale
        inverse[index_column * 4 + 3] = -translation / scale
    return inverse


def _close(left: float, right: float) -> bool:
    return math.isclose(left, right, rel_tol=1e-10, abs_tol=1e-9)


def _affine_semantics(
    matrix: list[float],
    shape: list[int],
    extent: list[float],
    inverse: list[float] | None,
) -> None:
    if not all(math.isfinite(value) for value in [*matrix, *extent]):
        _fail("affine and extent values must be finite")
    if matrix[12:] != [0, 0, 0, 1]:
        _fail("affine homogeneous row must be [0, 0, 0, 1]")
    for column in range(3):
        if sum(matrix[row * 4 + column] != 0 for row in range(3)) != 1:
            _fail("affine spatial columns must each have exactly one nonzero term")

    derived = _derive_inverse(matrix)
    if inverse is not None:
        if not all(math.isfinite(value) for value in inverse):
            _fail("inverse affine values must be finite")
        if not all(_close(actual, expected) for actual, expected in zip(inverse, derived)):
            _fail("declared inverse does not match the index-to-world affine")

    derived_extent: list[float] = []
    for world_row in range(3):
        index_column = next(column for column in range(3) if matrix[world_row * 4 + column] != 0)
        scale = matrix[world_row * 4 + index_column]
        translation = matrix[world_row * 4 + 3]
        edges = [translation + scale * -0.5, translation + scale * (shape[index_column] - 0.5)]
        derived_extent.extend([min(edges), max(edges)])
    if not all(_close(actual, expected) for actual, expected in zip(extent, derived_extent)):
        _fail("voxel-edge extent does not match affine and shape")


def _volume_semantics(document: dict[str, Any]) -> None:
    grid = document["grid"]
    _affine_semantics(
        grid["index_to_world_um"],
        grid["shape"],
        grid["voxel_edge_extent_um"],
        grid.get("world_to_index"),
    )
    validity = document["validity"]
    if validity["kind"] == "mask":
        mask = validity["mask"]
        if mask["dtype"] != "uint8" or mask["shape"] != grid["shape"]:
            _fail("validity mask must be uint8 with the volume grid shape")
        if len(set(validity["codes"].values())) != 3:
            _fail("validity mask codes must be distinct")


def _resource_index_semantics(document: dict[str, Any]) -> None:
    entries = document["chunks"] if document["layout"] == "chunks3d" else document["packs"]
    _unique([entry["resource"]["path"] for entry in entries], "volume resource path")
    for entry in entries:
        decoded = entry["decoded"]
        expected = math.prod(decoded["shape"]) * _DTYPE_BYTES[decoded["dtype"]]
        if entry["resource"]["codec"]["decoded_bytes"] != expected:
            _fail("volume resource decoded length does not match its decoded block")
    if document["layout"] == "chunks3d":
        _unique([entry["origin"] for entry in entries], "volume chunk origin")
        for entry in entries:
            if any(size > limit for size, limit in zip(entry["decoded"]["shape"], document["chunk_shape"])):
                _fail("decoded chunk shape exceeds declared chunk shape")
    else:
        axes = [entry["axis"] for entry in entries]
        if set(axes) != {"i0", "i1", "i2"}:
            _fail("orthogonal slice packs must cover i0, i1, and i2")
        _unique([[entry["axis"], entry["first_slice"]] for entry in entries], "slice-pack position")
        for entry in entries:
            if entry["decoded"]["storage_axes"][0] != entry["axis"]:
                _fail("slice-pack decoded leading axis must match its slice axis")
            if entry["decoded"]["shape"][0] != entry["slice_count"]:
                _fail("slice-pack decoded leading size must match slice_count")
            if entry["slice_count"] > document["pack_depth"]:
                _fail("slice-pack slice_count exceeds pack_depth")
