"""Deterministic and independently validated local-release ZIP bundles."""

from __future__ import annotations

import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
from typing import Any
import zipfile

from .io import sha256_file
from .validate import ValidationError, validate_release


BUNDLE_SUFFIX = ".ibl-ephys-atlas.zip"
ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)
ALLOWED_COMPRESSION = {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}


def _safe_path(name: str) -> PurePosixPath:
    if not name or "\\" in name or "\0" in name:
        raise ValidationError(f"unsafe ZIP path: {name!r}")
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ValidationError(f"unsafe ZIP path: {name!r}")
    return path


def _resource_paths(release_dir: Path) -> set[str]:
    """Resolve the complete declared resource graph from manifest.json."""
    expected = {"manifest.json"}
    manifest = json.loads((release_dir / "manifest.json").read_text())
    feature_paths = {
        descriptor["resource"]["path"]
        for descriptor in (item["descriptor"] for item in manifest["features"])
    }
    pending = [("manifest.json", PurePosixPath("."))]
    visited: set[str] = set()
    while pending:
        document_path, resource_base = pending.pop()
        if document_path in visited:
            continue
        visited.add(document_path)
        try:
            document = json.loads((release_dir / document_path).read_text())
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValidationError(f"invalid declared JSON resource {document_path}: {error}") from error

        def visit(value: Any) -> None:
            if isinstance(value, list):
                for item in value:
                    visit(item)
                return
            if not isinstance(value, dict):
                return
            if {"path", "bytes", "sha256", "codec"}.issubset(value):
                raw = value["path"]
                if not isinstance(raw, str):
                    raise ValidationError(f"invalid resource path in {document_path}")
                relative = _safe_path(raw)
                combined = resource_base / relative
                normalized = _safe_path(combined.as_posix()).as_posix()
                expected.add(normalized)
                if value.get("media_type") == "application/json":
                    next_base = (
                        PurePosixPath(normalized).parent
                        if normalized in feature_paths
                        else resource_base
                    )
                    pending.append((normalized, next_base))
            for item in value.values():
                visit(item)

        visit(document)
    return expected


def _validate_inventory(release_dir: Path) -> list[str]:
    declared = _resource_paths(release_dir)
    actual = {
        path.relative_to(release_dir).as_posix()
        for path in release_dir.rglob("*")
        if path.is_file()
    }
    missing = sorted(declared - actual)
    undeclared = sorted(actual - declared)
    if missing:
        raise ValidationError(f"bundle graph is missing declared files: {', '.join(missing[:8])}")
    if undeclared:
        raise ValidationError(f"bundle graph contains undeclared files: {', '.join(undeclared[:8])}")
    return sorted(actual)


def validate_bundle(bundle: Path, schema_dir: Path) -> dict[str, Any]:
    """Validate ZIP structure, complete inventory, and the extracted schema graph."""
    bundle = bundle.resolve()
    seen: set[str] = set()
    with tempfile.TemporaryDirectory(prefix="ibl-ephys-atlas-bundle-") as temporary:
        extracted = Path(temporary)
        try:
            archive = zipfile.ZipFile(bundle)
        except (OSError, zipfile.BadZipFile) as error:
            raise ValidationError(f"invalid local dataset ZIP: {error}") from error
        with archive:
            for info in archive.infolist():
                path = _safe_path(info.filename)
                name = path.as_posix()
                if name in seen:
                    raise ValidationError(f"duplicate ZIP path: {name}")
                seen.add(name)
                mode = info.external_attr >> 16
                if info.is_dir() or stat.S_ISLNK(mode):
                    raise ValidationError(f"ZIP entries must be regular files: {name}")
                if info.flag_bits & 0x1:
                    raise ValidationError(f"encrypted ZIP entries are unsupported: {name}")
                if info.compress_type not in ALLOWED_COMPRESSION:
                    raise ValidationError(f"unsupported ZIP compression for {name}")
                destination = extracted.joinpath(*path.parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as source, destination.open("wb") as target:
                    shutil.copyfileobj(source, target, length=1024 * 1024)
        if "manifest.json" not in seen:
            raise ValidationError("local dataset ZIP must contain manifest.json at its root")
        validate_release(extracted, schema_dir)
        files = _validate_inventory(extracted)
    return {
        "path": bundle,
        "bytes": bundle.stat().st_size,
        "sha256": sha256_file(bundle),
        "file_count": len(files),
    }


def write_bundle(release_dir: Path, output: Path, schema_dir: Path) -> dict[str, Any]:
    """Validate, write, reopen, and atomically install a deterministic bundle."""
    release_dir = release_dir.resolve()
    output = output.resolve()
    if not output.name.endswith(BUNDLE_SUFFIX):
        raise ValueError(f"bundle output must end with {BUNDLE_SUFFIX}")
    try:
        output.relative_to(release_dir)
    except ValueError:
        pass
    else:
        raise ValueError("bundle output must be outside the release directory")
    validate_release(release_dir, schema_dir)
    files = _validate_inventory(release_dir)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{output.name}.", suffix=".tmp", dir=output.parent
        )
        os.close(descriptor)
        temporary = Path(temporary_name)
        with zipfile.ZipFile(
            temporary,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=6,
            allowZip64=True,
        ) as archive:
            for name in files:
                path = release_dir / name
                info = zipfile.ZipInfo(name, ZIP_EPOCH)
                info.create_system = 3
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                with path.open("rb") as source, archive.open(info, "w", force_zip64=True) as target:
                    shutil.copyfileobj(source, target, length=1024 * 1024)
        temporary.chmod(0o644)
        result = validate_bundle(temporary, schema_dir)
        os.replace(temporary, output)
        temporary = None
        return {**result, "path": output, "bytes": output.stat().st_size, "sha256": sha256_file(output)}
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
