# Data / schema / reproducibility handoff

## Implemented decisions

- D010-D012 are incorporated: `ea_active` S3 channel/volume products are
  canonical scientific inputs; direct object-store transport is preferred only
  when measured browser requirements are met; manifests are dynamic feature
  catalogs; development may track `latest` while paper releases pin exact
  vintages.
- Schema v0.1 uses a small JSON `manifest.json` entry point and one feature JSON
  per feature. A feature may independently expose `regional` and/or `volume`.
  The `features` array is a catalog, not an enum; no Ephys Atlas feature list is
  hard-coded in the schema.
- Regional values are dense typed binary arrays aligned to one dataset-level
  region-id index per parcellation. Statistics and histograms are separate
  browser-readable typed arrays plus small JSON metadata.
- The current canonical 25 um NPZ was evaluated as a browser transport and does
  not meet the launch access/performance requirements. v0.1 therefore derives
  independent 3-D per-feature chunks with explicit dtype and geometry, while
  retaining the pinned/checksummed NPZ as scientific authority and download.
  This is a measured fallback under D010, not a blanket rule against direct S3.
- Missing/non-finite observations do not enter descriptive statistics or
  histograms; missing counts are explicit. No inferential tests are modeled.
- Immutable release ids live inside release manifests. Mutable aliases such as
  `latest` live outside immutable release directories and use `alias.schema.json`.
- Pulled scientific inputs get a `source.json` file list with SHA-256 checksums
  and an explicit canonical S3 bucket/key or prefix. Volume `latest` is resolved
  from the encoding-volume prefix itself rather than from the channel-feature
  catalog. Cluster aggregates lack an upstream vintage label, so their source
  snapshot id is content-derived rather than pretending `current` is immutable.
- Whole-release downloads are deterministic ZIPs with their digest stored in an
  external publication/index layer; embedding the archive digest in its own
  manifest would be self-referential.

## HTTP / volume validation

`docs/data/VOLUME_HTTP_VALIDATION.md` records the 2026-08-19 empirical probe:

- current public encoding-volume prefix: empty;
- known public IBL object: HTTP Range works (`206` with exact byte range);
- current public bucket: no matching browser CORS headers for atlas/localhost;
- current private encoding-volume URL: unsigned HEAD/Range/OPTIONS return 403;
- documented `2026_W12` main array: `(456, 528, 320, 41)` float16 = 6.32 GB raw;
  its feature-last monolithic layout cannot support efficient one-feature Range
  reads, even before accounting for likely NPZ compression.

The future public bucket/CDN must be re-tested when the encoding volumes are
published. A future directly addressable canonical layout may supersede the
chunk transform.

## Files/code produced

- `schema/v0.1/*.schema.json` — dataset, feature, regional, statistics, volume,
  provenance, artifact, alias, and common physical-array contracts.
- `builder/ephys_atlas_builder/` — deterministic JSON/binary writers, descriptive
  statistics, chunked volume writer, source pull/snapshot adapters,
  schema+payload validator, deterministic packager, CLI, and golden generator.
- `fixtures/golden-v0.1/` — deterministic synthetic release with one regional +
  volume feature and download artifact.
- `tests/` — schema/fixture, determinism, chunk decoding, tamper detection,
  source-snapshot identity, alias, and volume-vintage-resolution tests.
- `docs/data/PROVENANCE.md` — source/reproduction mapping and explicit scientific
  unknowns.
- `docs/data/STORAGE_FORMATS.md` — physical-format rationale under D010.
- `docs/data/VOLUME_HTTP_VALIDATION.md` — measured S3/HTTP/browser-access evidence.
- `Justfile` — provisional `data-pull`, `data-build`, `data-validate`,
  `data-package`, `golden`, and `test` workflow.

## Unresolved scientific/data questions

1. `ephys_atlas_channels`: approve raw vs denoised source values, exact
   vintage/PID/snippet inclusion, outlier handling, QC population, regional
   summary statistic, and units for columns where `ibleatools` does not declare
   one.
2. `ephys_atlas_clusters`: approve all vs good cluster population, exact QC
   rule, project and source-object snapshot/version policy, scalar feature list,
   and whether large waveform/ACG/STPC/STLFP arrays are launch downloads only.
3. `ephys_atlas_volumes`: identify and pin the producer/model/export recipe of
   `brainwide_ephys_atlas_25um.npz`; record scientific axis directions/origin/
   affine rather than inferring from shape; confirm outside-brain semantics.
   Value normalization is no longer unresolved: current paper documentation says
   stored predictions are already in final units, with mean/std for optional
   z-scoring only.
4. `brainwide_map`: define the v2 launch product precisely. Current evidence
   distinguishes the paper selection freeze and aggregate tables from legacy
   website regional analysis files; treating them as one dataset would be a
   semantic guess.
5. Select the paper-facing immutable release ids/aliases after final source
   vintages are frozen, and revalidate the production public HTTP URL/CORS
   configuration at that time.

## Proposed shared-architecture changes requiring Integration approval

- Adopt the v0.1 typed-binary regional contract and the derived chunked-volume
  contract for the **current** encoding-volume product. This implements D010:
  canonical S3 remains authoritative, while the measured NPZ is not used as the
  browser wire format.
- Keep mutable alias resolution (`latest`, paper default) outside immutable
  release manifests/directories; paper aliases resolve only to pinned snapshots.
- Require explicit volume geometry in every web release; rendering must not infer
  scientific orientation from array shape or v1 display calibration.
- Treat the published 25 um NPZ as canonical input until its upstream generation
  script/model export is identified; do not block frontend work on recomputing it.
- Permit a future direct-object volume representation if a later public source
  becomes independently feature/slice-addressable and passes the same Range,
  CORS, decode and memory checks.

These are provisional where they cross another workstream. Schema fields can be
extended compatibly before 0.1 is frozen; scientific semantics above must not be
filled in by implementation convenience.
