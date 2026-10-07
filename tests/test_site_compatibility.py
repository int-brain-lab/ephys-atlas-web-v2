import copy
import json

import pytest

from tools.site_compatibility import (REPOSITORY, SNAPSHOTS, check_compatibility,
                                     validate_catalog_links, validate_navigation, verified_document)


def inputs():
    config = json.loads((REPOSITORY / "data/deployment/initial-site.json").read_bytes())
    projection = json.loads((REPOSITORY / SNAPSHOTS / (config["projection"]["sha256"] + ".json")).read_bytes())
    regions = json.loads((REPOSITORY / "web/public" / config["atlas_regions"]["path"]).read_bytes())
    return config, projection, regions


def test_old_development_companion_is_rejected_by_exact_production_selection():
    config, projection, regions = inputs()
    nav = json.loads((REPOSITORY / "web/src/assets/navigation/manifest.json").read_bytes())
    # Both documents are independently schema-valid and have the same native
    # reference frame. This is the exact combination that previously deployed.
    with pytest.raises(ValueError, match="different projection pack/hash"):
        validate_navigation(nav, projection, config["projection"]["sha256"], regions, config["atlas_regions"]["sha256"])


def test_tracked_production_combination_passes_and_cannot_use_a_stale_snapshot(tmp_path):
    config, _, _ = inputs()
    result = check_compatibility(config)
    assert result["profile"] == "production"
    assert result["dependencies"]["projection"] == config["projection"]["sha256"]
    altered = copy.deepcopy(config)
    altered["projection"]["bytes"] += 1
    with pytest.raises(ValueError, match="projection manifest integrity"):
        check_compatibility(altered)


def test_site_receipt_must_revalidate_compatibility_even_when_all_files_are_unchanged(tmp_path, monkeypatch):
    from tools import site_build
    from tools.release_preflight import RepositoryState
    from ibl_ephys_atlas_publish.s3 import json_bytes
    from ephys_atlas_builder.build_environment import build_environment
    config, _, _ = inputs()
    receipt = {"format": "atlas-site-build-v1", "commit": "a" * 40, "environment": build_environment(),
               "config": config, "dependencies": site_build.dependencies(config), "compatibility": {"stale": True}}
    (tmp_path / "_site.json").write_bytes(json_bytes(receipt))
    with pytest.raises(ValueError, match="compatibility evidence"):
        site_build.validate_site(tmp_path, RepositoryState("main", "a" * 40, True))


@pytest.mark.parametrize("change, message", [
    ("reference", "reference spaces"), ("shape", "grid/affine"),
    ("affine", "grid/affine"), ("mapping", "signed mappings"),
])
def test_matching_pack_identity_does_not_replace_spatial_or_mapping_compatibility(change, message):
    config, projection, regions = inputs()
    nav = json.loads((REPOSITORY / "web/src/assets/navigation/manifest.json").read_bytes())
    # Test the independent semantic boundaries using synthetic mutations.
    nav["projection_pack"] = {"pack_id": projection["pack_id"], "manifest_sha256": config["projection"]["sha256"]}
    if change == "reference": regions["reference_space_id"] = "another-frame"
    if change == "shape": nav["grid"]["shape"][0] -= 1
    if change == "affine": nav["grid"]["index_to_world_um"][3] += 10
    if change == "mapping":
        for source in nav["provenance"]["sources"]:
            if source.get("path") == "regions.json": source["sha256"] = "0" * 64
    with pytest.raises(ValueError, match=message):
        validate_navigation(nav, projection, config["projection"]["sha256"], regions, config["atlas_regions"]["sha256"])


def test_served_byte_integrity_precedes_manifest_parsing():
    with pytest.raises(ValueError, match="integrity"):
        verified_document(b"not json", {"bytes": 8, "sha256": "0" * 64}, "projection")


@pytest.mark.parametrize("change", ["default", "edition", "duplicate"])
def test_existing_catalog_validator_checks_discovery_links(change):
    config, _, _ = inputs()
    catalog = json.loads((REPOSITORY / SNAPSHOTS / (config["catalog"]["sha256"] + ".json")).read_bytes())
    validate_catalog_links(catalog)
    if change == "default": catalog["datasets"][0]["default_release"] = "missing-release"
    if change == "edition": catalog["projects"][0]["editions"][0]["dataset_releases"][0]["release_id"] = "missing-release"
    if change == "duplicate": catalog["datasets"].append(copy.deepcopy(catalog["datasets"][0]))
    with pytest.raises(RuntimeError, match="catalog"):
        validate_catalog_links(catalog)
