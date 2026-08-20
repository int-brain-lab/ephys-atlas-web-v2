from pathlib import Path

from ephys_atlas_builder.fixture import generate_golden
from ephys_atlas_builder.validate import validate_release

ROOT = Path(__file__).resolve().parents[1]


def test_golden_fixture_validates(tmp_path):
    release = generate_golden(tmp_path / "golden")
    validate_release(release, ROOT / "schema" / "v0.1")


def test_checked_in_golden_fixture_validates():
    validate_release(ROOT / "fixtures" / "golden-v0.1", ROOT / "schema" / "v0.1")


def test_left_folded_checked_in_golden_fixture_validates():
    validate_release(ROOT / "fixtures" / "golden-v0.2", ROOT / "schema" / "v0.1")


def test_alias_schema(tmp_path):
    import json

    from jsonschema import Draft202012Validator

    schema = json.loads((ROOT / "schema/v0.1/alias.schema.json").read_text())
    instance = {
        "schema_version": "0.1",
        "dataset_id": "ephys_atlas_channels",
        "alias": "latest",
        "release_id": "2026_W33",
    }
    Draft202012Validator(schema).validate(instance)
