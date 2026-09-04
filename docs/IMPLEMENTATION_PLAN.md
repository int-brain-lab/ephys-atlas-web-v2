# Implementation plan

Status: active execution registry.

This file contains incomplete, executable work only. Completed implementation
history remains in decisions, focused evidence, release records, and Git. Work
top-to-bottom unless a lane is blocked and a later lane has an independent,
testable action.

## Current dependency summary

The schema-v1 producer/consumer cutover, five-view retained 2-D workspace,
optional sibling 3-D context, regional and volume exploration foundations,
publishing service, contextual/artifact downloads, D050 distribution contract,
and D054-reviewed local channel/cluster/Brain-Wide Map/volume releases are
implemented and green. [`INTEGRATION_STATUS.md`](INTEGRATION_STATUS.md) records
their current maturity; focused evidence lives under `docs/data/` and
`docs/rendering/`.

## Immediate product priorities

Repository-owner priority, recorded 2026-09-02, overrides the milestone order
below when selecting independent work:

1. implement the generic D056/D061 project/dataset/release catalog and
   project-edition machinery through the four green slices below, using
   synthetic fixtures for edition values; Q9 continues to block only the real
   paper-facing edition identity, scoped release mapping, defaults, aliases,
   and freeze process;
2. implement the deterministic synthetic documentation captures in
   [`DOCUMENTATION_SCREENSHOT_PLAN.md`](DOCUMENTATION_SCREENSHOT_PLAN.md) and
   add their non-mutating drift check to `just check`;
3. implement the flexible multi-feature comparison foundation and scientist-
   iteration sequence in
   [`tasks/2026-09-02-multi-feature-comparison/`](tasks/2026-09-02-multi-feature-comparison/README.md).

The previously second-ranked bounded scalar-presentation follow-ups are
complete. Q16 still retains real-feature palette and diverging-center choices.

All other active, deferred, and discussion work follows this recorded priority
sequence unless it is required to unblock or validate it, or a later
repository-owner decision changes the order. Deployment, remote publication,
and production-origin work remain separately gated by their existing
authorization and open questions.

### Catalog and navigation slices

1. add unresolved request versus exact resolved navigation, explicit
   edition/custom-with-optional-baseline/local context, intent-specific
   transitions, catalog-first startup and `popstate`, URL-v4 canonicalization,
   local lifecycle transitions, and separate failure domains;
2. implement the desktop/tablet Project/Dataset/Feature/View bar, edition or
   custom disclosure, exact release override/re-entry, View terminology, and
   loading/recovery behavior;
3. implement the narrow staged Data chooser, accessible grouped-menu keyboard
   behavior, responsive/local/error matrices, production-style synthetic
   catalog coverage, and durable completion documentation.

The atomic catalog/compiler cutover is complete. Schema v1, both validators,
the shared corpus, curator-owned compile/promote path, immutable edition
history, the synthetic Vite producer, and distinct public/local browser
composition now use only the D056/D061 contract. Ordinary release publication
does not grant catalog discovery or edition membership.

Run targeted contract, publishing, resolver, URL, repository, and browser tests
within each slice, then `just check` before its commit. The binding field,
transition, UI, failure, and test rules are in
[`frontend/DATASET_NAVIGATION.md`](frontend/DATASET_NAVIGATION.md).

## M5 — Custom authoring and ZIP import

Status: active; the Allen regional/volume authoring and browser ZIP-import
vertical slices are implemented. One `ibl-ephys-atlas` distribution contains
the public `ibl_ephys_atlas` API and internal builder namespace, exact bundled schema v1,
deterministic independently validated ZIP output, and clean-wheel coverage.
The bounded two-phase browser import, persistent Local identity, and automated
Chromium evidence are also complete. Five deterministic executable examples,
generated public API reference, and a locally served strict documentation site
are covered by `just check`; no site deployment or PyPI publication is
configured.

Blocker: none for the remaining independent extensions. PyPI publication is
not authorized or complete.

Next testable actions:

1. keep the reproducible capacity corpus and regression harness green, and
   capture native-Safari quota/process-RSS plus representative end-user-device
   evidence before advertising a broadly supported maximum capacity;
2. implement the deterministic synthetic documentation captures in
   [`DOCUMENTATION_SCREENSHOT_PLAN.md`](DOCUMENTATION_SCREENSHOT_PLAN.md), then
   add their non-mutating drift check to `just check`;
3. publish the Python distribution only after explicit authorization.

The pinned zip.js reader rejects unsafe or duplicate paths, non-regular,
encrypted, split/Zip64, nested, or unsupported-compression entries, undeclared
files, provisional size/ratio excesses, and integrity mismatches before storage
mutation. Preparation is local-only and read-only; the application seam keeps
one IndexedDB admission of individual resources separate so the UI can invoke
it only after explicit confirmation. The measured campaign retained the 1 GiB
archive, 20,000-entry, 1.5 GiB expanded-data, and 1000:1 ratio ceilings and
raised the aggregate declared decoded-resource budget to 3 GiB. Representative
real archives passed Chromium, Firefox, and native Safari; supported capacity
wording remains provisional because native-Safari quota/process-RSS and typical
end-user-device evidence were not captured. This work must not introduce a
second scientific schema. See
[`data/LOCAL_IMPORT_CAPACITY_EVIDENCE.md`](data/LOCAL_IMPORT_CAPACITY_EVIDENCE.md).

