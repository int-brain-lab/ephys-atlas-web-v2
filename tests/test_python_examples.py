from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import zipfile

import numpy as np
import pytest

from ephys_atlas_builder.bundle import validate_bundle
from ephys_atlas_builder.schema_v1 import SCHEMA_DIR


EXAMPLES = Path(__file__).parents[1] / "examples" / "python"


@pytest.mark.parametrize(
    ("script", "feature_id", "representations"),
    [
        ("regional_values.py", "regional_signal", {"regional"}),
        ("regional_observations.py", "repeated_signal", {"regional"}),
        ("volume_mask.py", "mask_volume", {"volume"}),
        ("volume_sentinel.py", "sentinel_volume", {"volume"}),
        ("mixed_representations.py", "mixed_signal", {"regional", "volume"}),
    ],
)
def test_executable_python_example_builds_independently_valid_bundle(
    tmp_path: Path,
    script: str,
    feature_id: str,
    representations: set[str],
) -> None:
    output = tmp_path / f"{Path(script).stem}.ibl-ephys-atlas.zip"
    subprocess.run(
        [sys.executable, str(EXAMPLES / script), str(output)],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    result = validate_bundle(output, SCHEMA_DIR)
    assert result["file_count"] > 1
    repeated = tmp_path / f"{Path(script).stem}-repeated.ibl-ephys-atlas.zip"
    subprocess.run(
        [sys.executable, str(EXAMPLES / script), str(repeated)],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert repeated.read_bytes() == output.read_bytes()

    with zipfile.ZipFile(output) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["dataset_id"].startswith("synthetic_")
        assert "not scientific data" in manifest["description"].lower()
        assert manifest["provenance"]["sources"][0]["role"] == "user-input"
        feature = json.loads(archive.read(f"features/{feature_id}/feature.json"))
        assert set(feature["representations"]) == representations


def test_reduced_mapping_example_preserves_observation_weighting(tmp_path: Path) -> None:
    output = tmp_path / "reduced.ibl-ephys-atlas.zip"
    subprocess.run(
        [sys.executable, str(EXAMPLES / "regional_observations.py"), str(output)],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    with zipfile.ZipFile(output) as archive:
        beryl = np.frombuffer(
            archive.read("features/repeated_signal/beryl.values.f32"), dtype="<f4"
        )
        assert beryl.tolist() == pytest.approx([13.0 / 3.0])
        manifest = json.loads(archive.read("manifest.json"))
        assert [item["id"] for item in manifest["parcellations"]] == [
            "allen",
            "beryl",
            "cosmos",
        ]


@pytest.mark.parametrize(
    ("script", "feature_id", "validity_kind", "dtype"),
    [
        ("volume_mask.py", "mask_volume", "mask", "float32"),
        ("volume_sentinel.py", "sentinel_volume", "sentinel", "float16"),
    ],
)
def test_volume_examples_preserve_explicit_validity_and_dtype(
    tmp_path: Path,
    script: str,
    feature_id: str,
    validity_kind: str,
    dtype: str,
) -> None:
    output = tmp_path / f"{feature_id}.ibl-ephys-atlas.zip"
    subprocess.run(
        [sys.executable, str(EXAMPLES / script), str(output)],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    with zipfile.ZipFile(output) as archive:
        feature = json.loads(archive.read(f"features/{feature_id}/feature.json"))
        volume = feature["representations"]["volume"]
        assert volume["validity"]["kind"] == validity_kind
        assert volume["array"]["dtype"] == dtype
        summary = json.loads(archive.read(f"features/{feature_id}/volume/summary.json"))
        assert (
            summary["valid_voxel_count"]
            + summary["outside_voxel_count"]
            + summary["missing_voxel_count"]
        ) == summary["total_voxel_count"] == 24
        assert sum(summary["distribution"]["binnings"][0]["global_counts"]) == 22
