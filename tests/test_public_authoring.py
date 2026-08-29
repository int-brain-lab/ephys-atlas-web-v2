from __future__ import annotations

import gzip
import json
from pathlib import Path
import zipfile

import numpy as np
import pytest
from iblatlas.regions import BrainRegions
from iblatlas.atlas import AllenAtlas, BrainCoordinates

import ibl_ephys_atlas
from ephys_atlas_builder.bundle import validate_bundle
from ephys_atlas_builder.schema_v1 import SCHEMA_DIR
from ibl_ephys_atlas import (
    AllenCCFGrid,
    Dataset,
    Source,
    ValueSemantics,
    VoxelValidity,
)


def semantics(quantity: str = "test scalar") -> ValueSemantics:
    return ValueSemantics(
        quantity=quantity,
        transform="identity",
        source_population="explicit synthetic observations passing test QC",
        missing_values="non-finite values are missing",
        qc_filter="synthetic test rows only",
    )


def dataset() -> Dataset:
    return Dataset(
        dataset_id="smith_lab_test",
        release_id="2026-08-29",
        title="Synthetic public authoring test",
        created_at="2026-08-29T00:00:00Z",
        sources=[Source.user_input(description="Deterministic synthetic test arrays")],
    )


def authored_fixture_dataset() -> Dataset:
    authored = Dataset(
        dataset_id="authored_regional_fixture",
        release_id="authored-regional-v1",
        title="Public authoring regional fixture",
        description="Deterministic non-scientific fixture generated through the public authoring API.",
        created_at="2026-08-29T00:00:00Z",
        sources=[Source.user_input(description="Deterministic synthetic public-authoring inputs")],
    )
    feature = authored.add_feature(
        id="decision_signal",
        label="Decision signal",
        description="Synthetic repeated regional observations.",
        unit="a.u.",
        semantics=ValueSemantics(
            quantity="synthetic regional test scalar",
            transform="identity",
            source_population="deterministic synthetic observations for contract testing",
            missing_values="non-finite values are missing",
            qc_filter="synthetic fixture rows only",
        ),
    )
    feature.add_region_observations(
        region_ids=[385, -385, 502, 669],
        values=[2.0, 4.0, 5.0, 9.0],
        ontology=BrainRegions(),
        aggregation="mean",
        hemisphere_policy="fold",
    )
    return authored


def read_array(archive: zipfile.ZipFile, path: str, dtype: str) -> np.ndarray:
    return np.frombuffer(archive.read(path), dtype=np.dtype(dtype))


def small_allen_atlas() -> AllenAtlas:
    """Construct an in-memory AllenAtlas test double without atlas I/O."""
    atlas = object.__new__(AllenAtlas)
    atlas.res_um = 50
    atlas.image = np.zeros((2, 3, 4), dtype=np.int16)
    atlas.label = np.ones((2, 3, 4), dtype=np.uint16)
    atlas.dims2xyz = np.asarray([1, 0, 2])
    atlas.xyz2dims = np.asarray([1, 0, 2])
    atlas.bc = BrainCoordinates(
        nxyz=(3, 2, 4),
        xyz0=(-0.005739, 0.0054, 0.000332),
        dxyz=50 * 1e-6 * np.asarray([1, -1, -1]),
    )
    return atlas


def test_public_surface_is_intentionally_small() -> None:
    assert ibl_ephys_atlas.__all__ == [
        "AllenCCFGrid",
        "BundleValidationError",
        "Dataset",
        "Feature",
        "Source",
        "ValidationIssue",
        "ValidationReport",
        "ValueSemantics",
        "VoxelValidity",
    ]


def test_committed_public_authoring_fixture_is_exactly_regenerable(tmp_path: Path) -> None:
    generated = tmp_path / "authored-regional-v1.ibl-ephys-atlas.zip"
    authored_fixture_dataset().write_zip(generated)
    committed = Path("fixtures/authored-regional-v1.ibl-ephys-atlas.zip")
    assert generated.read_bytes() == committed.read_bytes()
    assert validate_bundle(committed)["file_count"] == 8


