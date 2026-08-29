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

1. measure the provisional archive, entry, expansion, path, and manifest
   ceilings with representative regional and volume bundles in Chromium,
   Firefox, and Safari; record peak memory, preview latency, failure behavior,
   and IndexedDB quota results before freezing supported limits;
2. exercise representative real public-authored archives at supported capacity
   and publish the Python distribution only after explicit authorization.

The pinned zip.js reader rejects unsafe or duplicate paths, non-regular,
encrypted, split/Zip64, nested, or unsupported-compression entries, undeclared
files, provisional size/ratio excesses, and integrity mismatches before storage
mutation. Preparation is local-only and read-only; the application seam keeps
one IndexedDB admission of individual resources separate so the UI can invoke
it only after explicit confirmation. The current ceilings remain provisional
pending real-archive, cross-browser, and quota measurement. This work must not
introduce a second scientific schema.

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
capacity evidence and distribution publication remain unfinished. The user
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
deployment remains blocked.

Blockers: residual Q8 and Q9. Remote mutation requires explicit authorization
and credentials.

Next testable actions:

1. provision an IBL-owned staging S3 REST origin and CloudFront distribution
   without accessing `iblviz`;
2. deploy the immutable projection pack with opaque `.isvg.gz` bytes and verify
   served size, SHA-256, MIME, CORS, and cache behavior;
3. deploy the completed pinned development bundle without transforming its
   immutable browser-ready bytes, create a new descriptor with exact resolved
   HTTPS sources, and exercise the implemented atomic `just data` path from a
   clean checkout;
4. finalize the frozen scientific release set, catalog, and aliases;
5. deploy or explicitly waive the publishing service; if deployed, configure
   validation, secrets, storage, backups, TLS, and reverse proxy;
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

## Agent task-selection rule

1. Confirm `just check` on current `main` or establish the baseline failure.
2. Choose the earliest unblocked action above.
3. Prefer one end-to-end vertical slice over unused abstractions.
4. Never answer an item in [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) without
   authoritative evidence and required owner approval.
5. Finish with targeted tests, `just check`, updated durable status, and a
   coherent green commit.
