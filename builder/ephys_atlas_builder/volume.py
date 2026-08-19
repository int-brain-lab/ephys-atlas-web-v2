from __future__ import annotations

from itertools import product
from pathlib import Path

import numpy as np

from .io import write_chunk


def write_chunked_volume(
    root: Path,
    volume: np.ndarray,
    *,
    dtype: str = "float32",
    chunk_shape: tuple[int, int, int] = (64, 64, 64),
    codec: str = "gzip",
    level: int = 6,
    path_template: str = "chunks/{i0}.{i1}.{i2}.bin.gz",
) -> None:
    if volume.ndim != 3:
        raise ValueError("volume must be 3-D")
    shape = volume.shape
    nchunks = tuple((shape[d] + chunk_shape[d] - 1) // chunk_shape[d] for d in range(3))
    for i0, i1, i2 in product(*(range(n) for n in nchunks)):
        starts = (i0 * chunk_shape[0], i1 * chunk_shape[1], i2 * chunk_shape[2])
        stops = tuple(min(starts[d] + chunk_shape[d], shape[d]) for d in range(3))
        chunk = volume[starts[0]:stops[0], starts[1]:stops[1], starts[2]:stops[2]]
        rel = path_template.format(i0=i0, i1=i1, i2=i2)
        write_chunk(root / rel, chunk, dtype=dtype, codec=codec, level=level)
