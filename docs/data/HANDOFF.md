# Data / schema / reproducibility handoff

## Implemented decisions

- Schema v0.1 uses a small JSON `manifest.json` entry point and one feature JSON
  per feature. A feature may independently expose `regional` and/or `volume`.
- Regional values are dense typed binary arrays aligned to one dataset-level
  region-id index per parcellation. Statistics and histograms are separate
  browser-readable typed arrays plus small JSON metadata.
- Volume features are independent 3-D chunked arrays with explicit dtype,
  axis order, coordinate system, voxel size, origin, and index-to-world affine.
  v0.1 supports raw or gzip chunks and does not force Zarr at launch.
- Missing/non-finite observations do not enter descriptive statistics or
  histograms; missing counts are explicit. No inferential tests are modeled.
- Immutable release ids live inside release manifests. Mutable aliases such as
  `latest` live outside immutable release directories and use `alias.schema.json`.
- Pulled scientific inputs get a `source.json` file list with SHA-256 checksums.
  Cluster aggregates lack an upstream vintage label, so their source snapshot id
  is content-derived rather than pretending `current` is immutable.
- Whole-release downloads should be deterministic ZIPs with their digest stored
  in an external publication/index layer; embedding the archive digest in its
  own manifest would be self-referential.

## Files/code produced

- `schema/v0.1/*.schema.json` — dataset, feature, regional, statistics, volume,
  provenance, artifact, and common physical-array contracts.
- `builder/ephys_atlas_builder/` — deterministic JSON/binary writers, descriptive
  statistics, gzip chunked volume writer, source pull adapters, schema+payload
  validator, CLI, and golden-fixture generator.
- `fixtures/golden-v0.1/` — deterministic synthetic release with one regional +
  volume feature and download artifact.
- `tests/` — schema/fixture, determinism, chunk decoding, and tamper detection.
- `docs/data/PROVENANCE.md` — source/reproduction mapping and explicit scientific
  unknowns.
- `docs/data/STORAGE_FORMATS.md` — physical-format rationale.
- `Justfile` — provisional `data-pull`, `data-build`, `data-validate`, `data-package`,
  `golden`, and `test` workflow.
- deterministic whole-release ZIP writer; archive digests remain external to the
  release manifest to avoid self-reference.

## Unresolved scientific/data questions

1. `ephys_atlas_channels`: approve raw vs denoised source values, exact
   vintage/PID/snippet inclusion, outlier handling, QC population, regional
   summary statistic, and units for columns where `ibleatools` does not declare
   one.
2. `ephys_atlas_clusters`: approve all vs good cluster population, exact QC
   rule, project and source-object snapshot/version policy, scalar feature list,
   and whether large waveform/ACG/STPC/STLFP arrays are launch downloads only.
3. `ephys_atlas_volumes`: identify and pin the producer of
   `brainwide_ephys_atlas_25um.npz`; approve normalized vs denormalized value
   semantics; record scientific axis directions/origin/affine instead of
   inferring from shape; confirm outside-brain semantics.
4. `brainwide_map`: define the v2 launch product precisely. Current evidence
   distinguishes the paper selection freeze and aggregate tables from legacy
   website regional analysis files; treating them as one dataset would be a
   semantic guess.
5. Paper-facing immutable release ids and alias names still need to be selected
   once actual source snapshots are frozen.

## Proposed shared-architecture changes requiring Integration approval

- Adopt the v0.1 typed-binary regional and chunked-volume contract as the
  provisional frontend/rendering interface.
- Keep mutable alias resolution (`latest`, paper default) outside immutable
  release manifests/directories.
- Require explicit volume geometry in every release; rendering must not infer
  scientific orientation from array shape or v1 display calibration.
- Treat the published 25 µm NPZ as canonical input until its upstream generation
  script/model export is identified; do not block frontend work on recomputing it.

These are provisional where they cross another workstream. Schema fields can be
extended compatibly before 0.1 is frozen; scientific semantics above must not be
filled in by implementation convenience.
