from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RECORD = ROOT / "docs/data/REGISTERED_ATLAS_ASSET_PROVENANCE.json"
ATLAS = ROOT / "web/dist/atlas"
DEPLOYMENT = ROOT / "data/deployment/initial-site.json"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


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

    parent_path = ATLAS / "anatomy" / parent["pack_id"] / "manifest.json"
    display_path = ATLAS / "anatomy" / display["pack_id"] / "manifest.json"
    paths = {"parent": parent_path, "display": display_path}
    assert all(path.is_file() for path in paths.values())
    assert _sha256(parent_path) == parent["manifest_sha256"]
    assert _sha256(display_path) == display["manifest_sha256"]

    parent_manifest = json.loads(paths["parent"].read_text())
    display_manifest = json.loads(paths["display"].read_text())
    assert parent_manifest["pack_id"] == parent["pack_id"]
    assert display_manifest["parent"]["manifest_sha256"] == parent["manifest_sha256"]