def test_two_feature_regional_bundle_is_deterministic_aligned_and_valid(tmp_path: Path) -> None:
    regions = BrainRegions()
    authored = dataset()
    first = authored.add_feature(id="already_aggregated", label="Aggregated", semantics=semantics())
    first.add_region_values(
        region_ids=np.asarray([385, 502]),
        values=np.asarray([1.0, 2.0]),
        ontology=regions,
    )
    second = authored.add_feature(id="observations", label="Observations", semantics=semantics("replicates"))
    second.add_region_observations(
        region_ids=np.asarray([385, -385, 669]),
        values=np.asarray([2.0, 4.0, 9.0]),
        ontology=regions,
        aggregation="mean",
        hemisphere_policy="fold",
    )

    one = tmp_path / "one.ibl-ephys-atlas.zip"
    two = tmp_path / "two.ibl-ephys-atlas.zip"
    authored.write_zip(one)
    authored.write_zip(two)
    assert one.read_bytes() == two.read_bytes()
    assert validate_bundle(one, SCHEMA_DIR)["file_count"] == 13

    with zipfile.ZipFile(one) as archive:
        assert archive.namelist() == sorted(archive.namelist())
        assert read_array(archive, "parcellations/allen/region_ids.i32", "<i4").tolist() == [-669, -502, -385]
        aggregated = read_array(archive, "features/already_aggregated/allen.values.f32", "<f4")
        observations = read_array(archive, "features/observations/allen.values.f32", "<f4")
        assert np.isnan(aggregated[0])
        assert aggregated[1:].tolist() == [2.0, 1.0]
        assert observations[0] == 9.0
        assert np.isnan(observations[1])
        assert observations[2] == 3.0
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["provenance"]["recipe"]["presentation"] == "neutral Linear/Full"
        assert manifest["provenance"]["recipe"]["features"][1]["hemisphere_policy"] == "fold"
        for feature_id in ("already_aggregated", "observations"):
            feature = json.loads(archive.read(f"features/{feature_id}/feature.json"))
            assert feature["display"]["regional"] == {
                "distribution_domains": [{"kind": "full"}],
                "preferred_distribution_domain": "full",
                "preferred_scale": "linear",
                "scales": [{"kind": "linear"}],
            }


def test_regional_identity_rules_and_input_freezing(tmp_path: Path) -> None:
    regions = BrainRegions()
    values = np.asarray([7.0])
    authored = dataset()
    feature = authored.add_feature(id="visp", label="VISp", semantics=semantics())
    feature.add_region_values(acronyms=["VISp"], values=values, ontology=regions)
    values[0] = 999.0
    output = tmp_path / "frozen.ibl-ephys-atlas.zip"
    authored.write_zip(output)
    with zipfile.ZipFile(output) as archive:
        assert read_array(archive, "features/visp/allen.values.f32", "<f4").tolist() == [7.0]

    for kwargs, match in [
        ({"region_ids": [385], "acronyms": ["VISp"]}, "exactly one"),
        ({"region_ids": [0]}, "void"),
        ({"region_ids": [997]}, "root"),
        ({"region_ids": [-385]}, "hemisphere_policy='fold'"),
        ({"region_ids": [123456789]}, "unknown Allen"),
        ({"region_ids": [385.5]}, "integral"),
        ({"region_ids": [True]}, "integral numeric"),
        ({"acronyms": ["NOT_A_REGION"]}, "unknown or ambiguous"),
    ]:
        candidate = dataset().add_feature(id="candidate", label="Candidate", semantics=semantics())
        with pytest.raises((TypeError, ValueError), match=match):
            candidate.add_region_values(values=[1.0], ontology=regions, **kwargs)

    duplicate = dataset().add_feature(id="duplicate", label="Duplicate", semantics=semantics())
    with pytest.raises(ValueError, match="one value per folded logical"):
        duplicate.add_region_values(
            region_ids=[385, -385],
            values=[1.0, 2.0],
            ontology=regions,
            hemisphere_policy="fold",
        )


def test_structured_validation_and_atomic_failure(tmp_path: Path) -> None:
    invalid = Dataset(
        dataset_id="Invalid ID",
        release_id="release",
        title="",
        created_at="29 August 2026",
        sources=[],
    )
    report = invalid.validate()
    assert not report.valid
    assert {
        "dataset.id.invalid",
        "dataset.title.required",
        "dataset.created_at.invalid",
        "dataset.sources.required",
        "dataset.features.required",
    } <= {issue.code for issue in report.errors}

    destination = tmp_path / "preserved.ibl-ephys-atlas.zip"
    destination.write_bytes(b"existing archive")
    with pytest.raises(ibl_ephys_atlas.BundleValidationError):
        invalid.write_zip(destination)
    assert destination.read_bytes() == b"existing archive"


def test_observations_require_explicit_mean() -> None:
    feature = dataset().add_feature(id="observations", label="Observations", semantics=semantics())
    with pytest.raises(ValueError, match="explicit mean"):
        feature.add_region_observations(
            region_ids=[385, 385],
            values=[1.0, 2.0],
            ontology=BrainRegions(),
            aggregation="median",
        )


