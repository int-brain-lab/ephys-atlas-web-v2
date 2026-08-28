# Data sources and release notes

This document records source-of-truth information that constrains the v2 data pipeline. Scientific choices that remain unresolved are tracked in `docs/OPEN_QUESTIONS.md`; implementation agents must not fill them with inferred defaults.

## Ephys Atlas channel features

Current canonical project: `ea_active`.

The private paper repository documents the loading path in:

    paper-ephys-atlas/sources/examples/04_load_channel_features.py

That example uses `ephysatlas.data` from `ibleatools`, resolves/downloads a weekly vintage, and loads feature tables from:

    aggregates/atlas/features/ea_active/<YYYY_Www>/agg_full/

The example currently names:

    PROJECT = 'ea_active'
    VINTAGE = '2025_W28'

The feature list is not assumed stable before submission. The web application, builder, and dataset manifests must therefore be catalog-driven rather than hard-coding a fixed feature enum.

### Raw versus denoised ambiguity

The paper example contains a comment indicating that `load_denoised=False` selects raw features, but its actual `read_features_from_disk(...)` call omits `load_denoised`.

The current `int-brain-lab/ibleatools` implementation in `src/ephysatlas/data.py` defines:

    read_features_from_disk(..., strict=True, load_denoised=True)

and currently loads:

- `raw_ephys_features_denoised.pqt` when `load_denoised=True`;
- `raw_ephys_features.pqt` when `load_denoised=False`.

It also merges channel metadata/labels, derives Allen/Beryl/Cosmos IDs, and applies its validation/outlier handling path.

Therefore the paper-example comment does not establish that the effective example run is raw under the current API. The production release must pass raw/denoised mode explicitly and record it in provenance. See Q1 in `docs/OPEN_QUESTIONS.md`.

During development, `latest` may resolve to the most recent available weekly vintage. The paper-facing release must pin an exact immutable vintage/release and record the relevant source/tool version. See Q2.

## Ephys Atlas encoding volumes

Current canonical source prefix:

    s3://ibl-brain-wide-map-private/aggregates/atlas/encoding_volumes/ea_active/

The current development input, provided on 2026-08-21, is the immutable
`2026_W26` 50 um object:

    s3://ibl-brain-wide-map-private/aggregates/atlas/encoding_volumes/ea_active/2026_W26/brainwide_ephys_atlas_50um.npz

