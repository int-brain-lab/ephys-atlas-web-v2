from __future__ import annotations

import gzip
import json
from pathlib import Path

import numpy as np
import pytest
from ephys_atlas_builder.io import sha256_file, write_json
from ephys_atlas_builder.validate import validate_release
from ephys_atlas_builder.volumes import (
    VolumeBuildConfig,
    build_volumes_from_snapshot,
    build_volumes_release_from_arrays,
)

ROOT = Path(__file__).resolve().parents[1]
AFFINE = (
    0.0,
    0.0,
    -50.0,
    100.0,
    50.0,
    0.0,
    0.0,
    -25.0,
    0.0,
    -50.0,
    0.0,
    200.0,
    0.0,
    0.0,
    0.0,
    1.0,
)


def _config(**overrides) -> VolumeBuildConfig:
    values = {
        "release_id": "synthetic-volume-v1",
        "created_at": "2026-08-24T00:00:00Z",
        "resolution_um": 50,
        "reference_space_id": "allen-ccf-2017",
        "grid_id": "synthetic-50um-grid",
        "index_to_world_um": AFFINE,
        "outside_value": 0.0,
        "missing_values": "nonfinite",
        "layout": "orthogonal_slice_packs",
        "pack_depth": 2,
        "histogram_bins": 4,
    }
    values.update(overrides)
    return VolumeBuildConfig(**values)


def _features() -> dict[str, np.ndarray]:
    values = np.arange(24, dtype=np.float16).reshape(2, 3, 4)
    values[0, 0, 0] = 0
    values[0, 0, 1] = np.nan
    return {"rms_ap": values}


@pytest.mark.parametrize(
    ("layout", "options"),
    [
        ("chunks3d", {"pack_depth": None, "chunk_shape": (1, 2, 3)}),
        ("orthogonal_slice_packs", {"pack_depth": 2, "chunk_shape": None}),
    ],
)
def test_volume_recipe_builds_both_schema_layouts(tmp_path, layout, options):
    release = build_volumes_release_from_arrays(
        tmp_path / layout,
        _config(layout=layout, **options),
        _features(),
        [{"role": "canonical-data", "description": "synthetic volume recipe test"}],
    )
    validate_release(release, ROOT / "schema" / "v1")
    feature = json.loads((release / "features/rms_ap/feature.json").read_text())
    volume = feature["representations"]["volume"]
    assert volume["encoding"]["layout"] == layout
    assert volume["grid"]["index_to_world_um"] == list(AFFINE)
    assert volume["grid"]["voxel_edge_extent_um"] == [
        -75.0,
        125.0,
        -50.0,
        50.0,
        75.0,
        225.0,
    ]
    summary = json.loads((release / "features/rms_ap/volume/summary.json").read_text())
    assert (
        summary["valid_voxel_count"],
        summary["outside_voxel_count"],
        summary["missing_voxel_count"],
    ) == (22, 1, 1)
    assert sum(summary["histogram"]["counts"]) == 22


