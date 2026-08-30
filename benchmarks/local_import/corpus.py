"""Build deterministic, untracked ZIP-import benchmark corpora.

Real releases are packaged unchanged through the canonical bundle writer.
Capacity releases extend the canonical synthetic golden graph only with
declared auxiliary resources. Adversarial archives are intentionally invalid
and small enough to exercise ZIP metadata rejection without large allocation.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import tempfile
import warnings
import zipfile

from ephys_atlas_builder.bundle import (
    BUNDLE_SUFFIX,
    ZIP_EPOCH,
    declared_release_resource_paths,
    write_bundle,
)
from ephys_atlas_builder.io import sha256_file


CORPUS_FORMAT = "ibl-ephys-atlas-local-import-benchmark-corpus-v1"
SYNTHETIC_NOTICE = "Synthetic benchmark input with no scientific interpretation."
_SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
_LOCAL_HEADER = b"PK\x03\x04"
_CENTRAL_HEADER = b"PK\x01\x02"


@dataclass(frozen=True)
class ReleaseCase:
    """One unchanged schema-v1 release to package for transport measurement."""

    id: str
    representation: str
    release_dir: Path


@dataclass(frozen=True)
class CapacityCase:
    """One valid synthetic graph with an exact file count and payload budget."""

    id: str
    payload_bytes: int
    entries: int


def _check_id(value: str, description: str) -> str:
    if not _SAFE_ID.fullmatch(value):
        raise ValueError(f"{description} must match {_SAFE_ID.pattern}: {value!r}")
    return value


def _write_index(output_dir: Path, cases: list[dict[str, object]]) -> Path:
    index = output_dir / "corpus.json"
    document = {"format": CORPUS_FORMAT, "cases": cases}
    index.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
    return index


def _archive_record(
    archive: Path,
    *,
    case_id: str,
    kind: str,
    synthetic: bool,
    **details: object,
) -> dict[str, object]:
    with zipfile.ZipFile(archive) as source:
        entries = len(source.infolist())
        expanded_bytes = sum(item.file_size for item in source.infolist())
    return {
        "id": case_id,
        "kind": kind,
        "synthetic": synthetic,
        "archive": archive.name,
        "archive_bytes": archive.stat().st_size,
        "archive_sha256": sha256_file(archive),
        "entries": entries,
        "zip_expanded_bytes": expanded_bytes,
        **details,
    }


def _representation_inventory(release_dir: Path) -> set[str]:
    manifest = json.loads((release_dir / "manifest.json").read_text())
    result: set[str] = set()
    for feature_ref in manifest["features"]:
        relative = feature_ref["descriptor"]["resource"]["path"]
        feature = json.loads((release_dir / relative).read_text())
        result.update(feature["representations"])
    return result


def _file_record(path: Path, root: Path) -> dict[str, object]:
    return {
        "path": path.relative_to(root).as_posix(),
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def generate_real_corpus(
    output_dir: Path,
    releases: list[ReleaseCase],
    *,
    schema_dir: Path | None = None,
) -> Path:
    """Bundle exact real release directories with the canonical machinery."""
    if not releases:
        raise ValueError("at least one real release case is required")
    output_dir.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, object]] = []
    seen: set[str] = set()
    for case in releases:
        case_id = _check_id(case.id, "release case id")
        if case_id in seen:
            raise ValueError(f"duplicate release case id: {case_id}")
        seen.add(case_id)
        if case.representation not in {"regional", "volume"}:
            raise ValueError(f"unsupported representation label: {case.representation}")
        release_dir = case.release_dir.resolve()
        if case.representation not in _representation_inventory(release_dir):
            raise ValueError(f"{release_dir} has no {case.representation} representation")
        manifest = json.loads((release_dir / "manifest.json").read_text())
        declared = declared_release_resource_paths(release_dir)
        actual = {
            path.relative_to(release_dir).as_posix(): path
            for path in release_dir.rglob("*")
            if path.is_file()
        }
        missing = sorted(declared - actual.keys())
        if missing:
            raise ValueError(f"{release_dir} is missing declared files: {', '.join(missing[:8])}")
        excluded = [actual[name] for name in sorted(set(actual) - declared)]
        archive = output_dir / f"{case_id}{BUNDLE_SUFFIX}"
        with tempfile.TemporaryDirectory(prefix=f".{case_id}-", dir=output_dir) as temporary:
            staged = Path(temporary) / "release"
            for name in sorted(declared):
                destination = staged / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(actual[name], destination)
            info = write_bundle(staged, archive, schema_dir)
        records.append(_archive_record(
            archive,
            case_id=case_id,
            kind="exact-release",
            synthetic=False,
            representation=case.representation,
            source_release={
                "dataset_id": manifest["dataset_id"],
                "release_id": manifest["release"]["release_id"],
                "path": case.release_dir.as_posix(),
            },
            excluded_undeclared_files=[_file_record(path, release_dir) for path in excluded],
            canonical_bundle_sha256=info["sha256"],
        ))
    return _write_index(output_dir, records)


def _deterministic_payload(path: Path, size: int, seed: bytes) -> str:
    digest = hashlib.sha256()
    remaining = size
    counter = 0
    with path.open("wb") as target:
        while remaining:
            chunk_size = min(remaining, 1024 * 1024)
            chunk = hashlib.shake_256(
                seed + counter.to_bytes(8, "big")
            ).digest(chunk_size)
            target.write(chunk)
            digest.update(chunk)
            remaining -= len(chunk)
            counter += 1
    return digest.hexdigest()


def _capacity_release(
    destination: Path,
    golden_release: Path,
    case: CapacityCase,
) -> tuple[int, int]:
    case_id = _check_id(case.id, "capacity case id")
    if case.payload_bytes < 0:
        raise ValueError("capacity payload bytes must be non-negative")
    shutil.copytree(golden_release, destination)
    manifest_path = destination / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    feature_descriptor = manifest["features"][0]["descriptor"]
    feature_path = destination / feature_descriptor["resource"]["path"]
    feature = json.loads(feature_path.read_text())
    feature_root = feature_path.parent
    baseline_entries = len(declared_release_resource_paths(destination))
    if case.entries < baseline_entries:
        raise ValueError(
            f"capacity case {case_id} needs at least {baseline_entries} entries"
        )
    additional = case.entries - baseline_entries
    if case.payload_bytes and not additional:
        raise ValueError("a positive payload budget requires at least one added entry")

    quotient, remainder = divmod(case.payload_bytes, additional or 1)
    artifacts: list[dict[str, object]] = []
    for index in range(additional):
        size = quotient + (1 if index < remainder else 0)
        relative = Path("benchmark-payload") / f"{index:05d}.bin"
        path = feature_root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        sha256 = _deterministic_payload(
            path,
            size,
            f"{case_id}:{index}:".encode(),
        )
        artifacts.append({
            "id": f"benchmark-payload-{index:05d}",
            "role": "auxiliary",
            "description": SYNTHETIC_NOTICE,
            "resource": {
                "path": relative.as_posix(),
                "media_type": "application/octet-stream",
                "bytes": size,
                "sha256": sha256,
                "codec": {"name": "none", "decoded_bytes": size},
            },
        })

    manifest["dataset_id"] = f"local_import_benchmark_{case_id}"
    manifest["title"] = f"Synthetic local-import capacity case {case_id}"
    manifest["description"] = SYNTHETIC_NOTICE
    manifest["release"] = {
        "release_id": "synthetic-v1",
        "immutable": True,
        "created_at": "2026-08-30T00:00:00Z",
        "paper_snapshot": False,
    }
    source_text = f"{CORPUS_FORMAT}:{case_id}:{case.payload_bytes}:{case.entries}\n"
    manifest["provenance"] = {
        "sources": [{
            "role": "user-input",
            "description": SYNTHETIC_NOTICE,
            "sha256": hashlib.sha256(source_text.encode()).hexdigest(),
        }],
        "builder": {
            "name": "local-import-benchmark-corpus",
            "version": "1",
            "repository": "rossant/ibl-ephys-atlas-web-v2",
            "command": "python -m benchmarks.local_import.generate capacity",
        },
        "recipe": {"id": "local-import-capacity-synthetic-v1"},
        "notes": [SYNTHETIC_NOTICE],
    }
    feature["artifacts"] = [*feature["artifacts"], *artifacts]
    feature_path.write_text(json.dumps(feature, indent=2, sort_keys=True) + "\n")
    feature_bytes = feature_path.stat().st_size
    feature_descriptor["resource"].update({
        "bytes": feature_bytes,
        "sha256": sha256_file(feature_path),
        "codec": {"name": "none", "decoded_bytes": feature_bytes},
    })
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return baseline_entries, additional


def generate_capacity_corpus(
    output_dir: Path,
    cases: list[CapacityCase],
    *,
    golden_release: Path,
    schema_dir: Path | None = None,
) -> Path:
    """Generate valid synthetic size/count ladders without committing outputs."""
    if not cases:
        raise ValueError("at least one capacity case is required")
    output_dir.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, object]] = []
    seen: set[str] = set()
    for case in cases:
        if case.id in seen:
            raise ValueError(f"duplicate capacity case id: {case.id}")
        seen.add(case.id)
        with tempfile.TemporaryDirectory(prefix=f".{case.id}-", dir=output_dir) as temporary:
            release = Path(temporary) / "release"
            baseline, additional = _capacity_release(release, golden_release, case)
            archive = output_dir / f"{case.id}{BUNDLE_SUFFIX}"
            write_bundle(release, archive, schema_dir)
        record = _archive_record(
            archive,
            case_id=case.id,
            kind="valid-synthetic-capacity",
            synthetic=True,
            scientific_notice=SYNTHETIC_NOTICE,
            requested_payload_bytes=case.payload_bytes,
            requested_entries=case.entries,
            baseline_entries=baseline,
            added_payload_entries=additional,
        )
        if record["entries"] != case.entries:
            raise RuntimeError(
                f"capacity case {case.id} produced {record['entries']} entries; expected {case.entries}"
            )
        records.append(record)
    return _write_index(output_dir, records)


def _zip_bytes(entries: list[tuple[str, bytes]], compression: int = zipfile.ZIP_STORED) -> bytes:
    from io import BytesIO

    target = BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(target, "w", compression=compression, compresslevel=6) as archive:
            for name, payload in entries:
                info = zipfile.ZipInfo(name, ZIP_EPOCH)
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                info.compress_type = compression
                archive.writestr(info, payload)
    return target.getvalue()


def _patch_single_entry(
    payload: bytes,
    *,
    compression_method: int | None = None,
    uncompressed_size: int | None = None,
) -> bytes:
    result = bytearray(payload)
    local = result.find(_LOCAL_HEADER)
    central = result.find(_CENTRAL_HEADER)
    if local < 0 or central < 0:
        raise ValueError("ZIP headers are absent")
    if compression_method is not None:
        struct.pack_into("<H", result, local + 8, compression_method)
        struct.pack_into("<H", result, central + 10, compression_method)
    if uncompressed_size is not None:
        struct.pack_into("<I", result, local + 22, uncompressed_size)
        struct.pack_into("<I", result, central + 24, uncompressed_size)
    return bytes(result)


def _patch_entry_sizes(
    payload: bytes,
    *,
    compressed_sizes: list[int],
    uncompressed_sizes: list[int],
) -> bytes:
    if len(compressed_sizes) != len(uncompressed_sizes):
        raise ValueError("compressed and uncompressed size counts differ")
    result = bytearray(payload)
    local_offsets: list[int] = []
    central_offsets: list[int] = []
    offset = 0
    while (found := result.find(_LOCAL_HEADER, offset)) >= 0:
        local_offsets.append(found)
        offset = found + 4
    offset = 0
    while (found := result.find(_CENTRAL_HEADER, offset)) >= 0:
        central_offsets.append(found)
        offset = found + 4
    if len(local_offsets) != len(compressed_sizes) or len(central_offsets) != len(compressed_sizes):
        raise ValueError("ZIP entry count differs from requested patched sizes")
    for index, (compressed, uncompressed) in enumerate(zip(compressed_sizes, uncompressed_sizes)):
        struct.pack_into("<I", result, local_offsets[index] + 18, compressed)
        struct.pack_into("<I", result, local_offsets[index] + 22, uncompressed)
        struct.pack_into("<I", result, central_offsets[index] + 20, compressed)
        struct.pack_into("<I", result, central_offsets[index] + 24, uncompressed)
    return bytes(result)


def _corrupt_first_payload(payload: bytes) -> bytes:
    result = bytearray(payload)
    local = result.find(_LOCAL_HEADER)
    if local < 0:
        raise ValueError("ZIP local header is absent")
    name_bytes, extra_bytes = struct.unpack_from("<HH", result, local + 26)
    offset = local + 30 + name_bytes + extra_bytes
    result[offset] ^= 0x01
    return bytes(result)


def generate_adversarial_corpus(output_dir: Path) -> Path:
    """Write compact, deterministic ZIP inventory and integrity edge cases."""
    output_dir.mkdir(parents=True, exist_ok=True)
    over_entry_bytes = 256 * 1024 * 1024 + 1
    maximum_entry_bytes = 256 * 1024 * 1024
    over_entry_count = [("manifest.json", b"{}")] + [
        (f"payload/{index:05d}.bin", b"") for index in range(20_000)
    ]
    cases: list[tuple[str, str, bytes]] = [
        (
            "duplicate-path",
            "duplicate exact root paths",
            _zip_bytes([("manifest.json", b"{}"), ("manifest.json", b"{}")]),
        ),
        (
            "enclosing-directory",
            "manifest is not at the ZIP root",
            _zip_bytes([("release/manifest.json", b"{}")]),
        ),
        (
            "parent-traversal",
            "portable path traversal",
            _zip_bytes([("manifest.json", b"{}"), ("../escape.bin", b"x")]),
        ),
        (
            "percent-ambiguous-path",
            "percent-encoded path ambiguity",
            _zip_bytes([("manifest.json", b"{}"), ("data/%2e%2e/value.bin", b"x")]),
        ),
        (
            "nested-zip",
            "nested ZIP member",
            _zip_bytes([("manifest.json", b"{}"), ("payload.zip", b"PK")]),
        ),
        (
            "unsupported-compression",
            "central and local headers declare unsupported method 12",
            _patch_single_entry(_zip_bytes([("manifest.json", b"{}")]), compression_method=12),
        ),
        (
            "entry-expanded-size-over-limit",
            "central metadata exceeds the provisional per-entry expanded limit",
            _patch_single_entry(
                _zip_bytes([("manifest.json", b"{}")]),
                uncompressed_size=over_entry_bytes,
            ),
        ),
        (
            "compression-ratio-over-limit",
            "central metadata declares an exact 1,001:1 expansion ratio",
            _patch_single_entry(
                _zip_bytes([("manifest.json", b"x")]),
                uncompressed_size=1001,
            ),
        ),
        (
            "aggregate-expanded-size-over-limit",
            "aggregate expansion exceeds 1.5 GiB while every entry remains within 256 MiB",
            _patch_entry_sizes(
                _zip_bytes([
                    ("manifest.json", b"{}"),
                    *[(f"payload/{index}.bin", b"x") for index in range(6)],
                ]),
                compressed_sizes=[2, *[(maximum_entry_bytes + 999) // 1000] * 6],
                uncompressed_sizes=[2, *[maximum_entry_bytes] * 6],
            ),
        ),
        (
            "entry-count-over-limit",
            "central directory contains 20,001 entries",
            _zip_bytes(over_entry_count),
        ),
        (
            "crc-corruption",
            "stored payload differs from its declared CRC-32",
            _corrupt_first_payload(_zip_bytes([("manifest.json", b"{}")], zipfile.ZIP_STORED)),
        ),
        (
            "path-segment-over-limit",
            "one UTF-8 path segment exceeds 128 bytes",
            _zip_bytes([("manifest.json", b"{}"), (f"data/{'x' * 129}.bin", b"x")]),
        ),
    ]
    records: list[dict[str, object]] = []
    for case_id, purpose, payload in cases:
        archive = output_dir / f"{case_id}{BUNDLE_SUFFIX}"
        archive.write_bytes(payload)
        records.append(_archive_record(
            archive,
            case_id=case_id,
            kind="invalid-adversarial",
            synthetic=True,
            scientific_notice=SYNTHETIC_NOTICE,
            expected_rejection=purpose,
        ))
    return _write_index(output_dir, records)
