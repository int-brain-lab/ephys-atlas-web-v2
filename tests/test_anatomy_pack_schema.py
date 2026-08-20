from __future__ import annotations

import copy
import gzip
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import pytest
from jsonschema import Draft202012Validator, FormatChecker, ValidationError


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "schema" / "anatomy-pack-v1"
FIXTURE = ROOT / "fixtures" / "anatomy" / "anatomy-pack-v1"
PROJECTIONS = ("coronal", "sagittal", "horizontal")


def load(path: Path) -> dict:
    return json.loads(path.read_text())


@pytest.fixture(scope="module")
def manifest_schema() -> dict:
    schema = load(SCHEMA / "manifest.schema.json")
    Draft202012Validator.check_schema(schema)
    return schema


@pytest.fixture(scope="module")
def slice_pack_schema() -> dict:
    schema = load(SCHEMA / "slice-pack.schema.json")
    Draft202012Validator.check_schema(schema)
    return schema


@pytest.fixture()
def manifest() -> dict:
    return load(FIXTURE / "manifest.json")


def validate(instance: dict, schema: dict) -> None:
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(instance)


def matrix(values: list[float]) -> np.ndarray:
    result = np.asarray(values, dtype=np.float64).reshape(4, 4)
    assert np.isfinite(result).all()
    return result


def homogeneous(values: list[float]) -> np.ndarray:
    return np.asarray([*values, 1.0], dtype=np.float64)


def test_manifest_and_slice_pack_fixtures_validate(
    manifest: dict, manifest_schema: dict, slice_pack_schema: dict
) -> None:
    validate(manifest, manifest_schema)
    validate(load(FIXTURE / "example-slice-pack.json"), slice_pack_schema)


def test_manifest_requires_25um_left_signed_source(
    manifest: dict, manifest_schema: dict
) -> None:
    for field, invalid in (("resolution_um", 10), ("hemisphere", "both")):
        candidate = copy.deepcopy(manifest)
        candidate["source"][field] = invalid
        with pytest.raises(ValidationError):
            validate(candidate, manifest_schema)

    candidate = copy.deepcopy(manifest)
    candidate["source"]["region_ids"]["left_sign"] = "positive"
    with pytest.raises(ValidationError):
        validate(candidate, manifest_schema)


def test_slice_paths_carry_stable_signed_ids_for_all_mappings(
    slice_pack_schema: dict,
) -> None:
    pack = load(FIXTURE / "example-slice-pack.json")
    paths = [path for slice_ in pack["slices"] for path in slice_["paths"]]
    assert paths
    for path in paths:
        assert set(path["atlas_ids"]) == {"allen", "beryl", "cosmos"}
        assert all(atlas_id < 0 for atlas_id in path["atlas_ids"].values())
        assert "<" not in path["d"] and ">" not in path["d"]

    # Separate Allen boundaries may intentionally collapse to one coarse region.
    assert paths[0]["atlas_ids"]["allen"] != paths[1]["atlas_ids"]["allen"]
    assert paths[0]["atlas_ids"]["beryl"] == paths[1]["atlas_ids"]["beryl"]

    invalid = copy.deepcopy(pack)
    invalid["slices"][0]["paths"][0]["atlas_ids"]["allen"] = 101
    with pytest.raises(ValidationError):
        validate(invalid, slice_pack_schema)


def test_projection_affines_are_finite_inverses_and_match_voxel_view_boxes(
    manifest: dict,
) -> None:
    identity = np.eye(4)
    world_axis = {"ml": 0, "ap": 1, "dv": 2}
    for projection in PROJECTIONS:
        descriptor = manifest["projections"][projection]
        forward = matrix(descriptor["plane_index_to_world_um"])
        inverse = matrix(descriptor["world_to_plane_index"])
        np.testing.assert_allclose(forward @ inverse, identity, atol=1e-12)
        np.testing.assert_allclose(inverse @ forward, identity, atol=1e-12)
        rows, columns = descriptor["slice_shape"]
        assert descriptor["view_box"] == [-0.5, -0.5, columns, rows]

        # The affine input order is [slice_index, u, v, 1]. Only slice_index
        # changes the declared fixed world axis; u/v change the two plane axes.
        fixed_row = world_axis[descriptor["fixed_world_axis"]]
        assert forward[fixed_row, 0] != 0
        assert np.count_nonzero(forward[:3, 0]) == 1
        for input_column, axis in enumerate(descriptor["plane_axes"], start=1):
            axis_row = world_axis[axis]
            assert forward[axis_row, input_column] != 0
            assert np.count_nonzero(forward[:3, input_column]) == 1


