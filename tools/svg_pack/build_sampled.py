"""Build a display-sampled indexed SVG corpus from anatomy-pack-v2.

This tool only converts an already validated parent pack.  It deliberately does
not polygonize or otherwise change geometry; the parent manifest remains the
scientific authority.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import html
import json
import math
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any
from jsonschema import Draft202012Validator

from tools.svg_pack import SvgFragment, SvgPack, decode, encode

PROJECTIONS = ("coronal", "sagittal", "horizontal")
DEPTHS = (4, 8, 16)
FORMAT = "anatomy-pack-v3"


def _canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _safe_relative(path: str) -> Path:
    candidate = Path(path)
    if candidate.is_absolute() or ".." in candidate.parts or any(part == "" for part in candidate.parts):
        raise ValueError(f"unsafe artifact path: {path!r}")
    return candidate


def _fixed_coordinate(projection: dict[str, Any], index: int) -> float:
    matrix = projection["plane_index_to_world_um"]
    axis = {"ml": 0, "ap": 1, "dv": 2}[projection["fixed_world_axis"]]
    return float(matrix[axis * 4] * index + matrix[axis * 4 + 3])


def _lattice_anchor_index(projection: dict[str, Any]) -> int:
    matrix = projection["plane_index_to_world_um"]
    axis = {"ml": 0, "ap": 1, "dv": 2}[projection["fixed_world_axis"]]
    step = float(matrix[axis * 4])
    origin = float(matrix[axis * 4 + 3])
    if not math.isfinite(step) or step == 0 or not math.isfinite(origin):
        raise ValueError("projection fixed-axis affine must have a finite non-zero step")
    return min(int(projection["slice_count"]) - 1, max(0, round(-origin / step)))


def _fragment(slice_value: dict[str, Any]) -> str:
    fragments = []
    for path in slice_value["paths"]:
        ids = path["atlas_ids"]
        # Match the active renderer's fragment contract byte-for-byte.
        def esc(value: Any) -> str:
            return html.escape(str(value), quote=True)
        fragments.append(
            '<path class="atlas-region" fill-rule="evenodd" '
            f'data-allen-id="{esc(ids["allen"])}" '
            f'data-beryl-id="{esc(ids["beryl"])}" '
            f'data-cosmos-id="{esc(ids["cosmos"])}" '
            f'd="{esc(path["d"])}"/>'
        )
    return "".join(fragments)


def _load_parent_slices(root: Path, parent: dict[str, Any], projection_name: str, spacing_um: int) -> tuple[list[dict[str, Any]], int]:
    projection = parent["projections"][projection_name]
    result: list[dict[str, Any]] = []
    native_count = 0
    lattice_anchor_index = _lattice_anchor_index(projection)
    lattice_anchor = _fixed_coordinate(projection, lattice_anchor_index)
    # A benchmark parent may expose several depths; conversion consumes one
    # canonical source inventory, choosing the shallowest declared depth.
    pack_sets = projection["pack_sets"]
    if not pack_sets:
        raise ValueError(f"parent {projection_name} has no pack set")
    for pack_set in (pack_sets[sorted(pack_sets, key=int)[0]],):
        for artifact in sorted(pack_set["packs"], key=lambda value: value["pack_index"]):
            rel = _safe_relative(artifact["path"])
            compressed = (root / rel).read_bytes()
            if len(compressed) != artifact["bytes"] or _sha(compressed) != artifact["sha256"]:
                raise ValueError(f"parent artifact integrity mismatch: {rel}")
            payload = json.loads(gzip.decompress(compressed))
            if payload["projection"] != projection_name:
                raise ValueError("parent projection identity mismatch")
            slices = payload["slices"]
            expected_first = native_count
            if [item["slice_index"] for item in slices] != list(range(expected_first, expected_first + len(slices))):
                raise ValueError(f"parent {projection_name} inventory is not contiguous")
            for item in slices:
                expected = _fixed_coordinate(projection, int(item["slice_index"]))
                if not math.isclose(float(item["world_coordinate_um"]), expected, abs_tol=1e-6, rel_tol=0):
                    raise ValueError(f"parent affine/world mismatch at {projection_name}:{item['slice_index']}")
                if math.isclose((float(item["world_coordinate_um"]) - lattice_anchor) / spacing_um, round((float(item["world_coordinate_um"]) - lattice_anchor) / spacing_um), abs_tol=1e-8):
                    result.append(item)
            # Only sampled items are retained; native count is tracked separately.
            native_count += len(slices)
    if native_count != projection["slice_count"]:
        raise ValueError(f"parent {projection_name} inventory count mismatch")
    return result, native_count


def build_sampled(
    parent_root: Path,
    output: Path,
    *,
    spacing_um: int = 80,
    pack_depth: int = 8,
    created_at: str | None = None,
    generator_commit: str = "synthetic-test",
) -> dict[str, Any]:
    if spacing_um <= 0 or spacing_um % 10:
        raise ValueError("spacing_um must be a positive multiple of the native 10 um grid")
    if pack_depth not in DEPTHS:
        raise ValueError(f"pack_depth must be one of {DEPTHS}")
    parent_root = parent_root.resolve()
    manifest_path = parent_root / "manifest.json"
    parent = json.loads(manifest_path.read_bytes())
    if parent.get("format") != "anatomy-pack-v2":
        raise ValueError("parent must be an anatomy-pack-v2 manifest")
    if output.exists():
        raise FileExistsError(f"refusing to overwrite output: {output}")
    if output.resolve() == parent_root or parent_root in output.resolve().parents:
        raise ValueError("output must not be the parent pack or inside it")
    created_at = created_at or "1970-01-01T00:00:00Z"
    parent_sha = _sha(manifest_path.read_bytes())
    pack_id = f"{parent['pack_id']}-display-{spacing_um}um-d{pack_depth}-{_sha(_canonical({
        'format': FORMAT,
        'parent_manifest_sha256': parent_sha,
        'spacing_um': spacing_um,
        'pack_depth': pack_depth,
        'codec': 'ISVG-1+gzip-9',
        'generator_commit': generator_commit,
    }))[:12]}"
    stage_parent = output.parent
    stage_parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".{output.name}-", dir=stage_parent) as temp:
        stage = Path(temp)
        projections: dict[str, Any] = {}
        for name in PROJECTIONS:
            parent_projection = parent["projections"][name]
            selected, native_count = _load_parent_slices(parent_root, parent, name, spacing_um)
            anchor_index = _lattice_anchor_index(parent_projection)
            anchor = _fixed_coordinate(parent_projection, anchor_index)
            if not selected:
                raise ValueError(f"no planes selected for {name}")
            artifacts = []
            for start in range(0, len(selected), pack_depth):
                chunk = selected[start:start + pack_depth]
                pack_index = start // pack_depth
                artifact_pack_id = f"{pack_id}:{name}:{pack_index}"
                pack = SvgPack(name, artifact_pack_id, tuple(SvgFragment(int(s["slice_index"]), float(s["world_coordinate_um"]), _fragment(s)) for s in chunk))
                raw = encode(pack)
                if decode(raw) != pack:
                    raise ValueError(f"indexed SVG round-trip mismatch: {name}:{pack_index}")
                compressed = gzip.compress(raw, compresslevel=9, mtime=0)
                rel = Path("packs") / str(pack_depth) / name / f"{pack_index}.isvg.gz"
                rel = _safe_relative(rel.as_posix())
                target = stage / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(compressed)
                artifacts.append({"pack_id": artifact_pack_id, "pack_index": pack_index, "first_display_index": start, "first_slice_index": chunk[0]["slice_index"], "slice_count": len(chunk), "path": rel.as_posix(), "media_type": "application/vnd.ibl.indexed-svg", "compression": "gzip", "bytes": len(compressed), "uncompressed_bytes": len(raw), "sha256": _sha(compressed)})
            projections[name] = {"fixed_world_axis": parent_projection["fixed_world_axis"], "plane_axes": parent_projection["plane_axes"], "slice_count": native_count, "display_slice_count": len(selected), "display_slice_indices": [int(item["slice_index"]) for item in selected], "slice_shape": parent_projection["slice_shape"], "view_box": parent_projection["view_box"], "plane_index_to_world_um": parent_projection["plane_index_to_world_um"], "world_to_plane_index": parent_projection["world_to_plane_index"], "lattice_anchor_slice_index": anchor_index, "lattice_origin_um": anchor, "lattice_spacing_um": spacing_um, "pack_sets": {str(pack_depth): {"pack_depth": pack_depth, "path_template": f"packs/{pack_depth}/{name}/{{pack}}.isvg.gz", "packs": artifacts}}, "validation": {"native_source_slices": native_count, "display_emitted_slices": len(selected)}}
        manifest = {"format": FORMAT, "schema_version": "3.0", "pack_id": pack_id, "immutable": True, "created_at": created_at, "parent": {"manifest_sha256": parent_sha, "pack_id": parent["pack_id"], "format": parent["format"], "source": parent.get("source"), "provenance": parent.get("provenance"), "validation": parent.get("validation"), "synchronization_sentinels": parent.get("synchronization_sentinels")}, "provenance": {"generator": {"repository": "rossant/ibl-ephys-atlas-web-v2", "commit": generator_commit, "dirty": False}, "derivation": "byte-preserving SVG fragment extraction from validated parent anatomy-pack-v2"}, "sampling": {"native_resolution_um": 10, "spacing_um": spacing_um, "lattice": "native plane nearest fixed-axis world zero plus integer spacing", "pack_depth": pack_depth}, "coordinate_system": parent["coordinate_system"], "projections": projections, "validation": {"native_source_slices": sum(item["slice_count"] for item in projections.values()), "display_emitted_slices": sum(item["display_slice_count"] for item in projections.values())}}
        schema_path = Path(__file__).resolve().parents[2] / "schema/anatomy-pack-v3/manifest.schema.json"
        Draft202012Validator(json.loads(schema_path.read_text())).validate(manifest)
        (stage / "manifest.json").write_bytes(_canonical(manifest))
        shutil.move(stage, output)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parent", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--spacing-um", type=int, default=80)
    parser.add_argument("--pack-depth", type=int, choices=DEPTHS, default=8)
    parser.add_argument("--created-at", default="1970-01-01T00:00:00Z")
    args = parser.parse_args()
    repository = Path(__file__).resolve().parents[2]
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repository, check=True, capture_output=True, text=True
    ).stdout.strip()
    dirty = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=no"],
        cwd=repository,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if dirty:
        raise RuntimeError("refusing provenance build from a dirty tracked worktree")
    build_sampled(
        args.parent,
        args.output,
        spacing_um=args.spacing_um,
        pack_depth=args.pack_depth,
        created_at=args.created_at,
        generator_commit=commit,
    )


if __name__ == "__main__":
    main()
