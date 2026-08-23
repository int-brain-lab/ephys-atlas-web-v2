from __future__ import annotations

import argparse
import gzip
import json
import platform
import time
from itertools import product
from pathlib import Path

import numpy as np
from ephys_atlas_builder.io import sha256_file
from ephys_atlas_builder.npz import extract_last_axis_feature


def _compressed(payload: bytes) -> int:
    return len(gzip.compress(payload, compresslevel=6, mtime=0))


def _chunks(volume: np.ndarray, edge: int) -> dict:
    shape = volume.shape
    grid = tuple((size + edge - 1) // edge for size in shape)
    sizes = {}
    raw_bytes = 0
    started = time.perf_counter()
    for index in product(*(range(count) for count in grid)):
        starts = tuple(value * edge for value in index)
        stops = tuple(min(starts[axis] + edge, shape[axis]) for axis in range(3))
        block = np.ascontiguousarray(
            volume[
                starts[0] : stops[0],
                starts[1] : stops[1],
                starts[2] : stops[2],
            ]
        ).tobytes()
        raw_bytes += len(block)
        sizes[index] = _compressed(block)

    centers = tuple(size // 2 for size in shape)
    planes = []
    union = set()
    for axis in range(3):
        slab = centers[axis] // edge
        keys = {index for index in sizes if index[axis] == slab}
        union.update(keys)
        planes.append(
            {
                "axis": f"axis{axis}",
                "requests": len(keys),
                "gzip_bytes": sum(sizes[key] for key in keys),
            }
        )
    return {
        "layout": "chunks3d",
        "edge": edge,
        "grid": list(grid),
        "objects": len(sizes),
        "raw_bytes": raw_bytes,
        "gzip_bytes": sum(sizes.values()),
        "gzip_ratio": sum(sizes.values()) / raw_bytes,
        "encode_seconds": time.perf_counter() - started,
        "center_planes": planes,
        "center_union": {
            "requests": len(union),
            "gzip_bytes": sum(sizes[key] for key in union),
        },
    }


def _slice_packs(volume: np.ndarray, depth: int) -> dict:
    raw_bytes = 0
    gzip_bytes = 0
    objects = 0
    axes = []
    started = time.perf_counter()
    for axis in range(3):
        oriented = np.moveaxis(volume, axis, 0)
        center_start = (volume.shape[axis] // 2 // depth) * depth
        center_gzip = None
        axis_raw = 0
        axis_gzip = 0
        axis_objects = 0
        for start in range(0, oriented.shape[0], depth):
            payload = np.ascontiguousarray(oriented[start : start + depth]).tobytes()
            compressed = _compressed(payload)
            if start == center_start:
                center_gzip = compressed
            axis_raw += len(payload)
            axis_gzip += compressed
            axis_objects += 1
        assert center_gzip is not None
        axes.append(
            {
                "axis": f"axis{axis}",
                "objects": axis_objects,
                "raw_bytes": axis_raw,
                "gzip_bytes": axis_gzip,
                "center_pack_gzip_bytes": center_gzip,
            }
        )
        raw_bytes += axis_raw
        gzip_bytes += axis_gzip
        objects += axis_objects
    return {
        "layout": "orthogonal_slice_packs",
        "depth": depth,
        "objects": objects,
        "raw_bytes": raw_bytes,
        "gzip_bytes": gzip_bytes,
        "gzip_ratio": gzip_bytes / raw_bytes,
        "encode_seconds": time.perf_counter() - started,
        "center_planes": {
            "requests": 3,
            "gzip_bytes": sum(axis["center_pack_gzip_bytes"] for axis in axes),
        },
        "axes": axes,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("npz", type=Path)
    parser.add_argument("--feature-index", type=int, required=True)
    parser.add_argument("--feature-id", required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    args.work_dir.mkdir(parents=True, exist_ok=True)
    extracted = args.work_dir / f"{args.feature_id}.npy"
    extraction_started = time.perf_counter()
    extraction = extract_last_axis_feature(args.npz, extracted, args.feature_index)
    extraction["seconds"] = time.perf_counter() - extraction_started
    extraction["source"] = args.npz.as_posix()
    extraction["output"] = extracted.name
    volume = np.load(extracted, mmap_mode="r")
    with np.load(args.npz, allow_pickle=True) as source:
        resolution_um = int(np.asarray(source["res_um"]).reshape(-1)[0])

    report = {
        "benchmark": "real-ephys-volume-layout-v1",
        "machine": {
            "platform": platform.platform(),
            "python": platform.python_version(),
            "numpy": np.__version__,
        },
        "feature_id": args.feature_id,
        "feature_index": args.feature_index,
        "resolution_um": resolution_um,
        "axis_semantics": "physical axis0/axis1/axis2 only; scientific mapping unresolved",
        "source": {
            "path": args.npz.as_posix(),
            "bytes": args.npz.stat().st_size,
            "sha256": sha256_file(args.npz),
        },
        "extraction": extraction,
        "layouts": [
            _chunks(volume, 32),
            _chunks(volume, 64),
            _slice_packs(volume, 4),
            _slice_packs(volume, 8),
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
