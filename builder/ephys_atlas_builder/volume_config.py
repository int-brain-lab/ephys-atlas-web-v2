"""Explicit volume build configuration and reviewed grid geometry."""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, replace
from itertools import product
from pathlib import Path

import numpy as np

from .io import sha256_file

DATASET_ID = "ephys_atlas_volumes"
_COMMIT_RE = re.compile(r"^[0-9a-f]{7,40}$")
_IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


@dataclass(frozen=True)
class VolumeBuildConfig:
    release_id: str
    created_at: str
    source_release_id: str | None = None
    resolution_um: int | None = None
    reference_space_id: str | None = None
    grid_id: str | None = None
    index_to_world_um: tuple[float, ...] | None = None
    outside_value: float | None = None
    missing_values: str | None = None
    layout: str | None = None
    pack_depth: int | None = None
    chunk_shape: tuple[int, int, int] | None = None
    features: tuple[str, ...] | None = None
    feature_display: Mapping[str, dict] | None = None
    histogram_bins: int = 50
    paper_snapshot: bool = False
    ibleatools_commit: str | None = None
    iblatlas_commit: str | None = None
    builder_commit: str | None = None
    geometry_selection: Path | None = None
    distribution_selection: Path | None = None
    regional_distribution_selection: Path | None = None
    regional_annotation: Path | None = None
    candidate: bool = False
    # Separate volume datasets reuse this recipe; the default keeps the encoding-volume identity.
    dataset_id: str = DATASET_ID
    title: str | None = None

    def validate(self) -> None:
        if not self.release_id:
            raise ValueError("release_id is required")
        if not self.created_at:
            raise ValueError(
                "created_at is required for deterministic release metadata"
            )
        if self.resolution_um is None or self.resolution_um <= 0:
            raise ValueError("resolution_um must be explicitly positive")
        if not self.reference_space_id:
            raise ValueError("reference_space_id is required and must not be inferred")
        if not self.grid_id:
            raise ValueError("grid_id is required and must not be inferred")
        if self.index_to_world_um is None:
            raise ValueError("index_to_world_um is required and must not be inferred")
        if len(self.index_to_world_um) != 16:
            raise ValueError("index_to_world_um must contain exactly 16 values")
        if self.outside_value is None or not math.isfinite(self.outside_value):
            raise ValueError("outside_value must be an explicit finite sentinel")
        if self.missing_values != "nonfinite":
            raise ValueError("missing_values must be explicitly nonfinite")
        if self.layout not in {"chunks3d", "orthogonal_slice_packs"}:
            raise ValueError(
                "layout must be explicitly chunks3d or orthogonal_slice_packs"
            )
        if self.layout == "orthogonal_slice_packs":
            if self.pack_depth is None or self.pack_depth < 1:
                raise ValueError(
                    "orthogonal_slice_packs requires an explicit positive pack_depth"
                )
            if self.chunk_shape is not None:
                raise ValueError("chunk_shape is not valid for orthogonal_slice_packs")
        else:
            if (
                self.chunk_shape is None
                or len(self.chunk_shape) != 3
                or any(value < 1 for value in self.chunk_shape)
            ):
                raise ValueError(
                    "chunks3d requires an explicit positive three-value chunk_shape"
                )
            if self.pack_depth is not None:
                raise ValueError("pack_depth is not valid for chunks3d")
        if self.histogram_bins < 2:
            raise ValueError("histogram_bins must be >= 2")
        if self.features is not None:
            if not self.features or len(set(self.features)) != len(self.features):
                raise ValueError("features must be nonempty and unique when provided")
            invalid = [
                feature
                for feature in self.features
                if not _IDENTIFIER_RE.fullmatch(feature)
            ]
            if invalid:
                raise ValueError(f"invalid feature identifiers: {', '.join(invalid)}")
        for name, value in (
            ("ibleatools_commit", self.ibleatools_commit),
            ("iblatlas_commit", self.iblatlas_commit),
            ("builder_commit", self.builder_commit),
        ):
            if value is not None and not _COMMIT_RE.fullmatch(value):
                raise ValueError(
                    f"{name} must be a 7-40 character lowercase Git commit"
                )

    def require_scientific_pins(self) -> None:
        missing = [
            name
            for name, value in (
                ("ibleatools_commit", self.ibleatools_commit),
                ("iblatlas_commit", self.iblatlas_commit),
                ("builder_commit", self.builder_commit),
            )
            if value is None
        ]
        if missing:
            raise ValueError(
                f"snapshot builds require reproducibility pins: {', '.join(missing)}"
            )


@dataclass(frozen=True)
class VolumeGeometrySelection:
    path: Path
    sha256: str
    resolution_um: int
    reference_space_id: str
    grid_id: str
    grid_shape: tuple[int, int, int]
    index_to_world_um: tuple[float, ...]
    outside_value: float
    missing_values: str
    source_uri: str
    source_bytes: int
    source_sha256: str
    iblatlas_commit: str
    audited_value_count: int


