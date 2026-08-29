#!/usr/bin/env python3
"""Author one tiny feature with regional and volume representations."""

from __future__ import annotations

import argparse

import numpy as np
from iblatlas.regions import BrainRegions

from ibl_ephys_atlas import AllenCCFGrid, VoxelValidity

from _synthetic import example_dataset, example_semantics, output_path, tiny_allen_atlas


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", help="destination .ibl-ephys-atlas.zip")
    args = parser.parse_args()

    dataset = example_dataset("mixed", "Synthetic mixed-representation example")
    feature = dataset.add_feature(
        id="mixed_signal",
        label="Synthetic mixed signal",
        unit="a.u.",
        semantics=example_semantics(
            "synthetic scalar in two representations",
            "one Allen region and one explicitly classified tiny voxel grid",
        ),
    )
    feature.add_region_values(
        region_ids=[385], values=[3.0], ontology=BrainRegions()
    )

    atlas = tiny_allen_atlas()
    grid = AllenCCFGrid.from_iblatlas(atlas, array_axes=("ap", "ml", "dv"))
    values = np.ones(grid.shape, dtype=np.float32)
    outside = np.zeros(grid.shape, dtype=bool)
    missing = np.zeros(grid.shape, dtype=bool)
    outside[0, 0, 0] = True
    feature.add_volume(
        values=values,
        grid=grid,
        validity=VoxelValidity.mask(outside=outside, missing=missing),
        chunk_shape=(2, 3, 4),
    )
    dataset.write_zip(output_path(args.output))


if __name__ == "__main__":
    main()
