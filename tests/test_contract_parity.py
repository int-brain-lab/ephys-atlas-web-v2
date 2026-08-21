from __future__ import annotations

import json
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from ephys_atlas_builder.validate import FORMAT_CHECKER

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = ROOT / "schema" / "v0.1"
CASES = ROOT / "tests" / "contract-fixtures" / "manifest-cases.json"


def _validator() -> Draft202012Validator:
    registry = Registry()
    schemas = {}
    for path in sorted(SCHEMA_DIR.glob("*.schema.json")):
        schema = json.loads(path.read_text())
        schemas[path.name] = schema
        registry = registry.with_resource(schema["$id"], Resource.from_contents(schema))
    return Draft202012Validator(
        schemas["dataset.schema.json"], registry=registry, format_checker=FORMAT_CHECKER
    )


def test_manifest_contract_corpus_matches_python_schema() -> None:
    validator = _validator()
    corpus = json.loads(CASES.read_text())
    failures = []
    for case in corpus["cases"]:
        document = case["document"]
        valid = not list(validator.iter_errors(document))
        if valid:
            parcellation_ids = [item["id"] for item in document["parcellations"]]
            feature_ids = [item["id"] for item in document["features"]]
            feature_paths = [item["path"] for item in document["features"]]
            valid = (
                len(parcellation_ids) == len(set(parcellation_ids))
                and len(feature_ids) == len(set(feature_ids))
                and len(feature_paths) == len(set(feature_paths))
            )
        if valid != case["valid"]:
            failures.append(f"{case['name']}: expected valid={case['valid']}, got {valid}")
    assert not failures, "\n".join(failures)
