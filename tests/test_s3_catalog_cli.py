import json
import subprocess

import pytest

from test_release_preflight import COMMIT, _release
from tools import s3_catalog, s3_publish
from tools.release_preflight import RepositoryState


def test_catalog_cli_validates_real_schema_offline(tmp_path, monkeypatch, capsys):
    root = _release(tmp_path)
    dataset = json.loads((root / "manifest.json").read_bytes())["dataset_id"]
    config = {"schema_version":"1.0", "default_project":"test-project",
              "projects":[{"project_id":"test-project", "title":"Test", "dataset_ids":[dataset],
                           "default_dataset":dataset, "editions":[]}],
              "datasets":[{"dataset_id":dataset, "title":"Test", "default_release":root.name,
                           "releases":[{"release_id":root.name,"label":"Test release"}]}]}
    path = tmp_path / "curator.json"
    path.write_text(json.dumps(config))
    monkeypatch.setattr(s3_catalog, "REPOSITORY", tmp_path)
    monkeypatch.setattr(s3_publish, "repository_state", lambda root: RepositoryState("main", COMMIT, True))
    monkeypatch.setattr(s3_publish.platform, "system", lambda: "Linux")
    monkeypatch.setattr(subprocess, "run", lambda args, **kw: subprocess.CompletedProcess(args, 0, "", ""))
    monkeypatch.setattr(s3_catalog, "AwsCliStore", lambda *args: pytest.fail("offline validation touched AWS"))
    assert s3_catalog.main([str(path), "--release", str(root), "--environment", "staging"]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["remote_history_checked"] is False
    assert result["catalog"]["datasets"][0]["releases"][0]["manifest"]["sha256"]
