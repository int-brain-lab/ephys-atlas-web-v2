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
            "--feature-mode",
            "both",
            "--population",
            "inside",
            "--log-color-feature",
            "rms_ap.raw",
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
    assert captured["release_dir"] == release_root / "ephys_atlas_channels" / "2026_W32"
    assert captured["config"].features is None
    assert captured["config"].log_color_features == ("rms_ap.raw",)
