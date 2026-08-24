import io
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import numpy as np
from ephys_atlas_builder.npz import (
    extract_last_axis_feature,
    extract_last_axis_features,
    extract_last_axis_nonzero_mask,
    inspect_volume_npz,
)


def test_inspect_volume_npz_reads_headers_without_loading_payloads(tmp_path: Path):
    path = tmp_path / "volume.npz"
    np.savez_compressed(
        path,
        ephys_atlas_vol=np.arange(2 * 3 * 4 * 2, dtype=np.float16).reshape(
            2, 3, 4, 2
        ),
        grid_shape=np.array([2, 3, 4], dtype=np.int32),
    )

    report = inspect_volume_npz(path)

    assert report["path"] == str(path)
    assert report["bytes"] == path.stat().st_size
    assert len(report["sha256"]) == 64
    main, grid = report["members"]
    assert main["path"] == "ephys_atlas_vol.npy"
    assert main["compression"] == "deflate"
    assert main["shape"] == [2, 3, 4, 2]
    assert main["fortran_order"] is False
    assert main["dtype"] == "float16"
    assert main["dtype_descriptor"] == "<f2"
    assert main["compressed_bytes"] < main["uncompressed_bytes"]
    assert grid["path"] == "grid_shape.npy"
    assert grid["shape"] == [3]
    assert grid["dtype"] == "int32"


def test_extract_last_axis_feature_streams_exact_values(tmp_path: Path):
    source = np.arange(2 * 3 * 4 * 3, dtype=np.float16).reshape(2, 3, 4, 3)
    path = tmp_path / "volume.npz"
    output = tmp_path / "feature.npy"
    np.savez_compressed(path, ephys_atlas_vol=source)

    report = extract_last_axis_feature(path, output, 1, block_voxels=5)

    extracted = np.load(output, mmap_mode="r")
    np.testing.assert_array_equal(extracted, source[..., 1])
    assert report["source_shape"] == [2, 3, 4, 3]
    assert report["output_shape"] == [2, 3, 4]
    assert report["dtype"] == "float16"
    assert report["dtype_descriptor"] == "<f2"
    assert report["feature_index"] == 1


def test_extract_last_axis_features_streams_multiple_outputs_in_one_pass(tmp_path: Path):
    source = np.arange(2 * 3 * 4 * 4, dtype=np.float16).reshape(2, 3, 4, 4)
    archive = tmp_path / "volume.npz"
    np.savez_compressed(archive, ephys_atlas_vol=source)
    outputs = {3: tmp_path / "last.npy", 1: tmp_path / "middle.npy"}

    reports = extract_last_axis_features(archive, outputs, block_voxels=5)

    assert list(reports) == [3, 1]
    np.testing.assert_array_equal(np.load(outputs[3]), source[..., 3])
    np.testing.assert_array_equal(np.load(outputs[1]), source[..., 1])
    assert reports[3]["source_shape"] == [2, 3, 4, 4]


def test_extract_last_axis_features_rejects_truncated_payload_and_cleans_outputs(
    tmp_path: Path,
):
    buffer = io.BytesIO()
    np.lib.format.write_array(
        buffer, np.arange(24, dtype=np.float16).reshape(2, 3, 4), allow_pickle=False
    )
    payload = buffer.getvalue()[:-2]
    archive = tmp_path / "corrupt.npz"
    with ZipFile(archive, "w", compression=ZIP_DEFLATED) as output:
        output.writestr("ephys_atlas_vol.npy", payload)
    extracted = tmp_path / "feature.npy"

    with np.testing.assert_raises_regex(ValueError, "truncated"):
        extract_last_axis_features(archive, {0: extracted}, block_voxels=5)

    assert not extracted.exists()


def test_extract_last_axis_nonzero_mask_streams_across_features(tmp_path: Path):
    values = np.zeros((2, 3, 4, 3), dtype=np.float16)
    values[0, 1, 2, 1] = 4
    values[1, 2, 3, 2] = np.nan
    archive = tmp_path / "volume.npz"
    output = tmp_path / "mask.npy"
    np.savez_compressed(archive, ephys_atlas_vol=values)

    report = extract_last_axis_nonzero_mask(archive, output, block_voxels=5)
    mask = np.load(output)
    assert mask.dtype == np.bool_
    assert report["output_shape"] == [2, 3, 4]
    assert report["nonzero_count"] == 2
    assert np.array_equal(mask, np.any(values != 0, axis=-1))
