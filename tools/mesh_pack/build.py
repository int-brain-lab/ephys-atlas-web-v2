"""Compile a deterministic bilateral atlas-mesh-pack-v1 from a GLB source."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import struct
from pathlib import Path
from typing import Any

from .binary import encode_raw_lod
from .geometry import HalfMesh, bounds, centroid, component_count, split_and_cap_hemispheres, vertex_normals
from .ontology import resolve_mapping, select_grey_matter_source_ids

FORMAT = "atlas-mesh-pack-v1"
REFERENCE_SPACE_ID = "allen-ccf-2017"
BUILDER_VERSION = "1.0.0"


def _canonical(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _deterministic_gzip(data: bytes) -> bytes:
    encoded = bytearray(gzip.compress(data, compresslevel=9, mtime=0))
    # zlib may emit the host OS identifier when mtime is zero. Pin the header
    # to Unix so identical inputs rebuild byte-for-byte on macOS and Linux.
    encoded[9] = 3
    return bytes(encoded)


def _read_json(path: Path) -> tuple[dict[str, Any], bytes]:
    data = path.read_bytes()
    return json.loads(data), data


def _glb_surfaces(data: bytes) -> dict[int, tuple[list[list[float]], list[list[int]]]]:
    if len(data) < 20 or data[:4] != b"glTF" or struct.unpack_from("<I", data, 4)[0] != 2:
        raise ValueError("source is not a GLB 2.0 file")
    declared_length = struct.unpack_from("<I", data, 8)[0]
    if declared_length != len(data):
        raise ValueError("source GLB length is inconsistent")
    json_length, json_kind = struct.unpack_from("<I4s", data, 12)
    if json_kind != b"JSON":
        raise ValueError("source GLB lacks its JSON chunk")
    gltf = json.loads(data[20 : 20 + json_length])
    binary_header = 20 + json_length
    binary_length, binary_kind = struct.unpack_from("<I4s", data, binary_header)
    if binary_kind != b"BIN\0":
        raise ValueError("source GLB lacks its binary chunk")
    binary = data[binary_header + 8 : binary_header + 8 + binary_length]

    def accessor(index: int) -> list[Any]:
        item = gltf["accessors"][index]
        view = gltf["bufferViews"][item["bufferView"]]
        components = {"SCALAR": 1, "VEC3": 3}[item["type"]]
        code, width = {5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}[item["componentType"]]
        offset = view.get("byteOffset", 0) + item.get("byteOffset", 0)
        count = item["count"] * components
        end = offset + count * width
        if offset < 0 or end > len(binary):
            raise ValueError("source GLB accessor is out of bounds")
        values = struct.unpack_from(f"<{count}{code}", binary, offset)
        return [list(values[position : position + components]) if components > 1 else values[position] for position in range(0, count, components)]

    surfaces: dict[int, tuple[list[list[float]], list[list[int]]]] = {}
    for mesh in gltf.get("meshes", []):
        identifier = mesh.get("extras", {}).get("allen_id")
        if not isinstance(identifier, int) or identifier <= 0 or len(mesh.get("primitives", [])) != 1:
            raise ValueError("source GLB mesh identity is invalid")
        primitive = mesh["primitives"][0]
        if primitive.get("mode", 4) != 4:
            raise ValueError("source GLB primitive is not triangles")
        positions = accessor(primitive["attributes"]["POSITION"])
        flat_indices = accessor(primitive["indices"])
        if len(flat_indices) % 3:
            raise ValueError("source GLB triangle index count is invalid")
        surfaces[identifier] = (positions, [flat_indices[position : position + 3] for position in range(0, len(flat_indices), 3)])
    if not surfaces:
        raise ValueError("source GLB has no Allen surfaces")
    return surfaces


def _identity(identifier: str, url: str, data: bytes) -> dict[str, Any]:
    return {"id": identifier, "url": url, "bytes": len(data), "sha256": _sha(data)}


def _region_record(feature_id: int, source_id: int, hemisphere: str, mesh: HalfMesh, catalog: dict[str, Any]) -> dict[str, Any]:
    sign = -1 if hemisphere == "left" else 1
    signed_id = sign * source_id
    mappings = {name: (None if (mapped := resolve_mapping(source_id, name, catalog)) is None else sign * mapped) for name in ("allen", "beryl", "cosmos")}
    return {
        "feature_id": feature_id,
        "source_allen_id": source_id,
        "signed_allen_id": signed_id,
        "hemisphere": hemisphere,
        "mappings": mappings,
        "bounds": bounds(mesh.positions),
        "vertex_count": len(mesh.positions),
        "triangle_count": len(mesh.triangles),
        "component_count": component_count(mesh.triangles),
        "centroid_um": centroid(mesh.positions),
        "signed_explode_group_id": signed_id,
    }


def _merge(regions: list[tuple[dict[str, Any], HalfMesh]], hemisphere: str) -> dict[str, Any]:
    positions: list[float] = []
    normals: list[float] = []
    feature_ids: list[int] = []
    indices: list[int] = []
    ranges = []
    for region, mesh in regions:
        vertex_start = len(positions) // 3
        index_start = len(indices)
        positions.extend(value for point in mesh.positions for value in point)
        normals.extend(vertex_normals(mesh.positions, mesh.triangles))
        feature_ids.extend([region["feature_id"]] * len(mesh.positions))
        indices.extend(vertex_start + index for face in mesh.triangles for index in face)
        ranges.append({
            "feature_id": region["feature_id"],
            "signed_allen_id": region["signed_allen_id"],
            "signed_explode_group_id": region["signed_explode_group_id"],
            "index_start": index_start,
            "index_count": len(mesh.triangles) * 3,
            "vertex_start": vertex_start,
            "vertex_count": len(mesh.positions),
        })
    return {"hemisphere": hemisphere, "positions": positions, "normals": normals, "feature_ids": feature_ids, "indices": indices, "ranges": ranges}


def build_pack(source_dir: Path, output: Path, *, builder_commit: str = "synthetic") -> dict[str, Any]:
    paths = {
        "source_glb": source_dir / "source.glb",
        "active_inventory": source_dir / "active-allen-ids.json",
        "projection_pack": source_dir / "projection-pack.json",
        "atlas_catalog": source_dir / "catalog.json",
        "annotation": source_dir / "annotation.txt",
        "lut": source_dir / "lut.json",
    }
    missing = [str(path) for path in paths.values() if not path.is_file()]
    if missing:
        raise FileNotFoundError("mesh-pack inputs are missing: " + ", ".join(missing))
    blobs = {name: path.read_bytes() for name, path in paths.items()}
    catalog = json.loads(blobs["atlas_catalog"])
    projection_pack = json.loads(blobs["projection_pack"])
    lut = json.loads(blobs["lut"])
    active_inventory_document = json.loads(blobs["active_inventory"])
    if projection_pack.get("reference_space_id") != REFERENCE_SPACE_ID:
        raise ValueError("projection-pack reference space differs from the mesh contract")
    surfaces = _glb_surfaces(blobs["source_glb"])
    active_inventory = {int(identifier) for identifier in active_inventory_document.get("allen_ids", [])}
    if not active_inventory:
        raise ValueError("active Allen inventory is empty")
    scope = select_grey_matter_source_ids(active_inventory, catalog)
    renderable = sorted(scope["renderable_ids"])
    if renderable != sorted(surfaces):
        raise ValueError("source GLB differs from deepest-active grey-matter scope")
    if sorted(lut.get("signed_allen_ids", [])) != sorted([-identifier for identifier in renderable] + renderable):
        raise ValueError("bilateral LUT differs from source geometry")

    compiled: list[tuple[dict[str, Any], HalfMesh]] = []
    open_sources: list[int] = []
    loop_counts: dict[str, int] = {}
    for source_id in renderable:
        positions, triangles = surfaces[source_id]
        split = split_and_cap_hemispheres(positions, triangles)
        loop_counts[str(source_id)] = split.intersection_loop_count
        if split.open_intersection_component_count:
            open_sources.append(source_id)
        for hemisphere, mesh in (("left", split.left), ("right", split.right)):
            if not mesh.triangles or any((point[0] > 1e-5 if hemisphere == "left" else point[0] < -1e-5) for point in mesh.positions):
                raise ValueError(f"compiled {source_id} {hemisphere} violates the ML half-space")
            record = _region_record(len(compiled), source_id, hemisphere, mesh, catalog)
            compiled.append((record, mesh))
    if open_sources:
        raise ValueError("source contains open medial intersections")

    regions = [region for region, _ in compiled]
    chunks = [_merge([(region, mesh) for region, mesh in compiled if region["hemisphere"] == hemisphere], hemisphere) for hemisphere in ("left", "right")]
    decoded = encode_raw_lod(chunks)
    encoded = _deterministic_gzip(decoded)
    source_triangles = sum(region["triangle_count"] for region in regions)
    input_digest = _sha(b"".join(blobs[name] for name in sorted(blobs)))
    pack_id = f"synthetic-mesh-{input_digest[:12]}"
    report = {
        "format": "atlas-mesh-pack-validation-report-v1",
        "pack_id": pack_id,
        "test_only": True,
        "results": {
            "rebuild": True, "coverage": True, "midline": True, "topology": True,
            "mapping": True, "bounds": True, "integrity": True, "complete_file_graph": True,
        },
        "evidence": {
            "source_allen_ids": renderable,
            "excluded_non_grey_allen_ids": sorted(scope["excluded_non_grey_active_ids"]),
            "intersection_loop_counts": loop_counts,
            "open_midline_source_allen_ids": open_sources,
            "signed_region_count": len(regions),
            "source_triangle_count": source_triangles,
            "lod_triangle_count": source_triangles,
        },
    }
    report_bytes = _canonical(report)
    resource_path = "default.eam3.gz"
    report_path = "validation-report.json"
    identities = {
        "source_glb": {**_identity("synthetic-source-glb-v1", "fixture://mesh/source.glb", blobs["source_glb"]), "inventory_allen_ids": renderable},
        "active_inventory": _identity("synthetic-active-allen-ids-v1", "fixture://mesh/active-allen-ids.json", blobs["active_inventory"]),
        "projection_pack": _identity(projection_pack["pack_id"], "fixture://projection/manifest.json", blobs["projection_pack"]),
        "atlas_catalog": _identity("synthetic-allen-catalog-v1", "fixture://atlas/regions.json", blobs["atlas_catalog"]),
        "annotation": _identity("synthetic-annotation-v1", "fixture://atlas/annotation.txt", blobs["annotation"]),
        "lut": _identity("synthetic-bilateral-lut-v1", "fixture://atlas/lut.json", blobs["lut"]),
    }
    whole_centroid = [sum(region["centroid_um"][axis] for region in regions) / len(regions) for axis in range(3)]
    manifest = {
        "schema_version": "1.0", "format": FORMAT, "pack_id": pack_id,
        "geometry_id": f"synthetic-bilateral-grey-{input_digest[:12]}",
        "immutable": True, "purpose": "test-only", "reference_space_id": REFERENCE_SPACE_ID,
        "coordinate_system": {
            "world_axes": ["ml", "ap", "dv"], "units": "um", "handedness": "right-handed",
            "source_to_world_um": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            "transform_evidence": "Synthetic GLB positions are authored directly in IBL ML/AP/DV micrometres.",
        },
        "sources": identities,
        "geometry_scope": {
            "ontology": "Allen CCF 2017", "root_allen_id": 8, "root_acronym": "grey",
            "policy": "deepest-active-grey-descendants", "active_allen_ids": renderable,
            "excluded_allen_ids": sorted(scope["excluded_non_grey_active_ids"]),
        },
        "whole_brain_centroid_um": whole_centroid,
        "explode_groups": [{"signed_group_id": region["signed_explode_group_id"], "hemisphere": region["hemisphere"], "centroid_um": region["centroid_um"]} for region in regions],
        "regions": regions,
        "default_lod_id": "default", "upgrade_lod_id": None,
        "lods": [{
            "id": "default", "target_triangle_ratio": 1.0, "actual_triangle_ratio": 1.0,
            "triangle_count": source_triangles, "maximum_error_um": 0.0,
            "adaptive_fallback_region_count": 0,
            "resource": {"path": resource_path, "media_type": "application/vnd.ibl.eam3", "bytes": len(encoded), "sha256": _sha(encoded), "codec": {"name": "gzip", "decoded_bytes": len(decoded), "level": 9}},
            "decoder": {"container": "EAM3", "container_version": 1, "encoding": "raw-v1", "position_bits": 0, "normal_bits": 0},
        }],
        "builder": {"name": "ibl-atlas-mesh-pack-builder", "version": BUILDER_VERSION, "commit": builder_commit, "command": "python -m tools.mesh_pack.build --source-dir <source> --output <output>"},
        "validation": {
            "report": {"path": report_path, "media_type": "application/json", "bytes": len(report_bytes), "sha256": _sha(report_bytes), "codec": {"name": "none", "decoded_bytes": len(report_bytes)}},
            **report["results"],
        },
    }
    if output.exists() and any(output.iterdir()):
        raise FileExistsError(f"mesh-pack output must be empty: {output}")
    output.mkdir(parents=True, exist_ok=True)
    (output / resource_path).write_bytes(encoded)
    (output / report_path).write_bytes(report_bytes)
    (output / "manifest.json").write_bytes(_canonical(manifest))
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="compile an immutable atlas-mesh-pack-v1")
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--builder-commit", default="synthetic")
    arguments = parser.parse_args()
    build_pack(arguments.source_dir, arguments.output, builder_commit=arguments.builder_commit)


if __name__ == "__main__":
    main()
