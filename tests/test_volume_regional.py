from __future__ import annotations

import gzip
import json
from pathlib import Path

import numpy as np
from iblatlas.regions import BrainRegions

from ephys_atlas_builder.validate import validate_release
from ephys_atlas_builder.volume_regional import (
    build_physical_parcellations,
    write_volume_regional_distributions,
)
from ephys_atlas_builder.volumes import (
    VolumeBuildConfig,
    build_volumes_release_from_arrays,
)

ROOT = Path(__file__).resolve().parents[1]
AFFINE = (
    50.0, 0.0, 0.0, -50.0,
    0.0, -50.0, 0.0, 50.0,
    0.0, 0.0, -50.0, 50.0,
    0.0, 0.0, 0.0, 1.0,
)


def _labels() -> np.ndarray:
    regions = BrainRegions()
    by_id = {int(atlas_id): index for index, atlas_id in enumerate(regions.id)}
    return np.asarray(
        [by_id[-8], by_id[8], by_id[-567], by_id[567]],
        dtype="<i4",
    ).reshape(2, 2, 1)


def test_physical_mapping_rows_are_signed_mutually_exclusive_and_deterministic() -> None:
    first = build_physical_parcellations(_labels(), semantics="brainregions-index")
    second = build_physical_parcellations(_labels(), semantics="brainregions-index")
    assert tuple(first) == ("allen", "beryl", "cosmos")
    for parcellation_id in first:
        left = first[parcellation_id]
        right = second[parcellation_id]
        np.testing.assert_array_equal(left.region_ids, right.region_ids)
        np.testing.assert_array_equal(left.voxel_rows, right.voxel_rows)
        assert np.all(left.voxel_rows >= 0)
        assert len(np.unique(left.voxel_rows)) <= len(left.region_ids)
        assert [item["atlas_id"] for item in left.metadata] == left.region_ids.tolist()
    assert first["allen"].region_ids.tolist() == [-567, -8, 8, 567]


def test_regional_matrices_reuse_exact_edges_and_conserve_assigned_voxels(
    tmp_path: Path,
) -> None:
    parcellations = build_physical_parcellations(
        _labels(), semantics="brainregions-index"
    )
    values = np.asarray([0.0, 1.0, 2.0, 3.0], dtype="<f2").reshape(2, 2, 1)
    binnings = [
        {
            "id": "linear-full",
            "edges": [0.0, 2.0, 3.0],
        }
    ]
    companions = write_volume_regional_distributions(
        tmp_path,
        values,
        np.ones(values.shape, dtype=bool),
        binnings,
        parcellations,
        require_complete_assignment=True,
    )
    for companion in companions:
        assert companion["assigned_valid_voxel_count"] == 4
        assert companion["unassigned_valid_voxel_count"] == 0
        descriptor = companion["binnings"][0]["regional_counts"]
        raw = gzip.decompress(
            (tmp_path / descriptor["resource"]["path"]).read_bytes()
        )
        counts = np.frombuffer(raw, dtype="<u4").reshape(descriptor["shape"])
        assert int(counts.sum()) == 4
        assert counts.shape[1] == len(binnings[0]["edges"]) + 1


def test_volume_builder_emits_valid_shared_parcellations_and_companions(
    tmp_path: Path,
) -> None:
    parcellations = build_physical_parcellations(
        _labels(), semantics="brainregions-index"
    )
    values = np.asarray([1.0, 2.0, 3.0, 4.0], dtype="<f2").reshape(2, 2, 1)
    config = VolumeBuildConfig(
        release_id="regional-volume-candidate-v1",
        created_at="2026-09-17T00:00:00Z",
        resolution_um=50,
        reference_space_id="allen-ccf-2017",
        grid_id="synthetic-grid",
        index_to_world_um=AFFINE,
        outside_value=-1.0,
        missing_values="nonfinite",
        layout="orthogonal_slice_packs",
        pack_depth=1,
        histogram_bins=2,
        regional_distribution_selection=(
            ROOT / "docs/data/VOLUME_REGIONAL_DISTRIBUTION_SELECTION.json"
        ),
    )
    release = build_volumes_release_from_arrays(
        tmp_path / "release",
        config,
        {"feature": values},
        [{"role": "canonical-data", "description": "synthetic regional volume"}],
        regional_parcellations=parcellations,
        require_complete_regional_assignment=True,
    )
    validate_release(release, ROOT / "schema/v1")
    manifest = json.loads((release / "manifest.json").read_text())
    assert [item["id"] for item in manifest["parcellations"]] == [
        "allen",
        "beryl",
        "cosmos",
    ]
    summary = json.loads(
        (release / "features/feature/volume/summary.json").read_text()
    )
    assert [item["parcellation_id"] for item in summary["regional_distributions"]] == [
        "allen",
        "beryl",
        "cosmos",
    ]
