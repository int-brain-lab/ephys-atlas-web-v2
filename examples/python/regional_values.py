#!/usr/bin/env python3
"""Author one tiny, non-scientific already-aggregated regional bundle."""

from __future__ import annotations

import argparse

from iblatlas.regions import BrainRegions

from _synthetic import example_dataset, example_semantics, output_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", help="destination .ibl-ephys-atlas.zip")
    args = parser.parse_args()

    dataset = example_dataset("regional_values", "Synthetic regional values example")
    feature = dataset.add_feature(
        id="regional_signal",
        label="Synthetic regional signal",
        unit="a.u.",
        semantics=example_semantics(
            "synthetic already-aggregated regional scalar",
            "two explicitly selected Allen regions",
        ),
    )
    feature.add_region_values(
        region_ids=[385, 502],
        values=[1.25, 2.5],
        ontology=BrainRegions(),
    )
    dataset.write_zip(output_path(args.output))


if __name__ == "__main__":
    main()
