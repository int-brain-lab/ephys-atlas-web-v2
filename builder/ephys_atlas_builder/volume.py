from __future__ import annotations

from itertools import product
from pathlib import Path
from typing import Any

import numpy as np

from .io import DTYPES, encoded_resource, write_chunk


def write_chunked_volume(
    root: Path,
    volume: np.ndarray,
    *,
    dtype: str = "float32",
    chunk_shape: tuple[int, int, int] = (64, 64, 64),
    codec: str = "gzip",
    level: int = 6,
    path_template: str = "chunks/{i0}.{i1}.{i2}.bin.gz",
    grid_id: str,
) -> dict[str, Any]:
    if volume.ndim != 3:
        raise ValueError("volume must be 3-D")
    shape = volume.shape
    nchunks = tuple((shape[d] + chunk_shape[d] - 1) // chunk_shape[d] for d in range(3))
    chunks = []
    for i0, i1, i2 in product(*(range(n) for n in nchunks)):
        starts = (i0 * chunk_shape[0], i1 * chunk_shape[1], i2 * chunk_shape[2])
        stops = tuple(min(starts[d] + chunk_shape[d], shape[d]) for d in range(3))
        chunk = volume[starts[0]:stops[0], starts[1]:stops[1], starts[2]:stops[2]]
        rel = path_template.format(i0=i0, i1=i1, i2=i2)
        path = root / rel
        write_chunk(path, chunk, dtype=dtype, codec=codec, level=level)
        chunks.append(
            {
                "origin": list(starts),
                "decoded": {
                    "dtype": dtype,
                    "shape": list(chunk.shape),
                    "order": "C",
                    "endianness": "little",
                    "storage_axes": ["i0", "i1", "i2"],
                },
                "resource": encoded_resource(
                    path,
                    root,
                    "application/octet-stream",
                    codec=codec,
                    decoded_bytes=chunk.size * DTYPES[dtype].itemsize,
                    level=level,
                ),
            }
        )
    return {
        "schema_version": "1.0",
        "format": "ephys-atlas-volume-resource-index-v1",
        "grid_id": grid_id,
        "layout": "chunks3d",
        "chunk_shape": list(chunk_shape),
        "chunks": chunks,
    }
