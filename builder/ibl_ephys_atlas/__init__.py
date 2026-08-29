"""Author validated IBL Ephys Atlas schema-v1 local bundles.

The public workflow is deliberately explicit: describe a :class:`Dataset`, add
one or more scalar :class:`Feature` objects, attach regional observations and/or
an Allen CCF volume, validate, then call :meth:`Dataset.write_zip`.  The result
is a deterministic ``.ibl-ephys-atlas.zip`` archive for browser-local import.

The package serializes already-computed values.  It does not choose scientific
populations, apply QC, register or resample volumes, infer missingness, upload
data, or publish a release.

Regional example::

    from iblatlas.regions import BrainRegions
    from ibl_ephys_atlas import Dataset, Source, ValueSemantics

    dataset = Dataset(
        dataset_id="example_regions",
        release_id="2026-08-30",
        title="Example regional estimates",
        created_at="2026-08-30T00:00:00Z",
        sources=[Source.user_input(description="Explicit example estimates")],
    )
    feature = dataset.add_feature(
        id="estimate",
        label="Estimate",
        unit="a.u.",
        semantics=ValueSemantics(
            quantity="model estimate",
            transform="identity",
            source_population="one estimate per included region",
            missing_values="non-finite estimates are missing",
            qc_filter="caller-selected included fits",
        ),
    )
    feature.add_region_values(
        region_ids=[385, 502],
        values=[1.5, 2.0],
        ontology=BrainRegions(),
    )
    dataset.write_zip("example.ibl-ephys-atlas.zip")

See :class:`AllenCCFGrid` and :class:`VoxelValidity` for the corresponding
explicit volume workflow.
"""

from .model import (
    BundleValidationError,
    Dataset,
    Feature,
    Source,
    ValidationIssue,
    ValidationReport,
    ValueSemantics,
    _authoring_version,
)
from .volume import AllenCCFGrid, VoxelValidity

__all__ = [
    "AllenCCFGrid",
    "BundleValidationError",
    "Dataset",
    "Feature",
    "Source",
    "ValidationIssue",
    "ValidationReport",
    "ValueSemantics",
    "VoxelValidity",
]

__version__ = _authoring_version()
