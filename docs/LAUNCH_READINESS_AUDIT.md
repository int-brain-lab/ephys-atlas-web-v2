# Launch-readiness traceability audit

Status: active evidence ledger.

This document maps every active acceptance criterion in
[`LAUNCH_SPEC.md`](LAUNCH_SPEC.md) to current evidence, a blocker, or an
independent gap. It is a traceability aid, not product or decision authority.
The launch specification defines what must launch; code and tests establish
implementation; effective decisions govern accepted choices; and
[`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) is the stop-condition registry.

The ledger is intentionally conservative. A compound criterion is satisfied
only when all listed subclaims are evidenced. Validated-real-local and
simulated-origin evidence does not establish published-production maturity.
Rows marked satisfied can regress and must be rechecked on the release commit.

## Coverage and dispositions

The current specification contains 95 bullets in its 13 acceptance-criteria
blocks and six definition-of-ready gates. This count excludes the five
launch-scope dataset bullets and seven explicitly deferred bullets. Earlier
working notes counted 88 because they omitted section 1's seven bullets.

Dispositions are:

- **satisfied** — implementation and proportionate evidence exist at the
  maturity required by the criterion;
- **independent gap** — work can proceed without resolving an open scientific
  or deployment choice;
- **blocked Q2/Q5/Q8/Q9** — the named open choice prevents completion;
- **waived Dxxx** — an effective decision explicitly waives the criterion.

No criterion is currently recorded as waived. Evidence references name the
smallest useful files; they do not replace the assertions inside those files.

The 2026-08-31 local-import campaign does not change any disposition count:
it strengthens the already-satisfied LS08-05 evidence, while LS01-07 remains
an independent gap because focused import coverage is not the full release
browser matrix.

## Shared evidence

- **Navigation/UI:** `web/test/browser/app.spec.ts`,
  `projection-viewport.spec.ts`, `static-projections.spec.ts`,
  `panel-layout.spec.ts`, `keyboard-shortcuts.spec.ts`, and
  `url-history.spec.ts`; URL, reducer, and projection-navigation unit tests;
  [`FRONTEND_LIFECYCLE_AUDIT.md`](FRONTEND_LIFECYCLE_AUDIT.md).
- **Regional/distributions:** regional browser and unit suites,
  `web/test/browser/color-scale.spec.ts`,
  [`data/DISTRIBUTION_AUDIT_EVIDENCE.md`](data/DISTRIBUTION_AUDIT_EVIDENCE.md),
  and the four distribution-selection artifacts.
- **Volume:** [`data/VOLUME_2026_W26_EVIDENCE.md`](data/VOLUME_2026_W26_EVIDENCE.md),
  the D043 geometry selection, `tests/rendering/volume.test.ts`, volume unit and
  browser suites, and the volume-candidate/benchmark suites.
- **Scientific releases:** channel, cluster, and Brain-Wide Map recipes and
  release records under [`data/`](data/README.md), their Python tests, and the
  three focused real-release browser suites.
- **Local/import:** [`data/CUSTOM_DATA_AUTHORING.md`](data/CUSTOM_DATA_AUTHORING.md),
  [`data/LOCAL_IMPORT_CAPACITY_EVIDENCE.md`](data/LOCAL_IMPORT_CAPACITY_EVIDENCE.md),
  public-authoring/packaging/example tests, local archive/validation/repository
  unit tests, the local-import browser/benchmark suites, and the distinct
  native-Safari runner.
- **Publishing:** [`docs/publishing/API.md`](publishing/API.md) and all tests under
  `publishing/tests/`.
- **Anatomy/assets:** contracts and evidence indexed by
  [`rendering/README.md`](rendering/README.md), anatomy/projection builder tests,
  and projection/static/worker/cache browser tests.
- **Current maturity:** [`INTEGRATION_STATUS.md`](INTEGRATION_STATUS.md),
  [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md), and
  [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md), with reproducibility evidence in
  [`REPRODUCIBILITY_INTEGRITY_EVIDENCE.md`](REPRODUCIBILITY_INTEGRITY_EVIDENCE.md).

## 1. Application shell and navigation

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS01-01](LAUNCH_SPEC.md#ls01-01) | Desktop primary; tablet usable; phone may reduce composition. | Navigation/UI responsive browser cases. | satisfied | Repeat the viewport matrix on the release commit. |
| [LS01-02](LAUNCH_SPEC.md#ls01-02) | Coronal, sagittal, and horizontal share one navigation state. | Projection navigation and linked-guide tests. | satisfied | Retain coverage. |
| [LS01-03](LAUNCH_SPEC.md#ls01-03) | One ML/AP/DV cursor; native bilateral 10 µm affine grid. | Navigation tests plus projection-pack validation. | satisfied | Retain exact-grid assertions. |
| [LS01-04](LAUNCH_SPEC.md#ls01-04) | Discoverable Top/Swanson slot; shared color/hover/selection/focus; no slice/world/voxel claim. | `static-projections.spec.ts` and projection-pack tests. | satisfied | Retain all subclaim assertions. |
| [LS01-05](LAUNCH_SPEC.md#ls01-05) | Cursor/derived slices, dataset/release, feature, representation, parcellation, coloring, selection, and relevant workspace state round-trip in a share URL. | URL-state, reducer, app, static-projection, and volume tests. | satisfied | Add a single field-completeness assertion if the URL schema changes. |
| [LS01-06](LAUNCH_SPEC.md#ls01-06) | Maximize, drawers, and responsive composition are keyboard-reversible and browser-tested. | App, panel-layout, and keyboard browser tests. | satisfied | Repeat cross-browser. |
| [LS01-07](LAUNCH_SPEC.md#ls01-07) | Current Chrome/Edge, Firefox, and Safari are release targets; Chromium alone is insufficient. | D040; focused local-import evidence covers Chromium, Firefox, and native Safari, with Playwright WebKit recorded separately. This is not a complete release matrix. | independent gap | Record the full Chrome/Edge, Firefox, and native Safari release matrices on the release commit. |

## 2. Regional feature exploration

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS02-01](LAUNCH_SPEC.md#ls02-01) | Discover features from the immutable release. | Regional and focused real-release browser suites. | satisfied | Retain dynamic-catalog tests. |
| [LS02-02](LAUNCH_SPEC.md#ls02-02) | Load parcellation metadata and region index from the release. | Regional loader/validation and browser tests. | satisfied | Retain coverage. |
| [LS02-03](LAUNCH_SPEC.md#ls02-03) | Search loaded metadata, not a hardcoded list. | `app.spec.ts` search case and regional-model tests. | satisfied | Retain coverage. |
| [LS02-04](LAUNCH_SPEC.md#ls02-04) | Display the selected statistic for each region. | Regional model and browser assertions. | satisfied | Retain coverage. |
| [LS02-05](LAUNCH_SPEC.md#ls02-05) | Color registered regions from statistic, colormap, and range. | Regional presentation/scalar-colormap/browser tests. | satisfied | Retain coverage. |
| [LS02-06](LAUNCH_SPEC.md#ls02-06) | Region list and SVG share selection state. | Projection viewport, reducer, and region-tree tests. | satisfied | Retain coverage. |
| [LS02-07](LAUNCH_SPEC.md#ls02-07) | Persist selection in URL state. | URL-state and renderer-selection browser tests. | satisfied | Retain coverage. |
| [LS02-08](LAUNCH_SPEC.md#ls02-08) | Show global descriptive statistics and distribution/histogram. | Regional data/model and app browser tests. | satisfied | Retain coverage. |
| [LS02-09](LAUNCH_SPEC.md#ls02-09) | Release-available Linear/Log/Signed-log; one synchronized control across color, distributions, and range geometry. | Distribution selections, color-scale browser tests, scale unit tests. | satisfied | Retain synchronization assertions. |
| [LS02-10](LAUNCH_SPEC.md#ls02-10) | Independent Full/Focused domains in global/comparison/compact views; exact tails; whole-population normalization; unchanged color bounds. | D050/D053/D054 evidence and distribution tests. | satisfied | Retain every subclaim in focused-domain tests. |
| [LS02-11](LAUNCH_SPEC.md#ls02-11) | URL preserves explicit scale/domain; observations unchanged; thresholds/bounds/availability/defaults come only from immutable representation metadata. | URL, presentation-scale, validation, and D054 evidence. | satisfied | Keep metadata-authority and non-mutation assertions explicit. |
| [LS02-12](LAUNCH_SPEC.md#ls02-12) | Compare selected-region statistics/distributions with the global population. | Regional model, app, and comparison tests. | satisfied | Retain coverage. |
| [LS02-13](LAUNCH_SPEC.md#ls02-13) | Identify synthetic fixtures as non-scientific. | Browser fixture labels and `web/README.md`. | satisfied | Recheck fixture labeling on release commit. |

## 3. Volume exploration

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS03-01](LAUNCH_SPEC.md#ls03-01) | Preserve shape, dtype, axes, validity, and affine; derive or strictly validate redundant voxel/origin fields. | Schema, builder, geometry, and volume unit tests. | satisfied | Retain property-level assertions. |
| [LS03-02](LAUNCH_SPEC.md#ls03-02) | Valid/outside/missing counts are exclusive and exhaustive; statistics/histogram use valid voxels only. | Volume-summary and distribution validation tests. | satisfied | Retain conservation assertions. |
| [LS03-03](LAUNCH_SPEC.md#ls03-03) | Same declared scales/domains where available; volume remains global and valid-only; no regional comparison curves. | Color-scale and volume browser/unit tests. | satisfied | Retain negative regional-curve assertion. |
| [LS03-04](LAUNCH_SPEC.md#ls03-04) | Map anatomy coordinates through the declared scientific transform, never SVG calibration. | D043, rendering volume tests. | satisfied | Retain transform-separation tests. |
| [LS03-05](LAUNCH_SPEC.md#ls03-05) | Exact `reference_space_id` equality before composition; distinct grids/resolutions/shapes/affines allowed. | Validation and rendering tests. | satisfied | Retain mismatch rejection. |
| [LS03-06](LAUNCH_SPEC.md#ls03-06) | Three retained Canvas planes; anatomy, selection, hover, guides remain independent layers. | Projection viewport and volume browser tests. | satisfied | Retain layer-stack assertions. |
| [LS03-07](LAUNCH_SPEC.md#ls03-07) | Consistent overlapping colormap/range semantics. | Shared scalar-colormap and color-scale tests. | satisfied | Retain shared-resolver tests. |
| [LS03-08](LAUNCH_SPEC.md#ls03-08) | Nearest-neighbor paint and inspection; inspection also works without an SVG path. | Rendering and volume browser tests. | satisfied | Retain SVG-free pointer case. |
| [LS03-09](LAUNCH_SPEC.md#ls03-09) | URL opacity/outline controls; decoded values, inspection, statistics, and exports unchanged. | URL/reducer and volume layer-control tests. | satisfied | Add explicit export invariance if controls change. |
| [LS03-10](LAUNCH_SPEC.md#ls03-10) | Explicit decoded-data memory bound. | 96 MiB active-feature LRU and cache tests. | satisfied | Measure the release candidate within this policy. |
| [LS03-11](LAUNCH_SPEC.md#ls03-11) | Ordinary production single-slice navigation avoids the entire volume. | Candidate request-bounded evidence only. | blocked Q5/Q8 | Repeat at the selected CloudFront origin and freeze transport. |
| [LS03-12](LAUNCH_SPEC.md#ls03-12) | Verify served bytes/SHA before cache/decode; evict invalid cache; retry cleanly. | Cache and volume integrity tests. | satisfied | Retain corrupt-cache regression. |
| [LS03-13](LAUNCH_SPEC.md#ls03-13) | Out-of-volume is explicit and not clamped. | Rendering and volume browser tests. | satisfied | Retain coverage. |
| [LS03-14](LAUNCH_SPEC.md#ls03-14) | Physical layout selected from measured real-data browser evidence. | Local/simulated candidates favor depth four but are non-production. | blocked Q5/Q8 | Run production-origin benchmark and record Q5 decision. |

## 4. `ephys_atlas_channels`

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS04-01](LAUNCH_SPEC.md#ls04-01) | Production source project and exact vintage recorded. | `2026_W32` development record is not paper authority. | blocked Q2 | Select and record the paper vintage. |
| [LS04-02](LAUNCH_SPEC.md#ls04-02) | Raw/denoised mode explicit and recorded. | D020, channel recipe/release tests. | satisfied | Rebuild after Q2 without changing recipe. |
| [LS04-03](LAUNCH_SPEC.md#ls04-03) | Population/QC recipe explicit and recorded. | D020 and channel recipe. | satisfied | Retain provenance assertions. |
| [LS04-04](LAUNCH_SPEC.md#ls04-04) | Feature catalog source-discovered, not frontend-copied. | Builder and dynamic real-release browser tests. | satisfied | Retain open-catalog tests. |
| [LS04-05](LAUNCH_SPEC.md#ls04-05) | Allen/Beryl/Cosmos share one deterministic recipe. | Channel builder/rebuild and browser tests. | satisfied | Repeat exact rebuild for paper vintage. |
| [LS04-06](LAUNCH_SPEC.md#ls04-06) | Units, transforms, source columns, missing semantics, and population in feature metadata. | Channel recipe, schema, and release tests. | satisfied | Retain field-level validation. |
| [LS04-07](LAUNCH_SPEC.md#ls04-07) | Regional statistics and histograms validate against schema v1. | Channel, schema, and distribution tests. | satisfied | Retain coverage. |
| [LS04-08](LAUNCH_SPEC.md#ls04-08) | Source hashes and builder version/command in provenance. | Development release and builder tests. | satisfied | Verify final paper release provenance. |
| [LS04-09](LAUNCH_SPEC.md#ls04-09) | Paper release consumes a pinned vintage, never `latest`. | D012 establishes policy; paper selection absent. | blocked Q2 | Freeze exact vintage and build immutable paper release. |

## 5. `ephys_atlas_clusters`

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS05-01](LAUNCH_SPEC.md#ls05-01) | Authoritative launch population and feature set. | D038/D044, cluster selections and recipe. | satisfied | Retain exact selection hashes. |
| [LS05-02](LAUNCH_SPEC.md#ls05-02) | Channel-equivalent provenance/QC rigor. | Cluster audit/release and builder tests. | satisfied | Verify published bytes unchanged. |
| [LS05-03](LAUNCH_SPEC.md#ls05-03) | Shared schema-v1 regional contract. | Schema and cluster release tests. | satisfied | Retain coverage. |
| [LS05-04](LAUNCH_SPEC.md#ls05-04) | No cluster-specific hardcoded feature list. | Complete 14-feature dynamic browser test. | satisfied | Retain coverage. |

## 6. `ephys_atlas_volumes`

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS06-01](LAUNCH_SPEC.md#ls06-01) | Canonical objects pinned by vintage and identity/hash where practical. | W26 evidence and selection records. | satisfied | Carry identities into final release. |
| [LS06-02](LAUNCH_SPEC.md#ls06-02) | Deterministic source-name and per-feature metadata mapping. | Volume builder and 41-feature candidate tests. | satisfied | Retain full-catalog coverage. |
| [LS06-03](LAUNCH_SPEC.md#ls06-03) | Scientific affine and outside semantics from authoritative source. | D043 geometry selection and review tests. | satisfied | Do not generalize beyond pinned source. |
| [LS06-04](LAUNCH_SPEC.md#ls06-04) | Selected production transport records requests, bytes, decode, interaction, and memory. | Local/simulated measurements are not final-origin evidence. | blocked Q5/Q8 | Repeat depth-four benchmark at selected origin. |
| [LS06-05](LAUNCH_SPEC.md#ls06-05) | Switch volume features without reload. | Volume candidate browser suite. | satisfied | Repeat against final release. |
| [LS06-06](LAUNCH_SPEC.md#ls06-06) | Converted transport traces to canonical source. | Candidate provenance and builder tests. | satisfied | Verify final manifest provenance. |

## 7. `brainwide_map`

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS07-01](LAUNCH_SPEC.md#ls07-01) | Preserve five checksummed Beryl-only v1 families. | D038, Brain-Wide Map recipe/tests. | satisfied | Publish reviewed bytes unchanged after authorization. |
| [LS07-02](LAUNCH_SPEC.md#ls07-02) | Label preserved legacy snapshot; do not claim current/paper regeneration. | Release metadata and focused browser assertions. | satisfied | Retain labels at publication. |
| [LS07-03](LAUNCH_SPEC.md#ls07-03) | Values and aggregation/significance semantics match pinned v1 generator deterministically. | Brain-Wide Map equivalence tests/evidence. | satisfied | Retain exact hashes. |
| [LS07-04](LAUNCH_SPEC.md#ls07-04) | Validate shared contract and discover through public catalog. | Contract/local HTTP discovery passes; no public entry. | blocked Q8/Q9 | Publish immutable release and add authorized catalog/default entry. |

## 8. Local datasets

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS08-01](LAUNCH_SPEC.md#ls08-01) | Import the same schema-v1 manifest/feature/representation graph. | Local validation/import tests. | satisfied | Retain schema-parity check. |
| [LS08-02](LAUNCH_SPEC.md#ls08-02) | IndexedDB/local Blob changes transport only; no shadow schema. | Repository/local-source architecture and tests. | satisfied | Retain architecture boundary. |
| [LS08-03](LAUNCH_SPEC.md#ls08-03) | UI distinguishes imported from published releases. | Local import/manager browser tests. | satisfied | Repeat cross-browser. |
| [LS08-04](LAUNCH_SPEC.md#ls08-04) | Regional and supported volume resources use the shared payload interfaces. | Repository/materializer and authored archive tests. | satisfied | Retain both representations in capacity corpus. |
| [LS08-05](LAUNCH_SPEC.md#ls08-05) | Invalid/incomplete import fails explicitly before partial misleading render. | Validation, integrity, quota, cancellation, rollback, recovery, and 12-case adversarial evidence in the local-import capacity campaign. | satisfied | Retain deterministic regressions; extend native-Safari quota and hard-termination coverage when practical. |

## 9. Downloads

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS09-01](LAUNCH_SPEC.md#ls09-01) | Current-feature artifact download or direct immutable navigation. | App and volume browser download tests. | satisfied | Repeat against final origin. |
| [LS09-02](LAUNCH_SPEC.md#ls09-02) | Selected/visible comparison export is documented and machine-readable. | Comparison CSV implementation/unit/browser tests. | satisfied | Retain documented column contract. |
| [LS09-03](LAUNCH_SPEC.md#ls09-03) | Immutable artifacts plus contextual exports satisfy launch; whole-release packaging remains non-blocking. | Download implementation and D051 scope. | satisfied | No launch action beyond final-origin QA. |
| [LS09-04](LAUNCH_SPEC.md#ls09-04) | Metadata identifies dataset, release, feature, representation, statistic/parcellation, and source vintage. | Comparison export and download browser tests. | satisfied | Assert every field against final releases. |

## 10. Publishing and public reads

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS10-01](LAUNCH_SPEC.md#ls10-01) | Public reads are static, unauthenticated, object-storage/CDN-suitable. | Architecture, static server paths, publishing API. | satisfied | Verify final origin anonymously. |
| [LS10-02](LAUNCH_SPEC.md#ls10-02) | Public `catalog.json` matches browser contract. | Cross-consumer catalog tests. | satisfied | Validate deployed catalog. |
| [LS10-03](LAUNCH_SPEC.md#ls10-03) | Published releases never mutate. | Publishing immutability/atomicity tests. | satisfied | Retain operational permissions. |
| [LS10-04](LAUNCH_SPEC.md#ls10-04) | Mutable aliases live outside releases and resolve immutable IDs. | Publishing catalog/alias tests. | satisfied | Configure aliases only after Q9. |
| [LS10-05](LAUNCH_SPEC.md#ls10-05) | Revocable capabilities; no launch-blocking user/OAuth system. | Publishing API/auth tests and D009. | satisfied | Configure credentials outside repository if deployed. |
| [LS10-06](LAUNCH_SPEC.md#ls10-06) | Uploads resumable and private until complete. | Publishing resume/private-stage tests. | satisfied | Repeat operationally if service is deployed. |
| [LS10-07](LAUNCH_SPEC.md#ls10-07) | Size, SHA, and schema validation precede atomic publication. | Publishing validation/publication tests. | satisfied | Retain external validator configuration. |
| [LS10-08](LAUNCH_SPEC.md#ls10-08) | Publishing performs no scientific transforms. | Architecture/service boundary and web architecture tests. | satisfied | Retain boundary. |

## 11. Registered anatomical and static projection assets

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS11-01](LAUNCH_SPEC.md#ls11-01) | Bilateral 10 µm geometry derives from pinned annotation/LUT via clean pinned generator; parent evidence retained. | Bilateral contract, manifests, validation reports/tests. | satisfied | Preserve immutable parent evidence. |
| [LS11-02](LAUNCH_SPEC.md#ls11-02) | One active projection manifest exposes three registered stacks and two static maps. | Projection-pack manifest/schema/tests and browser suites. | satisfied | Verify deployed manifest graph. |
| [LS11-03](LAUNCH_SPEC.md#ls11-03) | Sparse display corpus deterministic and parent-identified. | v3 contract and sampled-pack tests. | satisfied | Preserve derivation inputs. |
| [LS11-04](LAUNCH_SPEC.md#ls11-04) | Top/Swanson have distinct sources/hashes, exact view boxes/path counts, static status, and no invented affine/index/world coordinate. | D049, static asset provenance, projection-pack tests. | satisfied | Retain all manifest assertions. |
| [LS11-05](LAUNCH_SPEC.md#ls11-05) | Every compressed resource immutable, sized, SHA-verified, explicitly browser-decompressed. | Projection source/worker/cache tests. | satisfied | Repeat final-origin integrity. |
| [LS11-06](LAUNCH_SPEC.md#ls11-06) | Topology, coverage, signed-ID, boundary, IoU, synchronization gates cover 3,260 parent slices; sparse corpus preserves 407 fragments. | Anatomy reports/contracts and complete-corpus tests. | satisfied | Preserve reports with deployed pack. |
| [LS11-07](LAUNCH_SPEC.md#ls11-07) | Parent affines own navigation/guides; 80 µm inventory selects display planes only. | Calibration/navigation/inventory tests. | satisfied | Retain exact-affine assertions. |
| [LS11-08](LAUNCH_SPEC.md#ls11-08) | Production serves opaque compressed bytes without `Content-Encoding` where byte verification needs it. | Local CDN-like candidate only. | blocked Q8 | Verify headers and bytes at final origin. |
| [LS11-09](LAUNCH_SPEC.md#ls11-09) | One normalized SVG identity contract; no legacy host/crosswalk/parser/runtime compatibility dependency. | Architecture tests, D031/D034/D035, browser sources. | satisfied | Retain dependency checks. |

## 12. Performance and reliability

The local-import campaign now supplies representative desktop Chromium and
non-Chromium measurements for that subsystem. The section precondition still
belongs to the broader release-matrix work in
[LS01-07](LAUNCH_SPEC.md#ls01-07); it is not an additional acceptance bullet,
and focused import evidence does not satisfy the full browser target matrix.

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS12-01](LAUNCH_SPEC.md#ls12-01) | Shell becomes interactive without fetching full scientific datasets. | Initial request-bound browser behavior; shell/data boundary. | satisfied | Record dated release-build interactivity timing. |
| [LS12-02](LAUNCH_SPEC.md#ls12-02) | Feature/slice changes fetch active resources plus bounded prefetch only. | Request-count, cancellation, and prefetch tests. | satisfied | Repeat with final origin. |
| [LS12-03](LAUNCH_SPEC.md#ls12-03) | Production navigation meets documented request/bytes/decode/memory budget selected from real data. | Candidate evidence is local/simulated. | blocked Q5/Q8 | Benchmark at final origin and resolve Q5. |
| [LS12-04](LAUNCH_SPEC.md#ls12-04) | Asset/data failures are explicit, not stale or silently wrong. | Projection, static, volume, cache, and local failure tests. | satisfied | Extend adversarial race/failure coverage. |
| [LS12-05](LAUNCH_SPEC.md#ls12-05) | Immutable URLs and policies are cache-friendly. | URL/cache implementation and simulated headers; final CDN absent. | blocked Q8 | Record final CDN cache headers/behavior. |
| [LS12-06](LAUNCH_SPEC.md#ls12-06) | No launch-critical interaction requires mutation/backend API. | Static-read architecture and browser fixtures. | satisfied | Repeat against production static origin. |

## 13. Deployment and release

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS13-01](LAUNCH_SPEC.md#ls13-01) | Production domain/URL and storage/CDN selected and documented. | D040 gives direction, not concrete names/topology. | blocked Q8 | Owner selects names and topology; document them. |
| [LS13-02](LAUNCH_SPEC.md#ls13-02) | CORS and relevant Range behavior verified from production origin. | Simulated-origin evidence only. | blocked Q8 | Run production-origin HTTP matrix. |
| [LS13-03](LAUNCH_SPEC.md#ls13-03) | Paper default resolves to pinned immutable release set. | Alias machinery exists; selection absent. | blocked Q2/Q9 | Freeze release set and alias/default. |
| [LS13-04](LAUNCH_SPEC.md#ls13-04) | No deployment secrets or publisher credentials in repository. | Architecture/policy and current tracked tree. | satisfied | Record a release-time secret scan. |
| [LS13-05](LAUNCH_SPEC.md#ls13-05) | If publishing is deployed, document control-state backup/recovery. | Service not deployed; interruption recovery is tested, operational backup is not documented. | satisfied | If deployment is chosen, add and exercise backup/restore runbook before launch. |
| [LS13-06](LAUNCH_SPEC.md#ls13-06) | v1 remains available through initial launch window. | D001/D006 policy only; no dated availability/ownership record. | independent gap | Record v1 URL availability, owner, and fallback-window check. |

## Definition of launch-ready

| ID | Gate | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [DLR-01](LAUNCH_SPEC.md#dlr-01) | Every un-deferred criterion is satisfied or explicitly waived. | This ledger has unresolved rows and no waivers. | independent gap | Close blocked/gap rows or record authorized Dxxx waivers. |
| [DLR-02](LAUNCH_SPEC.md#dlr-02) | Every launch dataset has an immutable provenance-valid release or waiver. | Current real releases are validated-real-local; production set incomplete. | blocked Q2/Q5/Q8/Q9 | Build/publish the authorized frozen set or waive explicitly. |
| [DLR-03](LAUNCH_SPEC.md#dlr-03) | `just check` green on release commit. | Routine green gates are not release-commit evidence. | independent gap | Run and record `just check` on the release commit. |
| [DLR-04](LAUNCH_SPEC.md#dlr-04) | Browser QA and production-origin data/CORS checks recorded. | Chromium/local evidence exists; final cross-browser/origin evidence absent. | blocked Q8 | Complete browser matrix and production-origin checks. |
| [DLR-05](LAUNCH_SPEC.md#dlr-05) | No unresolved launch blocker in open questions. | Q2 and Q5 remain blockers; Q8/Q9 block downstream criteria. | blocked Q2/Q5/Q8/Q9 | Resolve questions through their documented procedure. |
| [DLR-06](LAUNCH_SPEC.md#dlr-06) | Integration status describes shipped state, not plans. | It accurately describes pre-launch state, not a shipped release. | independent gap | Update after the release set, origin, defaults, and QA are final. |

## Release-audit procedure

1. Run the deterministic documentation coverage check and `just check` on the
   proposed release commit.
2. Replace provisional evidence with dated browser, origin, release-ID, and
   commit-specific records.
3. Revisit every compound row and ensure each subclaim has direct evidence.
4. Resolve blockers only through `OPEN_QUESTIONS.md`, decisions, and immutable
   selection/provenance artifacts; do not infer scientific or deployment
   choices in this ledger.
5. Update dispositions and `INTEGRATION_STATUS.md` together when shipped reality
   changes.
