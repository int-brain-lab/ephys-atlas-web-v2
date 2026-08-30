from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath
import struct
import zipfile

from benchmarks.local_import.corpus import (
    CapacityCase,
    ReleaseCase,
    SYNTHETIC_NOTICE,
    generate_adversarial_corpus,
    generate_capacity_corpus,
    generate_real_corpus,
)
from benchmarks.local_import.generate import main
from ephys_atlas_builder.bundle import validate_bundle
from ephys_atlas_builder.fixture import generate_golden


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "schema" / "v1"


def _document(path: Path) -> dict:
    return json.loads(path.read_text())


def test_adversarial_corpus_is_deterministic_compact_and_metadata_driven(tmp_path: Path) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"
    first_index = generate_adversarial_corpus(first)
    second_index = generate_adversarial_corpus(second)

    assert first_index.read_bytes() == second_index.read_bytes()
    first_files = sorted(path.name for path in first.glob("*.zip"))
    assert first_files == sorted(path.name for path in second.glob("*.zip"))
    for name in first_files:
        assert (first / name).read_bytes() == (second / name).read_bytes()
    assert sum((first / name).stat().st_size for name in first_files) < 3_000_000

    duplicate = first / "duplicate-path.ibl-ephys-atlas.zip"
    with zipfile.ZipFile(duplicate) as archive:
        assert archive.namelist() == ["manifest.json", "manifest.json"]
    oversized = (first / "entry-expanded-size-over-limit.ibl-ephys-atlas.zip").read_bytes()
    central = oversized.index(b"PK\x01\x02")
    assert struct.unpack_from("<I", oversized, central + 24)[0] == 256 * 1024 * 1024 + 1
    with zipfile.ZipFile(first / "entry-count-over-limit.ibl-ephys-atlas.zip") as archive:
        assert len(archive.infolist()) == 20_001
    with zipfile.ZipFile(first / "compression-ratio-over-limit.ibl-ephys-atlas.zip") as archive:
        ratio = archive.infolist()[0].file_size / archive.infolist()[0].compress_size
        assert ratio == 1001
    with zipfile.ZipFile(first / "aggregate-expanded-size-over-limit.ibl-ephys-atlas.zip") as archive:
        entries = archive.infolist()
        assert max(item.file_size for item in entries) == 256 * 1024 * 1024
        assert sum(item.file_size for item in entries) == 1536 * 1024 * 1024 + 2
        assert all(
            item.file_size == 0 or item.file_size / item.compress_size <= 1000
            for item in entries
        )


def test_capacity_corpus_is_valid_exact_count_labeled_and_deterministic(tmp_path: Path) -> None:
    golden = generate_golden(tmp_path / "golden")
    baseline = len([path for path in golden.rglob("*") if path.is_file()])
    case = CapacityCase("small-ladder", payload_bytes=2 * 1024 * 1024 + 1, entries=baseline + 3)
    first = tmp_path / "capacity-first"
    second = tmp_path / "capacity-second"

    generate_capacity_corpus(first, [case], golden_release=golden, schema_dir=SCHEMA)
    generate_capacity_corpus(second, [case], golden_release=golden, schema_dir=SCHEMA)
    archive = first / "small-ladder.ibl-ephys-atlas.zip"

    assert archive.read_bytes() == (second / archive.name).read_bytes()
    assert validate_bundle(archive, SCHEMA)["file_count"] == case.entries
    with zipfile.ZipFile(archive) as source:
        manifest = json.loads(source.read("manifest.json"))
        feature_path = manifest["features"][0]["descriptor"]["resource"]["path"]
        feature = json.loads(source.read(feature_path))
        payloads = [item for item in feature["artifacts"] if item["id"].startswith("benchmark-payload-")]
        assert sum(item["resource"]["bytes"] for item in payloads) == case.payload_bytes
        feature_root = PurePosixPath(feature_path).parent
        payload_paths = {
            (feature_root / item["resource"]["path"]).as_posix()
            for item in payloads
        }
        compressed_payload_bytes = sum(
            item.compress_size for item in source.infolist() if item.filename in payload_paths
        )
        assert case.payload_bytes * 0.99 <= compressed_payload_bytes <= case.payload_bytes * 1.01
        assert manifest["description"] == SYNTHETIC_NOTICE
        assert manifest["provenance"]["notes"] == [SYNTHETIC_NOTICE]
    record = _document(first / "corpus.json")["cases"][0]
    assert record["entries"] == case.entries
    assert record["requested_payload_bytes"] == case.payload_bytes
    assert record["synthetic"] is True


def test_capacity_corpus_keeps_20000_entry_root_manifest_bounded(tmp_path: Path) -> None:
    golden = generate_golden(tmp_path / "golden-entries")
    output = tmp_path / "capacity-entries"
    case = CapacityCase("entries-20000", payload_bytes=1024 * 1024, entries=20_000)

    index = generate_capacity_corpus(output, [case], golden_release=golden, schema_dir=SCHEMA)
    record = _document(index)["cases"][0]
    archive = output / record["archive"]
    with zipfile.ZipFile(archive) as source:
        assert len(source.infolist()) == 20_000
        assert source.getinfo("manifest.json").file_size < 8 * 1024 * 1024
        manifest = json.loads(source.read("manifest.json"))
        feature_path = manifest["features"][0]["descriptor"]["resource"]["path"]
        feature = json.loads(source.read(feature_path))
        assert len(feature["artifacts"]) == 1 + (20_000 - record["baseline_entries"])


def test_real_corpus_uses_canonical_exact_bundle_and_checks_representation(tmp_path: Path) -> None:
    release = generate_golden(tmp_path / "release")
    extra = release / "source-selection.json"
    extra.write_text('{"local_evidence": true}\n')
    output = tmp_path / "real"
    index = generate_real_corpus(
        output,
        [ReleaseCase("golden-regional", "regional", release)],
        schema_dir=SCHEMA,
    )
    record = _document(index)["cases"][0]
    archive = output / record["archive"]

    assert validate_bundle(archive, SCHEMA)["sha256"] == record["canonical_bundle_sha256"]
    assert record["source_release"] == {
        "dataset_id": "golden_fixture",
        "release_id": "golden-v1",
        "path": release.as_posix(),
    }
    assert record["excluded_undeclared_files"] == [{
        "path": "source-selection.json",
        "bytes": extra.stat().st_size,
        "sha256": hashlib.sha256(extra.read_bytes()).hexdigest(),
    }]
    assert record["synthetic"] is False


def test_cli_generates_adversarial_corpus(tmp_path: Path, capsys) -> None:
    output = tmp_path / "cli"
    assert main(["adversarial", "--output-dir", str(output)]) == 0
    assert capsys.readouterr().out.strip() == str(output / "corpus.json")
    assert (output / "corpus.json").is_file()
