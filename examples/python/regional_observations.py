#!/usr/bin/env python3
"""Author repeated synthetic Allen observations with reduced mappings."""

from __future__ import annotations

import argparse

from iblatlas.regions import BrainRegions

from _synthetic import example_dataset, example_semantics, output_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", help="destination .ibl-ephys-atlas.zip")
    args = parser.parse_args()

    dataset = example_dataset(
        "regional_observations", "Synthetic repeated regional observations example"
    )
    feature = dataset.add_feature(
        id="repeated_signal",
        label="Synthetic repeated signal",
        unit="a.u.",
        semantics=example_semantics(
            "synthetic observation-level regional scalar",
            "three deterministic rows, including a folded bilateral pair",
        ),
    )
    feature.add_region_observations(
        region_ids=[593, -593, 821],
        values=[1.0, 3.0, 9.0],
        ontology=BrainRegions(),
        aggregation="mean",
        hemisphere_policy="fold",
        output_mappings=("Allen", "Beryl", "Cosmos"),
    )
    dataset.write_zip(output_path(args.output))


if __name__ == "__main__":
    main()
