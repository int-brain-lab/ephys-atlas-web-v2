from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def summarize(release: Path) -> dict:
    release = release.resolve()
    manifest_path = release / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    files = sorted(path for path in release.rglob("*") if path.is_file())
    graph = hashlib.sha256()
    total_bytes = 0
    for path in files:
        relative = path.relative_to(release).as_posix()
        size = path.stat().st_size
        sha256 = _sha256(path)
        graph.update(f"{relative}\0{size}\0{sha256}\n".encode())
        total_bytes += size

    shape = None
    features = []
    for entry in manifest["features"]:
        feature_id = entry["id"]
        root = release / "features" / feature_id
        feature = json.loads((root / "feature.json").read_text())
        volume = feature["representations"]["volume"]
        index = json.loads((root / volume["encoding"]["resource_index"]["resource"]["path"]).read_text())
        summary = json.loads((root / volume["summary"]["resource"]["path"]).read_text())
        shape = tuple(volume["grid"]["shape"])
        center_indices = [round(114.78), 108, round(6.64)]
        center = []
        for dimension, index_value in enumerate(center_indices):
            axis = f"i{dimension}"
            pack = next(
                item
                for item in index["packs"]
                if item["axis"] == axis
                and item["first_slice"] <= index_value
                < item["first_slice"] + item["slice_count"]
            )
            center.append(pack["resource"]["bytes"])
        features.append(
            {
                "id": feature_id,
                "pack_count": len(index["packs"]),
                "pack_bytes": sum(item["resource"]["bytes"] for item in index["packs"]),
                "linked_bregma_pack_bytes": sum(center),
                "linked_bregma_axis_bytes": center,
                "valid_voxel_count": summary["valid_voxel_count"],
                "outside_voxel_count": summary["outside_voxel_count"],
                "missing_voxel_count": summary["missing_voxel_count"],
                "total_voxel_count": summary["total_voxel_count"],
            }
        )
    if shape is None:
        raise ValueError("candidate contains no features")
    total_voxels = shape[0] * shape[1] * shape[2]
    if any(
        item["valid_voxel_count"]
        + item["outside_voxel_count"]
        + item["missing_voxel_count"]
        != total_voxels
        for item in features
    ):
        raise ValueError("candidate validity summaries are not exhaustive")
    worst = sorted(
        features,
        key=lambda item: (-item["linked_bregma_pack_bytes"], item["id"]),
    )
    return {
        "release_id": manifest["release"]["release_id"],
        "candidate_label": manifest["description"],
        "manifest_sha256": _sha256(manifest_path),
        "complete_graph_sha256": graph.hexdigest(),
        "file_count": len(files),
        "served_bytes": total_bytes,
        "feature_count": len(features),
        "grid_shape": list(shape),
        "transport": manifest["provenance"]["recipe"]["transport"],
        "source_sha256": manifest["provenance"]["sources"][0]["sha256"],
        "geometry_selection_sha256": _sha256(release / "geometry-selection.json"),
        "missing_voxel_count_max": max(item["missing_voxel_count"] for item in features),
        "features": features,
        "worst_linked_bregma_features": [item["id"] for item in worst[:8]],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("release", type=Path, nargs="+")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = {
        "benchmark": "w26-volume-candidate-graph-v1",
        "candidates": [summarize(path) for path in args.release],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
