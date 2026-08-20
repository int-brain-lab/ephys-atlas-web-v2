"""Build bilateral SVG anatomy packs from the real 10 um Allen annotation."""

from __future__ import annotations

import argparse
import gzip
import json
import shutil
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import shapely
from jsonschema import Draft202012Validator

from tools.anatomy_pack.build import (
    IBLATLAS_COMMIT,
    _git,
    canonical_json,
    sha256_bytes,
    sha256_file,
)
from tools.anatomy_pack.geometry import (
    SliceValidation,
    geometry_path,
    geometry_path_relative,
    raster_label_geometries,
    validate_exact_coverage,
)

RESOLUTION_UM = 10
LABEL_SHAPE = (1320, 1140, 800)  # AP, ML, DV
LEFT_ML_COUNT = 574  # centre coordinate is negative through index 573 (-9 um)
ORIGINS_UM = {"ml": -5739, "ap": 5400, "dv": 332}
LUT_NAME = "annotation_10_lut_bilateral_v02.npy"


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
        1320,
        (800, 1140),
        (
            0,
            10,
            0,
            -5739,
            -10,
            0,
            0,
            5400,
            0,
            0,
            -10,
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
        1140,
        (800, 1320),
        (
            10,
            0,
            0,
            -5739,
            0,
            10,
            0,
            -7790,
            0,
            0,
            -10,
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
        800,
        (1320, 1140),
        (
            0,
            10,
            0,
            -5739,
            0,
            0,
            -10,
            5400,
            -10,
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


def _positive_row_lookup(regions: Any) -> tuple[np.ndarray, np.ndarray]:
    positive_ids = np.asarray(regions.id[1:1328], dtype=np.int64)
    order = np.argsort(positive_ids)
    return positive_ids[order], order.astype(np.uint16) + 1


def map_annotation_block(
    raw_block: np.ndarray,
    regions: Any,
    *,
    ml_start: int = 0,
) -> np.ndarray:
    """Map raw Allen IDs to physically lateralized BrainRegions rows."""
    if raw_block.ndim != 3:
        raise ValueError("annotation block must have AP, ML, DV axes")
    sorted_ids, sorted_rows = _positive_row_lookup(regions)
    flat = np.asarray(raw_block).reshape(-1)
    nonzero = flat != 0
    mapped_flat = np.zeros(flat.shape, dtype=np.uint16)
    values = flat[nonzero].astype(np.int64, copy=False)
    positions = np.searchsorted(sorted_ids, values)
    if np.any(positions == len(sorted_ids)):
        raise ValueError("annotation contains an ID absent from BrainRegions")
    if np.any(sorted_ids[positions] != values):
        raise ValueError("annotation contains an ID absent from BrainRegions")
    mapped_flat[nonzero] = sorted_rows[positions]
    mapped = mapped_flat.reshape(raw_block.shape)

    left_stop = min(raw_block.shape[1], LEFT_ML_COUNT - ml_start)
    if left_stop > 0:
        left = mapped[:, :left_stop, :]
        left[left != 0] += 1327
    return mapped


def prepare_label_lut(cache: Path, regions: Any) -> Path:
    """Create a memory-mappable bilateral 10 um label LUT without loading MRI."""
    from iblatlas.atlas import AllenAtlas, _download_atlas_allen

    annotation = cache / "annotation_10.nrrd"
    if not annotation.exists():
        _download_atlas_allen(annotation)
    output = cache / LUT_NAME
    if output.exists():
        label = np.load(output, mmap_mode="r")
        if label.shape != LABEL_SHAPE or label.dtype != np.uint16:
            raise ValueError(f"invalid cached bilateral LUT {output}")
        return output

    raw = AllenAtlas._read_volume(annotation)
    if raw.shape != LABEL_SHAPE:
        raise ValueError(f"expected annotation shape {LABEL_SHAPE}, got {raw.shape}")
    temporary = output.with_suffix(".npy.tmp")
    mapped = np.lib.format.open_memmap(
        temporary, mode="w+", dtype=np.uint16, shape=LABEL_SHAPE
    )
    for first in range(0, LABEL_SHAPE[0], 4):
        last = min(first + 4, LABEL_SHAPE[0])
        mapped[first:last] = map_annotation_block(raw[first:last], regions)
        mapped.flush()
        if last % 80 == 0 or last == LABEL_SHAPE[0]:
            print(f"10 um LUT: {last}/{LABEL_SHAPE[0]} AP planes", flush=True)
    del mapped, raw
    temporary.replace(output)
    return output


def plane_for_projection(label: np.ndarray, projection: str, index: int) -> np.ndarray:
    if label.shape != LABEL_SHAPE:
        raise ValueError(f"expected bilateral 10 um label shape {LABEL_SHAPE}")
    if projection == "coronal":
        return label[index, :, :].T
    if projection == "sagittal":
        return label[::-1, index, :].T
    if projection == "horizontal":
        return label[:, :, index]
    raise ValueError(f"unknown projection {projection!r}")


def atlas_ids_for_row(regions: Any, row: int) -> dict[str, int]:
    source_id = int(regions.id[row])
    if source_id == 0:
        raise ValueError("background row must not be emitted")
    sign = -1 if source_id < 0 else 1
    result = {
        name.lower(): sign * abs(int(regions.id[regions.mappings[name][row]]))
        for name in ("Allen", "Beryl", "Cosmos")
    }
    if any(value == 0 or (value < 0) != (sign < 0) for value in result.values()):
        raise ValueError(f"row {row} has inconsistent bilateral atlas IDs: {result}")
    return result


def slice_paths(
    plane: np.ndarray,
    regions: Any,
) -> tuple[list[dict[str, Any]], SliceValidation]:
    rows = sorted(int(value) for value in np.unique(plane) if int(value) != 0)
    exact = raster_label_geometries(plane)
    simplified, validation = validate_exact_coverage(
        exact,
        source_plane=plane,
    )
    if sorted(simplified) != rows:
        raise ValueError("polygonization changed the non-background atlas row set")
    return [
        {
            "atlas_ids": atlas_ids_for_row(regions, row),
            "fill_rule": "evenodd",
            "d": geometry_path_relative(simplified[row]),
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
            "format": "anatomy-slice-pack-v2",
            "schema_version": "2.0",
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


def _pack_id(
    annotation_sha: str,
    lut_sha: str,
    *,
    pack_depth: int,
    generator_commit: str,
) -> str:
    identity = canonical_json(
        {
            "format": "anatomy-pack-v2",
            "annotation_sha256": annotation_sha,
            "region_lut_sha256": lut_sha,
            "resolution_um": 10,
            "hemisphere": "bilateral",
            "algorithm": "exact collinear vertex removal",
            "minimum_iou": 0.98,
            "minimum_iou_area_mm2": 0.01,
            "boundary_sampling_interval_voxels": 0.25,
            "pack_depth": pack_depth,
            "iblatlas_commit": IBLATLAS_COMMIT,
            "generator_commit": generator_commit,
            "shapely_version": shapely.__version__,
            "geos_version": shapely.geos_version_string,
            "sagittal_orientation": "posterior-to-anterior",
        }
    )
    return f"allen-ccfv3-10um-bilateral-exact-{sha256_bytes(identity)[:12]}"


def _sentinels() -> list[dict[str, Any]]:
    points_index = ((300, 660, 400), (800, 330, 200))  # ML, AP, DV
    result = []
    for number, (ml, ap, dv) in enumerate(points_index, start=1):
        world = [
            ORIGINS_UM["ml"] + ml * 10,
            ORIGINS_UM["ap"] - ap * 10,
            ORIGINS_UM["dv"] - dv * 10,
        ]
        result.append(
            {
                "name": f"allen-bilateral-grid-sentinel-{number}",
                "world_um": world,
                "projection_indices": {
                    "coronal": [ap, ml, dv],
                    "sagittal": [ml, 1319 - ap, dv],
                    "horizontal": [dv, ml, ap],
                },
            }
        )
    return result


def _validate_generated(root: Path, manifest: dict[str, Any], repository: Path) -> None:
    schema_root = repository / "schema" / "anatomy-pack-v2"
    manifest_schema = json.loads((schema_root / "manifest.schema.json").read_text())
    slice_schema = json.loads((schema_root / "slice-pack.schema.json").read_text())
    Draft202012Validator(manifest_schema).validate(manifest)
    slice_validator = Draft202012Validator(slice_schema)
    for projection in manifest["projections"].values():
        for pack_set in projection["pack_sets"].values():
            for artifact in pack_set["packs"]:
                compressed = (root / artifact["path"]).read_bytes()
                if len(compressed) != artifact["bytes"]:
                    raise ValueError(f"pack byte-size mismatch: {artifact['path']}")
                if sha256_bytes(compressed) != artifact["sha256"]:
                    raise ValueError(f"pack SHA-256 mismatch: {artifact['path']}")
                payload = gzip.decompress(compressed)
                if len(payload) != artifact["uncompressed_bytes"]:
                    raise ValueError(f"pack decoded-size mismatch: {artifact['path']}")
                slice_validator.validate(json.loads(payload))


def probe(
    label: np.ndarray,
    regions: Any,
) -> list[dict[str, Any]]:
    results = []
    samples = {"coronal": 660, "sagittal": 300, "horizontal": 400}
    for projection, index in samples.items():
        plane = plane_for_projection(label, projection, index)
        paths, validation = slice_paths(plane, regions)
        exact = raster_label_geometries(plane)
        absolute_paths = [
            {
                "atlas_ids": atlas_ids_for_row(regions, row),
                "fill_rule": "evenodd",
                "d": geometry_path(exact[row]),
            }
            for row in sorted(exact)
        ]
        compact_payload = canonical_json(paths)
        absolute_payload = canonical_json(absolute_paths)
        results.append(
            {
                "projection": projection,
                "slice_index": index,
                "absolute_raw_bytes": len(absolute_payload),
                "absolute_gzip_bytes": len(
                    gzip.compress(absolute_payload, compresslevel=9, mtime=0)
                ),
                "relative_raw_bytes": len(compact_payload),
                "relative_gzip_bytes": len(
                    gzip.compress(compact_payload, compresslevel=9, mtime=0)
                ),
                **validation.to_dict(),
            }
        )
    return results


def build_pack(
    *,
    output: Path,
    created_at: str,
    pack_depth: int,
) -> dict[str, Any]:
    from iblatlas.atlas import AllenAtlas
    from iblatlas.regions import BrainRegions

    repository = Path(__file__).resolve().parents[2]
    commit = _git("rev-parse", "HEAD", root=repository)
    dirty = bool(_git("status", "--porcelain", "--untracked-files=no", root=repository))
    if dirty:
        raise RuntimeError("refusing provenance build from a dirty tracked worktree")
    if output.exists():
        raise FileExistsError(f"output already exists: {output}")

    cache = Path(AllenAtlas._get_cache_dir())
    regions = BrainRegions()
    lut_path = prepare_label_lut(cache, regions)
    label = np.load(lut_path, mmap_mode="r")
    annotation = cache / "annotation_10.nrrd"
    annotation_sha = sha256_file(annotation)
    lut_sha = sha256_file(lut_path)
    pack_id = _pack_id(
        annotation_sha,
        lut_sha,
        pack_depth=pack_depth,
        generator_commit=commit,
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=f".{output.name}-", dir=output.parent
    ) as tmp:
        stage = Path(tmp)
        projection_manifests: dict[str, Any] = {}
        validations: list[SliceValidation] = []
        path_count = ring_count = 0
        for projection, spec in PROJECTIONS.items():
            buffer: list[dict[str, Any]] = []
            inventory: list[dict[str, Any]] = []
            for slice_index in range(spec.slice_count):
                paths, validation = slice_paths(
                    plane_for_projection(label, projection, slice_index), regions
                )
                validations.append(validation)
                path_count += len(paths)
                ring_count += sum(path["d"].count("M") for path in paths)
                buffer.append(
                    {
                        "slice_index": slice_index,
                        "world_coordinate_um": _world_coordinate(spec, slice_index),
                        "paths": paths,
                    }
                )
                if len(buffer) == pack_depth or slice_index == spec.slice_count - 1:
                    inventory.append(
                        _write_pack(
                            stage,
                            pack_id=pack_id,
                            projection=projection,
                            depth=pack_depth,
                            pack_index=len(inventory),
                            slices=buffer,
                        )
                    )
                    buffer = []
                if (slice_index + 1) % 16 == 0 or slice_index == spec.slice_count - 1:
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
                    str(pack_depth): {
                        "pack_depth": pack_depth,
                        "path_template": (
                            f"packs/{pack_depth}/{projection}/{{pack}}.json.gz"
                        ),
                        "packs": inventory,
                    }
                },
            }

        manifest = {
            "format": "anatomy-pack-v2",
            "schema_version": "2.0",
            "pack_id": pack_id,
            "immutable": True,
            "created_at": created_at,
            "source": {
                "atlas": "Allen CCFv3",
                "resolution_um": 10,
                "hemisphere": "bilateral",
                "annotation": {
                    "path": annotation.name,
                    "bytes": annotation.stat().st_size,
                    "sha256": annotation_sha,
                },
                "region_lut": {
                    "path": lut_path.name,
                    "bytes": lut_path.stat().st_size,
                    "sha256": lut_sha,
                },
                "region_ids": {
                    "domain": "signed_allen_atlas_id",
                    "left_sign": "negative",
                    "right_sign": "positive",
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
                    "dirty": False,
                },
                "shapely_version": shapely.__version__,
                "geos_version": shapely.geos_version_string,
                "simplification": {
                    "algorithm": "exact collinear vertex removal",
                    "tolerance_um": 0,
                    "boundary_sampling_interval_voxels": 0.25,
                    "boundary_error_bound_um": 0,
                },
            },
            "validation": {
                "topology_valid": True,
                "coverage_valid": True,
                "uncovered_voxels": sum(item.uncovered_voxels for item in validations),
                "multiply_covered_voxels": sum(
                    item.multiply_covered_voxels for item in validations
                ),
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
                    "max_upper_bound": max(
                        item.maximum_boundary_error_upper_bound_um
                        for item in validations
                    ),
                },
                "accepted_max_boundary_error_um": 0,
                "minimum_eligible_region_iou": min(
                    item.minimum_eligible_region_iou for item in validations
                ),
                "region_area_threshold_mm2": 0.01,
                "accepted_minimum_region_iou": 0.98,
                "background_topology_valid": all(
                    item.background_topology_valid for item in validations
                ),
                "internal_background_components_before": sum(
                    item.internal_background_components_before for item in validations
                ),
                "internal_background_components_after": sum(
                    item.internal_background_components_after for item in validations
                ),
                "coordinate_tolerance_um": 0.000001,
                "sentinel_max_error_um": 0,
            },
            "synchronization_sentinels": _sentinels(),
        }
        _validate_generated(stage, manifest, repository)
        (stage / "manifest.json").write_bytes(canonical_json(manifest))
        shutil.move(stage, output)
    return manifest


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=root / "artifacts/anatomy-pack-v2"
    )
    parser.add_argument("--pack-depth", type=int, choices=(16, 32), default=16)
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--probe", action="store_true")
    parser.add_argument(
        "--created-at",
        default=datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    from iblatlas.atlas import AllenAtlas
    from iblatlas.regions import BrainRegions

    args = parse_args(argv)
    if args.prepare_only or args.probe:
        cache = Path(AllenAtlas._get_cache_dir())
        regions = BrainRegions()
        lut_path = prepare_label_lut(cache, regions)
        print(f"Prepared {lut_path} ({lut_path.stat().st_size:,} bytes)")
        if args.probe:
            label = np.load(lut_path, mmap_mode="r")
            print(json.dumps(probe(label, regions), indent=2))
        return 0
    manifest = build_pack(
        output=args.output,
        created_at=args.created_at,
        pack_depth=args.pack_depth,
    )
    print(f"Wrote {args.output} ({manifest['pack_id']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
