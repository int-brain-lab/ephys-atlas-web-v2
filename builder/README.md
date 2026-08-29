# IBL Ephys Atlas Python package

`ibl-ephys-atlas` provides the public `ibl_ephys_atlas` API for authoring
validated local dataset bundles. The same distribution retains the internal
`ephys_atlas_builder` namespace and `ephys-atlas-data` command used to build
the product's official datasets.

Schema v1 is the sole release contract. Public authoring supports explicit
Allen regional scalar values and observations plus float16/float32 volumes on
a verified Allen CCF grid. It does not publish data, infer scientific
preprocessing choices, or register/resample values.

Start with the repository's
[`CUSTOM_DATA_TUTORIAL.md`](../docs/data/CUSTOM_DATA_TUTORIAL.md), run the
standalone scripts under [`examples/python/`](../examples/python/), or preview
the generated API reference with `just docs-serve` from the repository root.
The package is not yet published to PyPI.
