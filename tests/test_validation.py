from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
import pytest

from ephys_atlas_builder.io import sha256_file
from ephys_atlas_builder.validate import ValidationError, validate_release


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "schema" / "v1"


@pytest.fixture
def release(tmp_path: Path) -> Path:
    target = tmp_path / "golden-v1"
    shutil.copytree(ROOT / "fixtures" / "golden-v1", target)
    return target


def load(path: Path) -> dict | list:
    return json.loads(path.read_text())


def save(path: Path, value: dict | list) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def feature_path(release: Path) -> Path:
    return release / "features" / "rms_ap" / "feature.json"


def refresh_resource(owner: dict, payload: Path) -> None:
    resource = owner["resource"]
    resource["bytes"] = payload.stat().st_size
    resource["codec"]["decoded_bytes"] = payload.stat().st_size
    resource["sha256"] = sha256_file(payload)


def refresh_feature_reference(release: Path) -> None:
    path = feature_path(release)
    manifest_path = release / "manifest.json"
    manifest = load(manifest_path)
    refresh_resource(manifest["features"][0]["descriptor"], path)
    save(manifest_path, manifest)


def test_golden_release_validates(release: Path) -> None:
    validate_release(release, SCHEMA)


def test_duplicate_manifest_ids_are_rejected(release: Path) -> None:
    path = release / "manifest.json"
    manifest = load(path)
    manifest["features"].append(dict(manifest["features"][0]))
    save(path, manifest)
    with pytest.raises(ValidationError, match="duplicate feature id"):
        validate_release(release, SCHEMA)


def test_duplicate_parcellation_ids_are_rejected(release: Path) -> None:
    path = release / "manifest.json"
    manifest = load(path)
    manifest["parcellations"].append(json.loads(json.dumps(manifest["parcellations"][0])))
    save(path, manifest)
    with pytest.raises(ValidationError, match="duplicate parcellation id"):
        validate_release(release, SCHEMA)


def test_feature_display_symlog_requires_positive_threshold(release: Path) -> None:
    path = feature_path(release)
    feature = load(path)
    feature["display"]["regional"]["scales"][1]["linear_threshold"] = 0
    save(path, feature)
    refresh_feature_reference(release)
    with pytest.raises(ValidationError, match="linear_threshold|greater than"):
        validate_release(release, SCHEMA)


@pytest.mark.parametrize("created_at", ["not-a-date", "2026-02-30T00:00:00Z", "2026-08-21T24:00:00Z"])
def test_release_created_at_requires_rfc3339(release: Path, created_at: str) -> None:
    path = release / "manifest.json"
    manifest = load(path)
    manifest["release"]["created_at"] = created_at
    save(path, manifest)
    with pytest.raises(ValidationError, match="created_at"):
        validate_release(release, SCHEMA)


def test_region_metadata_must_match_dense_index(release: Path) -> None:
    metadata_path = release / "parcellations" / "allen" / "regions.json"
    regions = load(metadata_path)
    regions[1]["atlas_id"] = 999
    save(metadata_path, regions)
    manifest_path = release / "manifest.json"
    manifest = load(manifest_path)
    refresh_resource(manifest["parcellations"][0]["metadata"], metadata_path)
    save(manifest_path, manifest)
    with pytest.raises(ValidationError, match="atlas_id mismatch at row 1"):
        validate_release(release, SCHEMA)


def test_regional_value_length_must_match_parcellation(release: Path) -> None:
    path = feature_path(release)
    feature = load(path)
    values = feature["representations"]["regional"]["parcellations"][0]["values"]
    payload = path.parent / values["resource"]["path"]
    payload.write_bytes(payload.read_bytes()[:12])
    values["shape"] = [3]
    refresh_resource(values, payload)
    save(path, feature)
    refresh_feature_reference(release)
    with pytest.raises(ValidationError, match="regional values shape does not match allen"):
        validate_release(release, SCHEMA)


