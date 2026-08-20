from pathlib import Path

import numpy as np
from ephys_atlas_builder.npz import extract_last_axis_feature, inspect_volume_npz


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
