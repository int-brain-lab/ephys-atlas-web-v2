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
- Apple-silicon bootstrap, exact Node 22 selection, official private-data
  acquisition, and the active W26 volume continuation are durable repository
  instructions; a tracked-files-only clone passed `just bootstrap` and
  `just check` on 2026-08-24 without ignored artifacts or private data.

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

The pinned environment and schema-v1 development build were completed against
the immutable `2026_W32` snapshot on 2026-08-22. Details and exact pins are recorded
in `docs/data/DEVELOPMENT_RELEASE.md`.

Next actions:

1. use `just dev` for the local non-production catalog and viewer path to the
   immutable development release; missing real data is a startup error;
2. expose the same release through an authorized non-production object-store catalog;
3. repeat the now-green real-value browser acceptance suite against that origin
   to cover deployment headers and caching;
4. repeat the build and acceptance suite with the final paper vintage when Q2
   is resolved.

Acceptance reference: `docs/LAUNCH_SPEC.md` sections 2 and 4.

## M2 — Projection/volume cutover and production volume vertical slice

Status: **projection refactor complete; production science/transport remains
blocked**.

The completed pre-launch cutover is defined in
`docs/rendering/PROJECTION_VOLUME_CUTOVER_PLAN.md`. It replaced schema v0.1,
the `SliceRenderer`/hybrid switch, anatomy runtime compatibility, and URL
migrations with one schema v1, one five-projection asset contract, one current
URL codec, and retained layered projection viewports. Coronal, sagittal, and
horizontal support registered anatomy plus volume layers; Top and Swanson are
static regional projections using the same SVG presentation and interaction
path. Backward compatibility with the pre-launch formats is not a requirement.

Commits 1 through 8 are implemented. Schema v1 is now the
sole builder, publishing, HTTP/local browser, fixture, and download contract.
It separates scientific reference-space identity from grid and asset
identities, admits only the checked signed-permutation affine profile, verifies
encoded bytes before persistent caching, and keys decoded resources by SHA plus decode
contract. The newly identified `golden-v1` fixture is canonical; v0.1 schemas,
fixtures, readers, and compatibility tests are deleted. Projection and
responsive workspace state are registry-driven; one world cursor is the only
stored navigation authority; URL v4 persists that cursor plus independent
secondary-tab, compact-view, and maximized-view state and explicitly resets
unsupported versions. The deterministic five-projection pack builder now
losslessly repackages validated sparse registered geometry, emits strict
resource indexes, normalizes affine-free static fragments, and validates the
complete immutable file graph. Q13 still blocks a production Top/Swanson pack,
so the checked-in browser fixture uses conspicuously synthetic static fragments
alongside the validated registered geometry. The browser now uses one retained
`ProjectionViewport` per registered frame and
the schema-v1 projection pack directly. The old `SliceRenderer` facade,
hybrid switch, anatomy-pack readers, legacy renderer/crosswalk, URL migrations,
and application-owned slice triple are deleted. Compatible schema-v1 volume
planes now composite beneath retained anatomy after exact reference-space
validation and affine-derived voxel-edge placement; an unavailable volume
leaves the registered anatomy usable. Nearest-neighbor pointer inspection maps
background-capable projection coordinates through world space to exact volume
voxels and reports valid, outside, missing, or out-of-grid status. Sentinel and
checksummed mask validity drive both inspection and transparency. URL v4
persists independent volume opacity and anatomy-outline controls, and those
presentation changes repaint retained layers without resource requests. One
96 MiB decoded-volume budget covers the active feature's mask and scalar cache;
feature switches dispose the previous source, while consumer-aware in-flight
deduplication preserves current loads across obsolete-render cancellation.
The enabled projection registry now contains all five 2-D views. Top and
Swanson occupy tabs in the existing secondary workspace slot, load verified
affine-free gzip fragments on demand, and share regional coloring, parcellation
identity, hover, selection, and tooltip behavior. Responsive switching and
secondary maximize remain independent URL state. The checked-in static maps
remain visibly labeled synthetic fixtures; volume features show anatomy only
and never imply scalar values on those maps.

This machinery is unblocked with deterministic synthetic fixtures. It must not
resolve or conceal Q4/Q5.

Volume foundations already implemented and green on the handoff baseline:

