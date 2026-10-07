import json
import subprocess
from pathlib import Path

import pytest

from test_release_preflight import COMMIT, _release
from tools import s3_catalog
from tools.release_preflight import PreflightError, RepositoryState, check_catalog_release


def _curator_config(root):
    dataset = json.loads((root / "manifest.json").read_bytes())["dataset_id"]
    return {
        "schema_version": "1.0",
        "default_project": "test-project",
        "projects": [
            {
                "project_id": "test-project",
                "title": "Test",
                "dataset_ids": [dataset],
                "default_dataset": dataset,
                "editions": [],
            }
        ],
        "datasets": [
            {
                "dataset_id": dataset,
                "title": "Test",
                "default_release": root.name,
                "releases": [{"release_id": root.name, "label": "Test release"}],
            }
        ],
    }


def _offline_catalog(root, tmp_path, monkeypatch, capsys):
    config = _curator_config(root)
    path = tmp_path / "curator.json"
    path.write_text(json.dumps(config))
    monkeypatch.setattr(s3_catalog, "REPOSITORY", tmp_path)
    monkeypatch.setattr(
        s3_catalog,
        "repository_state",
        lambda root: RepositoryState("main", "c" * 40, True),
    )
    monkeypatch.setattr(s3_catalog.platform, "system", lambda: "Linux")
    monkeypatch.setattr(subprocess, "run", lambda args, **kw: subprocess.CompletedProcess(args, 0, "", ""))
    monkeypatch.setattr(
        s3_catalog,
        "publication_store",
        lambda *args: pytest.fail("offline validation touched AWS"),
    )
    assert s3_catalog.main([str(path), "--release", str(root), "--environment", "staging"]) == 0
    return json.loads(capsys.readouterr().out)


def test_catalog_cli_accepts_historical_canonical_release_offline(tmp_path, monkeypatch, capsys):
    root = _release(tmp_path)
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["provenance"]["builder"]["commit"] = "b" * 40
    manifest_path.write_text(json.dumps(manifest))
    result = _offline_catalog(root, tmp_path, monkeypatch, capsys)
    assert result["remote_history_checked"] is False
    assert result["catalog"]["datasets"][0]["releases"][0]["manifest"]["sha256"]


@pytest.mark.parametrize(
    ("repo", "host_os", "message"),
    [
        (RepositoryState("work", "c" * 40, True), "Linux", "requires main"),
        (RepositoryState("main", "c" * 40, False), "Linux", "clean tracked"),
    ],
)
def test_catalog_validation_requires_current_clean_main(tmp_path, repo, host_os, message):
    root = _release(tmp_path)
    with pytest.raises(PreflightError, match=message):
        check_catalog_release(root, repo=repo, host_os=host_os)


def test_catalog_validation_rejects_incomplete_historical_builder_provenance(tmp_path):
    root = _release(tmp_path)
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    del manifest["provenance"]["builder"]["commit"]
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(PreflightError, match="canonical 40-character builder commit"):
        check_catalog_release(
            root,
            repo=RepositoryState("main", "c" * 40, True),
            host_os="Linux",
        )


def test_production_catalog_compatibility_failure_stops_before_browser_and_publication(tmp_path, monkeypatch):
    config = tmp_path / "site.json"
    config.write_text(json.dumps({"catalog": {}}))
    from tools import site_build
    monkeypatch.setattr(site_build, "dependencies", lambda config: [])
    def incompatible(*args, **kwargs):
        raise ValueError("incompatible site dependencies")
    monkeypatch.setattr(s3_catalog, "check_compatibility", incompatible)
    monkeypatch.setattr(subprocess, "run", lambda *args, **kw: pytest.fail("incompatible site reached browser verification"))
    with pytest.raises(ValueError, match="incompatible"):
        s3_catalog.verify_catalog_site({}, config, "https://example.test")


def test_production_catalog_browser_failure_is_not_accepted(tmp_path, monkeypatch):
    config = tmp_path / "site.json"
    config.write_text(json.dumps({"catalog": {}}))
    from tools import site_build
    monkeypatch.setattr(site_build, "dependencies", lambda config: [])
    monkeypatch.setattr(s3_catalog, "check_compatibility", lambda *args, **kw: {})
    monkeypatch.setattr(s3_catalog, "validate_catalog_links", lambda catalog: None)
    def failed_browser(args, **kw):
        assert json.loads(Path(args[4]).read_bytes()) == {"proposed": True}
        assert args[5] == str(config.resolve())
        assert args[3] == ""
        raise subprocess.CalledProcessError(1, args)
    monkeypatch.setattr(subprocess, "run", failed_browser)
    with pytest.raises(ValueError, match="running-site verification"):
        s3_catalog.verify_catalog_site({"proposed": True}, config, "https://example.test")
