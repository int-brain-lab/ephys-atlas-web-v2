# Author an Allen regional or volume dataset

Status: runbook for the implemented Allen regional and volume authoring slices.

The `ibl_ephys_atlas` Python API turns explicit Allen-region scalars or an
explicit Allen CCF scalar volume into one validated `.ibl-ephys-atlas.zip`.
The website can preview and store that archive locally without uploading it.

The `ibl-ephys-atlas` distribution has not been published to PyPI yet. From a
repository checkout, install the locked environment once with `just bootstrap`
and run the example with:

```bash
uv run --project builder --locked python author_regions.py
```

## Complete example

Save this as `author_regions.py`:

```python
from pathlib import Path

import numpy as np
from iblatlas.regions import BrainRegions

from ibl_ephys_atlas import Dataset, Source, ValueSemantics


dataset = Dataset(
    dataset_id="smith_lab_decision_signal",
    release_id="2026-08-29",
    title="Regional decision-signal estimates",
    description="Mean fitted coefficient for each represented Allen region.",
    created_at="2026-08-29T00:00:00Z",
    sources=[
        Source.user_input(
            description="Smith lab model coefficients after analysis QC v2"
        )
    ],
)

feature = dataset.add_feature(
    id="decision_signal",
    label="Decision signal",
    description="Fitted decision coefficient summarized over accepted rows.",
    unit="a.u.",
    semantics=ValueSemantics(
        quantity="fitted decision coefficient",
        transform="identity",
        source_population="one row per animal-region fit passing analysis QC v2",
        missing_values="non-finite coefficients are missing observations",
        qc_filter="analysis QC v2",
    ),
)

# Repeated rows are observations, so aggregation must be explicit. Positive
# Allen IDs are non-lateralized logical regions in this example.
feature.add_region_observations(
    region_ids=np.asarray([385, 385, 502], dtype=np.int32),
    values=np.asarray([0.8, 1.2, -0.4], dtype=np.float64),
    ontology=BrainRegions(),
    source_mapping="Allen",
    output_mappings=("Allen", "Beryl", "Cosmos"),
    aggregation="mean",
)

dataset.validate().raise_for_errors()
result = dataset.write_zip(
    Path("smith-decision-signal.ibl-ephys-atlas.zip")
)
print(result["path"], result["sha256"])
```

`write_zip()` builds into temporary storage, validates the complete schema-v1
graph, writes a deterministic root-level ZIP, reopens and validates it, and
only then replaces the requested destination.

## Choose the correct regional method

- Use `add_region_values()` when every input identity already has one scalar.
  Duplicate folded identities are an error.
- Use `add_region_observations(..., aggregation="mean")` when repeated rows are
  observations. Mean is currently the only supported aggregation.
- Supply exactly one of `region_ids` or `acronyms`; the API never guesses the
  identity type from an array dtype.
- Pass an actual `iblatlas.regions.BrainRegions` instance. Unknown identities,
  Allen void `0`, and Allen root `997` are rejected.
- Positive IDs are required by default. For signed left/right source rows, set
  `hemisphere_policy="fold"`; both hemispheres then contribute observations to
  one logical regional value. Independent left/right regional values are not
  supported.

Repeated Allen observations may request `("Allen", "Beryl", "Cosmos")` or a
subset that includes Allen. Each original observation is remapped before mean
aggregation, so reduced values are not means of pre-aggregated Allen means.
If a requested reduced mapping produces root or void, authoring fails rather
than discarding or pooling the row. `add_region_values()` remains Allen-only.
Custom display scales/domains are not yet available; output uses the neutral
Linear/Full presentation.

## Add an explicit volume

Volume authoring requires an already-created `AllenAtlas`; the API does not
instantiate one or hide an atlas download. Supply exact float16 or float32
values and explicit validity:

```python
from iblatlas.atlas import AllenAtlas
from ibl_ephys_atlas import AllenCCFGrid, VoxelValidity

atlas = AllenAtlas(res_um=50)
values = volume.astype(np.float32, copy=False)
grid = AllenCCFGrid.from_iblatlas(atlas, array_axes=("ap", "ml", "dv"))

feature.add_volume(
    values=values,
    grid=grid,
    validity=VoxelValidity.mask(
        outside=atlas.label == 0,
        missing=(atlas.label != 0) & ~np.isfinite(values),
    ),
)
```

The masks must be boolean, shape-matched, and disjoint; no non-finite voxel may
be valid. `VoxelValidity.sentinel(outside_value=...)` is also available when an
explicit finite sentinel owns outside classification. The package does not
transpose, register, resample, normalize, clip, denoise, or silently downcast
the submitted values. Statistics and distributions use valid voxels only.

## Import in the website

1. Open the Dataset picker.
2. Choose **Import local dataset…**.
3. Select `smith-decision-signal.ibl-ephys-atlas.zip`.
4. Review the dataset/release identity, features, representation,
   parcellation, and byte inventory.
5. Choose **Import**. Volume releases select the Volume representation and
   render the declared grid from local resources.

The release receives a visible `Local` badge and persists in this browser's
IndexedDB. The outer ZIP is discarded after admission. A shared URL does not
contain the local data and works on another browser or device only after the
same immutable release has been imported there. **Manage local datasets…**
shows exact per-release bytes and integrity state plus separately labeled
origin-wide quota/persistence estimates. It can verify, delete, and recover by
reimport, but the source arrays and ZIP remain the durable copy.
