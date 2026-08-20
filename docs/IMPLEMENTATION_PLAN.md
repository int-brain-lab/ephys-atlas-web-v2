# Implementation plan

This is the active execution order for local agent development. Work top-to-bottom unless a milestone is explicitly blocked and another milestone is independent.

Every completed milestone must leave `main` green under `just check` and update `docs/INTEGRATION_STATUS.md`.

## M0 — Codex handoff baseline

Status: **complete (2026-08-20)**.

Goal: make a fresh checkout self-describing and safe for autonomous local development.

Completed:

- root `AGENTS.md` defines repository invariants;
- `docs/LAUNCH_SPEC.md`, this plan, `docs/OPEN_QUESTIONS.md`, and `docs/AGENTIC_DEVELOPMENT.md` define durable product/execution context;
- `docs/CODEX_HANDOFF.md` provides the local relay runbook;
- `README.md` points to the durable handoff documents;
- `Justfile` provides bootstrap/dev/targeted/full-check commands aligned with CI;
- generated local test/bootstrap artifacts are covered by the root `.gitignore`;
- historical workstream instructions are reduced to the current single-main model;
- current integration/source status is refreshed, including the raw/denoised ambiguity;
- GitHub lists only `main` as a branch;
- Python, TypeScript typecheck, unit tests, production build, and Playwright are green on the handoff baseline.

Routine product implementation should now move to local Codex on `main`.

## M1 — Production `ephys_atlas_channels`

Status: **machinery implemented; paper release blocked only on source vintage**.

Already implemented:

- deterministic schema-v0.1 release builder path;
- explicit source vintage, feature mode, population, creation time, and paper-snapshot inputs;
- dynamic feature discovery;
- regional statistics/histograms and Allen/Beryl/Cosmos packaging;
- provenance/validation tests.
- explicit dual raw/denoised feature variants;
- left-hemisphere folding and the approved `inside` population;
- source-value preservation without hidden alpha replacement;
- required source/tool/builder pins and copied source snapshot manifest.

Q1 and Q3 are resolved. The paper-facing release remains blocked by Q2.
Development may build the latest source only when it resolves and records an
immutable vintage.

The pinned environment and latest development build were completed against the
immutable `2026_W32` snapshot on 2026-08-20. Details and exact pins are recorded
in `docs/data/DEVELOPMENT_RELEASE.md`.

Next actions:

1. use `just dev-real` for the implemented local non-production catalog and
   viewer path to the immutable development release;
2. expose the same release through an authorized non-production object-store catalog;
3. repeat the now-green real-value browser acceptance suite against that origin
   to cover deployment headers and caching;
4. repeat the build and acceptance suite with the final paper vintage when Q2
   is resolved.

Acceptance reference: `docs/LAUNCH_SPEC.md` sections 2 and 4.

## M2 — Production volume vertical slice

Status: **browser/golden path implemented; production science/transport blocked**.

Already implemented and green on the handoff baseline:

- schema-v0.1 volume payload path for published/local sources;
- `chunks3d` reference adapter;
- `orthogonal_slice_packs` adapter with in-flight deduplication and a bounded decoded LRU;
- float16/float32 decoding and optional gzip;
- bounded slice chunk cache;
- scientific coordinate mapping through declared `index_to_world_um`;
- Canvas slice rendering below the shared `SliceRenderer` facade;
- hybrid regional/volume renderer;
- golden unit and Playwright coverage.

Blocked by: Q4 and Q5.

Unblocked preparation work Codex may do before scientific resolution:

1. extend the green real-`rms_ap` Chromium slice-pack benchmark to the other
   representative feature distributions and the eventual HTTP/CDN origin;
2. compare the current depth-4 recommendation against depth 8 under production
   cache headers/network profiles without selecting the winner prematurely;
3. keep renderer failures explicit for invalid transforms and resource layouts.

After Q4/Q5 resolution:

6. encode the authoritative transform/outside semantics;
7. select and document the production layout;
8. build a real immutable `ephys_atlas_volumes` release;
9. run linked-slice browser acceptance against it.

