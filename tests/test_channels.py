import json
from pathlib import Path

import numpy as np
import pytest

from ephys_atlas_builder.channels import (
    ChannelBuildConfig,
    RegionInfo,
    build_channels_release_from_arrays,
    discover_channel_table_dir,
)
from ephys_atlas_builder.validate import validate_release

ROOT = Path(__file__).resolve().parents[1]


def _inputs():
    features = {
        "rms_ap": np.array([1.0, 2.0, 3.0, 4.0, np.nan, 6.0]),
        "polarity": np.array([-0.8, -0.6, -0.4, -0.2, 0.0, 0.2]),
    }
    ids = {
        "allen": np.array([10, 10, 20, 20, 30, 30], dtype=float),
        "beryl": np.array([1, 1, 2, 2, 3, 3], dtype=float),
        "cosmos": np.array([100, 100, 200, 200, 300, 300], dtype=float),
    }
    metadata = {
        "allen": {
            10: RegionInfo(10, "A10", "Allen 10"),
            20: RegionInfo(20, "A20", "Allen 20"),
            30: RegionInfo(30, "A30", "Allen 30"),
        },
        "beryl": {
            1: RegionInfo(1, "B1", "Beryl 1"),
            2: RegionInfo(2, "B2", "Beryl 2"),
            3: RegionInfo(3, "B3", "Beryl 3"),
        },
        "cosmos": {
            100: RegionInfo(100, "C100", "Cosmos 100"),
            200: RegionInfo(200, "C200", "Cosmos 200"),
            300: RegionInfo(300, "C300", "Cosmos 300"),
        },
    }
    return features, ids, metadata


def _config():
    return ChannelBuildConfig(
        release_id="2026_W12",
        created_at="2026-08-20T00:00:00Z",
        feature_mode="denoised",
        population="inside",
        histogram_bins=8,
    )


def _build(path: Path) -> Path:
    features, ids, metadata = _inputs()
    return build_channels_release_from_arrays(
        path,
        _config(),
        features,
        ids,
        metadata,
        [{"role": "canonical-data", "description": "synthetic channel recipe test"}],
    )


def test_channel_recipe_builds_schema_valid_release(tmp_path):
    release = _build(tmp_path / "release")
    validate_release(release, ROOT / "schema" / "v0.1")

    manifest = json.loads((release / "manifest.json").read_text())
    assert manifest["dataset_id"] == "ephys_atlas_channels"
    assert manifest["provenance"]["recipe"]["feature_mode"] == "denoised"
    assert manifest["provenance"]["recipe"]["population"] == "inside"
    assert manifest["provenance"]["recipe"]["features"] == ["polarity", "rms_ap"]
    assert [item["id"] for item in manifest["parcellations"]] == ["allen", "beryl", "cosmos"]

    values = np.fromfile(release / "features/rms_ap/allen.values.f32", dtype="<f4")
    np.testing.assert_allclose(values, [1.5, 3.5, 6.0])


def test_channel_recipe_is_deterministic(tmp_path):
    a = _build(tmp_path / "a")
    b = _build(tmp_path / "b")
    paths_a = sorted(path.relative_to(a) for path in a.rglob("*") if path.is_file())
    paths_b = sorted(path.relative_to(b) for path in b.rglob("*") if path.is_file())
    assert paths_a == paths_b
    for rel in paths_a:
        assert (a / rel).read_bytes() == (b / rel).read_bytes(), rel


def test_channel_recipe_requires_explicit_scientific_choices():
    with pytest.raises(ValueError, match="feature_mode"):
        ChannelBuildConfig(
            release_id="2026_W12",
            created_at="2026-08-20T00:00:00Z",
            feature_mode="default",
            population="inside",
        ).validate()
    with pytest.raises(ValueError, match="population"):
        ChannelBuildConfig(
            release_id="2026_W12",
            created_at="2026-08-20T00:00:00Z",
            feature_mode="raw",
            population="paper-default",
        ).validate()


def test_discover_channel_table_dir_uses_explicit_feature_mode(tmp_path):
    table = tmp_path / "ea_active" / "2026_W12" / "agg_full"
    table.mkdir(parents=True)
    (table / "channels.pqt").write_bytes(b"")
    (table / "raw_ephys_features.pqt").write_bytes(b"")
    (table / "raw_ephys_features_denoised.pqt").write_bytes(b"")
    assert discover_channel_table_dir(tmp_path, "raw") == table
    assert discover_channel_table_dir(tmp_path, "denoised") == table
