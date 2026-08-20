from __future__ import annotations

from pathlib import Path
from zipfile import ZIP_BZIP2, ZIP_DEFLATED, ZIP_LZMA, ZIP_STORED, ZipFile

from numpy.lib import format

from .io import sha256_file

_COMPRESSION_NAMES = {
    ZIP_STORED: "stored",
    ZIP_DEFLATED: "deflate",
    ZIP_BZIP2: "bzip2",
    ZIP_LZMA: "lzma",
}


def _npy_header(stream) -> tuple[tuple[int, ...], bool, str, tuple[int, int]]:
    version = format.read_magic(stream)
    if version == (1, 0):
        shape, fortran_order, dtype = format.read_array_header_1_0(stream)
    elif version == (2, 0):
        shape, fortran_order, dtype = format.read_array_header_2_0(stream)
    else:
        shape, fortran_order, dtype = format._read_array_header(stream, version)
    return tuple(shape), bool(fortran_order), str(dtype), version


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
                    "dtype": dtype,
                }
            )
    return {
        "path": str(path),
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "members": members,
    }
