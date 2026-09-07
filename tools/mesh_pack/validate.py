"""Validate the complete immutable mesh-pack v1 file graph."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path
from typing import Any

from ephys_atlas_builder.schema_v1 import validate_schema_v1_document

from .binary import inspect_lod


def _resource(pack: Path, descriptor: dict[str, Any]) -> bytes:
    path = pack / descriptor["path"]
    try:
        path.resolve().relative_to(pack.resolve())
    except ValueError as error:
        raise ValueError(f"mesh resource escapes pack: {descriptor['path']}") from error
    if not path.is_file():
        raise FileNotFoundError(f"mesh resource is missing: {descriptor['path']}")
    encoded = path.read_bytes()
    if len(encoded) != descriptor["bytes"]:
        raise ValueError(f"mesh resource byte length differs: {descriptor['path']}")
    if hashlib.sha256(encoded).hexdigest() != descriptor["sha256"]:
        raise ValueError(f"mesh resource SHA-256 differs: {descriptor['path']}")
    codec = descriptor["codec"]
    if codec["name"] == "gzip":
        try:
            decoded = gzip.decompress(encoded)
        except (gzip.BadGzipFile, EOFError) as error:
            raise ValueError(f"mesh resource gzip is invalid: {descriptor['path']}") from error
    else:
        decoded = encoded
    if len(decoded) != codec["decoded_bytes"]:
        raise ValueError(f"mesh resource decoded length differs: {descriptor['path']}")
    return decoded


def validate_pack(pack: Path) -> dict[str, Any]:
    manifest_path = pack / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError("mesh manifest is missing")
    manifest = json.loads(manifest_path.read_text())
    validate_schema_v1_document(manifest, "mesh-pack.schema.json")
    declared = {"manifest.json"}
    for lod in manifest["lods"]:
        descriptor = lod["resource"]
        declared.add(descriptor["path"])
        header = inspect_lod(_resource(pack, descriptor))
        if header["encoding"] != lod["decoder"]["encoding"]:
            raise ValueError(f"mesh LOD decoder contract differs: {lod['id']}")
        chunk_ids = [chunk.get("chunk_id") for chunk in header["chunks"]]
        if not chunk_ids or any(not isinstance(item, str) or not item for item in chunk_ids) or len(chunk_ids) != len(set(chunk_ids)):
            raise ValueError(f"mesh LOD chunk inventory differs: {lod['id']}")
        component_ids = sorted(range_["component_id"] for chunk in header["chunks"] for range_ in chunk.get("ranges", []))
        if component_ids != list(range(len(manifest["components"]))):
            raise ValueError(f"mesh LOD component ranges differ: {lod['id']}")
        meshopt = header["encoding"] == "meshopt-quantized-v1"
        index_count = sum(chunk["index_count"] if meshopt else chunk["arrays"]["indices"]["count"] for chunk in header["chunks"])
        if index_count % 3 or index_count // 3 != lod["triangle_count"]:
            raise ValueError(f"mesh LOD triangle count differs: {lod['id']}")
        for chunk in header["chunks"]:
            chunk_index_count = chunk["index_count"] if meshopt else chunk["arrays"]["indices"]["count"]
            chunk_vertex_count = chunk["vertex_count"] if meshopt else chunk["arrays"]["component_ids"]["count"]
            if not meshopt and (chunk["arrays"]["positions"]["count"] != chunk_vertex_count * 3 or chunk["arrays"]["normals"]["count"] != chunk_vertex_count * 3):
                raise ValueError(f"mesh LOD vertex arrays differ: {lod['id']}")
            for range_ in chunk["ranges"]:
                if range_["index_start"] < 0 or range_["index_count"] <= 0 or range_["index_start"] + range_["index_count"] > chunk_index_count:
                    raise ValueError(f"mesh LOD index range is invalid: {lod['id']}")
                if range_["vertex_start"] < 0 or range_["vertex_count"] <= 0 or range_["vertex_start"] + range_["vertex_count"] > chunk_vertex_count:
                    raise ValueError(f"mesh LOD vertex range is invalid: {lod['id']}")
                component = manifest["components"][range_["component_id"]]
                if (range_["left_presentation_id"] != component["left_presentation_id"]
                        or range_["right_presentation_id"] != component["right_presentation_id"]):
                    raise ValueError(f"mesh LOD component presentation identity differs: {lod['id']}")
    report_descriptor = manifest["validation"]["report"]
    declared.add(report_descriptor["path"])
    report = json.loads(_resource(pack, report_descriptor))
    if report.get("format") != "atlas-mesh-pack-validation-report-v1" or report.get("pack_id") != manifest["pack_id"] or report.get("test_only") != (manifest["purpose"] == "test-only"):
        raise ValueError("mesh validation report identity differs")
    result_keys = {"rebuild", "coverage", "midline", "topology", "mapping", "bounds", "integrity", "complete_file_graph"}
    if set(report.get("results", {})) != result_keys or report["results"] != {key: manifest["validation"][key] for key in result_keys}:
        raise ValueError("mesh validation report results differ")
    actual = {path.relative_to(pack).as_posix() for path in pack.rglob("*") if path.is_file()}
    missing = declared - actual
    undeclared = actual - declared
    if missing:
        raise FileNotFoundError("mesh pack graph is missing: " + ", ".join(sorted(missing)))
    if undeclared:
        raise ValueError("mesh pack graph contains undeclared files: " + ", ".join(sorted(undeclared)))
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="validate an atlas-mesh-pack-v1 file graph")
    parser.add_argument("pack", type=Path)
    arguments = parser.parse_args()
    validate_pack(arguments.pack)


if __name__ == "__main__":
    main()