The implemented regional API requires explicit `BrainRegions`, identity kind,
scientific semantics, aggregation, provenance, and hemisphere policy. Repeated
Allen observations may be remapped observation-by-observation to Beryl/Cosmos
before mean aggregation; already-aggregated values remain Allen-only. It emits
only neutral Linear/Full releases. Atomic per-release deletion, deterministic
published fallback, actionable quota-exhaustion errors, and local-URL Share
disclosure are implemented. The manager inventories exact source identities,
import times, Blob bytes, resource counts, and integrity state; reports origin-
wide quota/persistence separately; and supports explicit deep verification and
delete/reimport recovery. The volume API accepts only factory-verified
`AllenCCFGrid` geometry from an already-created `AllenAtlas`, exact
float16/float32 arrays, and explicit mask or sentinel validity. It writes
deterministic chunks3d resources and valid-only
summaries without registration or value transformation. The committed tiny
synthetic volume is exactly regenerable and imports, renders, navigates, and
reloads without scientific HTTP reads in Chromium. Cross-browser real-archive
capacity evidence is recorded; distribution publication remains unfinished.
The user
path is documented in
[`data/CUSTOM_DATA_TUTORIAL.md`](data/CUSTOM_DATA_TUTORIAL.md).

Acceptance: [`LAUNCH_SPEC.md`](LAUNCH_SPEC.md) sections 8 and 9; binding plan:
[`data/CUSTOM_DATA_AUTHORING.md`](data/CUSTOM_DATA_AUTHORING.md).

## M1 — Freeze and stage `ephys_atlas_channels`

Status: validated-real-local development release complete; staging and paper
freeze remain.

Blockers: Q2 blocks the paper release; residual Q8 blocks origin-specific
staging evidence.

Next testable actions:

1. keep the immutable `2026_W32` development release and real-value browser
   suite reproducible;
2. after a staging origin is authorized, deploy the existing bytes and repeat
   acceptance against its headers and caching;
3. after Q2 is resolved, repeat the deterministic build and acceptance suite
   for the exact paper vintage without mutating prior releases.

Acceptance: [`LAUNCH_SPEC.md`](LAUNCH_SPEC.md) sections 2 and 4; evidence:
[`data/DEVELOPMENT_RELEASE.md`](data/DEVELOPMENT_RELEASE.md).

## M2 — Confirm volume transport and build the production release

Status: browser/builder machinery and full 41-feature candidates are complete;
production transport remains blocked.

Blockers: Q5, which depends on the selected Q8 CloudFront origin. D043 already
fixes the exact W26 geometry and outside/missing semantics.

Next testable actions:

1. retain the checksummed depth-4/depth-8 candidates and current local evidence;
2. repeat the depth-4 recommendation at the selected CloudFront origin,
   recording request count, bytes, decode/interaction latency, and memory;
3. resolve Q5 from that evidence;
4. build a new immutable W26 production release using the D043 selection and
   chosen layout, then run linked-slice production-origin acceptance.

Never generalize the D043 affine beyond the pinned W26 source identity.

Acceptance: [`LAUNCH_SPEC.md`](LAUNCH_SPEC.md) sections 3 and 6; runbook:
[`data/VOLUME_IMPLEMENTATION_HANDOFF.md`](data/VOLUME_IMPLEMENTATION_HANDOFF.md).

## M3/M4 — Publish clusters and Brain-Wide Map

Status: deterministic validated-real-local releases and production-style HTTP
browser acceptance are complete; online publication is deferred.

Blockers: residual Q8 and Q9.

Next testable actions:

1. keep both ignored immutable releases reproducible and their opt-in suites
   green;
2. after publication/default authorization, publish the reviewed bytes without
   rebuilding or changing scientific content;
3. add immutable releases to the public catalog and repeat acceptance at the
   selected origin.

Acceptance: [`LAUNCH_SPEC.md`](LAUNCH_SPEC.md) sections 5 and 7; cluster record:
[`data/CLUSTERS_RELEASE.md`](data/CLUSTERS_RELEASE.md).

## M6 — Production assets, catalog, and deployment

Status: the exact BWM and D042 inputs were recovered and verified; their new
immutable technical outputs, complete local descriptor, verifier, `just data`,
atomic downloader, descriptor-driven read-only `just dev`, focused launcher
compatibility, and onboarding command cleanup are implemented. Concrete
deployment remains blocked. D059 selects exact staging and production roots in
an authenticated IBL-owned private S3 bucket and the planned initial viewer
domain. D060 selects one CloudFront boundary for the S3-hosted Vite viewer and
data plus a local, operator-invoked publisher; no Cloudflare Pages or hosted
publishing server is planned. No remote mutation or public delivery
configuration has occurred.

Blockers: residual Q8 and Q9. Remote mutation requires explicit authorization
and credentials.

Next testable actions:

