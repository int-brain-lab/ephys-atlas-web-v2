import json

import pytest
from test_release_preflight import COMMIT, _release, _rename_release

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


def test_offline_staging_benchmark_plan_preserves_candidate_and_skips_indexes(
    tmp_path, monkeypatch, capsys
):
    release = _rename_release(_release(tmp_path), "canonical-candidate-depth4")
    monkeypatch.setattr(
        s3_publish, "repository_state", lambda root: RepositoryState("main", COMMIT, True)
    )
    monkeypatch.setattr(s3_publish.platform, "system", lambda: "Linux")
    monkeypatch.setattr(
        s3_publish, "AwsCliStore", lambda *args: pytest.fail("offline planning touched AWS")
    )
    assert s3_publish.main(
        [str(release), "--environment", "staging", "--staging-benchmark"]
    ) == 0
    plan = json.loads(capsys.readouterr().out)
    assert plan["mode"] == "offline-staging-benchmark-plan"
    assert plan["publication_scope"] == "staging-benchmark"
    assert plan["release_id"] == "canonical-candidate-depth4"
    assert plan["aliases"] == []
    assert plan["dataset_index_changed"] is False
    assert plan["catalog_changed"] is False


@pytest.mark.parametrize(
    "arguments",
    [
        ["--environment", "production", "--staging-benchmark"],
        ["--environment", "staging", "--staging-benchmark", "--alias", "latest"],
    ],
)
def test_staging_benchmark_cli_rejects_production_and_aliases(tmp_path, arguments):
    with pytest.raises(SystemExit):
        s3_publish.main([str(tmp_path), *arguments])


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
    with pytest.raises(ValueError, match="symlinks"), s3_publish.validated_snapshot(root):
        pytest.fail("symlink snapshot was accepted")
