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

The approved channel recipe publishes both raw and denoised variants, uses the
`inside` population, performs no additional QC or alpha replacement, folds
bilateral observations left, and uses the arithmetic mean as its primary
regional summary. Do not silently change those decisions. The remaining paper
blocker is the exact final vintage/PID/snippet population; feature units remain
null when they are not explicit in the pinned scientific schema.

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

    s3://ibl-brain-wide-map-private/aggregates/atlas/encoding_volumes/ea_active/<YYYY_Www>/brainwide_ephys_atlas_<res_um>um.npz

The current implementation input is the immutable `2026_W26` 50 um object at
the exact URI recorded in `docs/DATA_SOURCES.md`. The official `ibleatools`
guide documents shape `(228, 264, 160, 41)`, float16 raw/unnormalized values,
optional non-pre-applied z-scoring metadata, and outside-brain value `0.0`.

The older documented `2026_W12` vintage contains `ephys_atlas_vol` with shape
`(456, 528, 320, 41)` and float16 values, feature names, per-feature mean/std,
grid shape, and 25 um resolution. It remains the source of the committed
historical transport measurements.

The current v1 conversion tool establishes another behavioral fact: its website
payload does not assume the NPZ axis order from shape alone; it checks against
the Allen atlas, transposes for the current file, and masks outside-brain voxels.
Those operations are behavioral evidence, not a substitute for scientific
geometry metadata.

The inspected public `ibleatools` and available paper sources expose the NPZ and
loaders but not the script that generated this exact published NPZ. Until that
producer is identified, the NPZ itself is the canonical v2 input snapshot and
its SHA-256 must be recorded.

`docs/data/VOLUME_HTTP_VALIDATION.md` records an empirical HTTP validation. The
current private object is not anonymously readable; the volume prefix is not yet
mirrored in the public IBL bucket; current public IBL objects support byte ranges
but not browser CORS; and the NPZ's monolithic 4-D layout is unsuitable
for efficient incremental feature/slice access. Therefore the current schema-v1
web transport is a deterministic derived per-feature representation with an
explicit checksummed resource index, with
provenance back to the pinned NPZ. This must be re-evaluated if the future public
canonical artifact or CDN layout changes.

Development `latest` is resolved from the encoding-volume prefix itself. It must
not reuse the channel-feature latest label because the two catalogs may have
different vintages. The paper release pins an exact volume vintage.

**Do not guess:** scientific axis directions/origin/affine from the `x/y/z`
labels alone; missing-value semantics beyond the documented outside-brain zero;
model/training commit and export recipe that produced the NPZ.

## `brainwide_map`

The current `int-brain-lab/paper-brain-wide-map` repository (inspected commit
`118fc36cb3602934466ad2c6087c2b3b441f9f1f`) provides paper selection logic,
fixed `bwm_query` freezes, aggregate-table downloads, checksums, and UUID-hash
verification for `bwm_units`. It therefore provides authoritative provenance for
paper unit/session selections.

By D038, the v2 launch preserves the v1 website's exact Beryl-only regional
feature snapshot rather than regenerating a current paper product. The pinned
generator is `int-brain-lab/ephys-atlas-web/generate.py` at
`1d908bea095be2616a750d939d143f3b4db2a641`. The source files observed in the
clean sibling checkout on 2026-08-22 are:

| Family | Bytes | SHA-256 |
| --- | ---: | --- |
| `choice_bwm.pqt` | 19,742 | `179bd6714bbb3e22f98fc4311c07a9a367d6ad8bf7487469108862751a2c3421` |
| `feedback_bwm.pqt` | 20,053 | `262f48322b36f3655e76648aaa41db7a075387541a9403e52819523a56acf7f1` |
| `stimulus_bwm.pqt` | 18,892 | `6ecd376ec9a81bf179a04bd250793fc8f254cd3e77ba93c4c63ba861e07d8efa` |
| `wheel_speed_bwm.pqt` | 12,371 | `58b63dd36f7ce3e7615624d1e11e47906fae00eff717f08653f7e299f057a7ca` |
| `wheel_velocity_bwm.pqt` | 12,126 | `5da2ee7ae0added6996a433fd8c04796d8953bac15612cd89f46d8fb56688438` |

The new builder must accept explicit source paths, verify these bytes before
reading, preserve the legacy feature values and aggregation/significance
semantics through equivalence fixtures, and identify the result as a preserved
legacy website snapshot. The table records source identity; it does not fill
the missing end-to-end provenance that produced the Parquet files and must not
be presented as a newer paper-pipeline regeneration.

## `local`

There is no remote scientific authority. A local dataset is a user-provided schema-v1
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