Acceptance reference: `docs/LAUNCH_SPEC.md` sections 3 and 6.

## M3 — `ephys_atlas_clusters`

Status: **deterministic builder implemented; production source/catalog blocked**.

Implemented:

- explicit project and content-addressed source snapshots;
- explicit nonempty feature catalog with no hardcoded launch default;
- all-cluster, equal-cluster regional aggregation with no good-unit filter;
- left-folded Allen/Beryl/Cosmos summaries, provenance, and validation.

Blocked by the remaining parts of Q6: authoritative project/source snapshot
and launch feature catalog.

After resolution:

1. pull the approved content-addressed project snapshot;
2. inspect source-provided feature metadata/units;
3. build and validate the immutable release;
4. exercise the browser path without cluster-specific UI hardcoding.

Acceptance reference: section 5 of the launch spec.

## M4 — `brainwide_map`

Status: **blocked on product/scientific definition**.

Blocked by: Q7.

After resolution:

1. pin the authoritative source and selection/population;
2. implement the smallest deterministic builder adapter needed for the defined representation;
3. record provenance and validate;
4. add to the public catalog and browser acceptance suite.

Acceptance reference: section 7 of the launch spec.

## M5 — Downloads and local import completion

Status: **local import contract hardened; download/export UX remains**.

Completed:

- dataset/release-namespaced IndexedDB storage;
- complete supported regional/volume resource-graph validation before storage;
- WebCrypto SHA-256 verification and atomic immutable imports;
- deterministic golden and corruption/missing-resource tests.

Goals:

- production-grade local import validation for regional and supported volume releases;
- current-feature download/navigation;
- selected comparison export;
- deterministic whole-release package path exposed/documented where practical;
- visible provenance identifiers in exported data.

Requirements:

- do not invent a second local schema;
- browser-imported content must fail explicitly if resources are missing/inconsistent;
- exports must identify immutable release/feature/parcellation/statistic context.

Acceptance reference: sections 8 and 9 of the launch spec.

## M6 — Production assets, catalog, publishing, deployment

Status: **architecture implemented; deployment decisions open**.

Blocked in part by: Q8, Q9, Q10.

Actions:

1. copy the five pinned curated SVG bundles byte-for-byte to the selected immutable v2 asset origin;
2. switch runtime URLs after verifying hashes/inventory and browser behavior;
3. finalize static public catalog/default aliases for the frozen release set;
4. configure production CORS/cache policy;
5. deploy or explicitly waive the remote publishing service for launch;
6. if deployed, configure validator command, secrets, storage, backups, and TLS/reverse proxy;
7. verify public release URLs from the production origin.

Acceptance reference: sections 10, 11, and 13.

## M7 — Release QA and performance

Status: **not started as final release gate**.

Actions:

1. run `just check` from a clean checkout;
2. run representative real-data performance measurements;
3. execute the cross-browser matrix chosen in Q11;
4. verify responsive desktop/tablet/phone behavior;
5. test deep links and immutable release URLs;
6. test asset/data failure states;
7. verify downloads/local import;
8. verify production CORS/cache/Range behavior as applicable;
9. ensure every launch-blocking open question is resolved or explicitly waived by decision;
10. update `docs/INTEGRATION_STATUS.md` to the release state.

## Optional post-launch / non-blocking work

Only start these when M1-M7 are no longer threatened:

- richer 3-D rendering;
- AGEA;
- MERFISH;
- large point-cloud workflows;
- advanced inferential statistics;
- broader legacy custom-bucket compatibility;
- full user identity/OAuth.

## Task selection rule for agents

At the start of each autonomous work session:

1. run or confirm `just check` on the current `main` baseline;
2. choose the earliest milestone above that has an unblocked, testable action;
3. prefer end-to-end vertical progress over adding unused abstractions;
4. if blocked by an item in `OPEN_QUESTIONS.md`, do not choose an answer yourself—move to the next independent action;
5. finish with `just check`, an updated status/plan if needed, and a green commit.
