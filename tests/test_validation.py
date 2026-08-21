from __future__ import annotations

import json
import math
import shutil
from pathlib import Path

import pytest

from ephys_atlas_builder.io import sha256_file
from ephys_atlas_builder.validate import ValidationError, validate_release


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "schema" / "v0.1"


@pytest.fixture
def release(tmp_path: Path) -> Path:
    target = tmp_path / "golden-v0.1"
    shutil.copytree(ROOT / "fixtures" / "golden-v0.1", target)
    return target


def load(path: Path) -> dict | list:
    return json.loads(path.read_text())


def save(path: Path, value: dict | list) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def feature_path(release: Path) -> Path:
    return release / "features" / "rms_ap" / "feature.json"


def install_slice_packs(release: Path, *, shared_template: bool = False) -> None:
    path = feature_path(release)
    feature = load(path)
    assert isinstance(feature, dict)
    volume = feature["representations"]["volume"]
    volume["layout"] = "orthogonal_slice_packs"
    volume.pop("chunks")
    if shared_template:
        volume["grid"]["shape"] = [4, 4, 4]
    shape = volume["grid"]["shape"]
    axis_order = volume["grid"]["axis_order"]
    dimensions = {
        "coronal": axis_order.index("ap"),
        "sagittal": axis_order.index("ml"),
        "horizontal": axis_order.index("dv"),
    }
    pack_depth = 2
    axes = {}
    for axis, dimension in dimensions.items():
        template = "volume/packs/{pack}.f32" if shared_template else f"volume/packs/{axis}.{{pack}}.f32"
        slice_shape = [shape[index] for index in range(3) if index != dimension]
        axes[axis] = {
            "slice_shape": slice_shape,
            "codec": {"name": "none"},
            "path_template": template,
        }
        pack_count = math.ceil(shape[dimension] / pack_depth)
        for pack in range(pack_count):
            slices = min(pack_depth, shape[dimension] - pack * pack_depth)
            output = path.parent / template.format(pack=pack)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(bytes(4 * slices * math.prod(slice_shape)))
    volume["slice_packs"] = {"pack_depth": pack_depth, "axes": axes}
    save(path, feature)


def test_golden_release_and_orthogonal_slice_packs_validate(release: Path) -> None:
    validate_release(release, SCHEMA)
    install_slice_packs(release)
    validate_release(release, SCHEMA)


def test_duplicate_manifest_ids_are_rejected(release: Path) -> None:
    path = release / "manifest.json"
    manifest = load(path)
    assert isinstance(manifest, dict)
    manifest["features"].append(dict(manifest["features"][0]))
    save(path, manifest)
    with pytest.raises(ValidationError, match="duplicate feature id: rms_ap"):
        validate_release(release, SCHEMA)


def test_duplicate_parcellation_ids_are_rejected(release: Path) -> None:
    path = release / "manifest.json"
    manifest = load(path)
    assert isinstance(manifest, dict)
    duplicate = json.loads(json.dumps(manifest["parcellations"][0]))
    duplicate["region_index"]["path"] = "parcellations/duplicate/region_ids.i32"
    duplicate["metadata"] = "parcellations/duplicate/regions.json"
    manifest["parcellations"].append(duplicate)
    save(path, manifest)
    with pytest.raises(ValidationError, match="duplicate parcellation id: allen"):
        validate_release(release, SCHEMA)


def test_feature_display_scale_is_limited_to_supported_color_mappings(release: Path) -> None:
    path = feature_path(release)
    feature = load(path)
    assert isinstance(feature, dict)
    feature["display"] = {"scale": "symlog"}
    save(path, feature)
    with pytest.raises(ValidationError, match="display.scale"):
        validate_release(release, SCHEMA)


@pytest.mark.parametrize(
    "created_at",
    [
        "not-a-date",
        "2026-02-30T00:00:00Z",
        "2026-08-21T24:00:00Z",
        "2026-08-21T00:00:00+25:00",
    ],
)
def test_release_created_at_requires_a_valid_rfc3339_date_time(
    release: Path, created_at: str
) -> None:
    path = release / "manifest.json"
    manifest = load(path)
    assert isinstance(manifest, dict)
    manifest["release"]["created_at"] = created_at
    save(path, manifest)
    with pytest.raises(ValidationError, match="created_at"):
        validate_release(release, SCHEMA)


