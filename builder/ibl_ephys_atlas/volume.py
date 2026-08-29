"""Verified Allen CCF geometry and validity for public volume authoring.

This module deliberately accepts only already-created ``iblatlas`` Allen atlas
objects.  It derives schema-v1 geometry from their ``BrainCoordinates`` and
never downloads atlas data, infers an affine from array shape, or modifies
submitted scientific values.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
from importlib.metadata import PackageNotFoundError, version
from itertools import product
import json
from pathlib import Path
from typing import Any, Literal, Sequence

import numpy as np

from ephys_atlas_builder.io import json_resource, write_array, write_json
from ephys_atlas_builder.regional_release import (
    build_global_distribution_binnings,
    linear_full_display,
)
from ephys_atlas_builder.statistics import describe
from ephys_atlas_builder.volume import write_chunked_volume


_AXES = ("ml", "ap", "dv")
_SUPPORTED_RESOLUTIONS_UM = (10, 25, 50)


def _iblatlas_version() -> str:
    try:
        return version("iblatlas")
    except PackageNotFoundError:  # pragma: no cover - broken installation
        return "unknown"


def _clean_floats(values: np.ndarray) -> tuple[float, ...]:
    return tuple(
        0.0 if abs(float(value)) < 1e-12 else float(value)
        for value in values.reshape(-1)
    )


def _extent(matrix: np.ndarray, shape: tuple[int, int, int]) -> tuple[float, ...]:
    corners = np.asarray(
        [
            [i0, i1, i2, 1.0]
            for i0, i1, i2 in product(
                (-0.5, shape[0] - 0.5),
                (-0.5, shape[1] - 0.5),
                (-0.5, shape[2] - 0.5),
            )
        ],
        dtype=np.float64,
    )
    world = corners @ matrix.T
    return _clean_floats(
        np.asarray(
            [
                coordinate
                for axis in range(3)
                for coordinate in (world[:, axis].min(), world[:, axis].max())
            ]
        )
    )


@dataclass(frozen=True, init=False)
class AllenCCFGrid:
    """One immutable Allen CCF sampling grid expressed in schema-v1 axes.

    Construct grids only with :meth:`from_iblatlas`.  Public attributes expose
    the verified array shape and axis order, the row-major index-to-world and
    world-to-index matrices, voxel-edge extent, reference/grid identities, and
    the ``iblatlas`` implementation identity recorded in release provenance.

    Integer array indices denote voxel centers; half-integers denote voxel
    edges.  Matrix rows map to world axes ``(ml, ap, dv)`` in micrometres, while
    matrix columns follow :attr:`array_axes`.
    """

    reference_space_id: str
    grid_id: str
    shape: tuple[int, int, int]
    array_axes: tuple[str, str, str]
    index_to_world_um: tuple[float, ...]
    world_to_index: tuple[float, ...]
    voxel_edge_extent_um: tuple[float, ...]
    resolution_um: int
    iblatlas_version: str
    atlas_class: str

    def __init__(self, *_args: Any, **_kwargs: Any) -> None:
        raise TypeError("AllenCCFGrid must be created with AllenCCFGrid.from_iblatlas()")

    @classmethod
    def _verified(cls, **values: Any) -> "AllenCCFGrid":
        instance = object.__new__(cls)
        for name, value in values.items():
            object.__setattr__(instance, name, value)
        return instance

    @classmethod
    def from_iblatlas(
        cls,
        atlas: Any,
        *,
        array_axes: Sequence[str],
    ) -> "AllenCCFGrid":
        """Verify and translate an already-created ``AllenAtlas`` grid.

        Args:
            atlas: Existing :class:`iblatlas.atlas.AllenAtlas`.  Constructing
                the atlas, including any cache access or download, remains the
                caller's responsibility; this method only inspects it.
            array_axes: Exact permutation of ``("ml", "ap", "dv")`` describing
                the three submitted value-array dimensions.  For the native
                ``AllenAtlas.image``/``label`` order, use
                ``("ap", "ml", "dv")``.

        Returns:
            A frozen grid with an exact ``allen-ccf-2017`` reference-space ID,
            geometry-derived grid ID, affine inverse, and voxel-edge extent.

        Raises:
            RuntimeError: If ``iblatlas`` is unavailable.
            TypeError: If ``atlas`` is not an already-created ``AllenAtlas``.
            ValueError: If axes, resolution, spacing, shapes, dimension maps,
                or ``BrainCoordinates`` are unsupported or inconsistent.

        Only the standard 10, 25, and 50 micrometre Allen grids are accepted.
        Scaled atlases are rejected.  Matching reference-space IDs permit
        compositing, but matching shapes or grid IDs alone never establish
        coordinate compatibility.

        Example:
            >>> from iblatlas.atlas import AllenAtlas
            >>> atlas = AllenAtlas(res_um=50)  # may use/download caller cache
            >>> grid = AllenCCFGrid.from_iblatlas(
            ...     atlas, array_axes=("ap", "ml", "dv")
            ... )
            >>> grid.shape == atlas.image.shape
            True
        """
        try:
            from iblatlas.atlas import AllenAtlas
        except ImportError as error:  # pragma: no cover - installation failure
            raise RuntimeError("volume authoring requires the iblatlas package") from error
        if not isinstance(atlas, AllenAtlas):
            raise TypeError("atlas must be an already-created iblatlas.atlas.AllenAtlas")

        axes = tuple(array_axes)
        if len(axes) != 3 or set(axes) != set(_AXES):
            raise ValueError("array_axes must be one exact permutation of ('ml', 'ap', 'dv')")
        resolution = getattr(atlas, "res_um", None)
        if isinstance(resolution, bool) or resolution not in _SUPPORTED_RESOLUTIONS_UM:
            raise ValueError("AllenAtlas resolution must be exactly 10, 25, or 50 micrometres")

        bc = getattr(atlas, "bc", None)
        image = np.asarray(getattr(atlas, "image", None))
        label = np.asarray(getattr(atlas, "label", None))
        dims2xyz = np.asarray(getattr(atlas, "dims2xyz", None))
        xyz2dims = np.asarray(getattr(atlas, "xyz2dims", None))
        if bc is None or image.ndim != 3 or label.shape != image.shape:
            raise ValueError("AllenAtlas must expose matching three-dimensional image and label grids")
        if (
            dims2xyz.shape != (3,)
            or xyz2dims.shape != (3,)
            or set(dims2xyz.tolist()) != {0, 1, 2}
            or set(xyz2dims.tolist()) != {0, 1, 2}
            or not np.array_equal(dims2xyz[xyz2dims], np.arange(3))
        ):
            raise ValueError("AllenAtlas axis mappings are not an exact three-axis permutation")

        nxyz = np.asarray(bc.nxyz)
        origins_m = np.asarray([bc.x0, bc.y0, bc.z0], dtype=np.float64)
        steps_m = np.asarray(bc.dxyz, dtype=np.float64)
        if (
            nxyz.shape != (3,)
            or not np.all(np.isfinite(nxyz))
            or np.any(nxyz != np.trunc(nxyz))
            or np.any(nxyz < 1)
            or not np.all(np.isfinite(origins_m))
            or not np.all(np.isfinite(steps_m))
        ):
            raise ValueError("AllenAtlas BrainCoordinates are incomplete or non-finite")
        expected_steps = np.asarray([resolution, -resolution, -resolution], dtype=np.float64) * 1e-6
        if not np.array_equal(steps_m, expected_steps):
            raise ValueError("scaled or non-standard AllenAtlas voxel spacing is unsupported")

        native_shape = tuple(int(nxyz[int(xyz)]) for xyz in dims2xyz)
        if native_shape != tuple(image.shape):
            raise ValueError("AllenAtlas array shape disagrees with BrainCoordinates and axis mappings")

        axis_to_xyz = {axis: index for index, axis in enumerate(_AXES)}
        shape = tuple(int(nxyz[axis_to_xyz[axis]]) for axis in axes)
        matrix = np.zeros((4, 4), dtype=np.float64)
        matrix[3, 3] = 1.0
        matrix[:3, 3] = origins_m * 1e6
        for array_dimension, axis in enumerate(axes):
            xyz_dimension = axis_to_xyz[axis]
            matrix[xyz_dimension, array_dimension] = steps_m[xyz_dimension] * 1e6

        # Verify the constructed matrix against the authoritative coordinate
        # object at the origin and at each array-axis basis vector.
        probes = np.vstack((np.zeros(3), np.eye(3)))
        xyz_indices = np.zeros_like(probes)
        for array_dimension, axis in enumerate(axes):
            xyz_indices[:, axis_to_xyz[axis]] = probes[:, array_dimension]
        expected_world = np.asarray(bc.i2xyz(xyz_indices), dtype=np.float64) * 1e6
        actual_world = np.c_[probes, np.ones(len(probes))] @ matrix.T
        if not np.allclose(actual_world[:, :3], expected_world, rtol=0.0, atol=1e-9):
            raise ValueError("AllenAtlas affine conversion failed exact BrainCoordinates verification")

        inverse = np.linalg.inv(matrix)
        index_to_world = _clean_floats(matrix)
        index_convention = "integer-centers-half-integer-edges"
        fingerprint_input = {
            "array_axes": list(axes),
            "index_convention": index_convention,
            "index_to_world_um": list(index_to_world),
            "shape": list(shape),
        }
        fingerprint = hashlib.sha256(
            json.dumps(
                fingerprint_input, sort_keys=True, separators=(",", ":")
            ).encode("utf-8")
        ).hexdigest()
        return cls._verified(
            reference_space_id="allen-ccf-2017",
            grid_id=f"allen-ccf-2017-{resolution}um-{fingerprint}",
            shape=shape,
            array_axes=axes,  # type: ignore[arg-type]
            index_to_world_um=index_to_world,
            world_to_index=_clean_floats(inverse),
            voxel_edge_extent_um=_extent(matrix, shape),
            resolution_um=int(resolution),
            iblatlas_version=_iblatlas_version(),
            atlas_class=f"{type(atlas).__module__}.{type(atlas).__qualname__}",
        )

    def descriptor(self) -> dict[str, Any]:
        """Return the schema-v1 volume-grid descriptor.

        This method is primarily useful for inspection and integration.  The
        returned dictionary is newly allocated; mutating it does not change
        the immutable grid.
        """

        return {
            "reference_space_id": self.reference_space_id,
            "grid_id": self.grid_id,
            "world_axes": list(_AXES),
            "shape": list(self.shape),
            "index_to_world_um": list(self.index_to_world_um),
            "world_to_index": list(self.world_to_index),
            "voxel_edge_extent_um": list(self.voxel_edge_extent_um),
            "index_convention": "integer-centers-half-integer-edges",
        }


@dataclass(frozen=True, init=False)
class VoxelValidity:
    """An explicit, immutable volume validity classification policy.

    Create policies with :meth:`mask` or :meth:`sentinel`.  Classification is
    always evaluated in the order outside, missing, valid.  Zero has no special
    meaning unless supplied explicitly as a sentinel or marked by a mask.
    """

    kind: Literal["mask", "sentinel"]
    outside: np.ndarray | None = None
    missing: np.ndarray | None = None
    outside_value: float | None = None

    def __init__(self, *_args: Any, **_kwargs: Any) -> None:
        raise TypeError(
            "VoxelValidity must be created with VoxelValidity.mask() or VoxelValidity.sentinel()"
        )

    @classmethod
    def _verified(cls, **values: Any) -> "VoxelValidity":
        instance = object.__new__(cls)
        for name in ("kind", "outside", "missing", "outside_value"):
            object.__setattr__(instance, name, values.get(name))
        return instance

    @classmethod
    def mask(cls, *, outside: Any, missing: Any) -> "VoxelValidity":
        """Classify outside and missing voxels with disjoint boolean masks.

        Args:
            outside: Three-dimensional boolean array identifying voxels
                outside the scientific domain.
            missing: Three-dimensional boolean array identifying missing
                voxels inside that domain.

        Returns:
            A policy containing private, read-only copies of both masks.  The
            complement is valid and is checked against the submitted values by
            :meth:`Feature.add_volume <ibl_ephys_atlas.Feature.add_volume>`.

        Raises:
            TypeError: If either mask does not have boolean dtype.
            ValueError: If masks are not 3-D, differ in shape, or overlap.

        The emitted uint8 resource uses stable codes 0=valid, 1=outside, and
        2=missing.  Finite values may be explicitly missing; no non-finite
        value may remain valid.
        """

        outside_array = np.asarray(outside)
        missing_array = np.asarray(missing)
        if outside_array.dtype != np.dtype(bool) or missing_array.dtype != np.dtype(bool):
            raise TypeError("outside and missing validity masks must contain booleans")
        if outside_array.ndim != 3 or missing_array.ndim != 3:
            raise ValueError("outside and missing validity masks must be three-dimensional")
        if outside_array.shape != missing_array.shape:
            raise ValueError("outside and missing validity masks must have the same shape")
        if np.any(outside_array & missing_array):
            raise ValueError("outside and missing validity masks must be disjoint")
        frozen_outside = np.array(outside_array, dtype=bool, order="C", copy=True)
        frozen_missing = np.array(missing_array, dtype=bool, order="C", copy=True)
        frozen_outside.setflags(write=False)
        frozen_missing.setflags(write=False)
        return cls._verified(
            kind="mask", outside=frozen_outside, missing=frozen_missing
        )

    @classmethod
    def sentinel(cls, *, outside_value: float) -> "VoxelValidity":
        """Classify one explicit finite scalar as outside.

        Args:
            outside_value: Finite real value reserved for outside voxels.
                During attachment it is represented in the submitted volume
                dtype and that exact value is recorded in the release.

        Returns:
            An immutable sentinel policy.  Voxels equal to the representable
            sentinel are outside; remaining non-finite voxels are missing; all
            remaining voxels are valid.

        Raises:
            TypeError: If ``outside_value`` is boolean or not a real scalar.
            ValueError: If it is non-finite, or cannot remain finite in the
                submitted float16/float32 dtype.
        """

        if isinstance(outside_value, bool) or not isinstance(
            outside_value, (int, float, np.integer, np.floating)
        ):
            raise TypeError("outside_value must be an explicit finite real scalar")
        value = float(outside_value)
        if not np.isfinite(value):
            raise ValueError("outside_value must be finite; missing voxels are non-finite")
        return cls._verified(kind="sentinel", outside_value=value)


@dataclass(frozen=True)
class VolumeData:
    values: np.ndarray
    grid: AllenCCFGrid
    validity: VoxelValidity
    valid: np.ndarray
    outside: np.ndarray
    missing: np.ndarray
    chunk_shape: tuple[int, int, int]


def normalize_volume_input(
    *,
    values: Any,
    grid: AllenCCFGrid,
    validity: VoxelValidity,
    chunk_shape: Sequence[int],
) -> VolumeData:
    if not isinstance(grid, AllenCCFGrid):
        raise TypeError("grid must be an AllenCCFGrid created from an existing AllenAtlas")
    if not isinstance(validity, VoxelValidity):
        raise TypeError("validity must be an explicit VoxelValidity mask or sentinel")
    raw = np.asarray(values)
    if raw.ndim != 3:
        raise ValueError("volume values must be three-dimensional")
    if raw.dtype.kind != "f" or raw.dtype.itemsize not in {2, 4}:
        raise TypeError("volume values must have dtype float16 or float32; silent conversion is unsupported")
    if tuple(raw.shape) != grid.shape:
        raise ValueError(
            f"volume shape {tuple(raw.shape)} does not match explicit grid shape {grid.shape}"
        )
    chunks = tuple(chunk_shape)
    if (
        len(chunks) != 3
        or any(isinstance(value, bool) or not isinstance(value, (int, np.integer)) or value < 1 for value in chunks)
    ):
        raise ValueError("chunk_shape must contain exactly three positive integers")

    frozen_values = np.array(raw, dtype=raw.dtype.newbyteorder("="), order="C", copy=True)
    frozen_values.setflags(write=False)
    if validity.kind == "mask":
        assert validity.outside is not None and validity.missing is not None
        if validity.outside.shape != raw.shape:
            raise ValueError("validity mask shape must exactly match the explicit volume grid")
        outside = validity.outside
        missing = validity.missing
    else:
        assert validity.outside_value is not None
        with np.errstate(over="ignore", invalid="ignore"):
            canonical_outside = np.asarray(
                validity.outside_value, dtype=frozen_values.dtype
            ).item()
        if not np.isfinite(canonical_outside):
            raise ValueError("outside sentinel is not finite in the submitted volume dtype")
        validity = VoxelValidity.sentinel(outside_value=float(canonical_outside))
        outside = frozen_values == canonical_outside
        missing = ~outside & ~np.isfinite(frozen_values)
    valid = ~outside & ~missing
    if np.any(valid & ~np.isfinite(frozen_values)):
        raise ValueError("no non-finite volume voxel may be classified valid")
    for classification in (valid, outside, missing):
        classification.setflags(write=False)
    return VolumeData(
        values=frozen_values,
        grid=grid,
        validity=validity,
        valid=valid,
        outside=outside,
        missing=missing,
        chunk_shape=tuple(int(value) for value in chunks),
    )


def write_volume_representation(
    feature_root: Path,
    volume: VolumeData,
    histogram_bins: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    dtype = "float16" if volume.values.dtype.itemsize == 2 else "float32"
    suffix = "f16" if dtype == "float16" else "f32"
    resource_index = write_chunked_volume(
        feature_root,
        volume.values,
        dtype=dtype,
        chunk_shape=volume.chunk_shape,
        codec="gzip",
        path_template=f"volume/chunks/{{i0}}.{{i1}}.{{i2}}.{suffix}.gz",
        grid_id=volume.grid.grid_id,
    )
    resource_index_path = feature_root / "volume" / "resource-index.json"
    write_json(resource_index_path, resource_index)

    valid_values = np.asarray(volume.values[volume.valid], dtype=np.float64)
    display = linear_full_display()
    stats = describe(valid_values)
    summary: dict[str, Any] = {
        "schema_version": "1.0",
        "format": "ephys-atlas-volume-summary-v1",
        "grid_id": volume.grid.grid_id,
        "grid_shape": list(volume.grid.shape),
        "total_voxel_count": int(volume.values.size),
        "valid_voxel_count": int(volume.valid.sum()),
        "outside_voxel_count": int(volume.outside.sum()),
        "missing_voxel_count": int(volume.missing.sum()),
        "valid_statistics": {
            field: stats[field]
            for field in ("min", "max", "mean", "std", "q05", "q25", "median", "q75", "q95")
        },
    }
    if valid_values.size:
        summary["distribution"] = {
            "binnings": build_global_distribution_binnings(
                valid_values, histogram_bins, display
            )
        }
    summary_path = feature_root / "volume" / "summary.json"
    write_json(summary_path, summary)

    if volume.validity.kind == "mask":
        codes = {"valid": 0, "outside": 1, "missing": 2}
        mask = np.full(volume.values.shape, codes["valid"], dtype=np.uint8)
        mask[volume.outside] = codes["outside"]
        mask[volume.missing] = codes["missing"]
        mask_descriptor = write_array(
            feature_root / "volume" / "validity.u8",
            mask,
            "uint8",
            root=feature_root,
        )
        validity_document: dict[str, Any] = {
            "kind": "mask",
            "mask": mask_descriptor,
            "codes": codes,
            "classification_order": ["outside", "missing", "valid"],
        }
    else:
        validity_document = {
            "kind": "sentinel",
            "outside_value": volume.validity.outside_value,
            "missing_values": "nonfinite",
            "classification_order": ["outside", "missing", "valid"],
        }

    representation = {
        "format": "ephys-atlas-volume-v1",
        "grid": volume.grid.descriptor(),
        "array": {"dtype": dtype, "order": "C", "endianness": "little"},
        "validity": validity_document,
        "summary": json_resource(
            summary_path, feature_root, "ephys-atlas-volume-summary-v1"
        ),
        "encoding": {
            "layout": "chunks3d",
            "resource_index": json_resource(
                resource_index_path,
                feature_root,
                "ephys-atlas-volume-resource-index-v1",
            ),
        },
    }
    return representation, display
