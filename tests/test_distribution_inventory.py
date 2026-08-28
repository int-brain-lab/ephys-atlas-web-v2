from __future__ import annotations

import json

import numpy as np

from ephys_atlas_builder.distribution_inventory import audit_release_inventory
from ephys_atlas_builder.fixture import generate_golden


def test_release_inventory_marks_new_exact_candidates_unavailable(tmp_path):
    release = generate_golden(tmp_path / "golden")
    output = tmp_path / "inventory.json"
    audit_release_inventory(release, output)
    report = json.loads(output.read_text())
    regional = next(
        representation
        for item in report["features"]
        for representation in item["representations"]
        if representation["kind"] == "regional"
    )
    entry = regional["parcellations"][0]
    assert entry["value_counts"]["positive_count"] is None
    assert entry["new_candidate_binnings"]["availability"] == "unavailable-from-release"


def test_release_inventory_retains_both_representations_for_hybrid_feature(tmp_path):
    release = generate_golden(tmp_path / "golden")
    output = tmp_path / "inventory.json"
    audit_release_inventory(release, output)
    report = json.loads(output.read_text())
    feature = next(item for item in report["features"] if item["id"] == "rms_ap")
    assert [item["kind"] for item in feature["representations"]] == ["regional", "volume"]
