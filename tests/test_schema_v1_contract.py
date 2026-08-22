from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest

from ephys_atlas_builder.schema_v1 import validate_schema_v1_document
from ephys_atlas_builder.validate import ValidationError

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "tests" / "contract-fixtures" / "v1" / "cases.json"


def _expand(value: Any, fixtures: dict[str, Any]) -> Any:
    if isinstance(value, dict):
        if set(value) == {"$fixture"}:
            return _expand(deepcopy(fixtures[value["$fixture"]]), fixtures)
        return {key: _expand(child, fixtures) for key, child in value.items()}
    if isinstance(value, list):
        return [_expand(child, fixtures) for child in value]
    return value


def _target(document: Any, pointer: str) -> tuple[Any, str]:
    parts = [part.replace("~1", "/").replace("~0", "~") for part in pointer.split("/")[1:]]
    parent = document
    for part in parts[:-1]:
        parent = parent[int(part)] if isinstance(parent, list) else parent[part]
    return parent, parts[-1]


def _document(case: dict[str, Any], fixtures: dict[str, Any]) -> dict[str, Any]:
    document = _expand(deepcopy(fixtures[case["document"]]), fixtures)
    for pointer, value in case.get("set", {}).items():
        parent, key = _target(document, pointer)
        expanded = _expand(deepcopy(value), fixtures)
        if isinstance(parent, list):
            parent[int(key)] = expanded
        else:
            parent[key] = expanded
    for pointer, value in case.get("append", {}).items():
        parent, key = _target(document, pointer)
        target = parent[int(key)] if isinstance(parent, list) else parent[key]
        target.append(_expand(deepcopy(value), fixtures))
    return document


def _cases() -> list[tuple[dict[str, Any], dict[str, Any]]]:
    corpus = json.loads(CORPUS.read_text())
    return [(case, corpus["fixtures"]) for case in corpus["cases"]]


@pytest.mark.parametrize(("case", "fixtures"), _cases(), ids=lambda value: value.get("name", "fixtures") if isinstance(value, dict) else None)
def test_schema_v1_python_contract_corpus(case: dict[str, Any], fixtures: dict[str, Any]) -> None:
    document = _document(case, fixtures)
    if case["valid"]:
        validate_schema_v1_document(document, case["schema"])
    else:
        with pytest.raises(ValidationError):
            validate_schema_v1_document(document, case["schema"])


def test_schema_v1_corpus_covers_every_top_level_schema() -> None:
    corpus = json.loads(CORPUS.read_text())
    covered = {case["schema"] for case in corpus["cases"]}
    top_level = {path.name for path in (ROOT / "schema" / "v1").glob("*.schema.json")}
    assert covered == top_level - {"common.schema.json"}
