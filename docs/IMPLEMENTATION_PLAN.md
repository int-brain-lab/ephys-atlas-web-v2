# Implementation plan

Status: active execution registry.

This file contains only incomplete work and the shortest path to launch.
Completed behavior belongs in code, decisions, evidence, and
[`INTEGRATION_STATUS.md`](INTEGRATION_STATUS.md). Work top-to-bottom when a lane
is unblocked; never invent an answer from [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md).

## Current state

Schema v1, all four scientific builders, the retained five-view 2-D viewer,
optional 3-D context, local ZIP authoring/import, downloads, project-edition
navigation, distributions, comparison foundations, and the reviewed local data
bundle are implemented. Linux is now the canonical production environment;
macOS is a preview host. `just data-refresh-local` verifies whether upstream
channel/cluster `latest` aliases still match the reviewed releases and stops if
new scientific review is needed.

The launch path is constrained by Q8, then Q5, Q2, and Q9.

## M6 — Finish staging and publication machinery

Status: active; release preflight, S3 dataset-release and curator catalog/edition
transactions, validated pack/site publication and the isolated site build are
implemented with offline tests. Remote infrastructure and staging evidence
remain incomplete. The 2026-09-08 authenticated audit confirms the production
distribution, DNS/TLS, private bucket and narrowed OAI grant; isolated staging
and publisher write authorization remain unverified.

Blocker: Q8 for existing-site routing setup and unverified publisher access.
D074's direct first-deployment amendment removes separate staging infrastructure
as a prerequisite. Actual creation of the production router was denied; see the
reduced, unsent [administrator request](publishing/AWS_DEPLOYMENT_ACCESS_REQUEST.md).

Next actions:

1. Obtain the production router and scoped operator access for the existing
   distribution. Preserve the existing OAI, origin, DNS, certificate and bucket
   settings; no staging identity or distribution is required.
2. Rebuild/preflight the approved initial releases and packs on clean Linux
   `main` at the publication commit. The complete earlier build and eight offline
   publication plans passed at `9e8d116`; later commits require fresh provenance.
3. Publish approved immutable data, promote the catalog, and build/publish the
   landing/viewer against actual dependency hashes. Apply reviewed routing/cache
   settings to the existing atlas distribution with fresh ETag and rollback evidence.
4. Record actual served-byte SHA-256, MIME, Range, cache, private-prefix denial
   and desktop/mobile browser evidence before wider promotion.
5. Create a development-bundle descriptor with exact immutable HTTPS sources
   and prove `just data` from a clean checkout.

Runbook: [S3 deployment](publishing/S3_DEPLOYMENT.md). Acceptance:
[`LAUNCH_SPEC.md`](LAUNCH_SPEC.md) sections 10, 11, and 13.

## M2 — Confirm and build the production volume release

Status: blocked by Q5, which depends on working Q8 CloudFront delivery. D043 already
fixes W26 geometry and validity; local evidence favors depth-four orthogonal
slice packs.

For the direct first-deployment path, first implement and test a non-catalogued
benchmark delivery mode at the existing origin. Preserve ordinary production
release guards; the current benchmark mode is staging-only.

The earlier isolated-staging alternative remains:

1. Use the implemented staging-only candidate publication path:
   preserve candidate IDs and keep candidates out of production and
   curator defaults. Then repeat depth-four measurements at the real origin, recording requests,
   bytes, decode/interaction latency, and memory.
2. Resolve Q5 from that evidence.
3. Build a new immutable W26 release on clean Linux `main`, run production
   preflight, stage it, and repeat linked-slice acceptance.

Never generalize D043 beyond the pinned W26 source. Evidence and procedure:
[`data/VOLUME_2026_W26_EVIDENCE.md`](data/VOLUME_2026_W26_EVIDENCE.md).

## M1/M3/M4 — Freeze the paper dataset set

Status: reviewed local channel, cluster, and Brain-Wide Map releases are green;
paper identity and publication remain incomplete.

For initial deployment, D074 selects W32 channels and defaults; the exact
initial release/edition IDs are tracked in `data/deployment/initial-curator.json`.
Q2/Q9 remain for a separate paper freeze, not initial deployment authorization.

After those decisions:

1. Pull and pin the selected channel source; apply only approved recipe and
   selection artifacts.
