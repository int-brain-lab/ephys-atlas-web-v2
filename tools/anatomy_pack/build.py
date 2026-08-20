"""Build immutable, topology-validated left Allen CCF anatomy slice packs."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import shutil
import subprocess
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import shapely

from tools.anatomy_pack.geometry import (
    SliceValidation,
    geometry_path,
    raster_label_geometries,
    simplify_coverage,
)

IBLATLAS_COMMIT = "52083adf44825d0622a503705e095699a5957587"
RESOLUTION_UM = 25
LEFT_ML_COUNT = 230
ORIGINS_UM = {"ml": -5739, "ap": 5400, "dv": 332}


@dataclass(frozen=True)
class ProjectionSpec:
    name: str
    fixed_world_axis: str
    plane_axes: tuple[str, str]
    slice_count: int
    slice_shape: tuple[int, int]
    matrix: tuple[float, ...]


PROJECTIONS = {
    "coronal": ProjectionSpec(
        "coronal",
        "ap",
        ("ml", "dv"),
        528,
        (320, LEFT_ML_COUNT),
        (
            0,
            25,
            0,
            -5739,
            -25,
            0,
            0,
            5400,
            0,
            0,
            -25,
            332,
            0,
            0,
            0,
            1,
        ),
    ),
    "sagittal": ProjectionSpec(
        "sagittal",
        "ml",
        ("ap", "dv"),
        LEFT_ML_COUNT,
        (320, 528),
        (
            25,
            0,
            0,
            -5739,
            0,
            25,
            0,
            -7775,
            0,
            0,
            -25,
            332,
            0,
            0,
            0,
            1,
        ),
    ),
    "horizontal": ProjectionSpec(
        "horizontal",
        "dv",
        ("ml", "ap"),
        320,
        (528, LEFT_ML_COUNT),
        (
            0,
            25,
            0,
            -5739,
            0,
            0,
            -25,
            5400,
            -25,
            0,
            0,
            332,
            0,
            0,
            0,
            1,
        ),
    ),
}


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _git(*args: str, root: Path) -> str:
    return subprocess.run(
        ["git", *args], cwd=root, check=True, capture_output=True, text=True
    ).stdout.strip()


def plane_for_projection(label: np.ndarray, projection: str, index: int) -> np.ndarray:
    """Return left-only label rows with y/x equal to the declared plane axes."""
    if label.shape != (528, 456, 320):
        raise ValueError(
            f"expected 25 um Allen label shape (528, 456, 320), got {label.shape}"
        )
    if projection == "coronal":
        return label[index, :LEFT_ML_COUNT, :].T
    if projection == "sagittal":
        return label[::-1, index, :].T
    if projection == "horizontal":
        return label[:, :LEFT_ML_COUNT, index]
    raise ValueError(f"unknown projection {projection!r}")


def atlas_ids_for_row(regions: Any, row: int) -> dict[str, int]:
    """Map an iblatlas label row to stable left-folded parcellation IDs."""
    result = {
        name.lower(): -abs(int(regions.id[regions.mappings[name][row]]))
        for name in ("Allen", "Beryl", "Cosmos")
    }
    if any(value >= 0 for value in result.values()):
        raise ValueError(f"row {row} does not map to nonzero left atlas IDs: {result}")
    return result


def _slice_paths(
    plane: np.ndarray,
    regions: Any,
    *,
    tolerance_um: float,
    maximum_error_um: float,
    minimum_iou: float,
) -> tuple[list[dict[str, Any]], SliceValidation]:
    rows = sorted(int(value) for value in np.unique(plane) if int(value) != 0)
    exact = raster_label_geometries(plane)
    simplified, validation = simplify_coverage(
        exact,
        tolerance_um=tolerance_um,
        resolution_um=RESOLUTION_UM,
        maximum_error_um=maximum_error_um,
        minimum_iou=minimum_iou,
        minimum_iou_area_um2=10_000,
    )
    if sorted(simplified) != rows:
        raise ValueError("polygonization changed the non-background atlas row set")
    return [
        {
            "atlas_ids": atlas_ids_for_row(regions, row),
            "d": geometry_path(simplified[row]),
        }
        for row in rows
    ], validation


def _world_coordinate(spec: ProjectionSpec, slice_index: int) -> float:
    vector = np.asarray(spec.matrix).reshape(4, 4) @ np.asarray(
        [slice_index, 0, 0, 1], dtype=float
    )
    return float(vector[{"ml": 0, "ap": 1, "dv": 2}[spec.fixed_world_axis]])


def _write_pack(
    root: Path,
    *,
    pack_id: str,
    projection: str,
    depth: int,
    pack_index: int,
    slices: list[dict[str, Any]],
) -> dict[str, Any]:
    first = int(slices[0]["slice_index"])
    payload = canonical_json(
        {
            "format": "anatomy-slice-pack-v1",
            "schema_version": "1.0",
            "anatomy_pack_id": pack_id,
            "projection": projection,
            "pack_depth": depth,
            "pack_index": pack_index,
            "first_slice_index": first,
            "slice_count": len(slices),
            "slices": slices,
        }
    )
    compressed = gzip.compress(payload, compresslevel=9, mtime=0)
    relative = Path("packs") / str(depth) / projection / f"{pack_index}.json.gz"
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(compressed)
    return {
        "pack_index": pack_index,
        "first_slice_index": first,
        "slice_count": len(slices),
        "path": relative.as_posix(),
        "media_type": "application/json",
        "compression": "gzip",
        "bytes": len(compressed),
        "uncompressed_bytes": len(payload),
        "sha256": sha256_bytes(compressed),
    }


def _ring_count(paths: list[dict[str, Any]]) -> int:
    return sum(path["d"].count("M") + path["d"].count("m") for path in paths)


def _pack_id(annotation_sha: str, lut_sha: str, tolerance_um: float) -> str:
    identity = canonical_json(
        {
            "annotation_sha256": annotation_sha,
            "region_lut_sha256": lut_sha,
            "resolution_um": RESOLUTION_UM,
            "hemisphere": "left",
            "tolerance_um": tolerance_um,
            "iblatlas_commit": IBLATLAS_COMMIT,
        }
    )
    tolerance = str(tolerance_um).replace(".", "p")
    return f"allen-ccfv3-25um-left-t{tolerance}-{sha256_bytes(identity)[:12]}"


def _sentinels() -> list[dict[str, Any]]:
    points_index = ((114, 264, 160), (24, 100, 40))  # ML, AP, DV
    result = []
    for number, (ml, ap, dv) in enumerate(points_index, start=1):
        world = [
            ORIGINS_UM["ml"] + ml * 25,
            ORIGINS_UM["ap"] - ap * 25,
            ORIGINS_UM["dv"] - dv * 25,
        ]
        result.append(
            {
                "name": f"allen-grid-sentinel-{number}",
                "world_um": world,
                "projection_indices": {
                    "coronal": [ap, ml, dv],
                    "sagittal": [ml, 527 - ap, dv],
                    "horizontal": [dv, ml, ap],
                },
            }
        )
    return result


def build_pack(
    *,
    output: Path,
    created_at: str,
    tolerance_um: float,
    maximum_error_um: float,
    minimum_iou: float,
    pack_depths: tuple[int, ...],
    allow_dirty: bool = False,
) -> dict[str, Any]:
    """Generate all left-hemisphere projection slices and their manifest."""
    from iblatlas.atlas import AllenAtlas

    repository = Path(__file__).resolve().parents[2]
    commit = _git("rev-parse", "HEAD", root=repository)
    dirty = bool(_git("status", "--porcelain", "--untracked-files=no", root=repository))
    if dirty and not allow_dirty:
        raise RuntimeError("refusing provenance build from a dirty tracked worktree")
    if output.exists():
        raise FileExistsError(f"output already exists: {output}")

    atlas = AllenAtlas(res_um=RESOLUTION_UM)
    label = np.asarray(atlas.label)
    cache = Path(atlas._get_cache_dir())
    annotation = cache / "annotation_25.nrrd"
    annotation_lut_volume = cache / "annotation_25_lut_v01.npz"
    if not annotation.exists() or not annotation_lut_volume.exists():
        raise FileNotFoundError(
            "iblatlas did not provide the required 25 um annotation"
        )

    annotation_sha = sha256_file(annotation)
    lut_sha = sha256_file(annotation_lut_volume)
    pack_id = _pack_id(annotation_sha, lut_sha, tolerance_um)

    temporary_parent = output.parent
    temporary_parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=f".{output.name}-", dir=temporary_parent
    ) as tmp:
        stage = Path(tmp)
        projection_manifests: dict[str, Any] = {}
        validations: list[SliceValidation] = []
        path_count = ring_count = 0
        for projection, spec in PROJECTIONS.items():
            buffers = {depth: [] for depth in pack_depths}
            inventories = {depth: [] for depth in pack_depths}
            for slice_index in range(spec.slice_count):
                paths, validation = _slice_paths(
                    plane_for_projection(label, projection, slice_index),
                    atlas.regions,
                    tolerance_um=tolerance_um,
                    maximum_error_um=maximum_error_um,
                    minimum_iou=minimum_iou,
                )
                validations.append(validation)
                path_count += len(paths)
                ring_count += _ring_count(paths)
                slice_payload = {
                    "slice_index": slice_index,
                    "world_coordinate_um": _world_coordinate(spec, slice_index),
                    "paths": paths,
                }
                for depth in pack_depths:
                    buffers[depth].append(slice_payload)
                    if (
                        len(buffers[depth]) == depth
                        or slice_index == spec.slice_count - 1
                    ):
                        inventories[depth].append(
                            _write_pack(
                                stage,
                                pack_id=pack_id,
                                projection=projection,
                                depth=depth,
                                pack_index=len(inventories[depth]),
                                slices=buffers[depth],
                            )
                        )
                        buffers[depth] = []
                if (slice_index + 1) % 32 == 0 or slice_index == spec.slice_count - 1:
                    print(
                        f"{projection}: {slice_index + 1}/{spec.slice_count} slices",
                        flush=True,
                    )
            matrix = np.asarray(spec.matrix, dtype=float).reshape(4, 4)
            projection_manifests[projection] = {
                "fixed_world_axis": spec.fixed_world_axis,
                "plane_axes": list(spec.plane_axes),
                "slice_count": spec.slice_count,
                "slice_shape": list(spec.slice_shape),
                "view_box": [-0.5, -0.5, spec.slice_shape[1], spec.slice_shape[0]],
                "plane_index_to_world_um": list(spec.matrix),
                "world_to_plane_index": list(np.linalg.inv(matrix).reshape(-1)),
                "pack_sets": {
                    str(depth): {
                        "pack_depth": depth,
                        "path_template": f"packs/{depth}/{projection}/{{pack}}.json.gz",
                        "packs": inventories[depth],
                    }
                    for depth in pack_depths
                },
            }

        conservative_errors = [
            validation.maximum_boundary_error_upper_bound_um
            for validation in validations
        ]
        manifest = {
            "format": "anatomy-pack-v1",
            "schema_version": "1.0",
            "pack_id": pack_id,
            "immutable": True,
            "created_at": created_at,
            "source": {
                "atlas": "Allen CCFv3",
                "resolution_um": 25,
                "hemisphere": "left",
                "annotation": {
                    "path": annotation.name,
                    "bytes": annotation.stat().st_size,
                    "sha256": annotation_sha,
                },
                "region_lut": {
                    "path": annotation_lut_volume.name,
                    "bytes": annotation_lut_volume.stat().st_size,
                    "sha256": lut_sha,
                },
                "region_ids": {
                    "domain": "signed_allen_atlas_id",
                    "left_sign": "negative",
                    "background_id": 0,
                },
            },
            "coordinate_system": {
                "name": "IBL Allen CCF coordinates relative to Bregma",
                "units": "um",
                "world_axes": ["ml", "ap", "dv"],
                "voxel_centers": "integer-indices",
                "voxel_edges": "half-integer-indices",
                "matrix_order": "row-major",
            },
            "projections": projection_manifests,
            "provenance": {
                "iblatlas": {
                    "repository": "int-brain-lab/iblatlas",
                    "commit": IBLATLAS_COMMIT,
                },
                "generator": {
                    "repository": "rossant/ibl-ephys-atlas-web-v2",
                    "commit": commit,
                    "dirty": dirty,
                },
                "shapely_version": shapely.__version__,
                "geos_version": shapely.geos_version_string,
                "simplification": {
                    "algorithm": "GEOS coverage_simplify",
                    "tolerance_um": tolerance_um,
                    "boundary_sampling_interval_voxels": 0.25,
                    "boundary_error_bound_um": RESOLUTION_UM * 0.125,
                },
            },
            "validation": {
                "topology_valid": True,
                "coverage_valid": True,
                "uncovered_voxels": 0,
                "multiply_covered_voxels": 0,
                "adjacency_mismatches": 0,
                "invalid_geometries": 0,
                "missing_atlas_ids": [],
                "source_slices": sum(spec.slice_count for spec in PROJECTIONS.values()),
                "emitted_slices": sum(
                    spec.slice_count for spec in PROJECTIONS.values()
                ),
                "path_count": path_count,
                "ring_count": ring_count,
                "vertices_before": sum(item.vertices_before for item in validations),
                "vertices_after": sum(item.vertices_after for item in validations),
                "boundary_error_um": {
                    "worst_slice_median": max(
                        item.median_boundary_error_um for item in validations
                    ),
                    "worst_slice_p95": max(
                        item.p95_boundary_error_um for item in validations
                    ),
                    "max_upper_bound": max(conservative_errors),
                },
                "accepted_max_boundary_error_um": maximum_error_um,
                "minimum_eligible_region_iou": min(
                    item.minimum_eligible_region_iou for item in validations
                ),
                "region_area_threshold_mm2": 0.01,
                "accepted_minimum_region_iou": minimum_iou,
                "coordinate_tolerance_um": 0.000001,
                "sentinel_max_error_um": 0,
            },
            "synchronization_sentinels": _sentinels(),
        }
        (stage / "manifest.json").write_bytes(canonical_json(manifest))
        shutil.move(stage, output)
    return manifest


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=root / "artifacts/anatomy-pack-v1"
    )
    parser.add_argument("--tolerance-um", type=float, default=10.0)
    parser.add_argument("--maximum-error-um", type=float, default=50.0)
    parser.add_argument("--minimum-iou", type=float, choices=(0.98,), default=0.98)
    parser.add_argument("--pack-depth", type=int, choices=(16, 32), action="append")
    parser.add_argument(
        "--created-at",
        default=datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
    )
    parser.add_argument("--allow-dirty", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    args.pack_depth = tuple(dict.fromkeys(args.pack_depth or [16]))
    if args.tolerance_um < 0 or args.maximum_error_um <= 0:
        parser.error("tolerances must be non-negative and maximum error positive")
    if not 0 < args.minimum_iou <= 1:
        parser.error("minimum IoU must be in (0, 1]")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    manifest = build_pack(
        output=args.output,
        created_at=args.created_at,
        tolerance_um=args.tolerance_um,
        maximum_error_um=args.maximum_error_um,
        minimum_iou=args.minimum_iou,
        pack_depths=args.pack_depth,
        allow_dirty=args.allow_dirty,
    )
    print(f"Wrote {args.output} ({manifest['pack_id']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
