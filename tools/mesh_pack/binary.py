"""Versioned deterministic EAM3 raw container encoding."""

from __future__ import annotations

import json
import struct
from typing import Any

MAGIC = b"EAM3"
VERSION = 1
PREFIX_BYTES = 12


def _canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def encode_raw_lod(chunks: list[dict[str, Any]]) -> bytes:
    payload = bytearray()
    descriptors = []
    for chunk in chunks:
        arrays: dict[str, dict[str, Any]] = {}
        specifications = (
            ("positions", "f", "float32", 3),
            ("normals", "f", "float32", 3),
            ("feature_ids", "H", "uint16", 1),
            ("indices", "I", "uint32", 1),
        )
        for name, code, component_type, item_size in specifications:
            values = chunk[name]
            width = struct.calcsize(f"<{code}")
            padding = (-len(payload)) % width
            payload.extend(b"\0" * padding)
            arrays[name] = {"byte_offset": len(payload), "count": len(values), "component_type": component_type, "item_size": item_size}
            payload.extend(struct.pack(f"<{len(values)}{code}", *values))
        descriptors.append({"hemisphere": chunk["hemisphere"], "arrays": arrays, "ranges": chunk["ranges"]})
    header = _canonical_json({"encoding": "raw-v1", "chunks": descriptors})
    payload_offset = (PREFIX_BYTES + len(header) + 3) // 4 * 4
    output = bytearray(payload_offset + len(payload))
    output[:4] = MAGIC
    struct.pack_into("<II", output, 4, VERSION, len(header))
    output[PREFIX_BYTES : PREFIX_BYTES + len(header)] = header
    output[payload_offset:] = payload
    return bytes(output)


def inspect_lod(data: bytes) -> dict[str, Any]:
    if len(data) < PREFIX_BYTES:
        raise ValueError("mesh LOD is truncated")
    if data[:4] != MAGIC:
        raise ValueError("mesh LOD magic is invalid")
    version, header_length = struct.unpack_from("<II", data, 4)
    if version != VERSION:
        raise ValueError("mesh LOD version is unsupported")
    payload_offset = (PREFIX_BYTES + header_length + 3) // 4 * 4
    if payload_offset > len(data):
        raise ValueError("mesh LOD header is truncated")
    try:
        header = json.loads(data[PREFIX_BYTES : PREFIX_BYTES + header_length])
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("mesh LOD header is invalid") from error
    if header.get("encoding") != "raw-v1" or not isinstance(header.get("chunks"), list):
        raise ValueError("mesh LOD encoding is unsupported")
    widths = {"float32": 4, "uint16": 2, "uint32": 4}
    for chunk in header["chunks"]:
        for descriptor in chunk.get("arrays", {}).values():
            width = widths.get(descriptor.get("component_type"))
            if width is None or descriptor.get("byte_offset", -1) < 0 or descriptor.get("count", -1) < 0:
                raise ValueError("mesh LOD array descriptor is invalid")
            if payload_offset + descriptor["byte_offset"] + descriptor["count"] * width > len(data):
                raise ValueError("mesh LOD array is out of bounds")
    return header
