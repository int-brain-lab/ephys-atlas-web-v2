import hashlib
import json
from pathlib import Path

import pytest

from ephys_atlas_builder.build_environment import build_environment
from tools import site_build, s3_assets
from tools.release_preflight import RepositoryState
from ibl_ephys_atlas_publish.client import file_info
from ibl_ephys_atlas_publish.s3 import json_bytes


ATLAS_REGIONS = {
    "path": "atlas/allen-ccf-2017/regions.json",
    "bytes": 4,
    "sha256": hashlib.sha256(b"test").hexdigest(),
}


def config():
    return {"catalog": {"path": "catalog.json", "bytes": 1, "sha256": "a"*64},
            "projection": {"path": "atlas/projections/test-only/manifest.json", "bytes": 2, "sha256": "b"*64},
            "atlas_regions": ATLAS_REGIONS.copy()}


def write_atlas_regions(root: Path):
    target = root / ATLAS_REGIONS["path"]
    target.parent.mkdir(parents=True)
    target.write_bytes(b"test")


def config_with_default():
    value = config()
    value["default_view"] = {
        "project_id": "ephys-atlas",
        "dataset_id": "ephys_atlas_channels",
        "release_id": "2026_W32-ibl-review-20260908-v1",
        "feature_id": "rms_ap.denoised",
        "parcellation_id": "allen",
        "curator_config": "data/deployment/initial-curator.json",
    }
    return value


def test_production_environment_cannot_inherit_preview_defaults(monkeypatch):
    monkeypatch.setenv("EPHYS_ATLAS_REAL_RELEASE", "/private/preview")
    monkeypatch.setenv("VITE_DEFAULT_RELEASE_ID", "preview")
    monkeypatch.setenv("VITE_BRAIN_MESH_MANIFEST_URL", "/synthetic")
    env = site_build.build_environment_for_site(config(), "c"*32)
    assert env["VITE_DATASET_CATALOG_URL"] == "/catalog.json"
    assert env["EPHYS_ATLAS_SITE_BUILD"] == "1"
    assert env["VITE_ATLAS_REGIONS_URL"] == "/site/builds/" + "c"*32 + "/atlas/allen-ccf-2017/regions.json"
    assert env["VITE_ATLAS_REGIONS_BYTES"] == "4"
    assert env["VITE_ATLAS_REGIONS_SHA256"] == ATLAS_REGIONS["sha256"]
    assert "EPHYS_ATLAS_REAL_RELEASE" not in env
    assert "VITE_DEFAULT_RELEASE_ID" not in env
    assert "VITE_BRAIN_MESH_MANIFEST_URL" not in env


def test_site_default_view_is_pinned_to_the_tracked_curator_default(monkeypatch):
    monkeypatch.setenv("VITE_DEFAULT_FEATURE_ID", "inherited-preview-feature")
    env = site_build.build_environment_for_site(config_with_default(), "c"*32)
    assert env["VITE_DEFAULT_DATASET_ID"] == "ephys_atlas_channels"
    assert env["VITE_DEFAULT_RELEASE_ID"] == "2026_W32-ibl-review-20260908-v1"
    assert env["VITE_DEFAULT_FEATURE_ID"] == "rms_ap.denoised"
    assert env["VITE_DEFAULT_PARCELLATION_ID"] == "allen"


def test_site_default_view_rejects_a_release_outside_the_curator_default_edition():
    value = config_with_default()
    value["default_view"]["release_id"] = "not-in-curator"
    with pytest.raises(ValueError, match="dataset/release"):
        site_build.build_environment_for_site(value, "c"*32)


def test_site_default_view_rejects_a_nondefault_curator_dataset():
    value = config_with_default()
    value["default_view"]["dataset_id"] = "ephys_atlas_clusters"
    value["default_view"]["release_id"] = "sha256-9b5e55215b306f26-ibl-review-20260908-v1"
    with pytest.raises(ValueError, match="default_dataset"):
        site_build.build_environment_for_site(value, "c"*32)


@pytest.mark.parametrize("path", ["https://external/catalog.json", "../catalog.json", "_staging/catalog.json", "catalog.json?x"])
def test_site_rejects_external_or_private_dependencies(path):
    value = config()
    value["catalog"]["path"] = path
    with pytest.raises(ValueError):
        site_build.dependencies(value)


