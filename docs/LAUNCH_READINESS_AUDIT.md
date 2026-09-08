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

The current specification contains 96 bullets in its 13 acceptance-criteria
blocks and six definition-of-ready gates. This count excludes the five
launch-scope dataset bullets and seven explicitly deferred bullets. Earlier
working notes counted 88 because they omitted section 1's original seven
bullets; D056 subsequently added LS01-08.

Dispositions are:

- **satisfied** — implementation and proportionate evidence exist at the
  maturity required by the criterion;
- **independent gap** — work can proceed without resolving an open scientific
  or deployment choice;
- **blocked Q2/Q9** — the named open choice prevents completion; Q2 and
  Q9 govern the later paper freeze, not the D074 initial website deployment;
- **waived Dxxx** — an effective decision explicitly waives the criterion.

No criterion is currently recorded as waived. Evidence references name the
smallest useful files; they do not replace the assertions inside those files.

The 2026-08-31 local-import campaign does not change any disposition count:
it strengthens the already-satisfied LS08-05 evidence, while LS01-07 remains
an independent gap because focused import coverage is not the full release
browser matrix.

The 2026-09-08 D074 initial deployment supplies public-origin evidence for the
landing, viewer, four scientific datasets, projection pack, native D070 mesh
pack and initial review edition. It closes Q8; it does not freeze the paper
release set or satisfy the full launch browser/performance matrix. D075 closes Q5 with the real CloudFront benchmark; the new production volume
release is now published and catalogued. Q2/Q9 remain paper-only choices.

## Shared evidence

