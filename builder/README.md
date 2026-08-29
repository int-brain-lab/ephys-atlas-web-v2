# IBL Ephys Atlas Python package

`ibl-ephys-atlas` provides the public `ibl_ephys_atlas` API for authoring
validated local dataset bundles. The same distribution retains the internal
`ephys_atlas_builder` namespace and `ephys-atlas-data` command used to build
the product's official datasets.

Schema v1 is the sole release contract. Public authoring currently supports
explicit Allen regional scalar values and observations; it does not publish
data or infer scientific preprocessing choices.
