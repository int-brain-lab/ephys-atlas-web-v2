import json
from pathlib import Path

import pytest

from ephys_atlas_builder.channels import ChannelBuildConfig
from tools.release_preflight import PreflightError, RepositoryState, check_release

from test_channels import _inputs
from ephys_atlas_builder.channels import build_channels_release_from_arrays


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
        manifest_path = release / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["release"]["release_id"] = release_id
        manifest_path.write_text(json.dumps(manifest))
        renamed = release.with_name(release_id)
        release.rename(renamed)
        release = renamed
    with pytest.raises(PreflightError, match=message):
        check_release(release, repo=repo, host_os=host_os)
