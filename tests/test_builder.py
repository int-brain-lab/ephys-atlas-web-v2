import gzip
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


def test_volume_edge_chunk_decodes_to_declared_dtype(tmp_path):
    release = generate_golden(tmp_path / "golden")
    feature = json.loads((release / "features/rms_ap/feature.json").read_text())
    volume = feature["representations"]["volume"]
    path = release / "features/rms_ap/volume/chunks/1.1.1.f32.gz"
    with gzip.open(path, "rb") as f:
        raw = f.read()
    # 8x6x4 with 4x3x2 chunks -> every chunk is exactly 4x3x2 in this fixture.
    arr = np.frombuffer(raw, dtype=DTYPES[volume["array"]["dtype"]])
    assert arr.size == 4 * 3 * 2


def test_validator_detects_tampered_binary(tmp_path):
    release = generate_golden(tmp_path / "golden")
    values = release / "features/rms_ap/allen.values.f32"
    values.write_bytes(values.read_bytes()[:-1] + b"x")
    with pytest.raises(ValidationError, match="sha256 mismatch"):
        validate_release(release, ROOT / "schema" / "v0.1")


def test_validator_detects_tampered_artifact(tmp_path):
    release = generate_golden(tmp_path / "golden")
    artifact = release / "features/rms_ap/rms_ap.csv"
    artifact.write_text(artifact.read_text() + "# tampered\n")
    with pytest.raises(ValidationError, match="artifact sha256 mismatch|byte size mismatch"):
        validate_release(release, ROOT / "schema" / "v0.1")
