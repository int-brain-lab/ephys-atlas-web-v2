# Integration status

Status: local Codex handoff baseline complete on `main`. All accepted implementation work is consolidated there, GitHub lists no other branches, and the handoff baseline has passed Python, TypeScript, unit, production-build, and Playwright gates. `docs/IMPLEMENTATION_PLAN.md` is now the active execution plan and `docs/OPEN_QUESTIONS.md` contains unresolved choices that must not be guessed.

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

A production scientific release is intentionally not frozen yet. Q1-Q3 in `docs/OPEN_QUESTIONS.md` must be resolved first.

Important source ambiguity: the private paper example comments that `load_denoised=False` is the raw path, but its actual `read_features_from_disk(...)` call omits that parameter. The current `ibleatools` API defaults `load_denoised=True`. Therefore the effective paper-example behavior cannot be treated as an authoritative raw/denoised decision without explicit confirmation.

## Regional viewer vertical slice

The regional schema-v0.1 path is implemented end-to-end using the golden fixture:

1. catalog -> immutable manifest -> feature metadata;
2. parcellation region index + metadata;
3. regional values, descriptive-statistic matrix, global/regional histograms;
4. browser regional payload;
5. real region list/search and selected/global comparison;
6. statistic/colormap coloring of curated SVG regions;
7. SVG and list interactions sharing one selection state;
8. selection persisted in URL state.

The lower-level curated SVG renderer remains under the application `SliceRenderer` facade.

The five deployed v1 curated bundles are pinned by identity/inventory in `docs/frontend/LEGACY_CURATED_ASSETS.md`. Orthogonal bundles contain even display indices; scientific navigation remains on full 10 um domains and the display layer chooses the nearest available curated slice.

## Volume viewer vertical slice

A reference schema-v0.1 volume path is implemented and green on `main` using the golden `chunks3d` representation:

1. published/local volume payloads provide transport-independent resource callbacks;
2. the `chunks3d` adapter decodes float16/float32 chunks (and optional gzip);
3. descriptor axis order is permuted into anatomical AP/ML/DV slice axes explicitly;
4. linked regional coordinates map to volume indices through the declared `index_to_world_um` transform;
5. `VolumeSliceLoader` extracts orthogonal slices with bounded chunk caching;
6. Canvas2D renders scalar slices;
7. the hybrid application renderer switches between regional SVG and volume Canvas below the same `SliceRenderer` boundary;
8. unit and Playwright coverage exercise the golden volume path.

This validates the reference browser architecture, not the final production science/transport. Q4 must supply authoritative scientific transform/outside semantics and Q5 must select production physical layout from real-data benchmark evidence.

## Publishing/public catalog

The capability-based publishing implementation is integrated:

- revocable publisher credentials;
- dataset ownership without a user/OAuth platform;
- private resumable staged uploads;
- byte-size/SHA checks;
- optional external schema validator before atomic publication;
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

## Current canonical source evidence

### Channel features

- project: `ea_active`;
- private example vintage: `2025_W28` (not yet the final paper freeze);
- feature loading is through current `ephysatlas.data` tooling;
- raw/denoised effective behavior is unresolved as described above.

### Encoding volumes

Private source documentation describes `brainwide_ephys_atlas_25um.npz` with:

- `ephys_atlas_vol` shape `(456, 528, 320, N)` float16;
- `feature_names`;
- per-feature mean/std;
- 25 um resolution;
- 41 features in the documented `2026_W12` vintage.

This establishes contents/shape but not the authoritative scientific affine. Values are not assumed pre-normalized.

## Remaining launch work

The active sequence is defined in `docs/IMPLEMENTATION_PLAN.md`. In summary:

1. resolve Q1-Q3 and build/validate a real immutable `ephys_atlas_channels` release;
2. benchmark the unblocked M2 volume transport candidates, then resolve Q4-Q5 and build the real volume release/transport;
3. define/build `ephys_atlas_clusters` (Q6);
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
