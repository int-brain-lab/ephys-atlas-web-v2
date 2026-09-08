import json

import pytest
from test_release_preflight import COMMIT, _release, _rename_release

from tools import s3_publish
from tools.release_preflight import RepositoryState


def test_publication_store_selects_the_requested_apply_transport(monkeypatch):
    destination = s3_publish.Destination("production")
    cli = object()
    sdk = object()
    monkeypatch.setattr(s3_publish, "AwsCliStore", lambda *args: cli)
    from ibl_ephys_atlas_publish import s3_sdk
    monkeypatch.setattr(s3_sdk, "AwsSdkStore", lambda *args: sdk)
    assert s3_publish.publication_store(destination, "ibl-atlas", "cli") is cli
    assert s3_publish.publication_store(destination, "ibl-atlas", "sdk") is sdk
    with pytest.raises(ValueError, match="transport"):
        s3_publish.publication_store(destination, "ibl-atlas", "other")


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


def _volume_candidate(release):
    manifest_path = release / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["dataset_id"] = "ephys_atlas_volumes"
    manifest_path.write_text(json.dumps(manifest))
    return _rename_release(release, "2026_W26-candidate-depth4")


def test_offline_direct_benchmark_plan_uses_production_and_skips_indexes(
    tmp_path, monkeypatch, capsys
):
    release = _volume_candidate(_release(tmp_path))
    monkeypatch.setattr(
        s3_publish, "repository_state", lambda root: RepositoryState("main", COMMIT, True)
    )
    monkeypatch.setattr(s3_publish.platform, "system", lambda: "Linux")
    monkeypatch.setattr(
        s3_publish, "AwsCliStore", lambda *args: pytest.fail("offline planning touched AWS")
    )
    assert s3_publish.main(
        [str(release), "--environment", "production", "--direct-benchmark"]
    ) == 0
    plan = json.loads(capsys.readouterr().out)
    assert plan["mode"] == "offline-direct-benchmark-plan"
    assert plan["publication_scope"] == "direct-origin-benchmark"
    assert plan["dataset_id"] == "ephys_atlas_volumes"
    assert plan["aliases"] == []
    assert plan["dataset_index_changed"] is False
    assert plan["catalog_changed"] is False


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
        ["--environment", "staging", "--direct-benchmark"],
        ["--environment", "production", "--direct-benchmark", "--alias", "latest"],
        ["--environment", "production", "--staging-benchmark", "--direct-benchmark"],
    ],
)
def test_benchmark_cli_rejects_wrong_environment_aliases_and_combined_modes(tmp_path, arguments):
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


@pytest.mark.parametrize("benchmark", [[], ["--direct-benchmark"]])
def test_apply_requires_exact_destination_confirmation(tmp_path, benchmark):
    with pytest.raises(SystemExit):
        s3_publish.main([
            str(tmp_path), "--environment", "production", *benchmark,
            "--apply", "--profile", "test",
        ])
    with pytest.raises(SystemExit):
        s3_publish.main([
            str(tmp_path), "--environment", "production", *benchmark,
            "--apply", "--profile", "test",
            "--confirm-root", s3_publish.Destination("staging").root,
        ])


def test_symlinks_rejected_before_copying(tmp_path):
    root = tmp_path / "release"
    root.mkdir()
    (root / "escape").symlink_to(tmp_path)
    with pytest.raises(ValueError, match="symlinks"), s3_publish.validated_snapshot(root):
        pytest.fail("symlink snapshot was accepted")
