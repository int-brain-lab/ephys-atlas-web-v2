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
- provenance, artifact byte-size/SHA-256 identity, aliases, and optional
  deterministic whole-release ZIP packaging.

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
good-unit filter or insertion balancing. D038 selects
`ibl_neuropixel_brainwide_01` as the source project and the
legacy 14 scalar features as the review candidate. The remaining Q6 work is to
pull and checksum the exact aggregate snapshot, audit those columns and units,
and freeze the final catalog after human review. See
`docs/data/CLUSTERS_RECIPE.md`.

## Brain-Wide Map release

D038 resolves Q7 by preserving the five checksummed Beryl-only v1 website
families: choice, feedback, stimulus, wheel speed, and wheel velocity. The local
schema-v1 builder now verifies the five recorded Parquet identities and their
pinned Beryl metadata dependency before decoding. Deterministic tests reproduce
the pinned generator's lateralization, arithmetic aggregation, six-significant-
digit serialization, and `false=0.5`/`true=1.0` significance behavior. An
exact-input local run produced 30 schema-valid features over 210 Beryl regions.
The ignored `legacy-v1-1d908bea` local release was built and validated from
builder commit `9d2d37b`. The output identifies itself as a legacy website
snapshot rather than a current paper-pipeline regeneration. The opt-in local
catalog/Chromium suite validates all 30 discovered features, Beryl-only context
reconciliation, representative significance values and provenance, feature
switching, regional population counts, and CSV context through the production
HTTP reader. Run it with `just test-brainwide-map-release`. Online publication
remains deferred.

## Volume releases

The canonical implementation input is the private immutable
`ea_active/2026_W26/brainwide_ephys_atlas_50um.npz` object. Its exact URI and
official `ibleatools` access recipe are recorded in `docs/DATA_SOURCES.md`.
The older `2026_W12` 25 µm object remains historical transport evidence.
The W26 object has now been pulled and header-inspected locally: 238,954,924
bytes, SHA-256
`1f7509fe9e368a90704173bdb5c385827b199a7d5fa4b0aaa8fec5aca5402253`,
with the documented shape/dtype and 41 features. Representative offline and
Chromium depth-4/depth-8 results are in
`docs/data/VOLUME_2026_W26_EVIDENCE.md`.

The builder/schema/browser machinery supports both physical layouts, but no
production scientific volume release may be built until Q4 supplies the
authoritative axis mapping, affine/origin/directions, and any missing-value
semantics beyond documented outside-brain zero. Q5 separately requires
final-origin measurements before selecting the launch transport. Completed W26
local evidence favors depth-four orthogonal slice packs without yet resolving
that decision.

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
publish and validate the W32 channel development release at a non-production
origin, repeat W26 volume inspection/benchmarks without inventing Q4/Q5, audit
the selected cluster source/catalog, and implement the preserved legacy BWM
builder.