def test_regional_representation_requires_manifest_parcellation(release: Path) -> None:
    path = feature_path(release)
    feature = load(path)
    feature["representations"]["regional"]["parcellations"][0]["parcellation_id"] = "missing"
    save(path, feature)
    refresh_feature_reference(release)
    with pytest.raises(ValidationError, match="references unknown parcellation missing"):
        validate_release(release, SCHEMA)


def test_regional_summary_shape_matches_fields(release: Path) -> None:
    stats_path = release / "features" / "rms_ap" / "allen.statistics.json"
    statistics = load(stats_path)
    values = statistics["regional_summary"]["values"]
    payload = stats_path.parent / values["resource"]["path"]
    payload.write_bytes(payload.read_bytes()[:320])
    values["shape"] = [4, 10]
    refresh_resource(values, payload)
    save(stats_path, statistics)
    feature_file = feature_path(release)
    feature = load(feature_file)
    stats_ref = feature["representations"]["regional"]["parcellations"][0]["statistics"]
    refresh_resource(stats_ref, stats_path)
    save(feature_file, feature)
    refresh_feature_reference(release)
    with pytest.raises(ValidationError, match="regional summary shape does not match fields"):
        validate_release(release, SCHEMA)


def test_regional_distribution_rows_conserve_each_region_count(release: Path) -> None:
    stats_path = release / "features" / "rms_ap" / "allen.statistics.json"
    statistics = load(stats_path)
    binning = statistics["distribution"]["binnings"][0]
    descriptor = binning["regional_counts"]
    payload = stats_path.parent / descriptor["resource"]["path"]
    counts = np.fromfile(payload, dtype="<u4")
    counts[0] += 1
    counts.tofile(payload)
    refresh_resource(descriptor, payload)
    save(stats_path, statistics)
    feature_file = feature_path(release)
    feature = load(feature_file)
    refresh_resource(
        feature["representations"]["regional"]["parcellations"][0]["statistics"],
        stats_path,
    )
    save(feature_file, feature)
    refresh_feature_reference(release)
    with pytest.raises(ValidationError, match="do not conserve regional finite counts"):
        validate_release(release, SCHEMA)


def test_feature_display_must_match_exact_distribution_availability(release: Path) -> None:
    path = feature_path(release)
    feature = load(path)
    feature["display"]["regional"]["scales"] = [{"kind": "linear"}]
    feature["display"]["regional"]["preferred_scale"] = "linear"
    save(path, feature)
    refresh_feature_reference(release)
    with pytest.raises(ValidationError, match="display availability does not match"):
        validate_release(release, SCHEMA)


def test_display_distribution_spec_matching_normalizes_numeric_spelling(
    release: Path,
) -> None:
    path = feature_path(release)
    feature = load(path)
    # JSON integer and floating-point spellings represent the same raw bounds.
    # Cross-document validation must compare their numeric value, not dumps text.
    feature["display"]["regional"]["distribution_domains"][1]["bounds"] = [0, 3]
    save(path, feature)
    refresh_feature_reference(release)
    validate_release(release, SCHEMA)


def test_volume_summary_grid_identity_must_match(release: Path) -> None:
    summary_path = release / "features" / "rms_ap" / "volume" / "summary.json"
    summary = load(summary_path)
    summary["grid_id"] = "different-grid"
    save(summary_path, summary)
    feature_file = feature_path(release)
    feature = load(feature_file)
    refresh_resource(feature["representations"]["volume"]["summary"], summary_path)
    save(feature_file, feature)
    refresh_feature_reference(release)
    with pytest.raises(ValidationError, match="volume summary grid does not match"):
        validate_release(release, SCHEMA)


def test_missing_explicit_volume_chunk_is_rejected(release: Path) -> None:
    (release / "features" / "rms_ap" / "volume" / "chunks" / "1.1.0.f32").unlink()
    with pytest.raises(ValidationError, match="missing resource"):
        validate_release(release, SCHEMA)


def test_non_v1_schema_directory_is_rejected(release: Path, tmp_path: Path) -> None:
    other_schema = tmp_path / "other-schema"
    other_schema.mkdir()
    with pytest.raises(ValidationError, match="schema v1 is the only supported"):
        validate_release(release, other_schema)
