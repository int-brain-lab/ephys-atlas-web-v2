"""Shared tiny non-scientific inputs for the executable authoring examples."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from iblatlas.atlas import AllenAtlas, BrainCoordinates

from ibl_ephys_atlas import Dataset, Source, ValueSemantics


def example_dataset(example_id: str, title: str) -> Dataset:
    return Dataset(
        dataset_id=f"synthetic_{example_id}",
        release_id="non-scientific-example-v1",
        title=title,
        description=(
            "Tiny deterministic synthetic authoring example. "
            "This bundle is not scientific data."
        ),
        created_at="2026-08-29T00:00:00Z",
        sources=[
            Source.user_input(
                description="Tiny deterministic synthetic values; not scientific data"
            )
        ],
        histogram_bins=8,
    )


def example_semantics(quantity: str, population: str) -> ValueSemantics:
    return ValueSemantics(
        quantity=quantity,
        transform="identity; synthetic values unchanged",
        source_population=population,
        missing_values="explicit example validity policy",
        qc_filter="none; deterministic synthetic example only",
    )


def tiny_allen_atlas() -> AllenAtlas:
    """Return an in-memory synthetic Allen grid without atlas I/O or downloads."""
    atlas = object.__new__(AllenAtlas)
    atlas.res_um = 50
    atlas.image = np.zeros((2, 3, 4), dtype=np.int16)
    atlas.label = np.ones((2, 3, 4), dtype=np.uint16)
    atlas.dims2xyz = np.asarray([1, 0, 2])
    atlas.xyz2dims = np.asarray([1, 0, 2])
    atlas.bc = BrainCoordinates(
        nxyz=(3, 2, 4),
        xyz0=(-0.005739, 0.0054, 0.000332),
        dxyz=50 * 1e-6 * np.asarray([1, -1, -1]),
    )
    return atlas


def output_path(argument: str) -> Path:
    output = Path(argument)
    if not output.name.endswith(".ibl-ephys-atlas.zip"):
        raise ValueError("output path must end with .ibl-ephys-atlas.zip")
    return output
