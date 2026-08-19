from __future__ import annotations

import zipfile
from pathlib import Path

from .io import sha256_file


ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)


def package_release(release_dir: Path, output: Path) -> dict:
    """Create a byte-deterministic ZIP of an immutable release directory."""
    release_dir = release_dir.resolve()
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        output.relative_to(release_dir)
    except ValueError:
        pass
    else:
        raise ValueError("package output must be outside the release directory")
    files = sorted(p for p in release_dir.rglob("*") if p.is_file())
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in files:
            info = zipfile.ZipInfo(path.relative_to(release_dir).as_posix(), ZIP_EPOCH)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            with path.open("rb") as f:
                zf.writestr(info, f.read(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
    return {"path": output, "bytes": output.stat().st_size, "sha256": sha256_file(output)}
