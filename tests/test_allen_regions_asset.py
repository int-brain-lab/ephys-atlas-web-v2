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
        "beryl": 787,
        "cosmos": 35,
    }
    allen = document["mappings"]["allen"]
    sentinel = next(row for row in allen if row["atlas_id"] == -10)
    assert sentinel == {
        "acronym": "SCig",
        "atlas_id": -10,
        "color_hex": "#ff90ff",
        "depth": 6,
        "idx": 2162,
        "mapping_member": True,
        "name": "Superior colliculus motor related intermediate gray layer (left)",
        "parent_id": -294,
    }
    for mapping, rows in document["mappings"].items():
        assert len({row["atlas_id"] for row in rows}) == len(rows), mapping
        assert len({row["idx"] for row in rows}) == len(rows), mapping
        assert all(re.fullmatch(r"#[0-9a-f]{6}", row["color_hex"]) for row in rows)
        assert all(isinstance(row["mapping_member"], bool) for row in rows)
    assert (
        hashlib.sha256(raw).hexdigest()
        == "71a878043aad6c4dbf7a4ca92bd643cad9910984ed81231784e96ff5829afa8b"
    )


def test_every_left_mapping_is_a_parent_closed_allen_ontology_tree():
    document = json.loads(ASSET.read_bytes())
    expected = {
        "allen": (1097, 1097, 10),
        "beryl": (393, 306, 8),
        "cosmos": (17, 10, 5),
    }
    for mapping, (row_count, member_count, maximum_depth) in expected.items():
        rows = [row for row in document["mappings"][mapping] if row["atlas_id"] < 0]
        by_id = {row["atlas_id"]: row for row in rows}
        position = {row["atlas_id"]: index for index, row in enumerate(rows)}
        assert len(rows) == row_count
        assert sum(row["mapping_member"] for row in rows) == member_count
        assert max(row["depth"] for row in rows) == maximum_depth
        assert [row["atlas_id"] for row in rows if row["parent_id"] is None] == [-997]
        for row in rows:
            parent_id = row["parent_id"]
            if parent_id is None:
                assert row["depth"] == 0
                continue
            assert parent_id in by_id, (mapping, row)
            assert position[parent_id] < position[row["atlas_id"]], (mapping, row)
            assert by_id[parent_id]["depth"] + 1 == row["depth"], (mapping, row)


def test_reduced_mappings_keep_real_allen_containers_and_colors():
    document = json.loads(ASSET.read_bytes())
    beryl = {row["atlas_id"]: row for row in document["mappings"]["beryl"]}
    assert [
        (beryl[atlas_id]["acronym"], beryl[atlas_id]["mapping_member"])
        for atlas_id in (-997, -8, -567, -688, -695, -315, -500, -985)
    ] == [
        ("root", False),
        ("grey", False),
        ("CH", False),
        ("CTX", False),
        ("CTXpl", False),
        ("Isocortex", False),
        ("MO", False),
        ("MOp", True),
    ]
    assert beryl[-985]["color_hex"] == "#1f9d5a"

    cosmos = {row["atlas_id"]: row for row in document["mappings"]["cosmos"]}
    assert cosmos[-315]["mapping_member"] is True
    assert cosmos[-315]["parent_id"] == -695
    assert cosmos[-315]["color_hex"] == "#70ff71"