def load_volume_geometry_selection(path: Path) -> VolumeGeometrySelection:
    """Load one owner-approved geometry record and reject incomplete policy."""
    path = path.resolve()
    try:
        document = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot load volume geometry selection {path}") from error
    try:
        source = document["source"]
        volume = source["volume"]
        validity = document["validity"]
        shape = tuple(document["grid_shape"])
        affine = tuple(document["index_to_world_um"])
    except (KeyError, TypeError) as error:
        raise ValueError("volume geometry selection is incomplete") from error
    if document.get("schema") != "ibl-volume-geometry-selection-v1":
        raise ValueError("unsupported volume geometry selection schema")
    if document.get("scientific_owner_confirmation") is not True:
        raise ValueError("volume geometry selection lacks scientific-owner confirmation")
    if document.get("axis_order") != ["ml", "ap", "dv"]:
        raise ValueError("volume geometry selection must declare ML/AP/DV source axes")
    if document.get("index_convention") != "voxel_centers":
        raise ValueError("volume geometry selection must declare voxel centers")
    if len(shape) != 3 or any(type(value) is not int or value < 1 for value in shape):
        raise ValueError("volume geometry selection has an invalid grid shape")
    if len(affine) != 16 or any(
        isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
        for value in affine
    ):
        raise ValueError("volume geometry selection has an invalid affine")
    if validity.get("missing_values") != "nonfinite":
        raise ValueError("volume geometry selection has an unsupported missing policy")
    if not isinstance(validity.get("outside_value"), (int, float)) or not math.isfinite(
        validity["outside_value"]
    ):
        raise ValueError("volume geometry selection has an invalid outside sentinel")
    if type(validity.get("audited_value_count")) is not int or validity["audited_value_count"] < math.prod(shape):
        raise ValueError("volume geometry selection has an invalid validity audit count")
    if validity.get("audited_nan_count") != 0 or validity.get("audited_infinite_count") != 0:
        raise ValueError("volume geometry selection validity audit is not the approved W26 policy")
    sha = volume.get("sha256")
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{64}", sha):
        raise ValueError("volume geometry selection has an invalid source SHA-256")
    selection = VolumeGeometrySelection(
        path=path,
        sha256=sha256_file(path),
        resolution_um=int(document["resolution_um"]),
        reference_space_id=str(document["reference_space_id"]),
        grid_id=str(document["grid_id"]),
        grid_shape=shape,
        index_to_world_um=tuple(float(value) for value in affine),
        outside_value=float(validity["outside_value"]),
        missing_values=validity["missing_values"],
        source_uri=str(volume["uri"]),
        source_bytes=int(volume["bytes"]),
        source_sha256=sha,
        iblatlas_commit=str(source["iblatlas"]["commit"]),
        audited_value_count=validity["audited_value_count"],
    )
    if selection.resolution_um <= 0 or not selection.reference_space_id or not selection.grid_id:
        raise ValueError("volume geometry selection has invalid grid identity")
    return selection


def apply_volume_geometry_selection(
    config: VolumeBuildConfig, selection: VolumeGeometrySelection
) -> VolumeBuildConfig:
    """Populate scientific geometry only from the reviewed selection record."""
    return replace(
        config,
        resolution_um=selection.resolution_um,
        reference_space_id=selection.reference_space_id,
        grid_id=selection.grid_id,
        index_to_world_um=selection.index_to_world_um,
        outside_value=selection.outside_value,
        missing_values=selection.missing_values,
        geometry_selection=config.geometry_selection or selection.path,
    )

def _clean_floats(values: np.ndarray) -> list[float]:
    return [
        0.0 if abs(float(value)) < 1e-12 else float(value)
        for value in values.reshape(-1)
    ]


def _grid_descriptor(config: VolumeBuildConfig, shape: tuple[int, int, int]) -> dict:
    matrix = np.asarray(config.index_to_world_um, dtype=np.float64).reshape(4, 4)
    if not np.isfinite(matrix).all() or not np.array_equal(matrix[3], [0, 0, 0, 1]):
        raise ValueError(
            "index_to_world_um must be a finite affine with homogeneous row [0, 0, 0, 1]"
        )
    spatial = matrix[:3, :3]
    nonzero = np.abs(spatial) > 1e-12
    if not np.all(nonzero.sum(axis=0) == 1) or not np.all(nonzero.sum(axis=1) == 1):
        raise ValueError("index_to_world_um must be an axis-aligned signed permutation")
    inverse = np.linalg.inv(matrix)
    corners = np.array(
        [
            [i0, i1, i2, 1.0]
            for i0, i1, i2 in product(
                (-0.5, shape[0] - 0.5),
                (-0.5, shape[1] - 0.5),
                (-0.5, shape[2] - 0.5),
            )
        ]
    )
    world = corners @ matrix.T
    bounds = [(world[:, axis].min(), world[:, axis].max()) for axis in range(3)]
    extent = np.asarray([value for pair in bounds for value in pair])
    # Schema order is [ml_min, ml_max, ap_min, ap_max, dv_min, dv_max].
    return {
        "reference_space_id": config.reference_space_id,
        "grid_id": config.grid_id,
        "world_axes": ["ml", "ap", "dv"],
        "shape": list(shape),
        "index_to_world_um": _clean_floats(matrix),
        "world_to_index": _clean_floats(inverse),
        "voxel_edge_extent_um": _clean_floats(extent),
        "index_convention": "integer-centers-half-integer-edges",
    }


