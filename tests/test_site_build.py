import hashlib
import json
from pathlib import Path

import pytest

from ephys_atlas_builder.build_environment import build_environment
from tools import site_build, s3_assets
from tools.release_preflight import RepositoryState
from ibl_ephys_atlas_publish.client import file_info
from ibl_ephys_atlas_publish.s3 import json_bytes


def config():
    return {"catalog": {"path": "catalog.json", "bytes": 1, "sha256": "a"*64},
            "projection": {"path": "atlas/projections/test-only/manifest.json", "bytes": 2, "sha256": "b"*64}}


def test_production_environment_cannot_inherit_preview_defaults(monkeypatch):
    monkeypatch.setenv("EPHYS_ATLAS_REAL_RELEASE", "/private/preview")
    monkeypatch.setenv("VITE_DEFAULT_RELEASE_ID", "preview")
    monkeypatch.setenv("VITE_BRAIN_MESH_MANIFEST_URL", "/synthetic")
    env = site_build.build_environment_for_site(config())
    assert env["VITE_DATASET_CATALOG_URL"] == "/catalog.json"
    assert env["EPHYS_ATLAS_SITE_BUILD"] == "1"
    assert "EPHYS_ATLAS_REAL_RELEASE" not in env
    assert "VITE_DEFAULT_RELEASE_ID" not in env
    assert "VITE_BRAIN_MESH_MANIFEST_URL" not in env


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
    receipt["files"] = {p.relative_to(tmp_path).as_posix(): file_info(p) for p in tmp_path.rglob("*") if p.is_file()}
    (tmp_path / "_site.json").write_bytes(json_bytes(receipt))
    if extra_resource:
        with pytest.raises(ValueError, match="missing or non-build asset"):
            site_build.validate_site(tmp_path, repo)
    else:
        assert site_build.validate_site(tmp_path, repo)["build_id"] == identity


def test_synthetic_mesh_cannot_pass_publication_preflight(monkeypatch):
    monkeypatch.setattr(s3_assets, "canonical_host", lambda: RepositoryState("main", "a"*40, True))
    with pytest.raises(ValueError, match="approved purpose"):
        s3_assets.validate_asset(Path(__file__).parents[1] / "fixtures/mesh-pack-v1/pack", "mesh")