- schema-v1 volume payload path for published/local sources;
- `chunks3d` reference adapter;
- `orthogonal_slice_packs` adapter with in-flight deduplication and a bounded decoded LRU;
- float16/float32 decoding and optional gzip;
- bounded slice chunk cache;
- scientific coordinate mapping through declared `index_to_world_um`;
- Canvas scalar-layer painting inside the retained projection viewport;
- both physical volume adapters behind one decoded-plane source;
- sentinel and full-grid mask validity with transparent invalid voxels;
- world/voxel/value inspection over both anatomical paths and SVG background;
- URL-persisted opacity and anatomy-outline presentation controls;
- one active-feature decoded-memory budget, cancellation, and in-flight request
  deduplication;
- golden unit and Playwright coverage.
- fail-closed schema-v1 volume release machinery with dynamic NPZ feature
  discovery, verified source identity, float16 value preservation, both
  transports, valid/outside/missing summaries, explicit affine/validity/layout
  inputs, and deterministic synthetic coverage.
- machine-consumable D043 selection loading with exact W26 source/grid/affine/
  validity matching and no CLI affine transcription;
- one-pass bounded-memory multi-feature NPZ extraction with corruption tests;
- ignored, explicitly candidate-labelled 41-feature depth-4/depth-8 releases,
  complete-graph hashes/validity evidence, production-style local browser
  acceptance, and worst-feature simulated delivery profiles.

Blocked by: Q5. Q4 is resolved for the exact pinned W26 object by D043.

Current implementation input: the private immutable `ea_active` `2026_W26`
50 um object. Its exact S3 URI and the official `ibleatools` access recipe are
recorded in `docs/DATA_SOURCES.md`. The older `2026_W12` 25 um measurements are
historical transport evidence, not the default input for new implementation.
The complete cross-machine continuation contract is
`docs/data/VOLUME_IMPLEMENTATION_HANDOFF.md`.

Ordered next actions before production packaging:

1. retain the implemented D043 machine-consumable gate and
   `docs/data/VOLUME_2026_W26_GEOMETRY_SELECTION.json` as the exact-source
   scientific geometry authority; do not generalize the affine to another
   vintage, resolution, or source hash;
2. rebuild external development releases under new schema-v1 release IDs
   before using the opt-in real-release suite; do not add a compatibility reader;
3. retain the completed checksum/header inspection, full 41-feature candidates,
   complete graph report, local production-style acceptance, and representative
   plus worst-feature depth-4/depth-8 Chromium evidence;
4. repeat the current depth-4 recommendation at the selected CloudFront origin;
5. deploy the projection pack with immutable caching and transport-opaque gzip,
   and verify its headers and encoded hashes from the selected origin;
6. keep failures explicit for invalid transforms, out-of-volume coordinates,
   resource-integrity errors, and unsupported layouts.

After Q5 resolution:

7. encode the D043 transform and documented outside semantics;
8. select and document the production layout;
9. build a real immutable `ephys_atlas_volumes` release;
10. run linked-slice browser acceptance against it.

Acceptance reference: `docs/LAUNCH_SPEC.md` sections 3 and 6.

## P2S — Anatomy smoothing and simplification lab

Status: **complete through human review; D045 retains exact geometry and stops
without a shortlist**.

The exact bilateral 10 µm registered paths preserve raster-cell boundaries and
can look visibly stair-stepped when enlarged. Build a standalone, offline lab
to compare exact geometry with deterministic topology-aware smoothing and
simplification candidates before considering any new immutable anatomy asset.
The lab must keep rejected candidates visible with their failed gates, support
human visual review across all three projections, and provide a separate
full-corpus validation path for any shortlist. It must not modify the active
projection pack or introduce runtime smoothing.

D039 additionally requires the lab to pin the Allen 10 um average-template
intensity volume and expose exact/candidate boundaries over that anatomical
image, together with per-candidate encoded sizes, geometry/scientific metrics,
and representative browser costs. This investigation should run before the
production projection asset is frozen. Slices 1-3 now provide the pure strategy,
metric, failure-retention, synthetic-topology, deterministic report, pinned
source-validation, stress-selection, exact-parent regeneration, and interactive
offline review machinery. Slice 4 is complete: the repository owner preferred
exact option A in all three representative projections, so the predeclared rule
stopped without a shortlist. D045 retains exact geometry; Slices 5-6 are not
required and the lane is closed unless explicitly reopened with new evidence.
The report defaults to a one-question guided A/B review with distinct A-better,
no-meaningful-difference, and B-better responses, synchronized mouse navigation,
fixed A-left/B-right placement, previous-answer correction, adaptive
representative/stress rounds, and an exportable decision record; the
exhaustive evidence explorer is optional. Its recorded rule may
recommend retaining exact geometry or investigating a safer method, but cannot
promote the rejected diagnostic candidate or alter production geometry.
Long report runs now use identity-bound atomic per-variant checkpoints, expose
selection/percentage/ETA/heartbeat progress, and may evaluate independent
variants with an explicit bounded process-worker count without changing
deterministic report ordering or bytes.