1. implement the D060 local S3 publisher by reusing the existing validation and
   immutable-publication rules, then provision isolated staging and production
   CloudFront distributions with OAC, DNS, ACM/TLS, and a production origin
   restricted to the D059 namespace, without accessing `iblviz`;
2. deploy the immutable projection pack with opaque `.isvg.gz` bytes and verify
   served size, SHA-256, MIME, CORS, and cache behavior;
3. deploy the completed pinned development bundle without transforming its
   immutable browser-ready bytes, create a new descriptor with exact resolved
   HTTPS sources, and exercise the implemented atomic `just data` path from a
   clean checkout;
4. implement the four D056/D061 schema/catalog, resolved-navigation,
   desktop/tablet, and narrow/accessibility slices above using synthetic
   edition values; then, after Q9 is resolved, configure the real project
   edition, frozen scientific release set, defaults, and aliases;
5. deploy the compiled Vite site below the production `site/` namespace and
   verify that `ephys-atlas.iblcore.org` serves the entry document, immutable
   hashed assets, and same-origin data with the selected cache policies;
6. verify all anatomy and scientific release URLs from the production origin.

Acceptance: [`LAUNCH_SPEC.md`](LAUNCH_SPEC.md) sections 10, 11, and 13.
Binding local-bundle plan:
[`data/LOCAL_DEVELOPMENT_BUNDLE.md`](data/LOCAL_DEVELOPMENT_BUNDLE.md).
Valid local entries are reused without network access; resolved missing entries
stage and pass full integrity/graph validation before atomic installation.
Current v4 sources remain unresolved, so `just data` reports actionable Q8
blockers in a fresh checkout and `just dev` performs validation only.

## M7 — Final release QA

Status: blocked until production releases/origin/defaults are available.

Blockers: Q2, Q5, residual Q8, and Q9.

Next testable actions after unblock:

1. run `just check` from a clean checkout;
2. record representative real-data performance;
3. run automated Chromium and the D040 manual Firefox/Safari matrix;
4. verify desktop/tablet/phone behavior, deep links, immutable URLs, failure
   states, downloads/local import, and production CORS/cache/Range behavior;
5. ensure every launch blocker is resolved or explicitly waived;
6. update [`INTEGRATION_STATUS.md`](INTEGRATION_STATUS.md) to shipped state.

Acceptance: [`LAUNCH_SPEC.md`](LAUNCH_SPEC.md) definition of launch-ready.

## Deferred work

Do not select these while launch lanes are threatened unless a new decision
promotes them: richer production 3-D, AGEA, MERFISH, large point clouds,
inferential statistics, broad legacy custom-bucket compatibility, and full
OAuth/user identity.

The proposed 3-D follow-up that preserves native GLB connected components,
keeps medial components fixed during explode, and retains D042 as an immutable
rollback is recorded in
[`tasks/2026-09-02-native-3d-mesh-components/`](tasks/2026-09-02-native-3d-mesh-components/README.md).
It remains deferred and must begin by durably preserving the ignored D042 file
graph; the record does not select a new production default.

The bounded scalar-presentation follow-ups for outside-brain tooltip
suppression, selectable regional `std`, the expanded palette registry,
release-preferred Auto palettes, synthetic explicit-center machinery, and
regional-relative dot tracks are recorded in
[`tasks/2026-09-02-scalar-presentation-followups/`](tasks/2026-09-02-scalar-presentation-followups/README.md).
They are not launch blockers. Q16 retains all real feature-by-feature palette
and center selections for a future immutable release, and D050/LS03-03 volume
regional distributions remain explicitly deferred.

The fourth immediate product priority, the accepted flexible multi-feature
comparison foundation and scientist-iteration sequence, is recorded in
[`tasks/2026-09-02-multi-feature-comparison/`](tasks/2026-09-02-multi-feature-comparison/README.md).
It supports arbitrary release-ordered feature scopes through Focus, virtualized
Gallery, and Profile views rather than imposing a three-feature domain limit.
D058 fixes z-score comparison and modular boundaries; Q17 retains the real-
data normalization populations and parameters. Begin with synthetic fixtures
and a development-only UX lab, and do not add a bulk transport contract until
measured access patterns justify it.

D055 also accepts an optional unlisted-sharing follow-up, but it is not a
launch blocker and must remain distinct from official publishing. After Q15 is
resolved, the smallest vertical slice is: provision an isolated CloudFront OAC
and private S3 test origin with create-only conditional writes and expiry;
upload one synthetic golden release from IndexedDB using an opaque share ID and
completion marker; reload it through the ordinary HTTP reader with full
schema/size/hash validation; exercise corruption, incomplete upload, overwrite,
expiry disclosure, method denial, and upload-disable behavior; then record
cost/security evidence before enabling the UI outside a test environment.

## Agent task-selection rule

1. Confirm `just check` on current `main` or establish the baseline failure.
2. Choose the earliest unblocked action above.
3. Prefer one end-to-end vertical slice over unused abstractions.
4. Never answer an item in [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) without
   authoritative evidence and required owner approval.
5. Finish with targeted tests, `just check`, updated durable status, and a
   coherent green commit.
