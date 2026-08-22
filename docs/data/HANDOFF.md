# Data, schema, and reproducibility status

Status: current supporting summary. Use `docs/IMPLEMENTATION_PLAN.md` for work
order, `docs/OPEN_QUESTIONS.md` for choices an agent must not invent, and
`docs/INTEGRATION_STATUS.md` for the integrated product state.

## Shared contract

Schema v1 is the sole implemented contract for builders, browser HTTP reads,
browser-local IndexedDB imports, and publishing validation. It provides:

- immutable dataset manifests and dynamic feature catalogs;
- typed-binary regional values, descriptive statistics, histograms, and shared
  parcellation region indices;
- explicit volume geometry independent of physical layout;
- `chunks3d` and `orthogonal_slice_packs` volume layouts;
- provenance, artifact byte-size/SHA-256 identity, aliases, and deterministic
  whole-release ZIP packaging.

The Python validator and independent TypeScript validator share valid/invalid
fixtures for every contract document and semantic unit. `fixtures/golden-v1` is the deterministic synthetic
cross-implementation fixture; the browser-served copy must remain semantically
identical and must never be labeled scientific.

## Channel releases

The deterministic channel builder is implemented with explicit source project,
immutable vintage, creation time, paper-snapshot flag, population, and source
tool/builder commits. It discovers source features dynamically, publishes raw
and denoised variants separately, uses the approved `inside` population,
excludes non-finite observations per feature, preserves source values, folds
bilateral IDs to the left representation, and builds Allen/Beryl/Cosmos
statistics and histograms.

The pinned `ea_active/2026_W32` development snapshot was pulled, rebuilt, and
validated under schema v1 across all 70 discovered features and all three
parcellations. It is the ignored local development release, not the paper
release. Q2 still blocks the final paper vintage and aliases. See
`docs/data/CHANNELS_RECIPE.md` and `docs/data/DEVELOPMENT_RELEASE.md`.

## Cluster releases

The cluster builder accepts an explicit content-addressed project snapshot and
nonempty scalar feature catalog. It aggregates every finite row from
`clusters.table.pqt` with equal cluster weight after left folding, without a
good-unit filter or insertion balancing. Q6 still blocks the authoritative
project/source snapshot and launch feature catalog. See
`docs/data/CLUSTERS_RECIPE.md`.

## Volume releases

The canonical implementation input is the private immutable
`ea_active/2026_W26/brainwide_ephys_atlas_50um.npz` object. Its exact URI and
official `ibleatools` access recipe are recorded in `docs/DATA_SOURCES.md`.
The older `2026_W12` 25 µm object remains historical transport evidence.

The builder/schema/browser machinery supports both physical layouts, but no
production scientific volume release may be built until Q4 supplies the
authoritative axis mapping, affine/origin/directions, and any missing-value
semantics beyond documented outside-brain zero. Q5 separately requires
representative W26 and final-origin measurements before selecting the launch
transport. Current evidence favors depth-four orthogonal slice packs without
yet resolving that decision.

## Source and provenance rules

- Pulled inputs receive a `source.json` inventory with paths, byte sizes,
  SHA-256 hashes, and canonical object identity.
- Scientific choices are explicit builder inputs rather than inherited library
  defaults.
- Release provenance records source project/vintage, transformation mode,
  population/QC recipe, builder/tool versions, command, and hashes wherever the
  schema permits.
- Immutable release contents never contain mutable aliases. Whole-release ZIP
  digests live in the external publication/index layer to avoid self-reference.
- Publishing consumes already-built releases and never performs scientific
  transformation.

## Verification and next work

- `just test-python` covers builders, schemas, contract parity, packaging, and
  publishing.
- `just data-validate <path>` validates a built release.
- `just dev-real` and the separate real-release Playwright configuration cover
  the pinned channel development release.
- Private source pulls and real benchmarks are explicit integration work and
  are not required by a clean-checkout `just check`.

The next data work is the earliest unblocked action in the implementation plan:
rebuild the W32 channel development release under schema v1 before any
non-production publication, repeat W26 volume inspection/benchmarks without inventing Q4/Q5, then
consume authoritative answers for the paper channel, cluster, and
`brainwide_map` releases.