- **Initial live deployment:** [frozen deployment record](publishing/INITIAL_DEPLOYMENT_20260908.md)
  records release IDs/hashes, Linux source commit `62199f5`, site commit
  `db87240`, build `9fbcf5935cfe344374f9c0c84c2f35b8`, infrastructure scope,
  anonymous HTTP checks, private boundaries and recovery procedures.
  [Compact live QA](publishing/initial-live-qa-20260908.json) preserves workflow
  outcomes, raw diagnostics and screenshot identities. Firefox completed the
  applicable workflows but its strict raw report retains six expected
  navigation cancellations; it is not a clean raw diagnostic pass.

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
| [LS01-01](LAUNCH_SPEC.md#ls01-01) | Desktop primary; tablet usable; phone may reduce composition. | Navigation/UI responsive browser cases; live landing contained at desktop, tablet, 320 px and 390 px. | satisfied | Repeat the full viewer viewport matrix for the final release. |
| [LS01-02](LAUNCH_SPEC.md#ls01-02) | Coronal, sagittal, and horizontal share one navigation state. | Projection navigation and linked-guide tests. | satisfied | Retain coverage. |
| [LS01-03](LAUNCH_SPEC.md#ls01-03) | One ML/AP/DV cursor; native bilateral 10 µm affine grid. | Navigation tests plus projection-pack validation. | satisfied | Retain exact-grid assertions. |
| [LS01-04](LAUNCH_SPEC.md#ls01-04) | Discoverable Top/Swanson slot; shared color/hover/selection/focus; no slice/world/voxel claim. | `static-projections.spec.ts` and projection-pack tests. | satisfied | Retain all subclaim assertions. |
| [LS01-05](LAUNCH_SPEC.md#ls01-05) | Cursor/derived slices, dataset/release, feature, representation, parcellation, coloring, selection, and relevant workspace state round-trip in a share URL. | URL-state, reducer, app, static-projection, and volume tests. | satisfied | Add a single field-completeness assertion if the URL schema changes. |
| [LS01-06](LAUNCH_SPEC.md#ls01-06) | Maximize, drawers, and responsive composition are keyboard-reversible and browser-tested. | App, panel-layout, and keyboard browser tests. | satisfied | Repeat cross-browser. |
| [LS01-07](LAUNCH_SPEC.md#ls01-07) | Current Chrome/Edge, Firefox, and Safari are release targets; Chromium alone is insufficient. | D040; focused import coverage includes native Safari. Initial live Chromium workflows pass; Firefox applicable 2-D workflows complete with six retained expected navigation cancellations. Firefox headless 3-D was not attempted. | independent gap | Complete the general Chrome/Edge, Firefox and native Safari release matrices; focused import and D070 evidence do not waive them. |
| [LS01-08](LAUNCH_SPEC.md#ls01-08) | Public navigation separates project, dataset, immutable release, feature, and view; project editions preserve coordinated release mappings and disclose overrides. | Schema/compiler, catalog resolver, context/chooser and URL/history tests; live catalog binds immutable initial edition `ibl-review-20260908-v1` and its dataset mappings/defaults. | satisfied | Retain edition/override coverage; select the later paper edition only through Q9. |

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
| [LS03-11](LAUNCH_SPEC.md#ls03-11) | Ordinary production single-slice navigation avoids the entire volume. | D075 production release uses depth-four packs; live HTTP and slider checks confirm bounded slice access. | satisfied | Retain the measured transport and regression coverage. |
| [LS03-12](LAUNCH_SPEC.md#ls03-12) | Verify served bytes/SHA before cache/decode; evict invalid cache; retry cleanly. | Cache and volume integrity tests. | satisfied | Retain corrupt-cache regression. |
| [LS03-13](LAUNCH_SPEC.md#ls03-13) | Out-of-volume is explicit and not clamped. | Rendering and volume browser tests. | satisfied | Retain coverage. |
| [LS03-14](LAUNCH_SPEC.md#ls03-14) | Physical layout selected from measured real-data browser evidence. | D075 selects depth four from the 180-trial real-origin slider matrix and all-41-feature correctness sweep. | satisfied | Retain the frozen benchmark when building the production release. |

## 4. `ephys_atlas_channels`

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS04-01](LAUNCH_SPEC.md#ls04-01) | Production source project and exact vintage recorded. | D074 selects reviewed `ea_active` / `2026_W32`; published `2026_W32-ibl-review-20260908-v1` records its source and immutable identity. | satisfied | Retain initial-release provenance; resolve Q2 separately for the paper vintage. |
| [LS04-02](LAUNCH_SPEC.md#ls04-02) | Raw/denoised mode explicit and recorded. | D020, channel recipe/release tests and published raw/denoised feature metadata. | satisfied | Preserve the reviewed recipe in any later paper build. |
| [LS04-03](LAUNCH_SPEC.md#ls04-03) | Population/QC recipe explicit and recorded. | D020 and channel recipe. | satisfied | Retain provenance assertions. |
| [LS04-04](LAUNCH_SPEC.md#ls04-04) | Feature catalog source-discovered, not frontend-copied. | Builder and dynamic real-release browser tests. | satisfied | Retain open-catalog tests. |
| [LS04-05](LAUNCH_SPEC.md#ls04-05) | Allen/Beryl/Cosmos share one deterministic recipe. | Channel builder/rebuild and browser tests. | satisfied | Repeat exact rebuild for paper vintage. |
| [LS04-06](LAUNCH_SPEC.md#ls04-06) | Units, transforms, source columns, missing semantics, and population in feature metadata. | Channel recipe, schema, and release tests. | satisfied | Retain field-level validation. |
| [LS04-07](LAUNCH_SPEC.md#ls04-07) | Regional statistics and histograms validate against schema v1. | Channel, schema, and distribution tests. | satisfied | Retain coverage. |
| [LS04-08](LAUNCH_SPEC.md#ls04-08) | Source hashes and builder version/command in provenance. | Published initial manifest records source hashes and Linux build commit `62199f5`; preflight and reviewed-resource equivalence are recorded in the initial deployment evidence. | satisfied | Retain exact provenance; verify it again for the later paper release. |
| [LS04-09](LAUNCH_SPEC.md#ls04-09) | Paper release consumes a pinned vintage, never `latest`. | D012 establishes policy; paper selection absent. | blocked Q2 | Freeze exact vintage and build immutable paper release. |

## 5. `ephys_atlas_clusters`

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS05-01](LAUNCH_SPEC.md#ls05-01) | Authoritative launch population and feature set. | D038/D044, cluster selections and recipe. | satisfied | Retain exact selection hashes. |
| [LS05-02](LAUNCH_SPEC.md#ls05-02) | Channel-equivalent provenance/QC rigor. | Cluster audit/recipe and builder tests; initial Linux rebuild matches all 263 reviewed non-root-manifest files, with published manifest hash recorded. | satisfied | Retain the equivalence record and immutable publication identities. |
| [LS05-03](LAUNCH_SPEC.md#ls05-03) | Shared schema-v1 regional contract. | Schema and cluster release tests. | satisfied | Retain coverage. |
| [LS05-04](LAUNCH_SPEC.md#ls05-04) | No cluster-specific hardcoded feature list. | Complete 14-feature dynamic browser test. | satisfied | Retain coverage. |

## 6. `ephys_atlas_volumes`

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS06-01](LAUNCH_SPEC.md#ls06-01) | Canonical objects pinned by vintage and identity/hash where practical. | W26 evidence and selection records. | satisfied | Carry identities into final release. |
| [LS06-02](LAUNCH_SPEC.md#ls06-02) | Deterministic source-name and per-feature metadata mapping. | Volume builder and 41-feature candidate tests. | satisfied | Retain full-catalog coverage. |
| [LS06-03](LAUNCH_SPEC.md#ls06-03) | Scientific affine and outside semantics from authoritative source. | D043 geometry selection and review tests. | satisfied | Do not generalize beyond pinned source. |
| [LS06-04](LAUNCH_SPEC.md#ls06-04) | Selected production transport records requests, bytes, decode, interaction, and memory. | D075 origin benchmark records request/byte/interaction/heap measurements and pack-to-render timing; prior local evidence isolates decode work. | satisfied | Publish the numerically equivalent production release. |
| [LS06-05](LAUNCH_SPEC.md#ls06-05) | Switch volume features without reload. | Volume candidate browser suite. | satisfied | Repeat against final release. |
| [LS06-06](LAUNCH_SPEC.md#ls06-06) | Converted transport traces to canonical source. | Candidate provenance and builder tests. | satisfied | Verify final manifest provenance. |

## 7. `brainwide_map`

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS07-01](LAUNCH_SPEC.md#ls07-01) | Preserve five checksummed Beryl-only v1 families. | D038, recipe/tests; initial Linux rebuild matches all 153 reviewed non-root-manifest files and is published unchanged. | satisfied | Retain reviewed equivalence and immutable release bytes. |
| [LS07-02](LAUNCH_SPEC.md#ls07-02) | Label preserved legacy snapshot; do not claim current/paper regeneration. | Published release metadata, initial catalog and focused browser assertions identify the preserved legacy snapshot. | satisfied | Retain legacy labels in future catalog editions. |
| [LS07-03](LAUNCH_SPEC.md#ls07-03) | Values and aggregation/significance semantics match pinned v1 generator deterministically. | Brain-Wide Map equivalence tests/evidence. | satisfied | Retain exact hashes. |
| [LS07-04](LAUNCH_SPEC.md#ls07-04) | Validate shared contract and discover through public catalog. | Schema-v1 preflight and public catalog expose `legacy-v1-1d908bea-ibl-review-20260908-v1`; initial live browsing passes. | satisfied | Retain the exact catalog mapping and manifest hash. |

## 8. Local datasets

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS08-01](LAUNCH_SPEC.md#ls08-01) | Import the same schema-v1 manifest/feature/representation graph. | Local validation/import tests. | satisfied | Retain schema-parity check. |
| [LS08-02](LAUNCH_SPEC.md#ls08-02) | IndexedDB/local Blob changes transport only; no shadow schema. | Repository/local-source architecture and tests. | satisfied | Retain architecture boundary. |
| [LS08-03](LAUNCH_SPEC.md#ls08-03) | UI distinguishes imported from published releases. | Local import/manager tests; initial live Chromium and Firefox Brain-Wide Map imports retain local identity. | satisfied | Complete the broader native Safari release matrix. |
| [LS08-04](LAUNCH_SPEC.md#ls08-04) | Regional and supported volume resources use the shared payload interfaces. | Repository/materializer and authored archive tests. | satisfied | Retain both representations in capacity corpus. |
| [LS08-05](LAUNCH_SPEC.md#ls08-05) | Invalid/incomplete import fails explicitly before partial misleading render. | Validation, integrity, quota, cancellation, rollback, recovery, and 12-case adversarial evidence in the local-import capacity campaign. | satisfied | Retain deterministic regressions; extend native-Safari quota and hard-termination coverage when practical. |

## 9. Downloads

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS09-01](LAUNCH_SPEC.md#ls09-01) | Current-feature artifact download or direct immutable navigation. | App/volume download tests; current-feature CSV downloads pass in live Chromium and Firefox. | satisfied | Repeat volume downloads against the Q5-selected ordinary production release. |
| [LS09-02](LAUNCH_SPEC.md#ls09-02) | Selected/visible comparison export is documented and machine-readable. | Comparison CSV implementation/unit/browser tests. | satisfied | Retain documented column contract. |
| [LS09-03](LAUNCH_SPEC.md#ls09-03) | Immutable artifacts plus contextual exports satisfy launch; whole-release packaging remains non-blocking. | Download implementation and D051 scope. | satisfied | No launch action beyond final-origin QA. |
| [LS09-04](LAUNCH_SPEC.md#ls09-04) | Metadata identifies dataset, release, feature, representation, statistic/parcellation, and source vintage. | Comparison export and download browser tests. | satisfied | Assert every field against final releases. |

## 10. Publishing and public reads

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS10-01](LAUNCH_SPEC.md#ls10-01) | Public reads are static, unauthenticated, object-storage/CDN-suitable. | Initial landing/viewer, catalog and scientific resources are anonymously readable through the static CloudFront origin; direct private S3 access is denied. | satisfied | Retain anonymous read and private-origin checks. |
| [LS10-02](LAUNCH_SPEC.md#ls10-02) | Public `catalog.json` matches browser contract. | D056/D061 compiler schema/parser tests plus the published 3,202-byte catalog and recorded SHA-256; live browser discovery passes. | satisfied | Validate each subsequent curator promotion at the public origin. |
| [LS10-03](LAUNCH_SPEC.md#ls10-03) | Published releases never mutate. | Publishing immutability/atomicity tests. | satisfied | Retain operational permissions. |
| [LS10-04](LAUNCH_SPEC.md#ls10-04) | Mutable aliases live outside releases and resolve immutable IDs. | Publishing catalog/alias tests; initial edition/defaults resolve immutable IDs. The paper alias/default selection remains distinct. | satisfied | Configure paper-facing aliases only after Q9. |
| [LS10-05](LAUNCH_SPEC.md#ls10-05) | Revocable capabilities; no launch-blocking user/OAuth system. | Publishing API/auth tests, D009 and D060/D074 scoped operator publication with external AWS credentials; no user/OAuth backend is needed for public browsing. | satisfied | Retain revocable scoped operator credentials outside the repository. |
| [LS10-06](LAUNCH_SPEC.md#ls10-06) | Uploads resumable and private until complete. | Resume/private-stage tests and initial object-level resumable publication; retained private staging audit object returns CloudFront 403. | satisfied | Retain private staging and conditional completion boundaries. |
| [LS10-07](LAUNCH_SPEC.md#ls10-07) | Size, SHA, and schema validation precede atomic publication. | Four initial releases passed canonical Linux preflight; the publisher validates size/SHA/schema before conditional publication. Exact published manifest hashes are retained. | satisfied | Repeat preflight and publication validation for every new immutable release. |
| [LS10-08](LAUNCH_SPEC.md#ls10-08) | Publishing performs no scientific transforms. | Architecture/service boundary and web architecture tests. | satisfied | Retain boundary. |

## 11. Registered anatomical and static projection assets

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS11-01](LAUNCH_SPEC.md#ls11-01) | Bilateral 10 µm geometry derives from pinned annotation/LUT via clean pinned generator; parent evidence retained. | Bilateral contract, manifests, validation reports/tests. | satisfied | Preserve immutable parent evidence. |
| [LS11-02](LAUNCH_SPEC.md#ls11-02) | One active projection manifest exposes three registered stacks and two static maps. | Projection-pack manifest/schema/tests and public `ibl-atlas-projections-05b9f3f85db9` manifest hash; live linked/static browsing passes. | satisfied | Retain the deployed manifest graph and integrity checks. |
| [LS11-03](LAUNCH_SPEC.md#ls11-03) | Sparse display corpus deterministic and parent-identified. | v3 contract and sampled-pack tests. | satisfied | Preserve derivation inputs. |
| [LS11-04](LAUNCH_SPEC.md#ls11-04) | Top/Swanson have distinct sources/hashes, exact view boxes/path counts, static status, and no invented affine/index/world coordinate. | D049, static asset provenance, projection-pack tests. | satisfied | Retain all manifest assertions. |
| [LS11-05](LAUNCH_SPEC.md#ls11-05) | Every compressed resource immutable, sized, SHA-verified, explicitly browser-decompressed. | Projection source/worker/cache tests. | satisfied | Repeat final-origin integrity. |
| [LS11-06](LAUNCH_SPEC.md#ls11-06) | Topology, coverage, signed-ID, boundary, IoU, synchronization gates cover 3,260 parent slices; sparse corpus preserves 407 fragments. | Anatomy reports/contracts and complete-corpus tests. | satisfied | Preserve reports with deployed pack. |
| [LS11-07](LAUNCH_SPEC.md#ls11-07) | Parent affines own navigation/guides; 80 µm inventory selects display planes only. | Calibration/navigation/inventory tests. | satisfied | Retain exact-affine assertions. |
| [LS11-08](LAUNCH_SPEC.md#ls11-08) | Production serves opaque compressed bytes without `Content-Encoding` where byte verification needs it. | Production CloudFront compression is disabled; sampled compressed pack/AGEA resources retain verified opaque bytes without Content-Encoding, as recorded in initial deployment HTTP evidence. | satisfied | Retain byte/hash/header checks after delivery policy changes. |
| [LS11-09](LAUNCH_SPEC.md#ls11-09) | One normalized SVG identity contract; no legacy host/crosswalk/parser/runtime compatibility dependency. | Architecture tests, D031/D034/D035, browser sources. | satisfied | Retain dependency checks. |

## 12. Performance and reliability

The local-import campaign now supplies representative desktop Chromium and
non-Chromium measurements for that subsystem. The section precondition still
belongs to the broader release-matrix work in
[LS01-07](LAUNCH_SPEC.md#ls01-07); it is not an additional acceptance bullet,
and focused import evidence does not satisfy the full browser target matrix.

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS12-01](LAUNCH_SPEC.md#ls12-01) | Shell becomes interactive without fetching full scientific datasets. | Shell/data request-bound tests and dated live startup observations; landing fetches no scientific data. Recorded viewer timings are observations, not Q5 thresholds. | satisfied | Repeat startup observations for later release builds with cache conditions explicit. |
| [LS12-02](LAUNCH_SPEC.md#ls12-02) | Feature/slice changes fetch active resources plus bounded prefetch only. | Request-count/cancellation/prefetch tests; deployed `db87240` removes speculative volume downloads and live workflows avoid benchmark resources. | satisfied | Measure Q5 budgets separately and repeat against its final volume release. |
| [LS12-03](LAUNCH_SPEC.md#ls12-03) | Production navigation meets documented request/bytes/decode/memory budget selected from real data. | D075 180-trial real CloudFront benchmark passes request/byte/slider/startup budgets; the production release matches every non-manifest candidate byte and passes live checks. | satisfied | Keep cache conditions and measured hardware limits explicit. |
| [LS12-04](LAUNCH_SPEC.md#ls12-04) | Asset/data failures are explicit, not stale or silently wrong. | Projection, static, volume, cache, and local failure tests. | satisfied | Extend adversarial race/failure coverage. |
| [LS12-05](LAUNCH_SPEC.md#ls12-05) | Immutable URLs and policies are cache-friendly. | Deployed CDN uses zero-TTL mutable entry/catalog policies and one-year immutable build/pack/release policies; origin headers and hashes are recorded. | satisfied | Retain the cache-policy and served-byte checks after updates. |
| [LS12-06](LAUNCH_SPEC.md#ls12-06) | No launch-critical interaction requires mutation/backend API. | Static-read architecture and live default/deep-link/download/import workflows require no publishing/backend API. | satisfied | Retain the public-read boundary. |

## 13. Deployment and release

| ID | Criterion and compound subclaims | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [LS13-01](LAUNCH_SPEC.md#ls13-01) | Production domain/URL and storage/CDN selected and documented. | D074 live origin `ephys-atlas.iblcore.org`, distribution `ET6VJW8JWAGVR`, scoped production S3 root, retained OAI and router are documented in initial deployment evidence. | satisfied | Keep deployment identifiers and scoped configuration changes recorded. |
| [LS13-02](LAUNCH_SPEC.md#ls13-02) | CORS and relevant Range behavior verified from production origin. | Production app/data are same-origin HTTPS; live browser fetches and exact byte-range 206 checks pass. No cross-origin allowance is claimed. | satisfied | Recheck CORS if a separate data/viewer origin is introduced. |
| [LS13-03](LAUNCH_SPEC.md#ls13-03) | Paper default resolves to pinned immutable release set. | D074 initial review edition is pinned and public; it is explicitly not the paper release set. | blocked Q2/Q9 | Freeze the later paper release set and alias/default through Q2/Q9. |
| [LS13-04](LAUNCH_SPEC.md#ls13-04) | Secrets stay outside the repository and scientific releases use the canonical Linux preflight. | All five releases pass exact clean-Linux preflight. Bounded tracked-file private-key/AWS-key/GitHub-token signature checks found no matches; authentication uses the external AWS profile. | satisfied | Repeat credential hygiene and preflight for future releases. |
| [LS13-05](LAUNCH_SPEC.md#ls13-05) | If publishing is deployed, document control-state backup/recovery. | Local publisher and initial deployment recovery sections document conditional site restoration, retained catalog history and scoped routing rollback; no operational restore exercise is claimed. | satisfied | Exercise the documented control-state recovery before broad launch and retain the result. |
| [LS13-06](LAUNCH_SPEC.md#ls13-06) | v1 remains available through initial launch window. | D001/D006 policy and D074 scoped deployment preserve v1 resources; no dated v1 availability/ownership/window check is recorded. | independent gap | Record v1 URL availability, owner and fallback-window check. |

## Definition of launch-ready

| ID | Gate | Evidence | Disposition | Smallest next action |
| --- | --- | --- | --- | --- |
| [DLR-01](LAUNCH_SPEC.md#dlr-01) | Every un-deferred criterion is satisfied or explicitly waived. | This ledger has unresolved rows and no waivers. | independent gap | Close blocked/gap rows or record authorized Dxxx waivers. |
| [DLR-02](LAUNCH_SPEC.md#dlr-02) | Every launch dataset has an immutable provenance-valid release or waiver. | All approved initial scientific datasets, including the fresh D075 volume release, are published with immutable provenance and preflight evidence. | satisfied | Q2/Q9 remain separate for the later paper freeze. |
| [DLR-03](LAUNCH_SPEC.md#dlr-03) | `just check` green on release commit. | Deployed site commit `db87240` passed just check and CI run 34236039518; exact gate log and CI link are in the initial deployment record. | satisfied | Repeat and record the full gate for each subsequent release commit. |
| [DLR-04](LAUNCH_SPEC.md#dlr-04) | Browser QA and production-origin data/CORS checks recorded. | Dated live Chromium/Firefox workflows and production HTTP/private-boundary checks are recorded; general native Safari/browser and complete origin-header matrices remain incomplete. | independent gap | Complete LS01-07 and LS13-02 without treating expected Firefox cancellations as a clean raw diagnostic pass. |
| [DLR-05](LAUNCH_SPEC.md#dlr-05) | No unresolved launch blocker in open questions. | Q8 and Q5 are resolved; D074 approves the initial release set/defaults. Q2/Q9 and Q19 retain only their stated later paper/scientific scope. | satisfied | Do not represent initial IBL review as final paper or AGEA scientific acceptance. |
| [DLR-06](LAUNCH_SPEC.md#dlr-06) | Integration status describes shipped state, not plans. | Integration status and frozen initial deployment evidence describe the shipped site, five datasets and remaining general QA/paper limitations. | satisfied | Update shipped status again after Q5 and final broad QA. |

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
