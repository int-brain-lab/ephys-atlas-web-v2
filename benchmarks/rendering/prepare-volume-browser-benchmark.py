from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

import numpy as np
from ephys_atlas_builder.io import sha256_file
from ephys_atlas_builder.npz import extract_last_axis_feature


def _write_pack(path: Path, values: np.ndarray) -> dict[str, int | str]:
    payload = np.ascontiguousarray(values).tobytes()
    compressed = gzip.compress(payload, compresslevel=6, mtime=0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(compressed)
    return {"path": path.as_posix(), "raw_bytes": len(payload), "gzip_bytes": len(compressed)}


def _prepare_depth(volume: np.ndarray, root: Path, depth: int) -> dict:
    axis_names = ("coronal", "sagittal", "horizontal")
    packs = []
    files = []
    centers = []
    warm = []
    boundaries = []
    for dimension, axis in enumerate(axis_names):
        count = volume.shape[dimension]
        center = count // 2
        center_pack = center // depth
        boundary = (center_pack + 1) * depth
        if boundary >= count:
            boundary = (center_pack - 1) * depth
        if boundary < 0:
            raise ValueError(f"axis {axis} is too short for a boundary benchmark")
        local = center % depth
        warm_index = center + 1 if local + 1 < depth and center + 1 < count else center - 1
        centers.append(center)
        warm.append(warm_index)
        boundaries.append(boundary)
        oriented = np.moveaxis(volume, dimension, 0)
        for pack in sorted({center_pack, boundary // depth}):
            start = pack * depth
            relative = Path(f"depth{depth}/{axis}/{pack}.f16.gz")
            values = oriented[start : min(start + depth, count)]
            result = _write_pack(root / relative, values)
            result["path"] = relative.as_posix()
            files.append(result)
            storage_axes = [f"i{dimension}"] + [
                f"i{index}" for index in range(3) if index != dimension
            ]
            packs.append(
                {
                    "axis": f"i{dimension}",
                    "firstSlice": start,
                    "sliceCount": len(values),
                    "decoded": {
                        "shape": list(values.shape),
                        "storageAxes": storage_axes,
                    },
                    "resource": {
                        "path": relative.as_posix(),
                        "mediaType": "application/octet-stream",
                        "bytes": result["gzip_bytes"],
                        "sha256": sha256_file(root / relative),
                        "codec": {
                            "name": "gzip",
                            "decodedBytes": result["raw_bytes"],
                        },
                    },
                }
            )
    return {
        "depth": depth,
        "shape": list(volume.shape),
        "axis_order": ["ap", "ml", "dv"],
        "centers": centers,
        "warm_indices": warm,
        "boundary_indices": boundaries,
        "resource": {"pack_depth": depth, "packs": packs},
        "files": files,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("npz", type=Path)
    parser.add_argument("--feature-index", type=int, required=True)
    parser.add_argument("--feature-id", required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--depth", type=int, action="append", default=[])
    args = parser.parse_args()

    depths = args.depth or [4, 8]
    if any(depth <= 0 for depth in depths):
        parser.error("--depth must be positive")
    args.work_dir.mkdir(parents=True, exist_ok=True)
    extracted = args.work_dir / f"{args.feature_id}.npy"
    extraction = extract_last_axis_feature(args.npz, extracted, args.feature_index)
    volume = np.load(extracted, mmap_mode="r")
    report = {
        "benchmark": "real-ephys-volume-browser-artifacts-v1",
        "feature_id": args.feature_id,
        "feature_index": args.feature_index,
        "axis_semantics": "physical axis0/axis1/axis2 labeled AP/ML/DV only for transport benchmarking",
        "source": {
            "path": args.npz.as_posix(),
            "bytes": args.npz.stat().st_size,
            "sha256": sha256_file(args.npz),
        },
        "extraction": extraction,
        "layouts": [_prepare_depth(volume, args.work_dir, depth) for depth in depths],
    }
    manifest = args.work_dir / "benchmark-manifest.json"
    manifest.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(manifest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