def test_site_receipt_and_inventory_are_verified(tmp_path):
    repo = RepositoryState("main", "a"*40, True)
    receipt = {"commit": repo.commit, "environment": build_environment(), "node": "v22.17.1", "config": config()}
    identity = hashlib.sha256(json_bytes(receipt)).hexdigest()[:32]
    receipt.update(format="atlas-site-build-v1", build_id=identity, dependencies=site_build.dependencies(config()))
    (tmp_path / "index.html").write_text(
        f'<script src="/site/builds/{identity}/assets/main.js"></script>'
        f'<link href="/site/builds/{identity}/favicon.png"><a href="/app/">Open atlas</a>'
    )
    (tmp_path / "favicon.png").write_bytes(b"test")
    write_atlas_regions(tmp_path)
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets/main.js").write_text("// test-only")
    receipt["files"] = {p.relative_to(tmp_path).as_posix(): file_info(p) for p in tmp_path.rglob("*") if p.is_file()}
    (tmp_path / "_site.json").write_bytes(json_bytes(receipt))
    assert site_build.validate_site(tmp_path, repo)["build_id"] == identity
    (tmp_path / "secret.txt").write_text("must not upload")
    with pytest.raises(ValueError, match="inventory"):
        site_build.validate_site(tmp_path, repo)


@pytest.mark.parametrize("extra_resource", [
    "", '<img src="https://example.com/hero.jpg">',
    "<iframe src='/outside.html'></iframe>",
])
def test_site_receipt_checks_landing_resources_but_allows_navigation(tmp_path, extra_resource):
    repo = RepositoryState("main", "a"*40, True)
    receipt = {"commit": repo.commit, "environment": build_environment(), "node": "v22.17.1", "config": config()}
    identity = hashlib.sha256(json_bytes(receipt)).hexdigest()[:32]
    receipt.update(format="atlas-site-build-v1", build_id=identity, dependencies=site_build.dependencies(config()))
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text(
        f'<img src="/site/builds/{identity}/assets/hero.jpg"><link href="/site/builds/{identity}/favicon.png">'
        '<a href="/app/">Open atlas</a><a href="https://iblcore.org/">IBL Core</a>'
        + extra_resource
    )
    (tmp_path / "assets" / "hero.jpg").write_bytes(b"test-only")
    (tmp_path / "favicon.png").write_bytes(b"test-only")
    write_atlas_regions(tmp_path)
    receipt["files"] = {p.relative_to(tmp_path).as_posix(): file_info(p) for p in tmp_path.rglob("*") if p.is_file()}
    (tmp_path / "_site.json").write_bytes(json_bytes(receipt))
    if extra_resource:
        with pytest.raises(ValueError, match="missing or non-build asset"):
            site_build.validate_site(tmp_path, repo)
    else:
        assert site_build.validate_site(tmp_path, repo)["build_id"] == identity


def test_site_rejects_missing_or_altered_atlas_regions_file(tmp_path):
    repo = RepositoryState("main", "a"*40, True)
    receipt = {"commit": repo.commit, "environment": build_environment(), "node": "v22.17.1", "config": config()}
    identity = hashlib.sha256(json_bytes(receipt)).hexdigest()[:32]
    receipt.update(format="atlas-site-build-v1", build_id=identity, dependencies=site_build.dependencies(config()))
    (tmp_path / "index.html").write_text(f'<script src="/site/builds/{identity}/assets/main.js"></script><link href="/site/builds/{identity}/favicon.png">')
    (tmp_path / "favicon.png").write_bytes(b"test")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "main.js").write_text("// test-only")
    write_atlas_regions(tmp_path)
    receipt["files"] = {p.relative_to(tmp_path).as_posix(): file_info(p) for p in tmp_path.rglob("*") if p.is_file()}
    (tmp_path / "_site.json").write_bytes(json_bytes(receipt))
    (tmp_path / ATLAS_REGIONS["path"]).unlink()
    receipt["files"].pop(ATLAS_REGIONS["path"])
    (tmp_path / "_site.json").write_bytes(json_bytes(receipt))
    with pytest.raises(ValueError, match="atlas_regions"):
        site_build.validate_site(tmp_path, repo)


def test_synthetic_mesh_cannot_pass_publication_preflight(monkeypatch):
    monkeypatch.setattr(s3_assets, "canonical_host", lambda: RepositoryState("main", "a"*40, True))
    with pytest.raises(ValueError, match="approved purpose"):
        s3_assets.validate_asset(Path(__file__).parents[1] / "fixtures/mesh-pack-v1/pack", "mesh")
