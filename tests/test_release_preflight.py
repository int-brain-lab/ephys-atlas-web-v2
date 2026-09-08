import json
from pathlib import Path

import pytest
from ephys_atlas_builder.channels import (
    ChannelBuildConfig,
    build_channels_release_from_arrays,
)
from test_channels import _inputs

from tools.release_preflight import (
    PreflightError,
    RepositoryState,
    check_release,
    check_staging_benchmark_release,
)

COMMIT = "a" * 40


def _release(tmp_path: Path) -> Path:
    features, ids, metadata = _inputs()
    release = tmp_path / "canonical-v1"
    build_channels_release_from_arrays(
        release,
        ChannelBuildConfig(
            release_id=release.name,
            created_at="2026-09-04T00:00:00Z",
            feature_mode="both",
            population="inside",
            builder_commit=COMMIT,
        ),
        features,
        ids,
        metadata,
        [{"role": "canonical-data", "description": "test", "release": "2026_W32"}],
    )
    manifest_path = release / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["provenance"]["builder"]["environment"]["operating_system"] = "linux"
    manifest_path.write_text(json.dumps(manifest))
    return release


def _rename_release(release: Path, release_id: str) -> Path:
    manifest_path = release / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["release"]["release_id"] = release_id
    manifest_path.write_text(json.dumps(manifest))
    renamed = release.with_name(release_id)
    release.rename(renamed)
    return renamed


def test_accepts_valid_linux_main_release(tmp_path):
    release = _release(tmp_path)
    check_release(
        release,
        repo=RepositoryState(branch="main", commit=COMMIT, clean=True),
        host_os="Linux",
    )


@pytest.mark.parametrize(
    ("release_id", "repo", "host_os", "message"),
    [
        ("canonical-v1", RepositoryState("main", COMMIT, True), "Darwin", "must run on Linux"),
        ("canonical-v1", RepositoryState("work", COMMIT, True), "Linux", "requires main"),
        ("canonical-v1", RepositoryState("main", COMMIT, False), "Linux", "clean tracked"),
        ("canonical-v1", RepositoryState("main", "b" * 40, True), "Linux", "builder commit"),
        ("local-preview-v1", RepositoryState("main", COMMIT, True), "Linux", "local release"),
    ],
)
def test_rejects_noncanonical_conditions(tmp_path, release_id, repo, host_os, message):
    release = _release(tmp_path)
    if release_id != release.name:
        release = _rename_release(release, release_id)
    with pytest.raises(PreflightError, match=message):
        check_release(release, repo=repo, host_os=host_os)


def test_staging_benchmark_accepts_candidate_with_canonical_build_guards(tmp_path):
    release = _rename_release(_release(tmp_path), "canonical-candidate-depth4")
    check_staging_benchmark_release(
        release,
        repo=RepositoryState(branch="main", commit=COMMIT, clean=True),
        host_os="Linux",
    )
    with pytest.raises(PreflightError, match="cannot be published"):
        check_release(
            release,
            repo=RepositoryState(branch="main", commit=COMMIT, clean=True),
            host_os="Linux",
        )


@pytest.mark.parametrize(
    ("release_id", "repo", "host_os", "message"),
    [
        ("canonical-v1", RepositoryState("main", COMMIT, True), "Linux", "candidate identity"),
        ("local-preview-candidate", RepositoryState("main", COMMIT, True), "Linux", "local preview"),
        ("canonical-candidate", RepositoryState("main", COMMIT, False), "Linux", "clean tracked"),
        ("canonical-candidate", RepositoryState("main", COMMIT, True), "Darwin", "must run on Linux"),
    ],
)
def test_staging_benchmark_rejects_noncanonical_conditions(
    tmp_path, release_id, repo, host_os, message
):
    release = _rename_release(_release(tmp_path), release_id)
    with pytest.raises(PreflightError, match=message):
        check_staging_benchmark_release(release, repo=repo, host_os=host_os)
