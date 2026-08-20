# Integration status

Status: active local Codex implementation on `main`. The handoff baseline has
been extended with explicit ephys channel/cluster recipes, corrected regional
rendering identities, hardened local imports/publication, reproducible web
dependencies, and stronger semantic validation. The full gate remains the
completion criterion.

## Development and handoff state

- `main` is the sole active product-development branch (D017).
- Root `AGENTS.md` defines engineering/scientific guardrails.
- `docs/LAUNCH_SPEC.md` defines launch acceptance criteria.
- `docs/IMPLEMENTATION_PLAN.md` defines ordered milestones and next unblocked work.
- `docs/OPEN_QUESTIONS.md` records launch-blocking scientific/operational choices.
- `docs/AGENTIC_DEVELOPMENT.md` defines the autonomous local coding loop.
- `docs/CODEX_HANDOFF.md` provides the fresh-checkout relay runbook and suggested first local task.
- `Justfile` exposes `bootstrap`, `dev`, targeted gates, and the full `check` command aligned with CI.
- Root `.gitignore` prevents routine bootstrap/test outputs from appearing as false worktree changes.

M0 is complete. Routine product implementation should continue with local Codex on `main`.

## Integrated data/schema foundation

Schema v0.1 is the single contract for published HTTP releases and browser-imported local releases.

The repository contains:

- immutable release/provenance schemas;
- dynamic feature references rather than a hardcoded ephys feature enum;
- typed binary regional arrays/statistics/histograms;
- explicit volume geometry and discriminated physical layouts;
- deterministic golden regional+volume fixtures;
- builder validation and deterministic packaging;
- source acquisition/provenance helpers.
- semantic cross-resource validation for both supported volume layouts;
- a committed npm lockfile and active unit/rendering/browser CI suites.

The golden fixture is synthetic and has no scientific interpretation.

## `ephys_atlas_channels` builder

A deterministic channel-release recipe is implemented on `main`.

The builder makes scientifically material choices explicit rather than inheriting hidden defaults:

- source project/vintage;
- raw versus denoised feature mode;
- source population/QC recipe input;
- release timestamp and paper-snapshot status;
- dynamic source feature catalog;
- Allen/Beryl/Cosmos regional outputs;
- descriptive statistics/histograms and schema-v0.1 metadata/provenance.
- distinct raw and denoised feature variants when mode `both` is selected;
- left-hemisphere folding of bilateral atlas IDs;
- preservation of source values without the upstream implicit alpha replacement;
- pinned `ibleatools`, `iblatlas`, and builder commits plus the copied source manifest.

Q1 and Q3 are resolved: releases contain both raw and denoised variants and
use the explicit `inside` population with no additional physiological QC. The
real immutable `2026_W32` snapshot has been pulled and built as a validated
development release with the pinned scientific environment. Its separate
real-release Playwright suite passes through the production HTTP loader for all
three parcellations, including the promoted raw alpha `float64` arrays; see
`docs/data/DEVELOPMENT_RELEASE.md`. A paper-facing scientific release is not
frozen because Q2 still requires the final immutable `ea_active` vintage.

## `ephys_atlas_clusters` builder

A deterministic cluster release recipe is implemented:

- source pull requires an explicit project and produces a content-derived immutable snapshot ID;
- snapshot builds require an explicit nonempty scalar feature catalog and pinned code commits;
- all rows of `clusters.table.pqt` are eligible; `clusters_good.table.pqt` is not used;
- every finite cluster has equal weight within its left-folded Allen/Beryl/Cosmos region;
- no insertion balancing or hidden good-unit/QC filter is applied;
- schema-provided units are retained and absent units remain null.

Production remains blocked on the remaining Q6 choices: exact project/source
snapshot and launch feature catalog.

## Regional viewer vertical slice

The regional schema-v0.1 path is implemented end-to-end using the golden fixture:

1. catalog -> immutable manifest -> feature metadata;
2. parcellation region index + metadata;
3. regional values, descriptive-statistic matrix, global/regional histograms;
4. browser regional payload;
5. real region list/search and selected/global comparison;
6. statistic/colormap coloring of registered anatomy regions;
7. SVG and list interactions sharing one selection state;
8. selection persisted in URL state.

The default regional renderer consumes the immutable generated
`anatomy-pack-v1` under the application `SliceRenderer` facade. The legacy
adapter remains modular source code but is not active.

Generated paths carry negative signed Allen/Beryl/Cosmos atlas IDs directly,
matching folded ephys releases without a row-index crosswalk. The legacy
adapter alone retains its explicit BrainRegions row translation.
Independent request/render generations prevent stale feature, parcellation, or
volume-slice results from overwriting newer state, and renderer failures reach
visible runtime error status.

A pinned Allen Mouse CCF 2017 metadata asset supplies the full curated-SVG
region inventory, official ontology RGB, names, parents, depths, and legacy row
crosswalk. The settings panel exposes URL-persisted `Feature values` and
`Allen anatomy` fill modes. Anatomy mode shows the canonical left inventory and
color swatches in the region browser; geometry providers consume the shared
color presentation without owning state (D022).

The runtime anatomy is
`allen-ccfv3-25um-left-t15-4a565958b938`: 1,078 left-hemisphere 25 µm slices
in 68 lazy depth-16 gzip packs (18,768,176 compressed bytes). Full-corpus gates
record topology/coverage true, zero uncovered/multiply-covered voxels, zero
adjacency/geometry/missing-ID failures, minimum eligible-region IoU 1.0, and a
3.125 µm conservative boundary bound. Its affines synchronize all projections
through one native ML/AP/DV cursor; URL v2 uses native indices and migrates v1
10 µm links by world coordinate.

## Volume viewer vertical slice