def test_observations_remap_before_weighted_reduced_aggregation(tmp_path: Path) -> None:
    regions = BrainRegions()
    authored = dataset()
    layered = authored.add_feature(id="layered", label="Layered", semantics=semantics())
    layered.add_region_observations(
        region_ids=[593, -593, 821],
        values=[1.0, 3.0, 9.0],
        ontology=regions,
        aggregation="mean",
        hemisphere_policy="fold",
        output_mappings=("Cosmos", "Allen", "Beryl"),
    )
    cosmos_only = authored.add_feature(id="hippocampus", label="Hippocampus", semantics=semantics())
    cosmos_only.add_region_observations(
        region_ids=[502],
        values=[7.0],
        ontology=regions,
        aggregation="mean",
        output_mappings=("Allen", "Cosmos"),
    )

    output = tmp_path / "reduced.ibl-ephys-atlas.zip"
    authored.write_zip(output)
    with zipfile.ZipFile(output) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert [item["id"] for item in manifest["parcellations"]] == ["allen", "beryl", "cosmos"]
        assert read_array(archive, "parcellations/beryl/region_ids.i32", "<i4").tolist() == [-385]
        assert read_array(archive, "parcellations/cosmos/region_ids.i32", "<i4").tolist() == [-1089, -315]
        beryl_metadata = json.loads(archive.read("parcellations/beryl/regions.json"))
        cosmos_metadata = json.loads(archive.read("parcellations/cosmos/regions.json"))
        assert (beryl_metadata[0]["atlas_id"], beryl_metadata[0]["acronym"]) == (-385, "VISp")
        assert [(item["atlas_id"], item["acronym"]) for item in cosmos_metadata] == [
            (-1089, "HPF"),
            (-315, "Isocortex"),
        ]
        beryl_values = read_array(archive, "features/layered/beryl.values.f32", "<f4")
        assert beryl_values[0] == pytest.approx(13.0 / 3.0)
        cosmos_values = read_array(archive, "features/layered/cosmos.values.f32", "<f4")
        assert np.isnan(cosmos_values[0])
        assert cosmos_values[1] == pytest.approx(13.0 / 3.0)
        layered_doc = json.loads(archive.read("features/layered/feature.json"))
        assert [item["parcellation_id"] for item in layered_doc["representations"]["regional"]["parcellations"]] == [
            "allen",
            "beryl",
            "cosmos",
        ]
        hippocampus_doc = json.loads(archive.read("features/hippocampus/feature.json"))
        assert [item["parcellation_id"] for item in hippocampus_doc["representations"]["regional"]["parcellations"]] == [
            "allen",
            "cosmos",
        ]
        recipe = manifest["provenance"]["recipe"]
        assert recipe["output_mappings"] == ["Allen", "Beryl", "Cosmos"]
        assert recipe["mapping_aggregation"] == "observation-level remap before arithmetic mean"


def test_reduced_mapping_requests_fail_closed() -> None:
    regions = BrainRegions()
    for mappings, match in [
        (("Beryl",), "must include Allen"),
        (("Allen", "Beryl", "Beryl"), "duplicate"),
        (("allen",), "unsupported output mapping"),
        (("Allen", "Swanson"), "unsupported output mapping"),
    ]:
        feature = dataset().add_feature(id="candidate", label="Candidate", semantics=semantics())
        with pytest.raises(ValueError, match=match):
            feature.add_region_observations(
                region_ids=[593],
                values=[1.0],
                ontology=regions,
                aggregation="mean",
                output_mappings=mappings,
            )

    aggregated = dataset().add_feature(id="aggregated", label="Aggregated", semantics=semantics())
    with pytest.raises(ValueError, match="already-aggregated.*Allen-only"):
        aggregated.add_region_values(
            region_ids=[593],
            values=[1.0],
            ontology=regions,
            output_mappings=("Allen", "Beryl"),
        )

    root_fallback = dataset().add_feature(id="root", label="Root fallback", semantics=semantics())
    with pytest.raises(ValueError, match="Beryl.*root.*669"):
        root_fallback.add_region_observations(
            region_ids=[669],
            values=[1.0],
            ontology=regions,
            aggregation="mean",
            output_mappings=("Allen", "Beryl"),
        )


