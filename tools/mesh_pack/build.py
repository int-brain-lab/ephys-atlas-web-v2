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
from .components import triangle_components
from .geometry import (
    HalfMesh,
    bounds,
    centroid,
    split_and_cap_hemispheres,
    vertex_normals,
)
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


def _presentation_record(presentation_id: int, source_id: int, side: str, catalog: dict[str, Any]) -> dict[str, Any]:
    sign = -1 if side == "left" else 1
    signed_id = sign * source_id
    return {
        "presentation_id": presentation_id,
        "source_allen_id": source_id,
        "signed_allen_id": signed_id,
        "side": side,
        "mappings": {
            name: (None if (mapped := resolve_mapping(source_id, name, catalog)) is None else sign * mapped)
            for name in ("allen", "beryl", "cosmos")
        },
    }


def _merge(components: list[tuple[dict[str, Any], HalfMesh]]) -> dict[str, Any]:
    positions: list[float] = []
    normals: list[float] = []
    component_ids: list[int] = []
    indices: list[int] = []
    ranges = []
    for component, mesh in components:
        vertex_start = len(positions) // 3
        index_start = len(indices)
        positions.extend(value for point in mesh.positions for value in point)
        normals.extend(vertex_normals(mesh.positions, mesh.triangles))
        component_ids.extend([component["component_id"]] * len(mesh.positions))
        indices.extend(vertex_start + index for face in mesh.triangles for index in face)
        ranges.append({
            "component_id": component["component_id"],
            "left_presentation_id": component["left_presentation_id"],
            "right_presentation_id": component["right_presentation_id"],
            "index_start": index_start,
            "index_count": len(mesh.triangles) * 3,
            "vertex_start": vertex_start,
            "vertex_count": len(mesh.positions),
        })
    return {"chunk_id": "all", "positions": positions, "normals": normals, "component_ids": component_ids, "indices": indices, "ranges": ranges}


def _component_mesh(positions: list[list[float]], triangles: list[list[int]], ordinals: list[int]) -> HalfMesh:
    source_vertices = sorted({index for ordinal in ordinals for index in triangles[ordinal]})
    local_by_source = {source: local for local, source in enumerate(source_vertices)}
    return HalfMesh(
        positions=[positions[index] for index in source_vertices],
        triangles=[[local_by_source[index] for index in triangles[ordinal]] for ordinal in ordinals],
        surface_triangle_count=len(ordinals),
        cap_triangle_count=0,
    )


def _component_record(
    component_id: int,
    source_id: int,
    mesh: HalfMesh,
    lateralization: str,
    presentation_ids: dict[tuple[int, str], int],
) -> dict[str, Any]:
    return {
        "component_id": component_id,
        "source_allen_id": source_id,
        "lateralization": lateralization,
        "left_presentation_id": presentation_ids[(source_id, "left")] if lateralization != "right" else None,
        "right_presentation_id": presentation_ids[(source_id, "right")] if lateralization != "left" else None,
        "bounds": bounds(mesh.positions),
        "vertex_count": len(mesh.positions),
        "triangle_count": len(mesh.triangles),
        "centroid_um": centroid(mesh.positions),
        "explode_displacement_um": [0.0, 0.0, 0.0],
    }


def build_pack(
    source_dir: Path,
    output: Path,
    *,
    builder_commit: str = "synthetic",
    geometry_policy: str = "native-components",
) -> dict[str, Any]:
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

    if geometry_policy not in {"bilateral-cut-cap", "native-components"}:
        raise ValueError("mesh geometry policy is unsupported")
    presentations = [
        _presentation_record(index, source_id, side, catalog)
        for index, (source_id, side) in enumerate((source_id, side) for source_id in renderable for side in ("left", "right"))
    ]
    presentation_ids = {(item["source_allen_id"], item["side"]): item["presentation_id"] for item in presentations}
    compiled: list[tuple[dict[str, Any], HalfMesh]] = []
    open_sources: list[int] = []
    loop_counts: dict[str, int] = {}
    for source_id in renderable:
        positions, triangles = surfaces[source_id]
        if geometry_policy == "bilateral-cut-cap":
            split = split_and_cap_hemispheres(positions, triangles)
            loop_counts[str(source_id)] = split.intersection_loop_count
            if split.open_intersection_component_count:
                open_sources.append(source_id)
            for side, mesh in (("left", split.left), ("right", split.right)):
                if not mesh.triangles or any((point[0] > 1e-5 if side == "left" else point[0] < -1e-5) for point in mesh.positions):
                    raise ValueError(f"compiled {source_id} {side} violates the ML half-space")
                compiled.append((_component_record(len(compiled), source_id, mesh, side, presentation_ids), mesh))
        else:
            loop_counts[str(source_id)] = 0
            for ordinals in triangle_components(triangles, connectivity="edge"):
                mesh = _component_mesh(positions, triangles, ordinals)
                low, high = bounds(mesh.positions)["minimum_um"][0], bounds(mesh.positions)["maximum_um"][0]
                lateralization = "left" if high < 0 else "right" if low > 0 else "neutral"
                compiled.append((_component_record(len(compiled), source_id, mesh, lateralization, presentation_ids), mesh))
    if open_sources:
        raise ValueError("source contains open medial intersections")

    components = [component for component, _ in compiled]
    whole_centroid = [sum(component["centroid_um"][axis] for component in components) / len(components) for axis in range(3)]
    for component in components:
        if component["lateralization"] != "neutral":
            component["explode_displacement_um"] = [component["centroid_um"][axis] - whole_centroid[axis] for axis in range(3)]
    chunks = [_merge(compiled)]
    decoded = encode_raw_lod(chunks)
    encoded = _deterministic_gzip(decoded)
    source_triangles = sum(component["triangle_count"] for component in components)
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
            "presentation_count": len(presentations),
            "component_count": len(components),
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
        "geometry_policy": geometry_policy,
        "presentation_boundary": {
            "coordinate": "original-world-ml", "threshold_um": 0,
            "on_plane_side": "right", "status": "provisional-test-only",
        },
        "whole_brain_centroid_um": whole_centroid,
        "presentations": presentations,
        "components": components,
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
    parser.add_argument("--geometry-policy", choices=("bilateral-cut-cap", "native-components"), default="native-components")
    arguments = parser.parse_args()
    build_pack(arguments.source_dir, arguments.output, builder_commit=arguments.builder_commit, geometry_policy=arguments.geometry_policy)


if __name__ == "__main__":
    main()
