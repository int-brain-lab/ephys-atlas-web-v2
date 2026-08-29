from __future__ import annotations

import json
from pathlib import Path
import zipfile

import numpy as np
import pytest
from iblatlas.regions import BrainRegions

import ibl_ephys_atlas
from ephys_atlas_builder.bundle import validate_bundle
from ephys_atlas_builder.schema_v1 import SCHEMA_DIR
from ibl_ephys_atlas import Dataset, Source, ValueSemantics


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


def test_public_surface_is_intentionally_small() -> None:
    assert ibl_ephys_atlas.__all__ == [
        "BundleValidationError",
        "Dataset",
        "Feature",
        "Source",
        "ValidationIssue",
        "ValidationReport",
        "ValueSemantics",
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