def test_cross_projection_world_coordinate_sentinels_are_synchronized(
    manifest: dict,
) -> None:
    coordinate_tolerance_um = manifest["validation"]["coordinate_tolerance_um"]
    recorded_max = manifest["validation"]["sentinel_max_error_um"]
    observed_max = 0.0
    for sentinel in manifest["synchronization_sentinels"]:
        expected_world = homogeneous(sentinel["world_um"])
        reconstructed_worlds = []
        for projection in PROJECTIONS:
            descriptor = manifest["projections"][projection]
            expected_indices = homogeneous(sentinel["projection_indices"][projection])
            actual_indices = matrix(descriptor["world_to_plane_index"]) @ expected_world
            np.testing.assert_allclose(actual_indices, expected_indices, atol=1e-12)
            reconstructed = (
                matrix(descriptor["plane_index_to_world_um"]) @ expected_indices
            )
            reconstructed_worlds.append(reconstructed[:3])
            observed_max = max(
                observed_max,
                float(np.linalg.norm(reconstructed[:3] - expected_world[:3])),
            )
        for left, right in zip(reconstructed_worlds, reconstructed_worlds[1:]):
            np.testing.assert_allclose(left, right, atol=coordinate_tolerance_um)
    assert observed_max <= recorded_max + coordinate_tolerance_um


def test_pack_inventories_are_contiguous_and_deterministic(manifest: dict) -> None:
    all_paths: set[str] = set()
    for projection in PROJECTIONS:
        descriptor = manifest["projections"][projection]
        slice_count = descriptor["slice_count"]
        assert descriptor["pack_sets"]
        for key, pack_set in descriptor["pack_sets"].items():
            depth = int(key)
            assert pack_set["pack_depth"] == depth
            expected_pack_count = math.ceil(slice_count / depth)
            assert len(pack_set["packs"]) == expected_pack_count
            for index, artifact in enumerate(pack_set["packs"]):
                assert artifact["pack_index"] == index
                assert artifact["first_slice_index"] == index * depth
                assert artifact["slice_count"] == min(
                    depth, slice_count - index * depth
                )
                assert artifact["path"] == pack_set["path_template"].format(pack=index)
                assert artifact["compression"] == "gzip"
                assert artifact["path"] not in all_paths
                all_paths.add(artifact["path"])


def test_manifest_may_ship_one_pack_depth_without_duplicating_geometry(
    manifest: dict, manifest_schema: dict
) -> None:
    for projection in PROJECTIONS:
        manifest["projections"][projection]["pack_sets"].pop("32")
    validate(manifest, manifest_schema)

    manifest["projections"]["coronal"]["pack_sets"] = {}
    with pytest.raises(ValidationError):
        validate(manifest, manifest_schema)


def test_validation_metrics_encode_a_passing_full_corpus_gate(manifest: dict) -> None:
    validation = manifest["validation"]
    assert validation["topology_valid"] is True
    assert validation["coverage_valid"] is True
    assert validation["source_slices"] == validation["emitted_slices"]
    assert validation["vertices_after"] <= validation["vertices_before"]
    assert (
        validation["boundary_error_um"]["worst_slice_median"]
        <= validation["boundary_error_um"]["worst_slice_p95"]
    )
    assert (
        validation["boundary_error_um"]["worst_slice_p95"]
        <= validation["boundary_error_um"]["max_upper_bound"]
    )
    assert (
        validation["boundary_error_um"]["max_upper_bound"]
        <= validation["accepted_max_boundary_error_um"]
    )
    assert (
        validation["minimum_eligible_region_iou"]
        >= validation["accepted_minimum_region_iou"]
    )
    assert validation["region_area_threshold_mm2"] == 0.01
    simplification = manifest["provenance"]["simplification"]
    assert 0 < simplification["boundary_sampling_interval_voxels"] <= 1
    assert simplification["boundary_error_bound_um"] >= 0


def test_gzip_pack_bytes_are_reproducible_without_http_content_encoding() -> None:
    raw = (FIXTURE / "example-slice-pack.json").read_bytes()
    first = gzip.compress(raw, compresslevel=9, mtime=0)
    second = gzip.compress(raw, compresslevel=9, mtime=0)
    assert first == second
    assert first[:2] == b"\x1f\x8b"
    assert int.from_bytes(first[4:8], "little") == 0
    assert gzip.decompress(first) == raw
    assert len(hashlib.sha256(first).hexdigest()) == 64
