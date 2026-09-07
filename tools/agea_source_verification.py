"""Verify one Allen AGEA grid archive against an independently supplied volume.

This is source evidence, not a release reader. XML alignment fields are
retained verbatim; their interpretation belongs to the separate report code.
"""

from __future__ import annotations

import hashlib
import math
from pathlib import Path, PurePosixPath
import struct
from typing import Any
import xml.etree.ElementTree as ET
import zipfile

import numpy as np


_HEADER_MEMBER = "energy.mhd"
_RAW_MEMBER = "energy.raw"
_XML_MEMBER = "data_set.xml"
_REQUIRED_MEMBERS = {_HEADER_MEMBER, _RAW_MEMBER, _XML_MEMBER}
_MAX_HEADER_BYTES = 64 * 1024
_MAX_XML_BYTES = 16 * 1024 * 1024
# Generous compared with the 637,304-byte adult-mouse grids, while still
# bounding decompression before allocating from an untrusted DimSize.
_MAX_RAW_BYTES = 256 * 1024 * 1024


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _archive_members(archive: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    members: dict[str, zipfile.ZipInfo] = {}
    for info in archive.infolist():
        name = info.filename
        parts = PurePosixPath(name).parts
        if (
            not name
            or name.startswith("/")
            or "\\" in name
            or ".." in parts
            or PurePosixPath(name).is_absolute()
        ):
            raise ValueError(f"Unsafe ZIP member path: {name!r}")
        if name in members:
            raise ValueError(f"Duplicate ZIP member: {name}")
        members[name] = info
    missing = sorted(_REQUIRED_MEMBERS - members.keys())
    if missing:
        raise ValueError(f"Missing Allen archive member(s): {', '.join(missing)}")
    if members[_HEADER_MEMBER].file_size > _MAX_HEADER_BYTES:
        raise ValueError("MetaImage header exceeds size limit")
    if members[_XML_MEMBER].file_size > _MAX_XML_BYTES:
        raise ValueError("Allen data_set.xml exceeds size limit")
    if members[_RAW_MEMBER].file_size > _MAX_RAW_BYTES:
        raise ValueError("Allen energy.raw exceeds size limit")
    return members


def _parse_header(header_bytes: bytes) -> tuple[str, dict[str, str], tuple[int, ...]]:
    try:
        original = header_bytes.decode("ascii")
    except UnicodeDecodeError as exc:
        raise ValueError("MetaImage header is not ASCII") from exc

    fields: dict[str, str] = {}
    for line in original.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"Malformed MetaImage header line: {line!r}")
        key, value = (part.strip() for part in line.split("=", 1))
        if not key or key in fields:
            raise ValueError(f"Duplicate or empty MetaImage field: {key!r}")
        fields[key] = value

    required = {
        "ObjectType": "Image",
        "NDims": "3",
        "BinaryData": "True",
        "BinaryDataByteOrderMSB": "False",
        "ElementType": "MET_FLOAT",
        "ElementDataFile": _RAW_MEMBER,
    }
    for key, expected in required.items():
        if fields.get(key) != expected:
            raise ValueError(
                f"Unsupported MetaImage {key}: {fields.get(key)!r}; expected {expected!r}"
            )
    unsupported = {
        "CompressedData": ("False",),
        "ElementNumberOfChannels": ("1",),
        "HeaderSize": ("0",),
    }
    for key, supported_values in unsupported.items():
        if key in fields and fields[key] not in supported_values:
            raise ValueError(f"Unsupported MetaImage {key}: {fields[key]!r}")
    if "ElementByteOrderMSB" in fields:
        if fields["ElementByteOrderMSB"] != "False":
            raise ValueError(
                f"Unsupported MetaImage ElementByteOrderMSB: {fields['ElementByteOrderMSB']!r}"
            )
        if fields["ElementByteOrderMSB"] != fields["BinaryDataByteOrderMSB"]:
            raise ValueError("Conflicting MetaImage byte-order fields")
    try:
        dimensions = tuple(int(value) for value in fields["DimSize"].split())
    except (KeyError, ValueError) as exc:
        raise ValueError("Invalid or missing MetaImage DimSize") from exc
    if len(dimensions) != 3 or any(value <= 0 for value in dimensions):
        raise ValueError(f"Unsupported MetaImage DimSize: {fields.get('DimSize')!r}")
    expected_bytes = math.prod(dimensions) * 4
    if expected_bytes > _MAX_RAW_BYTES:
        raise ValueError("MetaImage dimensions exceed raw size limit")
    return original, fields, dimensions