The ordered implementation slices, metric contract, UI requirements,
scientific boundaries, and promotion stopping point are specified in
`docs/rendering/ANATOMY_SMOOTHING_LAB_PLAN.md`.

## P3D — Independent brain-mesh 3-D lab

Status: **geometry and LOD direction resolved by D042; runtime integration
complete through Commit 6; immutable deployment is non-blocking follow-up**.

The explicitly authorized worktree described by `AGENTS.md` has completed its
experimental purpose and now remains frozen as donor evidence. Its isolation
boundary remains authoritative: the lab must not import or fork `AtlasApp`, the
2-D projection viewport, URL state, or dataset sessions. Main integration owns
the context-content and shared regional-presentation contracts; port only
reviewed mesh-pack tooling, 3-D runtime behavior, and the standalone lab.

The completed donor at `ba1e2d129753bdc459bca7b23fa896f41ee13536`
demonstrates deterministic offline compilation, exact hemisphere clipping,
verified EAM3/meshopt loading, merged rendering, mapping/color/selection,
press-referenced arcball controls, and grouped explode. It is evidence, not an
integration branch: do not bulk merge or rebase it onto `main`.

The approved integration was reconstructed on `main` in the ordered commits
defined by `docs/rendering/3D_INTEGRATION_PLAN.md`. The existing
secondary/context slot is the integration seam; the four workspace slots and
2-D projection registry do not gain a permanent fifth panel or 3-D projection.

Commit 0 recorded green current-main and frozen-donor baselines without copying
or rebasing donor code. Commit 1 established the sole snake_case schema-v1
mesh contract, deterministic compiler/validator machinery, and a reproducible
tiny test-only bilateral pack. Commit 2 added verified manifest/LOD transport,
consumer-safe cancellation, worker-owned gzip and strict EAM3 raw/meshopt
decode, decoder-contract cache identity, and a bounded decoded CPU LRU. Commit
3 added the retained Three viewport boundary and thin fixture-backed lab:
merged hemisphere uploads, shader lookup presentation and explode, signed
filtered picking, press-referenced arcball, atomic LOD replacement, demand-only
rendering, resize/context-loss/disposal ownership, and failed-upgrade retention
are covered in Chromium. The obsolete exploratory renderer facade was removed.
Commit 4 added one pure application-owned regional-presentation resolver and
migrated registered, static, and 3-D applicators to its mapping, anatomy/
feature color, visibility, signed selection/hover, and left-feature semantics;
the duplicate renderer-local bilateral resolution is gone. Commit 5 made
`brain-3d` registry-driven context content without adding a projection or
workspace slot, and added validated renderer-neutral camera/explode state with
canonical optional URL-v4 fields, debounced camera history, responsive/null-
host behavior, and no mesh request before integration. Commit 6 added the thin
optional adapter: an explicitly configured immutable descriptor lazily creates
the retained viewport, shared presentation/selection/camera state stays linked,
hidden work pauses, failures remain isolated, and teardown is owned. The
canonical fixture is injected only by the browser-test server and is never a
runtime fallback.

D042 closes the geometry/LOD question with the already reviewed donor
compiled-full resource: pinned GLB geometry, 4,958,039 bytes, 989,811 retained
triangles, no smoothing, no triangle decimation, and no upgrade LOD. The later
canonical-annotation regeneration direction is retired. Remaining 3-D work is
limited to schema-v1 repackaging that preserves the selected inventory and
topology, immutable deployment, and ordinary cross-browser release checks. It
is not the next product milestone and must not delay M2 volume work.

Experiment evidence and budgets remain in `docs/rendering/3D_EVALUATION.md`.

## M3 — `ephys_atlas_clusters`

Status: **dual-histogram implementation in progress; earlier immutable local
release retained; online publication deferred**.

Implemented:

- explicit project and content-addressed source snapshots;
- explicit nonempty feature catalog with no hardcoded launch default;
- all-cluster, equal-cluster regional aggregation with no good-unit filter;
- left-folded Allen/Beryl/Cosmos summaries, provenance, and validation.

