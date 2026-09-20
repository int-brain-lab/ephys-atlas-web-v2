from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RECORD = ROOT / "docs/data/REGISTERED_ATLAS_ASSET_PROVENANCE.json"
DEPLOYMENT = ROOT / "data/deployment/initial-site.json"


def test_deployed_registered_graph_matches_hash_bound_provenance() -> None:
    record = json.loads(RECORD.read_text())
    parent = record["parent"]
    display = record["display_derivative"]
    projection = record["projection_pack"]
    deployment = json.loads(DEPLOYMENT.read_text())
    assert deployment["projection"]["path"] == (
        "atlas/projections/ibl-atlas-projections-05b9f3f85db9/manifest.json"
    )
    assert deployment["projection"]["sha256"] == projection["manifest_sha256"]
    assert deployment["projection"]["bytes"] == 7432
    assert record["status"] == "published-production"
    assert record["source"]["annotation"]["url"].endswith("/annotation_10.nrrd")
    assert record["source"]["region_lut"]["derivation"].startswith("IBL bilateral")
    assert record["source"]["terms_url"] == "https://alleninstitute.org/legal/terms-of-use"
    assert record["source"]["citation_policy_url"].endswith("/citation-policy/")
    assert record["publication"]["immutable_origin"].endswith(
        "/ibl-atlas-projections-05b9f3f85db9/manifest.json"
    )