def test_allen_ccf_grid_uses_exact_brain_coordinates_and_axis_order() -> None:
    atlas = small_allen_atlas()
    grid = AllenCCFGrid.from_iblatlas(atlas, array_axes=("ap", "ml", "dv"))
    assert grid.reference_space_id == "allen-ccf-2017"
    assert grid.shape == (2, 3, 4)
    assert grid.array_axes == ("ap", "ml", "dv")
    assert grid.index_to_world_um == pytest.approx((
        0.0, 50.0, 0.0, -5739.0,
        -50.0, 0.0, 0.0, 5400.0,
        0.0, 0.0, -50.0, 332.0,
        0.0, 0.0, 0.0, 1.0,
    ), abs=1e-9)
    assert grid.voxel_edge_extent_um == pytest.approx((
        -5764.0, -5614.0,
        5325.0, 5425.0,
        157.0, 357.0,
    ), abs=1e-9)

    reordered = AllenCCFGrid.from_iblatlas(
        atlas, array_axes=("ml", "ap", "dv")
    )
    assert reordered.shape == (3, 2, 4)
    assert reordered.grid_id != grid.grid_id
    shifted = small_allen_atlas()
    shifted.bc = BrainCoordinates(
        nxyz=(3, 2, 4),
        xyz0=(-0.005689, 0.0054, 0.000332),
        dxyz=50 * 1e-6 * np.asarray([1, -1, -1]),
    )
    shifted_grid = AllenCCFGrid.from_iblatlas(
        shifted, array_axes=("ap", "ml", "dv")
    )
    assert shifted_grid.grid_id != grid.grid_id

    scaled = small_allen_atlas()
    scaled.bc = BrainCoordinates(
        nxyz=(3, 2, 4),
        xyz0=(-0.005739, 0.0054, 0.000332),
        dxyz=50 * 1e-6 * np.asarray([2, -1, -1]),
    )
    with pytest.raises(ValueError, match="scaled or non-standard"):
        AllenCCFGrid.from_iblatlas(scaled, array_axes=("ap", "ml", "dv"))
    with pytest.raises(ValueError, match="exact permutation"):
        AllenCCFGrid.from_iblatlas(atlas, array_axes=("ap", "ap", "dv"))
    with pytest.raises(TypeError, match="already-created"):
        AllenCCFGrid.from_iblatlas(object(), array_axes=("ap", "ml", "dv"))
    with pytest.raises(TypeError, match="must be created"):
        AllenCCFGrid()


def test_float32_mask_volume_bundle_is_valid_deterministic_and_valid_only(
    tmp_path: Path,
) -> None:
    grid = AllenCCFGrid.from_iblatlas(
        small_allen_atlas(), array_axes=("ap", "ml", "dv")
    )
    values = np.arange(24, dtype=np.float32).reshape(grid.shape)
    outside = np.zeros(grid.shape, dtype=bool)
    missing = np.zeros(grid.shape, dtype=bool)
    outside[0, 0, 0] = True
    missing[0, 0, 1] = True
    values[0, 0, 0] = 5000.0
    values[0, 0, 1] = np.nan
    authored = dataset()
    authored.add_feature(
        id="mask_volume", label="Mask volume", semantics=semantics("voxels")
    ).add_volume(
        values=values,
        grid=grid,
        validity=VoxelValidity.mask(outside=outside, missing=missing),
        chunk_shape=(1, 2, 3),
    )
    # Input mutation cannot change the authored bundle.
    values[1, 1, 1] = 9999.0
    outside[1, 1, 1] = True

    first = tmp_path / "volume-one.ibl-ephys-atlas.zip"
    second = tmp_path / "volume-two.ibl-ephys-atlas.zip"
    authored.write_zip(first)
    authored.write_zip(second)
    assert first.read_bytes() == second.read_bytes()
    validate_bundle(first, SCHEMA_DIR)

    with zipfile.ZipFile(first) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        recipe = manifest["provenance"]["recipe"]
        assert recipe["id"] == "ibl-ephys-atlas-volume-authoring-v1"
        assert recipe["volume_features"][0]["array_axes"] == ["ap", "ml", "dv"]
        assert recipe["volume_features"][0]["atlas_class"] == "iblatlas.atlas.AllenAtlas"
        assert recipe["volume_features"][0]["resolution_um"] == 50
        assert manifest["provenance"]["sources"][-1]["role"] == "atlas-geometry"
        feature = json.loads(archive.read("features/mask_volume/feature.json"))
        volume = feature["representations"]["volume"]
        assert volume["array"]["dtype"] == "float32"
        assert volume["validity"]["codes"] == {
            "valid": 0, "outside": 1, "missing": 2
        }
        mask_path = volume["validity"]["mask"]["resource"]["path"]
        mask = read_array(archive, f"features/mask_volume/{mask_path}", "u1")
        assert np.bincount(mask, minlength=3).tolist() == [22, 1, 1]
        summary = json.loads(archive.read("features/mask_volume/volume/summary.json"))
        assert (
            summary["valid_voxel_count"],
            summary["outside_voxel_count"],
            summary["missing_voxel_count"],
        ) == (22, 1, 1)
        assert summary["valid_statistics"]["max"] == 23.0
        counts = summary["distribution"]["binnings"][0]["global_counts"]
        assert sum(counts) == 22
        chunk = gzip.decompress(
            archive.read("features/mask_volume/volume/chunks/1.0.0.f32.gz")
        )
        decoded = np.frombuffer(chunk, dtype="<f4").reshape(1, 2, 3)
        assert decoded[0, 1, 1] == 17.0


