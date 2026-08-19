# Launch dataset provenance

This records what is authoritative today and what remains scientifically
unresolved. Repository commits below are the current states inspected on
2026-08-19; a production release must pin the exact commits and source object
checksums used for that release rather than inheriting these moving refs.

## `ephys_atlas_channels`

**Authoritative published source:** current `int-brain-lab/ibleatools`
(`ephysatlas`, not the historical `ephys_atlas` package vendored in the private
paper repository). Current inspected commit:
`9bfa0623a16bc7a989a6b27a589887641beee0a8`.

Published source layout:

    aggregates/atlas/features/{project}/{YYYY_Www}/agg_full/
      raw_ephys_features_denoised.pqt
      raw_ephys_features.pqt
      channels.pqt
      channels_labels.pqt

`ephysatlas.data.download_tables()` resolves/downloads these artifacts;
`read_features_from_disk()` merges feature/channel information and maps XYZ to
Allen/Cosmos/Beryl ids. Current aggregation code in
`ephysatlas.aggregation` aggregates snippet-level feature outputs by
`(pid, channel)` and produces the raw and denoised parquet tables.

Reproducible v2 path:

1. resolve a weekly label to an immutable input snapshot;
2. download the exact parquet inputs and record their SHA-256 digests;
3. pin the `ibleatools` commit and the builder recipe;
4. explicitly select raw vs denoised source columns, QC/inclusion population,
   parcellation, and regional summary in a build spec;
5. build v2 regional/statistics artifacts without recomputing raw ephys.

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
A v2 immutable release therefore must snapshot and checksum the exact source
objects (or use an S3 object version if available) before publication.

**Do not guess:** all clusters vs `clusters_good`; the intended project;
exact QC criterion (including current relaxed-RP alternatives); which scalar
columns become web features; whether waveform/ACG/STPC/STLFP arrays are launch
features or only downloads; source-object versioning policy.

## `ephys_atlas_volumes`

**Authoritative published source artifact:** the precomputed weekly NPZ exposed
by current `ibleatools`:

    aggregates/atlas/encoding_volumes/{project}/{YYYY_Www}/
      brainwide_ephys_atlas_25um.npz

For the documented 2026_W12 vintage it contains `ephys_atlas_vol` with shape
`(456, 528, 320, N)` and float16 values, feature names, per-feature mean/std,
grid shape, and 25 µm resolution.

The current v1 conversion tool establishes an important behavioral fact: its
website payload does not assume the NPZ's axis order from shape alone; it checks
against the Allen atlas, transposes for the current file, and masks outside-brain
voxels.

The inspected public `ibleatools` and private paper archive expose the NPZ and
loaders but not the script that generated this exact published NPZ. Until that
producer is identified, the NPZ itself is the canonical v2 input snapshot and
its SHA-256 must be recorded.

**Do not guess:** whether a vintage is already in physical/display units or
requires `value * std + mean`; scientific axis directions/origin/affine from the
`x/y/z` labels alone; outside-brain semantics; model/training commit and export
recipe that produced the NPZ.

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
