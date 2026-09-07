import json
from pathlib import Path

import pytest

from test_release_preflight import COMMIT, _release
from tools import s3_publish
from tools.release_preflight import RepositoryState


def test_offline_plan_uses_real_preflight_and_never_constructs_aws(tmp_path, monkeypatch, capsys):
    release = _release(tmp_path)
    monkeypatch.setattr(s3_publish, "repository_state", lambda root: RepositoryState("main", COMMIT, True))
    monkeypatch.setattr(s3_publish.platform, "system", lambda: "Linux")
    def forbidden(*args):
        pytest.fail("offline planning touched AWS")
    monkeypatch.setattr(s3_publish, "AwsCliStore", forbidden)
    assert s3_publish.main([str(release), "--environment", "staging"]) == 0
    plan = json.loads(capsys.readouterr().out)
    assert plan["mode"] == "offline-plan"
    assert plan["total_bytes"] > 0
    assert plan["release_id"] == release.name


def test_failed_preflight_and_undeclared_files_never_open_remote_transaction(tmp_path, monkeypatch):
    release = _release(tmp_path)
    def forbidden(*args):
        pytest.fail("invalid release touched AWS")
    monkeypatch.setattr(s3_publish, "AwsCliStore", forbidden)
    monkeypatch.setattr(s3_publish, "repository_state", lambda root: RepositoryState("main", COMMIT, False))
    monkeypatch.setattr(s3_publish.platform, "system", lambda: "Linux")
    args = [str(release), "--environment", "staging", "--apply", "--profile", "test",
            "--confirm-root", s3_publish.Destination("staging").root]
    with pytest.raises(SystemExit):
        s3_publish.main(args)
    monkeypatch.setattr(s3_publish, "repository_state", lambda root: RepositoryState("main", COMMIT, True))
    (release / "private-secret.txt").write_text("must never leave machine")
    with pytest.raises(SystemExit):
        s3_publish.main(args)


def test_apply_requires_exact_destination_confirmation(tmp_path):
    with pytest.raises(SystemExit):
        s3_publish.main([str(tmp_path), "--environment", "production", "--apply", "--profile", "test"])


def test_symlinks_rejected_before_copying(tmp_path):
    root = tmp_path / "release"
    root.mkdir()
    (root / "escape").symlink_to(tmp_path)
    with pytest.raises(ValueError, match="symlinks"):
        with s3_publish.validated_snapshot(root):
            pytest.fail("symlink snapshot was accepted")
