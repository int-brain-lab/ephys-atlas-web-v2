import json
from pathlib import Path
from typing import ClassVar

import numpy as np
import pytest
from ephys_atlas_builder.channels import (
    ChannelBuildConfig,
    RegionInfo,
    _feature_info,
    build_channels_release_from_arrays,
    discover_channel_table_dir,
    fold_region_ids_left,
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
    validate_release(release, ROOT / "schema" / "v1")

    manifest = json.loads((release / "manifest.json").read_text())
    assert manifest["dataset_id"] == "ephys_atlas_channels"
    assert manifest["provenance"]["recipe"]["feature_mode"] == "denoised"
    assert manifest["provenance"]["recipe"]["population"] == "inside"
    assert manifest["provenance"]["recipe"]["features"] == ["polarity", "rms_ap"]
    assert [item["id"] for item in manifest["parcellations"]] == [
        "allen",
        "beryl",
        "cosmos",
    ]

    values = np.fromfile(release / "features/rms_ap/allen.values.f32", dtype="<f4")
    # Region ids are folded left and therefore sorted -30, -20, -10.
    np.testing.assert_allclose(values, [6.0, 3.5, 1.5])
    region_ids = np.fromfile(
        release / "parcellations/allen/region_ids.i32", dtype="<i4"
    )
    np.testing.assert_array_equal(region_ids, [-30, -20, -10])

    feature = json.loads((release / "features/rms_ap/feature.json").read_text())
    assert "no outlier replacement" in feature["value_semantics"]["transform"]
    recipe = manifest["provenance"]["recipe"]
    assert recipe["hemisphere"].startswith("bilateral observations folded onto left")
    assert recipe["outlier_policy"].startswith("preserve source values")


def test_channel_recipe_is_deterministic(tmp_path):
    a = _build(tmp_path / "a")
    b = _build(tmp_path / "b")
    paths_a = sorted(path.relative_to(a) for path in a.rglob("*") if path.is_file())
    paths_b = sorted(path.relative_to(b) for path in b.rglob("*") if path.is_file())
    assert paths_a == paths_b
    for rel in paths_a:
        assert (a / rel).read_bytes() == (b / rel).read_bytes(), rel


def test_channel_recipe_emits_explicit_log_color_defaults(tmp_path):
    features, ids, metadata = _inputs()
    config = ChannelBuildConfig(
        release_id="2026_W12",
        created_at="2026-08-20T00:00:00Z",
        feature_mode="denoised",
        population="inside",
        log_color_features=("rms_ap",),
    )
    release = build_channels_release_from_arrays(
        tmp_path / "release",
        config,
        features,
        ids,
        metadata,
        [{"role": "canonical-data", "description": "display metadata test"}],
    )
    validate_release(release, ROOT / "schema" / "v1")
    rms = json.loads((release / "features/rms_ap/feature.json").read_text())
    polarity = json.loads((release / "features/polarity/feature.json").read_text())
    manifest = json.loads((release / "manifest.json").read_text())
    assert rms["display"] == {"scale": "log"}
    assert "display" not in polarity
    assert manifest["provenance"]["recipe"]["log_color_features"] == ["rms_ap"]


def test_channel_recipe_rejects_unknown_log_color_feature(tmp_path):
    features, ids, metadata = _inputs()
    config = ChannelBuildConfig(
        release_id="2026_W12",
        created_at="2026-08-20T00:00:00Z",
        feature_mode="denoised",
        population="inside",
        log_color_features=("missing",),
    )
    with pytest.raises(ValueError, match="not in the release catalog"):
        build_channels_release_from_arrays(
            tmp_path / "release",
            config,
            features,
            ids,
            metadata,
            [{"role": "canonical-data", "description": "display metadata test"}],
        )


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
    assert discover_channel_table_dir(tmp_path, "both") == table


def test_region_ids_are_folded_left_and_strictly_validated():
    folded = fold_region_ids_left(np.array([10, -10, np.nan, 20.0]))
    np.testing.assert_allclose(folded, [-10, -10, np.nan, -20], equal_nan=True)

    with pytest.raises(ValueError, match="integral"):
        fold_region_ids_left(np.array([10.5]))
    with pytest.raises(ValueError, match="int32"):
        fold_region_ids_left(np.array([float(2**31)]))


def test_channel_recipe_preserves_extreme_source_values(tmp_path):
    features, ids, metadata = _inputs()
    features["alpha_mean"] = np.array([1.0, 100_000.0, 3.0, 4.0, 5.0, 6.0])
    release = build_channels_release_from_arrays(
        tmp_path / "release",
        _config(),
        features,
        ids,
        metadata,
        [{"role": "canonical-data", "description": "outlier preservation test"}],
    )
    summary = np.fromfile(
        release / "features/alpha_mean/allen.summary.f64", dtype="<f8"
    ).reshape(3, -1)
    # -10 is last after left folding. Its arithmetic mean proves 100000 was not
    # silently replaced by the median, as upstream read_features_from_disk does.
    mean_column = 4
    assert summary[-1, mean_column] == pytest.approx(50_000.5)


def test_channel_recipe_promotes_regional_values_that_exceed_float32(tmp_path):
    features, ids, metadata = _inputs()
    features["alpha_mean"] = np.array([1e40, 1e40, 3.0, 4.0, 5.0, 6.0])
    release = build_channels_release_from_arrays(
        tmp_path / "release",
        _config(),
        features,
        ids,
        metadata,
        [{"role": "canonical-data", "description": "float64 promotion test"}],
    )

    feature = json.loads(
        (release / "features/alpha_mean/feature.json").read_text()
    )
    allen = feature["representations"]["regional"]["parcellations"][0]
    assert allen["values"]["dtype"] == "float64"
    assert allen["values"]["resource"]["path"] == "allen.values.f64"
    values = np.fromfile(
        release / "features/alpha_mean/allen.values.f64", dtype="<f8"
    )
    assert np.isfinite(values).all()
    assert values[-1] == pytest.approx(1e40)


def test_both_mode_produces_explicit_variant_catalog(tmp_path):
    features, ids, metadata = _inputs()
    config = ChannelBuildConfig(
        release_id="2026_W12",
        created_at="2026-08-20T00:00:00Z",
        feature_mode="both",
        population="inside",
        features=("rms_ap",),
    )
    variant_values = {
        "rms_ap.raw": features["rms_ap"],
        "rms_ap.denoised": features["rms_ap"] + 1,
    }
    release = build_channels_release_from_arrays(
        tmp_path / "release",
        config,
        variant_values,
        ids,
        metadata,
        [{"role": "canonical-data", "description": "variant test"}],
    )
    manifest = json.loads((release / "manifest.json").read_text())
    assert [feature["id"] for feature in manifest["features"]] == [
        "rms_ap.denoised",
        "rms_ap.raw",
    ]
    for feature_id in ("rms_ap.denoised", "rms_ap.raw"):
        feature = json.loads((release / f"features/{feature_id}/feature.json").read_text())
        assert "(raw)" not in feature["description"]
        assert "(denoised)" not in feature["description"]


def test_snapshot_build_requires_reproducibility_pins():
    with pytest.raises(ValueError, match="reproducibility pins"):
        _config().require_scientific_pins()


def test_channel_feature_metadata_prefers_transformed_then_raw_units():
    class Column:
        description = "Schema description"
        metadata: ClassVar = {"raw_unit": "V", "transformed_unit": "dB rel. V"}

    class Schema:
        columns: ClassVar = {"rms_ap": Column()}

    class Model:
        @staticmethod
        def to_schema():
            return Schema()

    info = _feature_info(Model, "rms_ap", "raw")
    assert info.unit == "dB rel. V"
    assert info.source_column == "rms_ap"
    assert info.variant == "raw"
    assert info.label == "rms ap (raw)"
    assert info.description == "Schema description"
