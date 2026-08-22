"""Build the deterministic tiny GLB used only by mesh-pack tests."""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path
from typing import Any


def _padded(value: bytes, fill: bytes) -> bytes:
    return value + fill * ((-len(value)) % 4)


def build_synthetic_glb(spec_path: Path, output: Path) -> bytes:
    spec = json.loads(spec_path.read_text())
    if spec.get("format") != "synthetic-mesh-source-spec-v1":
        raise ValueError("unsupported synthetic mesh source specification")
    binary = bytearray()
    buffer_views: list[dict[str, Any]] = []
    accessors: list[dict[str, Any]] = []
    meshes = []
    for surface in spec["surfaces"]:
        positions = [float(value) for point in surface["positions_um"] for value in point]
        indices = [int(value) for triangle in surface["triangles"] for value in triangle]
        position_offset = len(binary)
        binary.extend(struct.pack(f"<{len(positions)}f", *positions))
        buffer_views.append({"buffer": 0, "byteOffset": position_offset, "byteLength": len(positions) * 4})
        position_view = len(buffer_views) - 1
        accessors.append({
            "bufferView": position_view, "componentType": 5126,
            "count": len(positions) // 3, "type": "VEC3",
            "min": [min(positions[axis::3]) for axis in range(3)],
            "max": [max(positions[axis::3]) for axis in range(3)],
        })
        position_accessor = len(accessors) - 1
        index_offset = len(binary)
        binary.extend(struct.pack(f"<{len(indices)}H", *indices))
        buffer_views.append({"buffer": 0, "byteOffset": index_offset, "byteLength": len(indices) * 2})
        accessors.append({"bufferView": len(buffer_views) - 1, "componentType": 5123, "count": len(indices), "type": "SCALAR"})
        meshes.append({"name": f"{surface['allen_id']}.obj", "extras": {"allen_id": surface["allen_id"]}, "primitives": [{"attributes": {"POSITION": position_accessor}, "indices": len(accessors) - 1, "mode": 4}]})
    binary_bytes = _padded(bytes(binary), b"\0")
    gltf = {
        "asset": {"version": "2.0", "generator": "ibl synthetic mesh fixture"},
        "buffers": [{"byteLength": len(binary_bytes)}],
        "bufferViews": buffer_views,
        "accessors": accessors,
        "meshes": meshes,
    }
    json_bytes = _padded(json.dumps(gltf, sort_keys=True, separators=(",", ":")).encode(), b" ")
    length = 12 + 8 + len(json_bytes) + 8 + len(binary_bytes)
    result = b"glTF" + struct.pack("<II", 2, length) + struct.pack("<I4s", len(json_bytes), b"JSON") + json_bytes + struct.pack("<I4s", len(binary_bytes), b"BIN\0") + binary_bytes
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("spec", type=Path)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()
    build_synthetic_glb(arguments.spec, arguments.output)


if __name__ == "__main__":
    main()
