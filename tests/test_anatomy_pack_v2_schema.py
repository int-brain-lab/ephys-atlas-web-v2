from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker, ValidationError

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "schema" / "anatomy-pack-v2"
FIXTURE = ROOT / "fixtures" / "anatomy" / "anatomy-pack-v2"


def load(path: Path) -> dict:
    return json.loads(path.read_text())


def validate(instance: dict, schema: dict) -> None:
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(instance)


def test_bilateral_manifest_and_slice_fixture_validate() -> None:
    manifest_schema = load(SCHEMA / "manifest.schema.json")
    slice_schema = load(SCHEMA / "slice-pack.schema.json")
    Draft202012Validator.check_schema(manifest_schema)
    Draft202012Validator.check_schema(slice_schema)
    validate(load(FIXTURE / "manifest.json"), manifest_schema)
    validate(load(FIXTURE / "example-slice-pack.json"), slice_schema)


def test_v2_requires_real_10um_bilateral_source_and_both_signs() -> None:
    schema = load(SCHEMA / "manifest.schema.json")
    manifest = load(FIXTURE / "manifest.json")
    assert manifest["source"]["region_ids"] == {
        "domain": "signed_allen_atlas_id",
        "left_sign": "negative",
        "right_sign": "positive",
        "background_id": 0,
    }
    for field, invalid in (("resolution_um", 25), ("hemisphere", "left")):
        candidate = copy.deepcopy(manifest)
        candidate["source"][field] = invalid
        with pytest.raises(ValidationError):
            validate(candidate, schema)


def test_v2_paths_require_nonzero_signed_ids_and_explicit_evenodd_fill() -> None:
    schema = load(SCHEMA / "slice-pack.schema.json")
    pack = load(FIXTURE / "example-slice-pack.json")
    paths = pack["slices"][0]["paths"]
    assert paths[0]["atlas_ids"]["allen"] < 0
    assert paths[1]["atlas_ids"]["allen"] > 0
    assert all(path["fill_rule"] == "evenodd" for path in paths)

    for mutation in ("zero", "missing-fill"):
        invalid = copy.deepcopy(pack)
        if mutation == "zero":
            invalid["slices"][0]["paths"][0]["atlas_ids"]["allen"] = 0
        else:
            invalid["slices"][0]["paths"][0].pop("fill_rule")
        with pytest.raises(ValidationError):
            validate(invalid, schema)


def test_v2_requires_background_topology_validation() -> None:
    schema = load(SCHEMA / "manifest.schema.json")
    manifest = load(FIXTURE / "manifest.json")
    validation = manifest["validation"]
    assert validation["background_topology_valid"] is True
    assert (
        validation["internal_background_components_before"]
        == validation["internal_background_components_after"]
    )

    invalid = copy.deepcopy(manifest)
    invalid["validation"]["background_topology_valid"] = False
    with pytest.raises(ValidationError):
        validate(invalid, schema)
