import hashlib
import json
import re
from pathlib import Path


ASSET = Path(__file__).parents[1] / "web/public/atlas/allen-ccf-2017/regions.json"


def test_pinned_allen_region_asset_has_complete_identity_and_color_contract():
    raw = ASSET.read_bytes()
    document = json.loads(raw)
    assert document["format"] == "ibl-atlas-regions-v1"
    assert document["atlas"] == "Allen Mouse CCF 2017"
    assert document["provenance"] == {
        "iblatlas_commit": "52083adf44825d0622a503705e095699a5957587",
        "legacy_svg_crosswalk_sha256": "9fca5fe4feeb368c715853c25a97667cb199d5a7ce160385771833ba61cedfc8",
        "legacy_svg_crosswalk_url": "https://atlas.internationalbrainlab.org/data/json/regions.json",
    }
    assert {name: len(rows) for name, rows in document["mappings"].items()} == {
        "allen": 2195,
        "beryl": 614,
        "cosmos": 22,
    }
    allen = document["mappings"]["allen"]
    sentinel = next(row for row in allen if row["atlas_id"] == -10)
    assert sentinel == {
        "acronym": "SCig",
        "atlas_id": -10,
        "color_hex": "#ff90ff",
        "depth": 6,
        "idx": 2162,
        "name": "Superior colliculus motor related intermediate gray layer (left)",
        "parent_id": -294,
    }
    for mapping, rows in document["mappings"].items():
        assert len({row["atlas_id"] for row in rows}) == len(rows), mapping
        assert len({row["idx"] for row in rows}) == len(rows), mapping
        assert all(re.fullmatch(r"#[0-9a-f]{6}", row["color_hex"]) for row in rows)
    assert hashlib.sha256(raw).hexdigest() == "3243b07e978e349ab9cc8601e23aeb12c9b2cc0f71f1a7894dce4d2dcfee3e38"
