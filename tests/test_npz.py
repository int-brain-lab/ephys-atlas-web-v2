from pathlib import Path

import numpy as np
from ephys_atlas_builder.npz import inspect_volume_npz


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
    assert main["compressed_bytes"] < main["uncompressed_bytes"]
    assert grid["path"] == "grid_shape.npy"
    assert grid["shape"] == [3]
    assert grid["dtype"] == "int32"
