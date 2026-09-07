"""Derive bounded geometric evidence for the exploratory AGEA alignment lab.

Matching index geometry is not biological registration acceptance.  The helper
only compares the hash-pinned loader affine with a native projection manifest.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Sequence

import numpy as np


RAW_AXES = ("ML", "DV", "AP")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _matrix(values: Sequence[float], name: str) -> np.ndarray:
    matrix = np.asarray(values, dtype=np.float64)
    if matrix.size != 16 or not np.all(np.isfinite(matrix)):
        raise ValueError(f"{name} must be a finite 4x4 affine")
    matrix = matrix.reshape(4, 4)
    if not np.array_equal(matrix[3], [0, 0, 0, 1]):
        raise ValueError(f"{name} must use homogeneous voxel-centre coordinates")
    return matrix


def derive_alignment_evidence(
    source_index_to_world_um: Sequence[float],
    source_shape: Sequence[int],
    native_manifest: dict[str, Any],
    *,
    candidate_reference_space_id: str | None = None,
) -> dict[str, Any]:
    """Compare AGEA raw ``ML,DV,AP`` indices with native registered indices."""
    source = _matrix(source_index_to_world_um, "source affine")
    shape = np.asarray(source_shape, dtype=np.int64)
    if shape.shape != (3,) or np.any(shape <= 0):
        raise ValueError("source shape must contain three positive dimensions")
    manifest_frame = native_manifest.get("reference_space_id")
    if not isinstance(manifest_frame, str) or not manifest_frame:
        raise ValueError("native manifest has no reference_space_id")
    if candidate_reference_space_id is not None and candidate_reference_space_id != manifest_frame:
        raise ValueError("candidate reference space does not match native manifest")

    projections = {p.get("id"): p for p in native_manifest.get("projections", [])}
    coronal = projections.get("coronal")
    if not coronal or coronal.get("kind") != "registered-slice-stack":
        raise ValueError("native manifest has no registered coronal projection")
    if coronal.get("reference_space_id") != manifest_frame:
        raise ValueError("native projection reference space mismatch")
    coronal_affine = _matrix(coronal.get("plane_index_to_world_um", []), "native coronal affine")
    coronal_shape = np.asarray(
        [coronal.get("slice_count"), *coronal.get("slice_shape", [])], dtype=np.int64
    )
    if coronal_shape.shape != (3,) or np.any(coronal_shape <= 0):
        raise ValueError("native coronal projection has invalid grid dimensions")

    source_steps = source[:3, :3]
    packed_steps = coronal_affine[:3, :3]
    if np.count_nonzero(source_steps) != 3 or np.count_nonzero(packed_steps) != 3:
        raise ValueError("source and native axes must be axis-aligned")
    # Registered projection affines use [slice, horizontal, vertical], so put
    # their columns back into the source's raw ML,DV,AP axis order.
    source_world_rows = np.argmax(np.abs(source_steps), axis=0)
    if not np.array_equal(source_world_rows, [0, 2, 1]):
        raise ValueError("source and native axis signs or order differ")
    packed_world_rows = np.argmax(np.abs(packed_steps), axis=0)
    try:
        order = [int(np.flatnonzero(packed_world_rows == row)[0]) for row in source_world_rows]
    except IndexError as exc:
        raise ValueError("source and native axis signs or order differ") from exc
    native = np.eye(4)
    native[:3, :3] = packed_steps[:, order]
    native[:3, 3] = coronal_affine[:3, 3]
    native_shape = coronal_shape[order]
    native_steps = native[:3, :3]
    if not np.array_equal(np.sign(source_steps), np.sign(native_steps)):
        raise ValueError("source and native axis signs or order differ")
    native_spacing = np.linalg.norm(native_steps, axis=0)
    source_spacing = np.linalg.norm(source_steps, axis=0)
    scale = source_spacing / native_spacing
    if not np.allclose(scale, np.round(scale), atol=1e-9) or np.any(scale <= 0):
        raise ValueError("source spacing is not an integer multiple of native spacing")
    scale_i = np.round(scale).astype(np.int64)
    offset = np.linalg.solve(native_steps, source[:3, 3] - native[:3, 3])
    if not np.allclose(offset, np.round(offset), atol=1e-9):
        raise ValueError("source origin is not on a native voxel centre")
    offset_i = np.round(offset).astype(np.int64)

    source_last_native = offset_i + scale_i * (shape - 1)
    in_bounds_max = np.minimum(shape - 1, np.floor_divide(native_shape - 1 - offset_i, scale_i))
    in_bounds_min = np.maximum(0, np.ceil((-offset_i) / scale_i).astype(np.int64))
    if np.any(in_bounds_max < in_bounds_min):
        in_bounds_count = 0
    else:
        in_bounds_count = int(np.prod(in_bounds_max - in_bounds_min + 1))
    mismatches = []
    for i, axis in enumerate(RAW_AXES):
        if offset_i[i] < 0 or source_last_native[i] >= native_shape[i]:
            mismatches.append({
                "axis": axis,
                "source_last_native_index": int(source_last_native[i]),
                "native_last_index": int(native_shape[i] - 1),
            })

    return {
        "status": "geometric candidate only; zero biological registration acceptance",
        "candidate_reference_space_id": manifest_frame,
        "source_axis_order": list(RAW_AXES),
        "source_shape": shape.tolist(),
        "native_shape": native_shape.tolist(),
        "source_index_to_world_um": source.ravel().tolist(),
        "native_index_to_world_um": native.ravel().tolist(),
        "native_indices_per_source_index": scale_i.tolist(),
        "native_index_offset": offset_i.tolist(),
        "in_bounds_source_index_min": in_bounds_min.tolist(),
        "in_bounds_source_index_max": in_bounds_max.tolist(),
        "in_bounds_voxel_centres": in_bounds_count,
        "source_voxel_centres": int(np.prod(shape)),
        "extent_mismatch": mismatches,
        "clamping_permitted": False,
    }


def load_projection_manifest(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    raw = path.read_bytes()
    return json.loads(raw), {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
