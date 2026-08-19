# Launch dataset provenance

This records what is authoritative today and what remains scientifically
unresolved. Repository commits below are the current states inspected on
2026-08-19; a production release must pin the exact commits and source object
checksums used for that release rather than inheriting these moving refs.

D010-D012 apply throughout: `ea_active` S3 products are the scientific authority
for Ephys Atlas channels/volumes; manifests are feature-catalog driven; development
may follow `latest`, while the paper release pins exact immutable source vintages.

## `ephys_atlas_channels`

**Authoritative published source:** current `int-brain-lab/ibleatools`
(`ephysatlas`, not the historical `ephys_atlas` package vendored in the private
paper repository). Current inspected commit:
`9bfa0623a16bc7a989a6b27a589887641beee0a8`.

Canonical project: `ea_active`.

Published source layout:

    aggregates/atlas/features/ea_active/<YYYY_Www>/agg_full/
      raw_ephys_features_denoised.pqt
      raw_ephys_features.pqt
      channels.pqt
      channels_labels.pqt

The private paper example `sources/examples/04_load_channel_features.py` uses
this current external `ephysatlas.data` path. `download_tables()` downloads the
weekly artifacts; `read_features_from_disk()` merges feature/channel information
and maps XYZ to Allen/Cosmos/Beryl ids. Current aggregation code in
`ephysatlas.aggregation` aggregates snippet-level feature outputs by
`(pid, channel)` and produces the raw and denoised parquet tables.

The feature list may change before submission. No release/frontend contract may
hard-code a fixed feature enum: the immutable manifest is the catalog for that
vintage, including feature ids, metadata, ordering and available
representations.

Reproducible v2 path:

1. resolve a weekly label to an immutable input snapshot;
2. download the exact parquet inputs and record their SHA-256 digests;
3. pin the `ibleatools` commit and the builder recipe;
4. explicitly select raw vs denoised source columns, QC/inclusion population,
   parcellation, and regional summary in a build spec;
5. discover the feature catalog from the selected source/build recipe rather
   than a compiled frontend list;
6. build v2 regional/statistics artifacts without recomputing raw ephys.

**Do not guess:** raw vs denoised features; which PIDs/snippets define the
vintage; QC/exclusion rules; whether outlier treatment from
`read_features_from_disk()` is intended for the web release; feature units when
not explicit in the scientific schema; primary regional summary (mean vs median
or another statistic).

## `ephys_atlas_clusters`

**Authoritative published source:** current `ibleatools` project aggregates:

    aggregates/atlas/projects/{project}/cells_aggregates/
      clusters.table.pqt
      clusters_good.table.pqt
      clusters.acgs_log.npy
      acgs_log.times.npy
      clusters.waveforms_peak.npy
      clusters_good.stpc.npy
      clusters_good.stlfp.npy

`download_cells_features()` and `read_cells_features()` are the current access
APIs. Cell-level algorithms live in `ephysatlas.cells`.

Unlike channel/volume data, this project path is not visibly vintage-labelled.
A v2 immutable release therefore snapshots and checksums the exact source
objects (or should use an S3 object version if publication infrastructure makes
one available). The provisional puller assigns a content-derived snapshot id.

**Do not guess:** all clusters vs `clusters_good`; the intended project;
exact QC criterion (including current relaxed-RP alternatives); which scalar
columns become web features; whether waveform/ACG/STPC/STLFP arrays are launch
features or only downloads; source-object versioning policy.

## `ephys_atlas_volumes`

**Canonical scientific source:** weekly `ea_active` object in the current private
IBL bucket:

    s3://ibl-brain-wide-map-private/aggregates/atlas/encoding_volumes/ea_active/<YYYY_Www>/brainwide_ephys_atlas_25um.npz

The documented `2026_W12` vintage contains `ephys_atlas_vol` with shape
`(456, 528, 320, 41)` and float16 values, feature names, per-feature mean/std,
grid shape, and 25 um resolution.

The private paper repository resolves one previous ambiguity explicitly: the
stored prediction values are **not normalized**. `mean_per_feature` and
`std_per_feature` are provided only for optional z-scoring. The web builder must
therefore not apply `value * std + mean` as a denormalization step.

The current v1 conversion tool establishes another behavioral fact: its website
payload does not assume the NPZ axis order from shape alone; it checks against
the Allen atlas, transposes for the current file, and masks outside-brain voxels.
Those operations are behavioral evidence, not a substitute for scientific
geometry metadata.

The inspected public `ibleatools` and private paper archive expose the NPZ and
loaders but not the script that generated this exact published NPZ. Until that
producer is identified, the NPZ itself is the canonical v2 input snapshot and
its SHA-256 must be recorded.

`docs/data/VOLUME_HTTP_VALIDATION.md` records an empirical HTTP validation. The
current private object is not anonymously readable; the volume prefix is not yet
mirrored in the public IBL bucket; current public IBL objects support byte ranges
but not browser CORS; and the NPZ's monolithic 4-D layout is unsuitable
for efficient incremental feature/slice access. Therefore the current v0.1 web
transport is a deterministic derived per-feature chunked representation, with
provenance back to the pinned NPZ. This must be re-evaluated if the future public
canonical artifact or CDN layout changes.

Development `latest` is resolved from the encoding-volume prefix itself. It must
not reuse the channel-feature latest label because the two catalogs may have
different vintages. The paper release pins an exact volume vintage.

**Do not guess:** scientific axis directions/origin/affine from the `x/y/z`
labels alone; outside-brain semantics; model/training commit and export recipe
that produced the NPZ.

## `brainwide_map`

The current `int-brain-lab/paper-brain-wide-map` repository (inspected commit
`118fc36cb3602934466ad2c6087c2b3b441f9f1f`) provides paper selection logic,
fixed `bwm_query` freezes, aggregate-table downloads, checksums, and UUID-hash
verification for `bwm_units`. It therefore provides authoritative provenance for
paper unit/session selections.

The v1 website's BWM regional feature files (`choice_bwm.pqt`,
`feedback_bwm.pqt`, `stimulus_bwm.pqt`, wheel analyses, etc.) are only consumed
by the v1 generator; their end-to-end production was not found in the four
requested current repositories. The current paper repository also defaults its
aggregate downloader to a 2026 tag, which is not automatically the same thing as
the 2025 paper snapshot.

**Do not guess:** what `brainwide_map` means for v2 launch (paper unit table,
paper analysis summaries, the v1 feature family, or a subset); which publication
freeze/tag is the paper-facing default; aggregation/significance semantics for
v1 analysis outputs.

## `local`

There is no remote scientific authority. A local dataset is a user-provided v0.1
release/package validated against exactly the same contract. Provenance should
record source filenames/checksums and user-supplied semantic metadata. Local
import must not silently manufacture units, transforms, parcellations, or volume
geometry.

## Private `paper-ephys-atlas-main.zip`

The archive contains both a historical vendored `sources/ephys_atlas` package
and newer examples/skills that import external `ephysatlas` from `ibleatools`.
The latter matches current reality. The old vendored code is useful historical
provenance but should not be used as the v2 scientific source of truth without a
specific reason and pin.
