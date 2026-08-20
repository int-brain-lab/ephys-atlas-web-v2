from __future__ import annotations

from pathlib import Path
from zipfile import ZIP_BZIP2, ZIP_DEFLATED, ZIP_LZMA, ZIP_STORED, ZipFile

import numpy as np
from numpy.lib import format

from .io import sha256_file

_COMPRESSION_NAMES = {
    ZIP_STORED: "stored",
    ZIP_DEFLATED: "deflate",
    ZIP_BZIP2: "bzip2",
    ZIP_LZMA: "lzma",
}


def _npy_header(stream) -> tuple[tuple[int, ...], bool, np.dtype, tuple[int, int]]:
    version = format.read_magic(stream)
    if version == (1, 0):
        shape, fortran_order, dtype = format.read_array_header_1_0(stream)
    elif version == (2, 0):
        shape, fortran_order, dtype = format.read_array_header_2_0(stream)
    else:
        shape, fortran_order, dtype = format._read_array_header(stream, version)
    return tuple(shape), bool(fortran_order), np.dtype(dtype), version


def inspect_volume_npz(path: Path) -> dict:
    """Inspect NPZ/NPY physical layout without materializing array payloads."""
    path = path.resolve()
    members = []
    with ZipFile(path) as archive:
        for info in archive.infolist():
            with archive.open(info) as stream:
                shape, fortran_order, dtype, version = _npy_header(stream)
            members.append(
                {
                    "path": info.filename,
                    "compression": _COMPRESSION_NAMES.get(
                        info.compress_type, f"zip-method-{info.compress_type}"
                    ),
                    "compressed_bytes": info.compress_size,
                    "uncompressed_bytes": info.file_size,
                    "crc32": f"{info.CRC:08x}",
                    "npy_version": list(version),
                    "shape": list(shape),
                    "fortran_order": fortran_order,
                    "dtype": str(dtype),
                    "dtype_descriptor": dtype.str,
                }
            )
    return {
        "path": str(path),
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "members": members,
    }


def extract_last_axis_feature(
    npz_path: Path,
    output_npy: Path,
    feature_index: int,
    *,
    member: str = "ephys_atlas_vol.npy",
    block_voxels: int = 131_072,
) -> dict:
    """Stream one C-order last-axis feature to NPY with bounded memory.

    This is a physical extraction only. It deliberately assigns no anatomical
    meaning to the source axes and applies no value normalization or masking.
    """
    if block_voxels < 1:
        raise ValueError("block_voxels must be positive")
    npz_path = npz_path.resolve()
    output_npy = output_npy.resolve()
    output_npy.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(npz_path) as archive, archive.open(member) as stream:
        shape, fortran_order, dtype, _version = _npy_header(stream)
        if fortran_order or len(shape) < 2:
            raise ValueError("feature extraction requires a C-order array with a last feature axis")
        feature_count = shape[-1]
        if not 0 <= feature_index < feature_count:
            raise ValueError(
                f"feature_index {feature_index} is outside [0, {feature_count})"
            )
        spatial_shape = shape[:-1]
        voxel_count = int(np.prod(spatial_shape, dtype=np.int64))
        output = format.open_memmap(
            output_npy, mode="w+", dtype=dtype, shape=spatial_shape
        )
        flat_output = output.reshape(-1)
        row_bytes = feature_count * dtype.itemsize
        offset = 0
        while offset < voxel_count:
            count = min(block_voxels, voxel_count - offset)
            wanted = count * row_bytes
            chunks = []
            received = 0
            while received < wanted:
                chunk = stream.read(wanted - received)
                if not chunk:
                    raise ValueError(
                        f"truncated {member}: expected {wanted} bytes at voxel {offset}"
                    )
                chunks.append(chunk)
                received += len(chunk)
            block = np.frombuffer(b"".join(chunks), dtype=dtype).reshape(
                count, feature_count
            )
            flat_output[offset : offset + count] = block[:, feature_index]
            offset += count
        if stream.read(1):
            raise ValueError(f"{member} contains payload bytes beyond its declared shape")
        output.flush()
    return {
        "source": str(npz_path),
        "member": member,
        "feature_index": feature_index,
        "source_shape": list(shape),
        "output": str(output_npy),
        "output_shape": list(spatial_shape),
        "dtype": str(dtype),
        "dtype_descriptor": dtype.str,
        "bytes": output_npy.stat().st_size,
        "sha256": sha256_file(output_npy),
    }
