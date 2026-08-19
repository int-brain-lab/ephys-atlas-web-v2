from pathlib import Path

from ephys_atlas_builder.fixture import generate_golden
from ephys_atlas_builder.validate import validate_release

ROOT = Path(__file__).resolve().parents[1]


def test_golden_fixture_validates(tmp_path):
    release = generate_golden(tmp_path / "golden")
    validate_release(release, ROOT / "schema" / "v0.1")


def test_checked_in_golden_fixture_validates():
    validate_release(ROOT / "fixtures" / "golden-v0.1", ROOT / "schema" / "v0.1")
