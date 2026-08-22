import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
from ephys_atlas_builder.fixture import generate_golden
from ephys_atlas_builder.io import DTYPES
from ephys_atlas_builder.validate import ValidationError, validate_release

ROOT = Path(__file__).resolve().parents[1]


def test_golden_is_deterministic(tmp_path):
    a = generate_golden(tmp_path / "a")
    b = generate_golden(tmp_path / "b")
    files_a = sorted(p.relative_to(a) for p in a.rglob("*") if p.is_file())
    files_b = sorted(p.relative_to(b) for p in b.rglob("*") if p.is_file())
    assert files_a == files_b
    for rel in files_a:
        assert (a / rel).read_bytes() == (b / rel).read_bytes(), rel


def test_checked_in_golden_and_browser_copy_match_generator(tmp_path):
    generated = generate_golden(tmp_path / "golden-v1")
    canonical = ROOT / "fixtures" / "golden-v1"
    browser = ROOT / "web" / "public" / "fixtures" / "ephys_atlas_channels" / "golden-v1"
    expected_files = sorted(path.relative_to(generated) for path in generated.rglob("*") if path.is_file())
    for copy in (canonical, browser):
        actual_files = sorted(path.relative_to(copy) for path in copy.rglob("*") if path.is_file())
        assert actual_files == expected_files
        for relative in expected_files:
            assert (copy / relative).read_bytes() == (generated / relative).read_bytes(), relative

    catalog = json.loads((ROOT / "web/public/fixtures/catalog.json").read_text())
    descriptor = catalog["datasets"][0]["releases"][0]["manifest"]
    served_manifest = ROOT / "web/public/fixtures" / descriptor["path"]
    manifest_bytes = served_manifest.read_bytes()
    assert descriptor["bytes"] == len(manifest_bytes)
    assert descriptor["sha256"] == hashlib.sha256(manifest_bytes).hexdigest()


def test_volume_edge_chunk_decodes_to_declared_dtype(tmp_path):
    release = generate_golden(tmp_path / "golden")
    feature = json.loads((release / "features/rms_ap/feature.json").read_text())
    volume = feature["representations"]["volume"]
    path = release / "features/rms_ap/volume/chunks/1.1.1.f32"
    raw = path.read_bytes()
    # 8x6x4 with 4x3x2 chunks -> every chunk is exactly 4x3x2 in this fixture.
    arr = np.frombuffer(raw, dtype=DTYPES[volume["array"]["dtype"]])
    assert arr.size == 4 * 3 * 2


def test_validator_detects_tampered_binary(tmp_path):
    release = generate_golden(tmp_path / "golden")
    values = release / "features/rms_ap/allen.values.f32"
    values.write_bytes(values.read_bytes()[:-1] + b"x")
    with pytest.raises(ValidationError, match="sha256 mismatch"):
        validate_release(release, ROOT / "schema" / "v1")


def test_validator_detects_tampered_artifact(tmp_path):
    release = generate_golden(tmp_path / "golden")
    artifact = release / "features/rms_ap/rms_ap.csv"
    artifact.write_text(artifact.read_text() + "# tampered\n")
    with pytest.raises(ValidationError, match="artifact sha256 mismatch|byte size mismatch"):
        validate_release(release, ROOT / "schema" / "v1")


def test_whole_release_package_is_deterministic(tmp_path):
    from ephys_atlas_builder.package import package_release

    release = generate_golden(tmp_path / "golden")
    a = package_release(release, tmp_path / "a.zip")
    b = package_release(release, tmp_path / "b.zip")
    assert a["sha256"] == b["sha256"]
    assert (tmp_path / "a.zip").read_bytes() == (tmp_path / "b.zip").read_bytes()


def test_content_release_id_is_stable_and_sensitive():
    from ephys_atlas_builder.sources import _content_release_id

    files = [{"path": "a.bin", "bytes": 3, "sha256": "0" * 64}]
    a = _content_release_id(files)
    assert a == _content_release_id(files)
    changed = [{"path": "a.bin", "bytes": 4, "sha256": "0" * 64}]
    assert a != _content_release_id(changed)