def _parse_xml(xml_bytes: bytes) -> dict[str, Any]:
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise ValueError("Invalid Allen data_set.xml") from exc
    section_numbers: list[int] = []
    for element in root.findall(".//section-image/section-number"):
        if element.text is None:
            raise ValueError("Empty section-number in Allen data_set.xml")
        try:
            section_numbers.append(int(element.text.strip()))
        except ValueError as exc:
            raise ValueError("Non-integer section-number in Allen data_set.xml") from exc

    alignments = root.findall(".//alignment3d")
    if len(alignments) > 1:
        raise ValueError("Multiple alignment3d elements in Allen data_set.xml")
    alignment3d = None
    if alignments:
        alignment3d = {
            child.tag: child.text.strip() if child.text is not None else None
            for child in alignments[0]
        }
    return {"section_numbers": section_numbers, "alignment3d": alignment3d}


def read_allen_archive(path: Path | str) -> tuple[np.ndarray, dict[str, Any]]:
    """Read a strictly supported Allen ZIP and return ``(volume, evidence)``.

    MetaImage stores x fastest.  The returned C-contiguous array therefore has
    the reverse of the three header dimensions.
    """
    archive_path = Path(path)
    try:
        with zipfile.ZipFile(archive_path) as archive:
            infos = _archive_members(archive)
            header_bytes = archive.read(_HEADER_MEMBER)
            original_header, header_fields, dimensions = _parse_header(header_bytes)
            expected_raw_bytes = math.prod(dimensions) * 4
            if infos[_RAW_MEMBER].file_size != expected_raw_bytes:
                raise ValueError(
                    "MetaImage raw length mismatch: "
                    f"expected {expected_raw_bytes}, got {infos[_RAW_MEMBER].file_size}"
                )
            raw_bytes = archive.read(_RAW_MEMBER)
            if len(raw_bytes) != expected_raw_bytes:
                raise ValueError("MetaImage raw data was truncated while reading")
            xml_bytes = archive.read(_XML_MEMBER)
    except zipfile.BadZipFile as exc:
        raise ValueError("Invalid Allen ZIP archive") from exc

    shape = tuple(reversed(dimensions))
    volume = np.frombuffer(raw_bytes, dtype="<f4").reshape(shape, order="C").copy()
    xml_evidence = _parse_xml(xml_bytes)
    member_evidence = {
        name: {"bytes": len(data), "sha256": _sha256_bytes(data)}
        for name, data in (
            (_HEADER_MEMBER, header_bytes),
            (_RAW_MEMBER, raw_bytes),
            (_XML_MEMBER, xml_bytes),
        )
    }
    evidence: dict[str, Any] = {
        "archive": {
            "bytes": archive_path.stat().st_size,
            "sha256": _sha256_file(archive_path),
        },
        "members": member_evidence,
        "metaimage": {
            "original_header": original_header,
            "fields": header_fields,
            "header_dimensions": list(dimensions),
            "numpy_shape": list(shape),
            "dtype": "little-endian float32",
            "order": "C",
        },
        "xml": xml_evidence,
    }
    return volume, evidence


def _selected_flat_indices(size: int) -> list[int]:
    return sorted({0, size // 2, size - 1})


def _json_float(value: float | np.floating[Any]) -> float | None:
    converted = float(value)
    return converted if math.isfinite(converted) else None


def verify_experiment(path: Path | str, values: np.ndarray) -> dict[str, Any]:
    """Return JSON-safe direct-source evidence against float16 AGEA values."""
    volume, evidence = read_allen_archive(path)
    supplied = np.asarray(values)
    if supplied.shape != volume.shape:
        raise ValueError(
            f"Experiment shape mismatch: Allen {volume.shape}, supplied {supplied.shape}"
        )
    supplied_f16 = supplied.astype("<f2", copy=False)
    allen_f16 = volume.astype("<f2")
    equal = np.equal(allen_f16, supplied_f16)

    with zipfile.ZipFile(path) as archive:
        # Deliberately independent of NumPy's decoding above.
        raw_bytes = archive.read(_RAW_MEMBER)
    selected = []
    for flat_index in _selected_flat_indices(volume.size):
        byte_offset = flat_index * 4
        raw_float32 = struct.unpack_from("<f", raw_bytes, byte_offset)[0]
        coordinate = [
            int(index) for index in np.unravel_index(flat_index, volume.shape, order="C")
        ]
        rounded = np.float16(raw_float32)
        expected = supplied_f16.flat[flat_index]
        error = abs(raw_float32 - float(rounded))
        selected.append(
            {
                "coordinate": coordinate,
                "flat_index": flat_index,
                "raw_byte_offset": byte_offset,
                "raw_float32": _json_float(raw_float32),
                "raw_as_float16": _json_float(rounded),
                "supplied_float16": _json_float(expected),
                "float16_equal": bool(rounded == expected),
                "raw_vs_float16_absolute_error": _json_float(error),
            }
        )
    evidence["comparison"] = {
        "voxel_count": int(volume.size),
        "float16_full_volume_equal": bool(np.all(equal)),
        "float16_mismatch_count": int(np.count_nonzero(~equal)),
        "selected_voxels": selected,
    }
    return evidence