2. Build every production scientific release on clean Linux `main` and run
   `just production-release-preflight <release...>`.
3. Stage and verify the complete set without altering immutable bytes.
4. Compile and promote the curator-owned catalog/edition mapping last.

Dataset authority: [`data/README.md`](data/README.md). Acceptance:
[`LAUNCH_SPEC.md`](LAUNCH_SPEC.md) sections 2–7.

## M7 — Final release QA

Status: blocked until the production origin, releases, and defaults exist.

Run from the release commit on Linux:

1. Run `just check` and every release preflight.
2. Record production-origin performance and failure behavior.
3. Exercise desktop/tablet/phone, deep links, downloads, and local import.
4. Run Chromium automation plus the D040 Firefox and native Safari matrix.
5. Resolve or explicitly waive every launch blocker, then update
   [`INTEGRATION_STATUS.md`](INTEGRATION_STATUS.md) to shipped reality.

## Independent non-launch work

### AGEA — full-catalog single-experiment browsing

Status: active under D067/D069/D074. Source audit, Chromium/Firefox transport evidence,
shared metadata-bundle machinery and the main-website original-value local
preview are implemented. D074 approves initial deployment of the original-value
recipe, with provisional processing/registration notes only in Data details.
See [AGEA evidence and continuation](data/AGEA.md).

The [coverage lab](data/AGEA_COVERAGE_LAB.md) is implemented for scientist review
of the original-volume/coarse-label mismatch. Use its mask comparison and
aggregate coverage before selecting Q19's population/validity policy.

The same lab now includes fixed-transform alignment review against the actual
website projection pack: linked native planes, CCF-derived reference image or
original expression, coarse boundaries, presets and source-grounded note export.
The review uses the atlas dark theme and a five-location save-and-advance flow;
experiment browsing, extra overlays and coordinate evidence are collapsed.
Coordinate evidence is tested; biological registration remains pending owner
review and is not implied by agreement with the CCF-derived template.

The [stripe screening and review report](data/AGEA_STRIPE_REPORT.md) is
implemented: direct-source checks, Ptpru section-gap projection, synthetic
controls, full-catalog scores and a reproducible 12-page PDF. Next: scientist
adjudication of the declared examples and confirmation of section conventions.
Screening flags are not confirmed defects; no production QC choice is implied.

The [main-website local preview](data/AGEA_LOCAL_PREVIEW.md) now provides all
4,345 experiments, fully scrollable virtualized search, original values with explicit
missing masks, shared metadata acceleration and bounded/quota-safe caching.
Next: owner review of integrated expression, remaining Q19 public-release
decisions, and peak-memory/constrained/final-origin browser measurements.
Full-catalog ZIP import remains outside the current archive entry limit.

### Other independent work

These remain useful but must not displace the launch path:

- capture representative native-Safari quota/RSS evidence before advertising
  broad local-import capacity; publish `ibl-ephys-atlas` only with authorization;
- run scientist review of the implemented multi-feature Focus/Gallery/Profile
  UX; Q17 retains real normalization populations;
- select real-feature palette/center metadata under Q16;
- pursue D055 unlisted sharing only after Q15;
- develop the D066 [native 3-D component candidate](tasks/2026-09-02-native-3d-mesh-components/README.md).
  The [baseline/component audit](tasks/2026-09-02-native-3d-mesh-components/AUDIT.md)
  and synthetic topology tests are implemented. D068 fixes side-specific
  presentation and independent movement; [movement proposals](tasks/2026-09-02-native-3d-mesh-components/MOVEMENT_REVIEW.md)
  are accepted unchanged by D070, closing Q18. Native geometry and weighted
  blended OIT passed owner review; additional Firefox/Safari checks for this
  selection are waived. The approved pack and v5 main-website bundle are
  integrated, with D042 rollback configured separately. Next: ordinary website
  use; future public distribution is covered by Q8 and release preflight.
  This optional lane does not
  block launch;
- keep other richer 3-D, MERFISH, point clouds, inferential statistics, and
  broad legacy compatibility deferred.

## Agent completion rule

Inspect current code/tests, implement one coherent vertical slice, run targeted
tests and `just check`, update durable authority when reality changes, commit
only intended files, and leave the next action explicit. A blocker permits work
on an independent lane; it never permits guessing the blocked choice.
