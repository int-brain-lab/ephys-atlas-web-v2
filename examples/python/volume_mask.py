#!/usr/bin/env python3
"""Author one tiny synthetic float32 volume with explicit validity masks."""

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
    values = np.arange(24, dtype=np.float32).reshape(grid.shape)
    outside = np.zeros(grid.shape, dtype=bool)
    missing = np.zeros(grid.shape, dtype=bool)
    outside[0, 0, 0] = True
    missing[0, 0, 1] = True
    values[0, 0, 1] = np.nan

    dataset = example_dataset("volume_mask", "Synthetic volume-mask example")
    feature = dataset.add_feature(
        id="mask_volume",
        label="Synthetic mask-validity volume",
        unit="a.u.",
        semantics=example_semantics(
            "synthetic voxel scalar", "explicitly classified tiny voxel grid"
        ),
    )
    feature.add_volume(
        values=values,
        grid=grid,
        validity=VoxelValidity.mask(outside=outside, missing=missing),
        chunk_shape=(1, 2, 3),
    )
    dataset.write_zip(output_path(args.output))


if __name__ == "__main__":
    main()
