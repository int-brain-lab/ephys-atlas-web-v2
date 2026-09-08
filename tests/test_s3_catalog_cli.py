import json
import subprocess

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
        (RepositoryState("main", "c" * 40, True), "Darwin", "must run on Linux"),
        (RepositoryState("work", "c" * 40, True), "Linux", "requires main"),
        (RepositoryState("main", "c" * 40, False), "Linux", "clean tracked"),
    ],
)
def test_catalog_validation_requires_current_clean_linux_main(tmp_path, repo, host_os, message):
    root = _release(tmp_path)
    with pytest.raises(PreflightError, match=message):
        check_catalog_release(root, repo=repo, host_os=host_os)


@pytest.mark.parametrize("mutation", ["missing-commit", "nonlinux-environment"])
def test_catalog_validation_rejects_incomplete_historical_builder_provenance(tmp_path, mutation):
    root = _release(tmp_path)
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if mutation == "missing-commit":
        del manifest["provenance"]["builder"]["commit"]
    else:
        manifest["provenance"]["builder"]["environment"]["operating_system"] = "darwin"
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(PreflightError, match="canonical (40-character builder commit|Linux builder environment)"):
        check_catalog_release(
            root,
            repo=RepositoryState("main", "c" * 40, True),
            host_os="Linux",
        )