def test_region_metadata_must_match_dense_index(release: Path) -> None:
    path = release / "parcellations" / "allen" / "regions.json"
    regions = load(path)
    assert isinstance(regions, list)
    regions[1]["atlas_id"] = 999
    save(path, regions)
    with pytest.raises(ValidationError, match="atlas_id mismatch at row 1"):
        validate_release(release, SCHEMA)


def test_regional_value_length_must_match_parcellation(release: Path) -> None:
    path = feature_path(release)
    feature = load(path)
    assert isinstance(feature, dict)
    values = feature["representations"]["regional"]["parcellations"][0]["values"]
    payload = path.parent / values["path"]
    payload.write_bytes(payload.read_bytes()[:12])
    values["shape"] = [3]
    values["bytes"] = 12
    values["sha256"] = sha256_file(payload)
    save(path, feature)
    with pytest.raises(ValidationError, match="regional values shape does not match parcellation allen"):
        validate_release(release, SCHEMA)


def test_regional_representation_must_reference_manifest_parcellation(release: Path) -> None:
    path = feature_path(release)
    feature = load(path)
    assert isinstance(feature, dict)
    feature["representations"]["regional"]["parcellations"][0]["parcellation_id"] = "missing"
    save(path, feature)
    with pytest.raises(ValidationError, match="references unknown parcellation missing"):
        validate_release(release, SCHEMA)


def test_regional_summary_shape_must_match_declared_fields(release: Path) -> None:
    path = release / "features" / "rms_ap" / "allen.statistics.json"
    statistics = load(path)
    assert isinstance(statistics, dict)
    values = statistics["regional_summary"]["values"]
    payload = path.parent / values["path"]
    payload.write_bytes(payload.read_bytes()[:320])
    values["shape"] = [4, 10]
    values["bytes"] = 320
    values["sha256"] = sha256_file(payload)
    save(path, statistics)
    with pytest.raises(ValidationError, match="regional summary shape does not match fields"):
        validate_release(release, SCHEMA)


def test_histogram_edges_must_be_strictly_ordered(release: Path) -> None:
    path = release / "features" / "rms_ap" / "allen.statistics.json"
    statistics = load(path)
    assert isinstance(statistics, dict)
    statistics["histogram"]["edges"][3] = statistics["histogram"]["edges"][2]
    save(path, statistics)
    with pytest.raises(ValidationError, match="histogram edges must be finite and strictly increasing"):
        validate_release(release, SCHEMA)


def test_volume_statistics_reference_must_exist(release: Path) -> None:
    path = feature_path(release)
    feature = load(path)
    assert isinstance(feature, dict)
    feature["representations"]["volume"]["statistics"] = "missing.statistics.json"
    save(path, feature)
    with pytest.raises(ValidationError, match="missing statistics metadata"):
        validate_release(release, SCHEMA)


def test_volume_axis_order_must_name_each_anatomical_axis_once(release: Path) -> None:
    path = feature_path(release)
    feature = load(path)
    assert isinstance(feature, dict)
    feature["representations"]["volume"]["grid"]["axis_order"] = ["ap", "ap", "dv"]
    save(path, feature)
    with pytest.raises(ValidationError, match="unique ap, ml, and dv"):
        validate_release(release, SCHEMA)


def test_nonfinite_volume_geometry_is_rejected(release: Path) -> None:
    path = feature_path(release)
    feature = load(path)
    assert isinstance(feature, dict)
    feature["representations"]["volume"]["grid"]["index_to_world_um"][0] = float("nan")
    save(path, feature)
    with pytest.raises(ValidationError, match="geometry must contain only finite numbers"):
        validate_release(release, SCHEMA)


def test_missing_slice_pack_is_rejected(release: Path) -> None:
    install_slice_packs(release)
    (release / "features" / "rms_ap" / "volume" / "packs" / "coronal.0.f32").unlink()
    with pytest.raises(ValidationError, match="missing coronal slice pack"):
        validate_release(release, SCHEMA)


def test_slice_pack_templates_must_produce_unique_paths(release: Path) -> None:
    install_slice_packs(release, shared_template=True)
    with pytest.raises(ValidationError, match="volume resource path template does not produce unique paths"):
        validate_release(release, SCHEMA)
