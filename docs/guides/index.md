# Guides

Status: reader navigation; the linked release metadata, authoring contract,
and schema remain authoritative.

## Explore data

Use [the viewer guide](using-the-viewer.md) for dataset and feature selection,
linked anatomical navigation, regional and voxel inspection, display controls,
sharing, and downloads. Read [the parcellation guide](parcellations.md) to
understand how Allen, Beryl, and Cosmos affect regional summaries and volume
anatomy overlays.

The application's **Help** action provides a compact Quick Start,
representation-specific guidance, keyboard shortcuts, and an optional guided
walkthrough of the visible interface.

## Author and import data

The supported workflow is:

1. create a `Dataset` with explicit identity, provenance, and value semantics;
2. add Allen regional observations/values, a volume on an explicit Allen CCF
   grid, or both;
3. validate and write one deterministic `.ibl-ephys-atlas.zip` archive;
4. choose **Import local dataset…** in the viewer, review the preview, and
   confirm admission to browser-local storage.

Use the [regional tutorial](../data/CUSTOM_DATA_TUTORIAL.md) for a narrated
first example. The [executable examples](examples.md) cover regional values,
repeated observations, mask and sentinel volumes, and a mixed representation.
The [Python API reference](../reference/python-api.md) provides signatures.

For scientific and transport rules, read the active
[custom authoring and ZIP contract](../data/CUSTOM_DATA_AUTHORING.md). In
particular, authoring never invents an affine, population/QC recipe, mapping, or
missing/outside classification. Synthetic inputs must be labelled as synthetic
and must not be presented as scientific data.

The `ibl-ephys-atlas` distribution is not yet published to PyPI. From a
repository checkout, run examples in the locked builder environment, as shown
on the examples page.