Use the official
[`ibleatools` loading guide](https://int-brain-lab.github.io/ibleatools/how-to/load-encoding-volume.html)
rather than inventing an S3 access path or copying credentials into this
repository.

The documented Python path is `ephysatlas.data.download_encoding_volume` with
a configured `one.api.ONE` instance. Pin both the vintage and resolution
for implementation/release work:

```python
from ephysatlas.data import download_encoding_volume
from one.api import ONE

file_path = download_encoding_volume(
    local_path,
    label="2026_W26",
    res_um=50,
    one=ONE(),
)
```

The guide documents this vintage as a `(228, 264, 160, 41)` float16 array on a
50 um grid. It also states that `ephys_atlas_vol` stores raw, unnormalized
feature values, that `mean_per_feature` and `std_per_feature` are optional
z-scoring metadata and are not pre-applied, and that `0.0` denotes voxels
outside the brain mask. These facts resolve the value-normalization and
outside-brain parts of the geometry review. D043 subsequently fixes the exact
W26 axis-to-CCF mapping, origin/affine, handedness, and voxel-center convention.

The official guide commit
[`fffe0c75810dd1a013a878abcbcf8ef6348a5a21`](https://github.com/int-brain-lab/ibleatools/blob/fffe0c75810dd1a013a878abcbcf8ef6348a5a21/docs/source/how-to/load-encoding-volume.rst)
calls the storage shape `(nx, ny, nz, N_features)` and the main array
`x × y × z × features`. The pinned
[`iblatlas` coordinate implementation](https://github.com/int-brain-lab/iblatlas/blob/52083adf44825d0622a503705e095699a5957587/iblatlas/atlas.py)
defines Allen `x/y/z` as ML/AP/DV and supplies IBL direction/Bregma behavior,
but the audited public material alone did not link the W26 producer to that
complete coordinate object. The repository/scientific owner supplied that
missing authority after linked visual review. The machine-consumable result is
`docs/data/VOLUME_2026_W26_GEOMETRY_SELECTION.json`; do not generalize it to a
different vintage, resolution, or source hash.

The producer/source layout uses files of the form:

    encoding_volumes/{project}/{label}/brainwide_ephys_atlas_{res_um}um.npz

The older `2026_W12` 25 um object remains the input for the committed historical
transport benchmarks. It contains:

- `ephys_atlas_vol` with shape `(456, 528, 320, N)` and float16 values;
- `feature_names`;
- `mean_per_feature` and `std_per_feature`;
- `grid_shape`;
- `res_um = 25`;
- `N = 41` features for that vintage.

A project collaborator recommends using the latest available encoding volumes from this source during development and switching to the public bucket when released. An HTTP object interface is expected to be available.

### Scientific geometry is exact-source authority, not shape inference

Shape/resolution alone remains insufficient to establish a scientific affine
or axis direction. D043 selects the all-forward ML/AP/DV, integer-index
voxel-center transform only for the checksummed W26 object. The browser/schema
requires that explicit geometry rather than inferring it from an NPZ shape.
Q5 independently blocks production transport selection.

### Canonical object versus browser transport

The S3 NPZ is the canonical scientific source, but it is not automatically the optimal browser wire format. Before freezing production transport, measure:

- exact object/file layout;
- HTTP Range support;
- CORS and authentication behavior on the current private bucket and future public bucket;
- bytes/request count required to show one feature/slice;
- decode latency and interaction latency;
- decoded memory/cache cost in target browsers;
- feature-switch cost.

Schema v1 supports a deterministic `chunks3d` reference layout and an
`orthogonal_slice_packs` browser-oriented layout through checksummed explicit
resource indexes. Production selection must come from a real-data benchmark.
See Q5.

If the canonical public object eventually becomes sufficiently feature/slice-addressable and meets the browser budgets, direct consumption remains acceptable under D010. If a web-optimized representation is required, it must be generated deterministically with provenance back to the pinned canonical object.

## Ephys Atlas clusters

The approved launch project is `ibl_neuropixel_brainwide_01`, described by the
current `ibleatools` S3 architecture as the frozen Brain-Wide Map dataset. It
is both an Alyx project/cohort name and the source namespace:

    aggregates/atlas/projects/ibl_neuropixel_brainwide_01/cells_aggregates/

It is not a release identifier. Snapshot and checksum the exact aggregate
objects before building. Use all rows of `clusters.table.pqt` under the recipe
in `docs/data/CLUSTERS_RECIPE.md`; do not substitute `clusters_good.table.pqt`
or the stricter paper `bwm_query` population. D044 freezes all 14 features and
the original website repository's explicit cluster-unit mapping. The final
catalog remains an explicit checksummed build input in
`docs/data/CLUSTERS_CATALOG_SELECTION.json`; see
`docs/data/CLUSTERS_RELEASE.md` for the validated local release.

## Preserved legacy Brain-Wide Map

The launch `brainwide_map` product is the five-family Beryl-only snapshot used
by the v1 website: choice, feedback, stimulus, wheel speed, and wheel velocity.
Exact byte sizes and hashes are recorded in `docs/data/PROVENANCE.md`. Its
generator is pinned to the clean v1 website commit
`1d908bea095be2616a750d939d143f3b4db2a641`. Preserve these inputs and semantics
as legacy data; do not describe the resulting release as regenerated from a
current BWM paper freeze.

## Regional aggregation evidence from v1

The legacy `int-brain-lab/ephys-atlas-web/make_ephys.py` provides useful historical aggregation semantics:

- finite/group statistics include mean, median, population standard deviation (`ddof=0`), min, max, count, uncertainty, and histograms;
- regional feature buckets historically defaulted to mean;
- atlas region IDs were grouped after excluding void/root in the legacy preparation path;
- hierarchical remapping summed counts/histogram bins and averaged other statistics;
- legacy histograms used 50 bins with a global range based on a 0.02 quantile convention.

This is evidence, not automatic authority for the v2 scientific population/QC recipe. Production choices still require explicit sign-off and provenance.

## Vintage policy

`ea_active` is expected to be recomputed before submission. Therefore:

- development/staging may follow a mutable `latest` alias;
- feature catalogs must tolerate additions/removals between vintages;
- published releases are immutable;
- the paper release pins exact source vintage(s);
- manifests/provenance record source project, vintage/label, source object(s)/hashes where practical, scientific recipe inputs, and builder version/command.

## Known references

- `int-brain-lab/ibleatools`, `src/ephysatlas/data.py`
- `int-brain-lab/ibleatools`, S3 architecture/how-to documentation
- private paper repository, `sources/examples/04_load_channel_features.py`
- private paper encoding-volume documentation/source examples
- legacy `int-brain-lab/ephys-atlas-web/make_ephys.py`

## Active validation tasks

See `docs/IMPLEMENTATION_PLAN.md` for execution order. The highest-value source-validation tasks are currently:

1. freeze the paper channel vintage under Q2 and publish the already-validated
   development release to a non-production origin;
2. repeat the completed local `2026_W26` 50 um representative transport
   benchmarks under the eventual production cache/network profile for Q5;
3. run the remaining complete-population distribution audits for owner review
   without inferring Q14 selections;
4. re-test the final S3/CloudFront origin for CORS/Range/cache behavior when available.
