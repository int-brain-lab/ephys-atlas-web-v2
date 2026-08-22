from pathlib import Path

from ephys_atlas_builder.fixture import generate_golden
from ephys_atlas_builder.validate import validate_release

ROOT = Path(__file__).resolve().parents[1]


def test_golden_fixture_validates(tmp_path):
    release = generate_golden(tmp_path / "golden")
    validate_release(release, ROOT / "schema" / "v1")


def test_checked_in_golden_fixture_validates():
    validate_release(ROOT / "fixtures" / "golden-v1", ROOT / "schema" / "v1")


def test_alias_schema(tmp_path):
    from ephys_atlas_builder.schema_v1 import validate_schema_v1_document

    instance = {
        "schema_version": "1.0",
        "dataset_id": "ephys_atlas_channels",
        "alias": "latest",
        "release_id": "2026_W33",
    }
    validate_schema_v1_document(instance, "alias.schema.json")