def test_float16_sentinel_and_mixed_representations_round_trip(tmp_path: Path) -> None:
    atlas = small_allen_atlas()
    grid = AllenCCFGrid.from_iblatlas(atlas, array_axes=("ap", "ml", "dv"))
    values = np.ones(grid.shape, dtype=np.float16)
    submitted_sentinel = 0.1
    encoded_sentinel = np.asarray(submitted_sentinel, dtype=np.float16).item()
    values[0, 0, 0] = encoded_sentinel
    values[0, 0, 1] = np.nan
    authored = dataset()
    feature = authored.add_feature(id="mixed", label="Mixed", semantics=semantics())
    feature.add_region_values(region_ids=[385], values=[3.0], ontology=BrainRegions())
    feature.add_volume(
        values=values,
        grid=grid,
        validity=VoxelValidity.sentinel(outside_value=submitted_sentinel),
        chunk_shape=(2, 3, 4),
    )
    output = tmp_path / "mixed.ibl-ephys-atlas.zip"
    authored.write_zip(output)
    validate_bundle(output, SCHEMA_DIR)
    with zipfile.ZipFile(output) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["provenance"]["recipe"]["id"] == "ibl-ephys-atlas-mixed-authoring-v1"
        feature_document = json.loads(archive.read("features/mixed/feature.json"))
        assert set(feature_document["representations"]) == {"regional", "volume"}
        validity = feature_document["representations"]["volume"]["validity"]
        assert validity["outside_value"] == encoded_sentinel
        summary = json.loads(archive.read("features/mixed/volume/summary.json"))
        assert (
            summary["valid_voxel_count"],
            summary["outside_voxel_count"],
            summary["missing_voxel_count"],
        ) == (22, 1, 1)


def test_volume_inputs_fail_closed_without_conversion_or_inferred_validity() -> None:
    grid = AllenCCFGrid.from_iblatlas(
        small_allen_atlas(), array_axes=("ap", "ml", "dv")
    )
    feature = dataset().add_feature(id="candidate", label="Candidate", semantics=semantics())
    with pytest.raises(TypeError, match="must be created"):
        VoxelValidity()
    with pytest.raises(TypeError, match="float16 or float32"):
        feature.add_volume(
            values=np.zeros(grid.shape, dtype=np.float64),
            grid=grid,
            validity=VoxelValidity.sentinel(outside_value=0.0),
        )
    with pytest.raises(ValueError, match="does not match explicit grid shape"):
        feature.add_volume(
            values=np.zeros((1, 2, 3), dtype=np.float32),
            grid=grid,
            validity=VoxelValidity.sentinel(outside_value=0.0),
        )
    overlap = np.zeros(grid.shape, dtype=bool)
    overlap[0, 0, 0] = True
    with pytest.raises(ValueError, match="must be disjoint"):
        VoxelValidity.mask(outside=overlap, missing=overlap)
    values = np.ones(grid.shape, dtype=np.float32)
    values[0, 0, 0] = np.nan
    with pytest.raises(ValueError, match="non-finite.*classified valid"):
        feature.add_volume(
            values=values,
            grid=grid,
            validity=VoxelValidity.mask(
                outside=np.zeros(grid.shape, dtype=bool),
                missing=np.zeros(grid.shape, dtype=bool),
            ),
        )
    with pytest.raises(ValueError, match="not finite.*dtype"):
        feature.add_volume(
            values=np.ones(grid.shape, dtype=np.float16),
            grid=grid,
            validity=VoxelValidity.sentinel(outside_value=1e100),
        )

    big_endian = np.arange(24, dtype=">f4").reshape(grid.shape)
    endian_feature = dataset().add_feature(
        id="endian", label="Endian", semantics=semantics()
    )
    endian_feature.add_volume(
        values=big_endian,
        grid=grid,
        validity=VoxelValidity.sentinel(outside_value=-1.0),
    )
    assert endian_feature._volume is not None
    assert endian_feature._volume.values.dtype == np.dtype("float32")