The source project is `ibl_neuropixel_brainwide_01` by D038. D044 resolves Q6
by approving every one of the original project's 14 scalar cluster features,
its explicit unit map, implementation-grounded descriptions, and robust v2
display policy. The checksummed selection is machine-consumable and fail-closed.
The complete 14-feature, three-parcellation release validates under schema v1,
reproduces byte-for-byte, and passes opt-in production-HTTP Chromium acceptance.
Exact hashes and commands are in `docs/data/CLUSTERS_RELEASE.md`.

Next actions:

1. regenerate a distinct immutable candidate implementing D046's exact
   linear/logarithmic histogram variants, validate it, and complete guided
   visual review without altering the earlier candidate;
2. keep both ignored immutable releases reproducible and the selected
   candidate's opt-in acceptance suite green;
3. publish the reviewed bytes and add the release to the public catalog
   only when Q8/Q9 publication and default-alias decisions are authorized;
4. repeat acceptance against the selected public origin.

Acceptance reference: section 5 of the launch spec.

## M4 — `brainwide_map`

Status: **deterministic local release and HTTP browser acceptance complete;
online publication deferred**.

Q7 is resolved by D038. The launch product preserves the five existing
Beryl-only v1 Parquet families with exact source hashes and semantic
equivalence evidence; it is not a current paper-pipeline regeneration.

Implemented locally:

- fail-closed byte-size/SHA-256 verification before Parquet decoding for all
  five families and the pinned Beryl metadata used by the legacy generator;
- rejection of builder provenance pins that are not commits in the local
  repository;
- a deterministic Beryl-only schema-v1 adapter with explicit legacy-snapshot
  provenance;
- equivalence coverage for lateralization, aggregation, six-significant-digit
  serialization, and boolean significance presentation;
- exact-input local validation of 30 features over 210 Beryl regions;
- an opt-in test-only local catalog exercising the production HTTP reader;
- Chromium acceptance for the dynamic 30-feature catalog, Beryl-only context,
  legacy significance values/provenance, feature switching, and CSV download.

Next actions:

1. keep the ignored release reproducible and its opt-in acceptance suite green;
2. add it to the public catalog only when publication is authorized.

Acceptance reference: section 7 of the launch spec.

## M5 — Downloads and local import completion

Status: **launch download path implemented; direct-URL and broader package UX remain non-blocking follow-ups**.

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
- schema-v1 release and feature artifact descriptors survive browser validation
  with their role, description, media type, byte size, hash, codec, and path;
- one download dialog exposes contextual regional CSV plus every declared
  feature/release artifact without implying that an artifact belongs to a
  representation its description does not claim;
- regional and volume views can download immutable artifact bytes through the
  same published/local resource-reader boundary, preserving encoded gzip bytes
  and verifying published byte size/SHA-256 before download;
- artifact integrity failures remain explicit and do not produce corrupt
  downloads; deterministic Chromium coverage exercises successful volume
  artifact download and checksum failure.

Goals:

- optional direct immutable artifact URL display/navigation for published data;
- deterministic whole-release package path as a non-blocking follow-up where practical;
- broader local-dataset management UX where practical.

Requirements:

- do not invent a second local schema;
- browser-imported content must fail explicitly if resources are missing/inconsistent;
- exports must identify immutable release/feature/parcellation/statistic context.

Acceptance reference: sections 8 and 9 of the launch spec.

## M6 — Production assets, catalog, publishing, deployment

Status: **registered anatomy integrated; S3/CloudFront direction selected; deployment details open**.

Blocked in part by: Q8 and Q9.

Actions:

1. provision a staging S3 REST origin and CloudFront distribution without
   accessing `iblviz`, then deploy the committed immutable projection pack and preserve opaque
   `.isvg.gz` bytes without HTTP `Content-Encoding`;
2. finalize static public catalog/default aliases for the frozen scientific release set;
3. configure and verify production CORS, MIME, cache, and bucket-access policy;
4. deploy or explicitly waive the remote publishing service for launch;
5. if deployed, configure validator command, secrets, storage, backups, and TLS/reverse proxy;
6. verify anatomy and scientific release URLs from the production origin.

Acceptance reference: sections 10, 11, and 13.

## M7 — Release QA and performance

Status: **not started as final release gate**.

Actions:

1. run `just check` from a clean checkout;
2. run representative real-data performance measurements;
3. execute automated Chromium plus the documented manual Firefox/Safari matrix
   selected by D040/Q11;
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
