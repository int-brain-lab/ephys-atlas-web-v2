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
and validated local channel/cluster/Brain-Wide Map/volume candidates are
implemented and green. [`INTEGRATION_STATUS.md`](INTEGRATION_STATUS.md) records
their current maturity; focused evidence lives under `docs/data/` and
`docs/rendering/`.

## P4D — Complete audited distribution selections

Status: blocked on owner review; the four read-only source audits and review
tables were completed on 2026-08-29.

Blocker: owner review is required before changing any Q14 selection. The exact
local evidence identities and descriptive results are recorded in
[`data/DISTRIBUTION_AUDIT_EVIDENCE.md`](data/DISTRIBUTION_AUDIT_EVIDENCE.md).

Next testable actions:

1. review the four local tables and approve exact per-feature
   scales/domains/thresholds/defaults, or retain the existing baseline;
2. after explicit approval, update complete selection artifacts, commit them
   before building, create new immutable release IDs, validate exact tails and
   scale/domain cross-products, run dataset browser suites,
   `just validate-local-full`, and `just check`.

The named D050 release directories were absent from this local workspace, so
their inventory step remains unavailable; older pre-D050 regional releases are
not scientific substitutes.

Do not promote audit heuristics into release defaults. D052 applies only to
regional channel `peak_val.raw`; D048 remains authoritative for the current
cluster firing-rate candidate.

Acceptance: [`LAUNCH_SPEC.md`](LAUNCH_SPEC.md) sections 2 and 3; binding runbook:
[`data/DISTRIBUTION_AUDIT.md`](data/DISTRIBUTION_AUDIT.md).

## M5 — Custom authoring and ZIP import

Status: active; D051 direction is accepted and implementation has not started.

Blocker: none for the regional scalar vertical slice.

Next testable actions:

1. add the public `ibl-ephys-atlas` distribution and `ibl_ephys_atlas`
   namespace beside the shared schema-v1 serializer/validator;
2. implement regional scalar authoring with explicit identity, aggregation,
   provenance, and hemisphere-folding rules backed by `iblatlas`;
3. write one deterministic `.ibl-ephys-atlas.zip` containing the schema-v1
   graph at its root;
4. replace the dormant directory import seam with bounded safe ZIP preview,
   complete integrity validation, and one atomic IndexedDB admission;
5. add persistent Local identity, inventory/deletion, quota/recovery behavior,
   and local-URL disclosure;
6. add explicit-grid volume authoring only after the regional slice is green.

The ZIP reader must reject unsafe or duplicate paths, encrypted/unsupported
entries, undeclared files, excessive sizes, and any integrity mismatch before
storage mutation. It must not introduce a second scientific schema.

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

Status: S3/CloudFront direction accepted; concrete deployment remains blocked.

Blockers: residual Q8 and Q9. Remote mutation requires explicit authorization
and credentials.

Next testable actions:

1. provision an IBL-owned staging S3 REST origin and CloudFront distribution
   without accessing `iblviz`;
2. deploy the immutable projection pack with opaque `.isvg.gz` bytes and verify
   served size, SHA-256, MIME, CORS, and cache behavior;
3. finalize the frozen scientific release set, catalog, and aliases;
4. deploy or explicitly waive the publishing service; if deployed, configure
   validation, secrets, storage, backups, TLS, and reverse proxy;
5. verify all anatomy and scientific release URLs from the production origin.

Acceptance: [`LAUNCH_SPEC.md`](LAUNCH_SPEC.md) sections 10, 11, and 13.

## M7 — Final release QA

Status: blocked until production releases/origin/defaults are available.

Blockers: Q2, Q5, residual Q8, and Q9. Residual Q14 blocks only additional
unapproved scale/domain selections, not the already validated baseline choices.

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
