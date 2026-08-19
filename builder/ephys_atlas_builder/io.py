from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np


DTYPES = {
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


def write_array(path: Path, values: np.ndarray, dtype: str) -> dict[str, Any]:
    dt = DTYPES[dtype]
    arr = np.ascontiguousarray(values, dtype=dt)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(arr.tobytes(order="C"))
    return {
        "path": path.name,
        "dtype": dtype,
        "shape": list(arr.shape),
        "order": "C",
        "endianness": "little" if dt.itemsize > 1 else "not-applicable",
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
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