A schema-v0.1 volume path is implemented and green on `main` using the golden `chunks3d` representation plus a tested `orthogonal_slice_packs` adapter:

1. published/local volume payloads provide transport-independent resource callbacks;
2. the `chunks3d` adapter decodes float16/float32 chunks (and optional gzip);
3. the slice-pack adapter decodes float16/float32 packs, reuses neighboring slices in a 48 MiB LRU, and deduplicates in-flight resource loads;
4. descriptor axis order is permuted into anatomical AP/ML/DV slice axes explicitly for both layouts;
5. linked regional coordinates map to volume indices through the declared `index_to_world_um` transform;
6. `VolumeSliceLoader` extracts orthogonal slices with bounded chunk caching;
7. Canvas2D renders scalar slices;
8. the hybrid application renderer switches between regional SVG and volume Canvas below the same `SliceRenderer` boundary;
9. unit and Playwright coverage exercise the golden volume path, while rendering tests cover all slice-pack planes, permuted storage axes, cache reuse, and edge packs.

This validates the reference browser architecture, not the final production science/transport. Q4 must supply authoritative scientific transform/outside semantics and Q5 must select production physical layout from real-data benchmark evidence.

The first ten-trial real-`rms_ap` Chromium measurement is also committed. The
optimized depth-4 adapter loads three current planes in 37.8/54.1 ms p50/p95,
reuses a neighboring slice in 0.8/1.5 ms without another request, and prepares
and paints six planes in 3.7/8.7 ms. Depth 4 is now the provisional transport
recommendation, pending other feature distributions and the final origin.

## Publishing/public catalog

The capability-based publishing implementation is integrated:

- revocable publisher credentials;
- dataset ownership without a user/OAuth platform;
- private resumable staged uploads;
- byte-size/SHA checks;
- manifest dataset/release identity binding and bounded external validation;
- serialized resumable appends under threaded deployment;
- idempotent recovery when a process stops after the release-directory rename;
- immutable public release directories and mutable aliases;
- administrative API state kept separate from the static browser catalog;
- public `catalog.json` emitted in the same v0.1 browser contract consumed by `HttpDatasetSource`.

Publishing prepares/distributes releases but never transforms scientific data.

## Browser/data runtime fixes already integrated

- Browser `fetch` is bound correctly before use through the resource fetcher; this fixed the Chromium `Illegal invocation` failure uncovered by the regional integration test.
- Regional metadata/value/statistics/histogram loading uses one schema-v0.1 path for HTTP and local imports.
- Volume resource loading likewise uses one logical payload contract across HTTP and IndexedDB/local storage.
- Curated SVG display inventory is validated before rendering.
- Strict TypeScript indexing in the volume adapter is resolved without weakening compiler settings.
- Local imports validate the complete supported regional/volume resource graph and every declared SHA-256 before opening a write transaction.
- Local storage is namespaced by source dataset and release, preventing same-release collisions across datasets.
- The 12 standalone rendering tests are compiled and run locally and in CI rather than remaining outside the package gate.

## Current canonical source evidence

### Channel features

- project: `ea_active`;
- private example vintage: `2025_W28` (not yet the final paper freeze);
- feature loading is through current `ephysatlas.data` tooling;
- raw and denoised source tables are loaded explicitly as separate feature variants;
- the final paper source vintage remains unresolved.

### Encoding volumes

Private source documentation describes `brainwide_ephys_atlas_25um.npz` with:

- `ephys_atlas_vol` shape `(456, 528, 320, N)` float16;
- `feature_names`;
- per-feature mean/std;
- 25 um resolution;
- 41 features in the documented `2026_W12` vintage.

The canonical `2026_W12` object is now checksummed and its ZIP/NPY headers are
measured: 1,636,734,203 bytes; a DEFLATE-compressed C-order
`(456, 528, 320, 41)` float16 main member; and a last, interleaved feature axis.
This resolves physical-container facts but not the authoritative scientific
axis mapping/affine, outside semantics, or interpretation of stored values
versus the included mean/std arrays.

A bounded-memory real layout benchmark extracts `psd_lfp`, `rms_ap`, and
`polarity` and measures 32³/64³ cubes against 4/8-slice packs. Packs reduce the
three center-plane request count to 3 with 0.83–3.32 MiB gzip, versus 136–534
cube requests with 5.21–21.77 MiB. The result prioritizes packs for browser
measurement but does not resolve Q5 until browser/HTTP, cache, latency, and
broader-feature evidence is recorded.

## Remaining launch work

The active sequence is defined in `docs/IMPLEMENTATION_PLAN.md`. In summary:

1. expose the validated immutable `2026_W32` development channel release through a non-production catalog, run real-value browser acceptance, and freeze the paper release after Q2;
2. benchmark the unblocked M2 volume transport candidates, then resolve Q4-Q5 and build the real volume release/transport;
3. resolve the remaining cluster project/catalog choices and build the production cluster release (Q6);
4. define/build exact `brainwide_map` product (Q7);
5. complete downloads/local-import production UX;
6. relocate pinned curated assets and finalize catalog/origin/deployment/publishing choices (Q8-Q10);
7. run final real-data performance and cross-browser release QA (Q11).

3-D, AGEA, MERFISH, large point-cloud workflows, advanced inferential statistics, full OAuth, and broad legacy custom-bucket compatibility remain deferred unless explicitly promoted.

## Source of truth for future agents

Do not reconstruct next steps from historical workstream chats. Use, in order:

1. `AGENTS.md`;
2. `docs/LAUNCH_SPEC.md`;
3. `docs/IMPLEMENTATION_PLAN.md`;
4. `docs/OPEN_QUESTIONS.md`;
5. `docs/DECISIONS.md`;
6. this file and focused implementation/source docs.
