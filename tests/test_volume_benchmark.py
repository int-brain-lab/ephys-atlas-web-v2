import gzip
import json
import subprocess
import sys
from pathlib import Path

import numpy as np


def test_browser_benchmark_artifacts_preserve_exact_slice_pack_values(tmp_path: Path):
    source = np.arange(20 * 18 * 16 * 2, dtype=np.float16).reshape(20, 18, 16, 2)
    archive = tmp_path / "volume.npz"
    output = tmp_path / "artifacts"
    np.savez_compressed(archive, ephys_atlas_vol=source)
    script = Path(__file__).parents[1] / "benchmarks/rendering/prepare-volume-browser-benchmark.py"

    subprocess.run(
        [
            sys.executable,
            str(script),
            str(archive),
            "--feature-index",
            "1",
            "--feature-id",
            "synthetic",
            "--work-dir",
            str(output),
            "--depth",
            "4",
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    manifest = json.loads((output / "benchmark-manifest.json").read_text())
    layout = manifest["layouts"][0]
    assert layout["shape"] == [20, 18, 16]
    assert layout["axis_order"] == ["ap", "ml", "dv"]
    expected_volume = source[..., 1]
    axis_dimension = {"coronal": 0, "sagittal": 1, "horizontal": 2}
    for descriptor in layout["files"]:
        relative = Path(descriptor["path"])
        axis = relative.parts[1]
        pack = int(relative.stem.split(".")[0])
        dimension = axis_dimension[axis]
        oriented = np.moveaxis(expected_volume, dimension, 0)
        expected = np.ascontiguousarray(oriented[pack * 4 : (pack + 1) * 4])
        payload = gzip.decompress((output / relative).read_bytes())
        assert payload == expected.tobytes()
        assert descriptor["raw_bytes"] == len(payload)
