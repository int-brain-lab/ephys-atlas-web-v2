from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np


DTYPES = {
    "uint8": np.dtype("u1"),
    "int16": np.dtype("<i2"),
    "int32": np.dtype("<i4"),
    "uint16": np.dtype("<u2"),
    "uint32": np.dtype("<u4"),
    "float16": np.dtype("<f2"),
    "float32": np.dtype("<f4"),
    "float64": np.dtype("<f8"),
}


def canonical_json(data: Any) -> bytes:
    return (json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode()


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical_json(data))


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def encoded_resource(
    path: Path,
    root: Path,
    media_type: str,
    *,
    codec: str = "none",
    decoded_bytes: int | None = None,
    level: int | None = None,
) -> dict[str, Any]:
    size = path.stat().st_size
    codec_descriptor: dict[str, Any] = {
        "name": codec,
        "decoded_bytes": size if decoded_bytes is None else decoded_bytes,
    }
    if codec == "gzip" and level is not None:
        codec_descriptor["level"] = level
    return {
        "path": path.relative_to(root).as_posix(),
        "media_type": media_type,
        "bytes": size,
        "sha256": sha256_file(path),
        "codec": codec_descriptor,
    }


def json_resource(path: Path, root: Path, format_name: str) -> dict[str, Any]:
    return {
        "format": format_name,
        "resource": encoded_resource(path, root, "application/json"),
    }


def write_array(
    path: Path,
    values: np.ndarray,
    dtype: str,
    *,
    root: Path | None = None,
) -> dict[str, Any]:
    dt = DTYPES[dtype]
    arr = np.ascontiguousarray(values, dtype=dt)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(arr.tobytes(order="C"))
    return {
        "format": "raw-binary-array-v1",
        "resource": encoded_resource(
            path,
            root or path.parent,
            "application/octet-stream",
        ),
        "dtype": dtype,
        "shape": list(arr.shape),
        "order": "C",
        "endianness": "little" if dt.itemsize > 1 else "not-applicable",
    }


def write_chunk(path: Path, values: np.ndarray, dtype: str, codec: str, level: int = 6) -> None:
    dt = DTYPES[dtype]
    raw = np.ascontiguousarray(values, dtype=dt).tobytes(order="C")
    path.parent.mkdir(parents=True, exist_ok=True)
    if codec == "none":
        path.write_bytes(raw)
    elif codec == "gzip":
        with path.open("wb") as f:
            with gzip.GzipFile(filename="", mode="wb", fileobj=f, compresslevel=level, mtime=0) as z:
                z.write(raw)
    else:
        raise ValueError(f"unsupported codec: {codec}")
