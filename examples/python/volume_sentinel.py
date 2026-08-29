#!/usr/bin/env python3
"""Author one tiny synthetic float16 volume with a sentinel policy."""

from __future__ import annotations

import argparse

import numpy as np

from ibl_ephys_atlas import AllenCCFGrid, VoxelValidity

from _synthetic import example_dataset, example_semantics, output_path, tiny_allen_atlas


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", help="destination .ibl-ephys-atlas.zip")
    args = parser.parse_args()

    atlas = tiny_allen_atlas()
    grid = AllenCCFGrid.from_iblatlas(atlas, array_axes=("ap", "ml", "dv"))
    values = np.linspace(1.0, 2.0, 24, dtype=np.float16).reshape(grid.shape)
    values[0, 0, 0] = np.float16(0.1)
    values[0, 0, 1] = np.nan

    dataset = example_dataset("volume_sentinel", "Synthetic volume-sentinel example")
    feature = dataset.add_feature(
        id="sentinel_volume",
        label="Synthetic sentinel-validity volume",
        unit="a.u.",
        semantics=example_semantics(
            "synthetic voxel scalar", "tiny grid with sentinel and non-finite classes"
        ),
    )
    feature.add_volume(
        values=values,
        grid=grid,
        validity=VoxelValidity.sentinel(outside_value=0.1),
        chunk_shape=(2, 3, 4),
    )
    dataset.write_zip(output_path(args.output))


if __name__ == "__main__":
    main()
