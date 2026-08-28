# Data sources

Status: active compatibility entry point.

Current source, recipe, selection, release, and audit ownership is indexed by
[`data/README.md`](data/README.md). This stable path summarizes the source
families without duplicating their hashes and commands.

## `ephys_atlas_channels`

Canonical source: the weekly `ea_active` channel-feature catalog in current
`ibleatools`/`ephysatlas` storage. Exact raw and denoised Parquet objects are
resolved to an immutable snapshot before building. D020 fixes the variants,
`inside` population, no additional QC/replacement, and left-folded aggregation.
Q2 still controls the final paper vintage.

Authority: [`data/CHANNELS_RECIPE.md`](data/CHANNELS_RECIPE.md). Current real
local evidence: [`data/DEVELOPMENT_RELEASE.md`](data/DEVELOPMENT_RELEASE.md).

## `ephys_atlas_clusters`

Canonical source: all rows from the content-addressed
`ibl_neuropixel_brainwide_01/cells_aggregates/clusters.table.pqt` snapshot.
D038/D044 fix the project, all-row population, 14-feature catalog, units, and
equal-cluster aggregation.

Authority: [`data/CLUSTERS_RECIPE.md`](data/CLUSTERS_RECIPE.md) and the
machine-readable catalog selection it names. Release evidence:
[`data/CLUSTERS_RELEASE.md`](data/CLUSTERS_RELEASE.md).

## `ephys_atlas_volumes`

Canonical implementation source: the private immutable
`ea_active/2026_W26/brainwide_ephys_atlas_50um.npz` object. The official
`ephysatlas.data.download_encoding_volume` path with configured ONE/IBL
credentials is the acquisition method; credentials never enter this repository.
D043 fixes scientific geometry and validity only for its exact byte identity.
Q5 independently controls browser transport.

Authority and acquisition: [`data/VOLUME_IMPLEMENTATION_HANDOFF.md`](data/VOLUME_IMPLEMENTATION_HANDOFF.md).
Source/transport evidence: [`data/VOLUME_2026_W26_EVIDENCE.md`](data/VOLUME_2026_W26_EVIDENCE.md).
Machine selection: [`data/VOLUME_2026_W26_GEOMETRY_SELECTION.json`](data/VOLUME_2026_W26_GEOMETRY_SELECTION.json).

The older W12 25 µm object is historical transport evidence only; it must not
replace the W26 implementation input.

## `brainwide_map`

The launch product is the D038-selected five-family Beryl-only legacy website
snapshot, not a regenerated current paper product. Its source Parquet and Beryl
metadata bytes are checksummed before decode; the pinned v1 generator supplies
the semantics reproduced by equivalence tests.

Authority: [`data/BRAINWIDE_MAP_RECIPE.md`](data/BRAINWIDE_MAP_RECIPE.md).

## `local`

There is no remote scientific source. A local dataset is a user-authored
schema-v1 release whose explicit identities, units, transformations,
aggregation, validity, and provenance are validated before atomic browser
admission. The browser must not manufacture missing scientific metadata.

Authority: D051 and [`data/CUSTOM_DATA_AUTHORING.md`](data/CUSTOM_DATA_AUTHORING.md).

## Shared policies

- Feature catalogs are discovered from pinned sources/selections and manifests,
  never copied into frontend enums.
- Development may resolve `latest` only when the resulting immutable snapshot
  identity is recorded. Paper-facing releases pin exact source vintages.
- A canonical scientific object and its browser transport are distinct; derived
  transports preserve provenance back to the source.
- Historical legacy code is behavioral evidence, not permission to inherit an
  unstated scientific choice.
