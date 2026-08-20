"""Deterministic v1 indexed SVG fragment pack codec.

The wire format is independent of anatomy geometry. All integers are
little-endian.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
import struct

MAGIC = b"ISVG"
VERSION = 1
_HEADER = struct.Struct("<4sBBHHHIIII")
_ENTRY = struct.Struct("<idII")
_MAX_COUNT = 1_000_000


@dataclass(frozen=True)
class SvgFragment:
    slice_index: int
    world_coordinate_um: float
    svg: str


@dataclass(frozen=True)
class SvgPack:
    projection: str
    pack_id: str
    fragments: tuple[SvgFragment, ...]


def _identity(value: str, label: str) -> bytes:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ValueError(f"{label} must be a non-empty string without NUL")
    result = value.encode("utf-8", "strict")
    if len(result) > 0xFFFF:
        raise ValueError(f"{label} is too long")
    return result


def encode(pack: SvgPack) -> bytes:
    projection = _identity(pack.projection, "projection")
    pack_id = _identity(pack.pack_id, "pack_id")
    fragments = tuple(pack.fragments)
    if len(fragments) > _MAX_COUNT:
        raise ValueError("too many fragments")
    payload = bytearray()
    entries: list[bytes] = []
    previous_slice_index = -1
    for fragment in fragments:
        if not isinstance(fragment.slice_index, int) or not 0 <= fragment.slice_index <= 0x7FFFFFFF:
            raise ValueError("slice_index must be a non-negative signed 32-bit integer")
        if fragment.slice_index <= previous_slice_index:
            raise ValueError("slice indices must be strictly increasing")
        if not math.isfinite(fragment.world_coordinate_um):
            raise ValueError("world_coordinate_um must be finite")
        if not isinstance(fragment.svg, str):
            raise ValueError("svg must be a string")
        svg = fragment.svg.encode("utf-8", "strict")
        offset = len(payload)
        payload.extend(svg)
        entries.append(_ENTRY.pack(fragment.slice_index, fragment.world_coordinate_um, offset, len(svg)))
        previous_slice_index = fragment.slice_index
    if len(payload) > 0xFFFFFFFF:
        raise ValueError("SVG payload is too large")
    table_offset = _HEADER.size + len(projection) + len(pack_id)
    payload_offset = table_offset + _ENTRY.size * len(entries)
    header = _HEADER.pack(
        MAGIC,
        VERSION,
        0,
        _HEADER.size,
        len(projection),
        len(pack_id),
        len(entries),
        table_offset,
        payload_offset,
        len(payload),
    )
    return header + projection + pack_id + b"".join(entries) + payload


def decode(data: bytes | bytearray | memoryview) -> SvgPack:
    raw = bytes(data)
    if len(raw) < _HEADER.size:
        raise ValueError("truncated SVG pack header")
    (
        magic,
        version,
        flags,
        header_size,
        projection_len,
        pack_len,
        count,
        table_offset,
        payload_offset,
        payload_len,
    ) = _HEADER.unpack_from(raw)
    if magic != MAGIC or version != VERSION or flags != 0 or header_size != _HEADER.size:
        raise ValueError("invalid SVG pack header")
    if count > _MAX_COUNT:
        raise ValueError("too many fragments")
    strings_end = _HEADER.size + projection_len + pack_len
    table_end = table_offset + count * _ENTRY.size
    payload_end = payload_offset + payload_len
    if table_offset != strings_end or payload_offset != table_end or payload_end != len(raw):
        raise ValueError("invalid SVG pack offsets")
    try:
        projection = raw[_HEADER.size : _HEADER.size + projection_len].decode("utf-8", "strict")
        pack_id = raw[_HEADER.size + projection_len : strings_end].decode("utf-8", "strict")
    except UnicodeDecodeError as exc:
        raise ValueError("invalid UTF-8 identity") from exc
    if not projection or not pack_id or "\x00" in projection + pack_id:
        raise ValueError("invalid pack identity")
    fragments: list[SvgFragment] = []
    previous_slice_index = -1
    expected_offset = 0
    for index in range(count):
        slice_index, world, offset, length = _ENTRY.unpack_from(raw, table_offset + index * _ENTRY.size)
        if (
            slice_index <= previous_slice_index
            or not math.isfinite(world)
            or offset != expected_offset
            or length > payload_len - offset
        ):
            raise ValueError("SVG fragment table entry out of bounds")
        try:
            svg = raw[payload_offset + offset : payload_offset + offset + length].decode("utf-8", "strict")
        except UnicodeDecodeError as exc:
            raise ValueError("invalid UTF-8 SVG fragment") from exc
        fragments.append(SvgFragment(slice_index, world, svg))
        previous_slice_index = slice_index
        expected_offset += length
    if expected_offset != payload_len:
        raise ValueError("SVG fragment table does not cover payload")
    return SvgPack(projection, pack_id, tuple(fragments))
