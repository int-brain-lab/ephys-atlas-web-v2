from ephys_atlas_builder import cli


def test_build_channels_omitted_features_use_upstream_catalog(monkeypatch, tmp_path):
    source_root = tmp_path / "source"
    release_root = tmp_path / "releases"
    snapshot = source_root / "ephys_atlas_channels" / "2026_W32"
    snapshot.mkdir(parents=True)
    captured = {}

    monkeypatch.setattr(cli, "resolve_source_release", lambda *_args: "2026_W32")

    def fake_build(source_snapshot, release_dir, config):
        captured.update(
            source_snapshot=source_snapshot,
            release_dir=release_dir,
            config=config,
        )

    monkeypatch.setattr(cli, "build_channels_from_snapshot", fake_build)
    monkeypatch.setattr(cli, "validate_release", lambda *_args: None)

    result = cli.main(
        [
            "build-channels",
            "2026_W32",
            "--release-id",
            "2026_W32-d050-v1",
            "--feature-mode",
            "both",
            "--population",
            "inside",
            "--distribution-selection",
            str(tmp_path / "channels-distribution-selection.json"),
            "--created-at",
            "2026-08-20T11:19:05Z",
            "--ibleatools-commit",
            "ibleatools-pin",
            "--iblatlas-commit",
            "iblatlas-pin",
            "--builder-commit",
            "builder-pin",
            "--source-root",
            str(source_root),
            "--release-root",
            str(release_root),
        ]
    )

    assert result == 0
    assert captured["source_snapshot"] == snapshot
    assert captured["release_dir"] == release_root / "ephys_atlas_channels" / "2026_W32-d050-v1"
    assert captured["config"].features is None
    assert captured["config"].source_release_id == "2026_W32"
    assert captured["config"].distribution_selection == tmp_path / "channels-distribution-selection.json"


def test_build_brainwide_map_uses_explicit_local_sources(monkeypatch, tmp_path):
    source_dir = tmp_path / "legacy"
    release_root = tmp_path / "releases"
    captured = {}

    def fake_build(source, release, config):
        captured.update(source=source, release=release, config=config)

    monkeypatch.setattr(cli, "build_brainwide_map_from_sources", fake_build)
    monkeypatch.setattr(cli, "validate_release", lambda *_args: None)

    result = cli.main(
        [
            "build-brainwide-map",
            "legacy-v1-1d908bea",
            "--release-id",
            "legacy-v1-1d908bea-d050-v1",
            "--created-at",
            "2026-08-23T00:00:00Z",
            "--builder-commit",
            "abcdef0",
            "--source-dir",
            str(source_dir),
            "--distribution-selection",
            str(tmp_path / "bwm-distribution-selection.json"),
            "--release-root",
            str(release_root),
        ]
    )

    assert result == 0
    assert captured["source"] == source_dir
    assert captured["release"] == release_root / "brainwide_map" / "legacy-v1-1d908bea-d050-v1"
    assert captured["config"].source_release_id == "legacy-v1-1d908bea"
    assert captured["config"].generator_commit == cli.BrainwideMapBuildConfig(
        release_id="x", created_at="2026-08-23T00:00:00Z"
    ).generator_commit
