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

- deterministic schema-v1 release builder path;
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

## M2 — Projection/volume cutover and production volume vertical slice

Status: **breaking projection refactor active; schema-v1 cutover complete;
production science/transport remains blocked**.

The next implementation unit is the pre-launch cutover in
`docs/rendering/PROJECTION_VOLUME_CUTOVER_PLAN.md`. It replaces schema v0.1,
the `SliceRenderer`/hybrid switch, anatomy runtime compatibility, and URL
migrations with one schema v1, one five-projection asset contract, one current
URL codec, and retained layered projection viewports. Coronal, sagittal, and
horizontal support registered anatomy plus volume layers; Top and Swanson are
static regional projections using the same SVG presentation and interaction
path. Backward compatibility with the pre-launch formats is not a requirement.

Commits 1 through 4 are implemented. Schema v1 is now the sole builder,
publishing, HTTP/local browser, fixture, and download contract. It separates
scientific reference-space identity from grid and asset identities, admits
only the checked signed-permutation affine profile, verifies encoded bytes
before persistent caching, and keys decoded resources by SHA plus decode
contract. The newly identified `golden-v1` fixture is canonical; v0.1 schemas,
fixtures, readers, and compatibility tests are deleted. Projection and
responsive workspace state are registry-driven; one world cursor is the only
stored navigation authority; URL v4 persists that cursor plus independent
secondary-tab, compact-view, and maximized-view state and explicitly resets
unsupported versions. The deterministic five-projection pack builder now
losslessly repackages validated sparse registered geometry, emits strict
resource indexes, normalizes affine-free static fragments, and validates the
complete immutable file graph. Q13 still blocks a production Top/Swanson pack,
so tests use conspicuously synthetic fragments. The next unit is Commit 5's
atomic retained-viewport cutover.

This machinery is unblocked with deterministic synthetic fixtures. It must not
resolve or conceal Q4/Q5.

Already implemented and green on the handoff baseline:

- schema-v1 volume payload path for published/local sources;
- `chunks3d` reference adapter;
- `orthogonal_slice_packs` adapter with in-flight deduplication and a bounded decoded LRU;
- float16/float32 decoding and optional gzip;
- bounded slice chunk cache;
- scientific coordinate mapping through declared `index_to_world_um`;
- Canvas slice rendering below the shared `SliceRenderer` facade;
- hybrid regional/volume renderer;
- golden unit and Playwright coverage.

Blocked by: Q4 and Q5.

Current implementation input: the private immutable `ea_active` `2026_W26`
50 um object. Its exact S3 URI and the official `ibleatools` access recipe are
recorded in `docs/DATA_SOURCES.md`. The older `2026_W12` 25 um measurements are
historical transport evidence, not the default input for new implementation.

Ordered next actions before scientific resolution:

1. execute commits 4-8 in the focused cutover plan, keeping every handoff green;
2. rebuild external development releases under new schema-v1 release IDs
   before using the opt-in real-release suite; do not add a compatibility reader;
3. verify the layered golden volume path, registered anatomy overlays, and
   Top/Swanson shared interactions across responsive layouts;
4. pull, checksum, and header-inspect the documented `2026_W26` object, then
   repeat the real-feature slice-pack benchmarks on representative feature
   distributions and the eventual HTTP/CDN origin;
5. compare the current depth-4 recommendation against depth 8 under production
   cache headers/network profiles without selecting the winner prematurely;
6. keep failures explicit for invalid transforms, out-of-volume coordinates,
   resource-integrity errors, and unsupported layouts.

After Q4/Q5 resolution:

7. encode the authoritative transform/outside semantics;
8. select and document the production layout;
9. build a real immutable `ephys_atlas_volumes` release;
10. run linked-slice browser acceptance against it.

Acceptance reference: `docs/LAUNCH_SPEC.md` sections 3 and 6.

## P3D — Independent brain-mesh 3-D lab

Status: **approved independent experiment; non-blocking for launch**.

This lane may run concurrently with M2 in the explicitly authorized short-lived
worktree described by `AGENTS.md`. It must not import or fork `AtlasApp`, the
2-D projection viewport, URL state, or dataset sessions. The refactor owns the
higher-level workspace-view and regional-presentation contracts; the lab owns
only deterministic mesh-pack tooling, reusable 3-D runtime modules, and a
standalone Vite entry with synthetic controls.

Ordered slices:

1. define `atlas-mesh-pack-v1`, pin and validate the source GLB and canonical
   10 um annotation/LUT, and add a tiny synthetic bilateral fixture;
2. build the measured default/high meshopt LODs with signed region IDs,
   canonical centroids, deterministic hashes, and region-coverage gates;
3. add `/3d-lab/` using Three.js WebGL2 with orbit, picking, mapping/color,
   visibility, selection, bilateral presentation, and radial explode controls;
4. measure transfer, decode, first frame, draw calls, memory, recoloring,
   picking, and LOD swaps at representative viewport sizes and browsers;
5. only after M2 exposes the shared workspace seam, integrate the lab as an
   optional `scene-3d` view through a small adapter and add URL/responsive tests.

The lab downloads one union default-LOD pack, not one file per region. It may
prefetch that pack at low priority after launch-critical 2-D work, loads one
optional high LOD on sustained/maximized use, and switches Allen/Beryl/Cosmos
through tables without fetching geometry again. Full-resolution and future
volume-rendering assets are separate follow-ups.

Detailed evidence, contracts, budgets, and promotion gates:
`docs/rendering/3D_EVALUATION.md`.

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

Status: **local import hardened; regional and selected-comparison exports implemented; broader package/export UX remains**.

Completed:

- dataset/release-namespaced IndexedDB storage;
- complete supported regional/volume resource-graph validation before storage;
- WebCrypto SHA-256 verification and atomic immutable imports;
- deterministic golden and corruption/missing-resource tests.
- immutable release, feature semantics, and provenance retained by the browser model and exposed through the contextual Info dialog;
- share action copies the complete URL-persisted exploration state;
- current regional statistic exports as CSV with dataset, immutable release, feature, representation, parcellation, statistic, unit, and region identity columns.
- selected regions compare as independently sum-normalized distributions over a shared feature-value axis, with descriptive statistics and sample sizes;
- selected comparison exports as CSV with scientific context, summaries, raw histogram bins, and normalized probabilities.

Goals:

- production-grade local import validation for regional and supported volume releases;
- volume-feature download/navigation;
- deterministic whole-release package path exposed/documented where practical;
- visible provenance identifiers in exported data.

Requirements:

- do not invent a second local schema;
- browser-imported content must fail explicitly if resources are missing/inconsistent;
- exports must identify immutable release/feature/parcellation/statistic context.

Acceptance reference: sections 8 and 9 of the launch spec.

## M6 — Production assets, catalog, publishing, deployment

Status: **registered anatomy integrated; catalog/deployment decisions open**.

Blocked in part by: Q8 and Q9.

Actions:

1. deploy the committed immutable v3 indexed-SVG anatomy pack and preserve opaque gzip bytes without HTTP `Content-Encoding`;
2. finalize static public catalog/default aliases for the frozen scientific release set;
3. configure production CORS/cache policy;
4. deploy or explicitly waive the remote publishing service for launch;
5. if deployed, configure validator command, secrets, storage, backups, and TLS/reverse proxy;
6. verify anatomy and scientific release URLs from the production origin.

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

Only start these when M1-M7 are no longer threatened, except for the explicitly
isolated P3D lab above:

- production promotion or richer 3-D rendering beyond P3D;
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