def test_slice_pack_recipe_is_byte_deterministic_and_preserves_orientation(tmp_path):
    releases = []
    for name in ("a", "b"):
        releases.append(
            build_volumes_release_from_arrays(
                tmp_path / name,
                _config(),
                _features(),
                [{"role": "canonical-data", "description": "determinism test"}],
            )
        )
    paths = sorted(
        path.relative_to(releases[0])
        for path in releases[0].rglob("*")
        if path.is_file()
    )
    assert paths == sorted(
        path.relative_to(releases[1])
        for path in releases[1].rglob("*")
        if path.is_file()
    )
    for relative in paths:
        assert (releases[0] / relative).read_bytes() == (
            releases[1] / relative
        ).read_bytes()

    index = json.loads(
        (releases[0] / "features/rms_ap/volume/resource-index.json").read_text()
    )
    i1 = next(
        pack
        for pack in index["packs"]
        if pack["axis"] == "i1" and pack["first_slice"] == 0
    )
    raw = gzip.decompress(
        (releases[0] / "features/rms_ap" / i1["resource"]["path"]).read_bytes()
    )
    decoded = np.frombuffer(raw, dtype="<f2").reshape(i1["decoded"]["shape"])
    np.testing.assert_array_equal(decoded, np.moveaxis(_features()["rms_ap"], 1, 0)[:2])


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"index_to_world_um": None}, "index_to_world_um"),
        ({"reference_space_id": None}, "reference_space_id"),
        ({"outside_value": None}, "outside_value"),
        ({"missing_values": None}, "missing_values"),
        ({"layout": None}, "layout"),
        ({"pack_depth": None}, "pack_depth"),
    ],
)
def test_volume_recipe_refuses_implicit_scientific_or_transport_choices(
    tmp_path, overrides, message
):
    with pytest.raises(ValueError, match=message):
        build_volumes_release_from_arrays(
            tmp_path / "release",
            _config(**overrides),
            _features(),
            [{"role": "canonical-data", "description": "failure test"}],
        )


def test_snapshot_recipe_verifies_source_identity_and_discovers_features(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    npz = source / "brainwide_ephys_atlas_50um.npz"
    first = _features()["rms_ap"]
    volume = np.stack((first, first + np.float16(1)), axis=-1)
    np.savez_compressed(
        npz,
        ephys_atlas_vol=volume,
        feature_names=np.array(["rms_ap", "polarity"], dtype=object),
        grid_shape=np.array(first.shape, dtype=np.int32),
        res_um=np.array([50], dtype=np.int32),
        mean_per_feature=np.zeros(2, dtype=np.float32),
        std_per_feature=np.ones(2, dtype=np.float32),
    )
    write_json(
        source / "source.json",
        {
            "schema_version": "1.0",
            "dataset_id": "ephys_atlas_volumes",
            "requested_release": "synthetic-volume-v1",
            "resolved_release": "synthetic-volume-v1",
            "project": "ea_active",
            "canonical_source": {"uri": "s3://official/synthetic-volume-v1.npz"},
            "files": [
                {
                    "path": npz.name,
                    "bytes": npz.stat().st_size,
                    "sha256": sha256_file(npz),
                }
            ],
        },
    )
    config = _config(
        features=("polarity",),
        ibleatools_commit="9bfa0623a16bc7a989a6b27a589887641beee0a8",
        iblatlas_commit="52083adf44825d0622a503705e095699a5957587",
        builder_commit="1234567",
    )
    release = build_volumes_from_snapshot(source, tmp_path / "release", config)
    validate_release(release, ROOT / "schema" / "v1")
    manifest = json.loads((release / "manifest.json").read_text())
    assert [feature["id"] for feature in manifest["features"]] == ["polarity"]
    assert manifest["provenance"]["recipe"]["index_to_world_um"] == list(AFFINE)
    command = manifest["provenance"]["builder"]["command"]
    assert "--pack-depth 2" in command
    assert "--feature polarity" in command
    assert "--index-to-world-um 0 0 -50 100" in command
    assert (release / "source.json").read_bytes() == (
        source / "source.json"
    ).read_bytes()


def test_snapshot_recipe_rejects_tampered_source_before_decode(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    npz = source / "brainwide_ephys_atlas_50um.npz"
    npz.write_bytes(b"not an npz")
    write_json(
        source / "source.json",
        {
            "dataset_id": "ephys_atlas_volumes",
            "resolved_release": "synthetic-volume-v1",
            "files": [{"path": npz.name, "bytes": 1, "sha256": "0" * 64}],
        },
    )
    config = _config(
        ibleatools_commit="9bfa0623a16bc7a989a6b27a589887641beee0a8",
        iblatlas_commit="52083adf44825d0622a503705e095699a5957587",
        builder_commit="1234567",
    )
    with pytest.raises(RuntimeError, match="identity mismatch"):
        build_volumes_from_snapshot(source, tmp_path / "release", config)
