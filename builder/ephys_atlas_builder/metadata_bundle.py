"""Deterministic schema-v1 metadata bundle acceleration."""

from __future__ import annotations

import gzip
import json
from collections.abc import Sequence
from pathlib import Path, PurePosixPath
from typing import Any

from .io import canonical_json, encoded_resource

OUTPUT_NAME = "metadata-bundle.json.gz"
MAX_ENTRIES = 20_000
MAX_DECODED_BYTES = 64 * 1024 * 1024


def _safe_path(value: str) -> PurePosixPath:
    if not value or "\\" in value or "\0" in value:
        raise ValueError(f"unsafe metadata bundle path: {value!r}")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError(f"unsafe metadata bundle path: {value!r}")
    return path


def write_metadata_bundle(root: Path, paths: Sequence[str]) -> dict[str, Any]:
    """Write a deterministic gzip bundle of exact, authoritative JSON bytes."""
    root = root.resolve()
    output = root / OUTPUT_NAME
    if output.exists():
        raise FileExistsError(f"metadata bundle already exists: {output}")
    if not paths:
        raise ValueError("metadata bundle requires at least one entry")
    if len(paths) > MAX_ENTRIES:
        raise ValueError(f"metadata bundle exceeds {MAX_ENTRIES} entries")
    normalized = [_safe_path(value).as_posix() for value in paths]
    if len(normalized) != len(set(normalized)):
        raise ValueError("duplicate metadata bundle path")
    if any(value in {"manifest.json", OUTPUT_NAME} for value in normalized):
        raise ValueError("metadata bundle cannot contain its manifest or itself")
    if any(not value.endswith(".json") for value in normalized):
        raise ValueError("metadata bundle entries must be JSON resources")

    resources: list[dict[str, str]] = []
    for relative in sorted(normalized):
        path = (root / relative).resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise ValueError(f"metadata bundle path escapes root: {relative}") from exc
        raw = path.read_bytes()
        try:
            text = raw.decode("utf-8")
            json.loads(text)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"metadata bundle entry is not valid UTF-8 JSON: {relative}") from exc
        resources.append({"path": relative, "text": text})

    decoded = canonical_json({
        "schema_version": "1.0",
        "format": "ephys-atlas-metadata-bundle-v1",
        "resources": resources,
    })
    if len(decoded) > MAX_DECODED_BYTES:
        raise ValueError(f"metadata bundle exceeds {MAX_DECODED_BYTES} decoded bytes")
    with output.open("wb") as stream, gzip.GzipFile(
        filename="", mode="wb", fileobj=stream, compresslevel=9, mtime=0
    ) as encoded:
        encoded.write(decoded)
    return encoded_resource(
        output, root, "application/json", codec="gzip", decoded_bytes=len(decoded), level=9
    )
