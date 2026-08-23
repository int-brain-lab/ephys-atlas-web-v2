import hashlib
import json
from pathlib import Path

import numpy as np
import pytest

import ephys_atlas_builder.brainwide_map as bwm
from ephys_atlas_builder.brainwide_map import (
    BrainwideMapBuildConfig,
    LegacyFamilyTable,
    build_brainwide_map_release_from_tables,
    verify_legacy_sources,
)
from ephys_atlas_builder.regional_release import RegionInfo
from ephys_atlas_builder.statistics import SUMMARY_FIELDS
from ephys_atlas_builder.validate import validate_release


ROOT = Path(__file__).resolve().parents[1]


def _families():
    families = {}
    for index, family in enumerate(bwm.LEGACY_FAMILY_SOURCES):
        feature = (
            "decoding_significant" if family == "choice" else "decoding_effect"
        )
        values = (
            np.array([0, 1, 1], dtype=np.int64)
            if feature.endswith("significant")
            else np.array([index + 0.123456789, np.nan, index + 2.0])
        )
        families[family] = LegacyFamilyTable(
            region_ids=np.array([-20, -10, -10], dtype=np.int64),
            acronyms=("B20", "B10", "B10"),
            features={feature: values},
        )
    return families


def _metadata():
    return {
        -20: RegionInfo(-20, "B20", "Beryl 20"),
        -10: RegionInfo(-10, "B10", "Beryl 10"),
    }


def _config():
    return BrainwideMapBuildConfig(
        release_id="legacy-v1-1d908bea",
        created_at="2026-08-23T00:00:00Z",
        histogram_bins=8,
        builder_commit="abcdef0",
    )


def _build(path):
    return build_brainwide_map_release_from_tables(
        path,
        _config(),
        _families(),
        _metadata(),
        [
            {
                "role": "canonical-data",
                "description": "synthetic legacy-equivalence fixture",
            }
        ],
    )


def test_brainwide_map_builds_valid_beryl_only_legacy_release(tmp_path):
    release = _build(tmp_path / "release")
    validate_release(release, ROOT / "schema" / "v1")

    manifest = json.loads((release / "manifest.json").read_text())
    assert manifest["dataset_id"] == "brainwide_map"
    assert [entry["id"] for entry in manifest["parcellations"]] == ["beryl"]
    assert "not a regeneration" in manifest["description"]
    assert manifest["provenance"]["recipe"]["significance_encoding"] == (
        "false=0.5, true=1.0"
    )
    assert manifest["provenance"]["sources"][-1]["commit"] == (
        bwm.LEGACY_GENERATOR_COMMIT
    )


def test_brainwide_map_matches_pinned_v1_aggregation_and_significance(tmp_path):
    release = _build(tmp_path / "release")
    values = np.fromfile(
        release / "features/choice_decoding_significant/beryl.values.f32",
        dtype="<f4",
    )
    # Output region order is -20, -10. The pinned generator maps false to 0.5,
    # true to 1.0, then takes the population mean for each lateralized region.
    np.testing.assert_array_equal(values, [0.5, 1.0])

    effect = np.fromfile(
        release / "features/feedback_decoding_effect/beryl.values.f32",
        dtype="<f4",
    )
    np.testing.assert_allclose(effect, [1.12346, 3.0], rtol=1e-6)
    summary = np.fromfile(
        release / "features/feedback_decoding_effect/beryl.summary.f64",
        dtype="<f8",
    ).reshape(2, len(SUMMARY_FIELDS))
    assert summary[1, SUMMARY_FIELDS.index("count")] == 1
    assert summary[1, SUMMARY_FIELDS.index("missing_count")] == 1


def test_brainwide_map_build_is_byte_deterministic(tmp_path):
    a = _build(tmp_path / "a")
    b = _build(tmp_path / "b")
    paths_a = sorted(path.relative_to(a) for path in a.rglob("*") if path.is_file())
    paths_b = sorted(path.relative_to(b) for path in b.rglob("*") if path.is_file())
    assert paths_a == paths_b
    for relative in paths_a:
        assert (a / relative).read_bytes() == (b / relative).read_bytes(), relative


def test_brainwide_map_requires_exact_five_families(tmp_path):
    families = _families()
    families.pop("stimulus")
    with pytest.raises(ValueError, match="exactly the five"):
        build_brainwide_map_release_from_tables(
            tmp_path / "release",
            _config(),
            families,
            _metadata(),
            [{"role": "canonical-data", "description": "test"}],
        )


def test_legacy_sources_are_verified_before_parquet_read(monkeypatch, tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    family_sources = {}
    for family in bwm.LEGACY_FAMILY_SOURCES:
        payload = family.encode()
        (source / f"{family}_bwm.pqt").write_bytes(payload)
        family_sources[family] = (len(payload), hashlib.sha256(payload).hexdigest())
    region_payload = b"regions"
    (source / "beryl_regions.pqt").write_bytes(region_payload)
    monkeypatch.setattr(bwm, "LEGACY_FAMILY_SOURCES", family_sources)
    monkeypatch.setattr(
        bwm,
        "LEGACY_REGION_SOURCE",
        (len(region_payload), hashlib.sha256(region_payload).hexdigest()),
    )

    verified = verify_legacy_sources(source)
    assert set(verified) == {*family_sources, "beryl_regions"}

    (source / "feedback_bwm.pqt").write_bytes(b"same-size-corruption"[:8])
    with pytest.raises(RuntimeError, match="byte-size mismatch|SHA-256 mismatch"):
        verify_legacy_sources(source)


def test_brainwide_map_rejects_an_unpinned_generator():
    config = BrainwideMapBuildConfig(
        release_id="release",
        created_at="2026-08-23T00:00:00Z",
        generator_commit="abcdef0",
    )
    with pytest.raises(ValueError, match="D038-pinned"):
        config.validate()
