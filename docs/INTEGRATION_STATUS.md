# Integration status

Status: active initial-deployment capability matrix.

Last updated: 2026-09-09 on `main` for the live initial IBL review deployment.

Code and tests are the implementation authority. This file summarizes current
capability and artifact maturity; it links to evidence instead of repeating
completed implementation diaries.

## Product architecture

| Capability | Implemented state | Evidence/maturity | Remaining production work |
| --- | --- | --- | --- |
| Release contract | Schema v1 is the sole builder, browser HTTP/local, publishing, fixture, and download contract; no v0.1 adapters remain. | Cross-language valid/invalid corpus and deterministic golden fixture are green. | None for contract machinery. |
| Browser boundaries | `core/domain`, `application`, `data`, `rendering`, and `ui` dependencies point inward; catalog IDs and feature catalogs remain open/data-driven. | Architecture tests are green; the [frontend lifecycle audit](FRONTEND_LIFECYCLE_AUDIT.md) records race fixes and bounded follow-ups. | None for current launch behavior. |
| 2-D workspace | One retained `ProjectionViewport` per registered frame composites scalar Canvas, regional SVG, guides, interaction, and errors. Top/Swanson use affine-free retained static viewports. Bounded, locally persisted desktop pane resizing/collapse gives space back to the retained workspace without changing share URLs or mobile drawers. | Production projection pack and responsive pane/keyboard Chromium coverage are green. | Published; HTTPS hashes and live Chromium/Firefox workflows verified. |
| Scientific navigation | One URL-v4 ML/AP/DV cursor drives the native bilateral 10 µm grid; sparse 80 µm SVG sampling changes display only. | Parent/sparse/projection-pack validation and performance evidence are complete. | Production-origin delivery verified. |
| Optional 3-D context | A sibling retained Three.js viewport shares regional presentation/selection and owns camera, explode, GPU lifecycle, and failure isolation. Volume features remain anatomy-only in 3-D. | D042 real pack is losslessly repackaged; Chromium plus owner Safari/Firefox review passed. The D066/D068 real native review-only pack preserves 966,645 triangles in 1,140 components. Pointer picking is suppressed during camera drags, and hover bursts settle for 75 ms before one pick. | D070 owner approval closes Q18 and selects the exact native movements/boundary. The approved pack is the v5 bundle's default; lazy loading, retained shared presentation/OIT and all five local datasets pass real-site Chromium checks. D042 cut/cap remains rollback evidence. Normal-view label is implemented; the D070 pack is published and the live Chromium 3-D check passes. |
| Integrity/cache | Encoded resources are byte-size/SHA verified before persistent admission; corrupt entries are evicted/retried; decoded identity includes hash plus decode contract. | HTTP/local/mesh/projection/volume tests are green. | Opaque gzip, immutable cache, Range and denial behavior verified at CloudFront. |
| Release environments | Builders record OS, machine, Python, and NumPy. Production preflight requires Linux, clean `main`, exact HEAD provenance, immutable IDs, and a fully valid release graph. macOS real-data catalogs are labelled Local. | Deterministic preflight tests and complete local-bundle validation are green. S3 release planning/apply invoke the same preflight on a private snapshot. | Initial direct production transactions verified under D074. |

Stable boundaries and end-to-end flow are in
[`SYSTEM_OVERVIEW.md`](SYSTEM_OVERVIEW.md) and
[`ARCHITECTURE.md`](ARCHITECTURE.md). Rendering evidence is indexed by
[`rendering/README.md`](rendering/README.md).

The shared 3-D renderer now uses [weighted blended OIT](rendering/3D_TRANSPARENCY.md)
for translucent context, with opaque-depth occlusion and a single-pass opaque
fast path. Synthetic order/recovery tests and real Native / D042 Chromium checks
pass; D070 records owner acceptance and waives additional Firefox/Safari review for this 3-D selection, without claiming unmeasured hardware performance.

## Scientific datasets

| Dataset | Builder and browser machinery | Current real artifact maturity | Blocker/next action |
| --- | --- | --- | --- |
| `ephys_atlas_channels` | Dynamic raw/denoised discovery, explicit `inside` recipe, Allen/Beryl/Cosmos summaries, D050 distributions, provenance, HTTP acceptance. | Published `2026_W32-ibl-review-20260908-v1` from the reviewed recipe; not the final paper freeze. | Q2 paper vintage remains separate; initial live browsing passed. |
| `ephys_atlas_clusters` | D038/D044 all-row 14-feature recipe, deterministic summaries, D048/D054 presentation, D050 distributions, HTTP acceptance. | Published `sha256-9b5e55215b306f26-ibl-review-20260908-v1` from the frozen source. | Initial live browsing passed. |
| `brainwide_map` | D038 five-family Beryl-only legacy adapter, equivalence coverage, D050 distributions, HTTP acceptance. | Published `legacy-v1-1d908bea-ibl-review-20260908-v1` from all six exact hash-pinned Parquets. | Initial live browsing passed. |
| `ephys_atlas_volumes` | Both schema transports, exact D043 mapping/validity, retained Canvas slices, inspection, summaries, D050 global-only distributions, full 41-feature builds. | Published `2026_W26-ibl-review-20260908-v1` from clean `2be9ec9`, with every non-manifest file identical to the measured candidate. | D075 measurement, publication and real-origin Chromium/Firefox chooser/slider/deep-link checks pass. |
| `agea` | Full original-expression catalog, shared metadata bundle, explicit missing masks and linked slices. | Published `agea-original-20260908-v1`, all 4,345 experiments; provisional processing/registration notes only in Data details. | Q19 final scientific acceptance remains separate from the D074 initial deployment. |
| `local` | Same schema-v1 graph and materializers; public regional and explicit-grid volume `ibl_ephys_atlas` authoring; deterministic validated ZIP packaging; strict bounded two-phase browser import, atomic IndexedDB admission/deletion, inventory, and integrity recovery. | Real regional and 467 MiB/6,807-entry volume archives pass Chromium, Firefox, and native Safari import/reload checks; near-1 GiB and 20,000-entry boundaries pass Chromium/Firefox; adversarial, cancellation, quota, rollback, reload, delete, and recovery regressions are recorded. | Supported capacity remains provisional pending native-Safari quota/RSS and representative end-user-device evidence; publish the Python distribution only after authorization. |

Dataset source, recipe, selection, release, and audit ownership is indexed by
[`data/README.md`](data/README.md). The final paper-facing source vintage and
all remaining choices are governed by [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md).

D067 activates independent AGEA development. The pinned full-catalog source
audit and Chromium/Firefox metadata/whole-volume transport benchmark are
implemented, including independent slice hashes and cache recovery checks.
D069 now adds the [main-website AGEA local preview](data/AGEA_LOCAL_PREVIEW.md):
4,345 original experiments, shared schema-v1 metadata-bundle HTTP/local-validation
support, fully scrollable virtualized feature search, linked anatomy, and 64 MiB/256
entry verified caching with quota fallback. Real-data Chromium tests pass;
D074-authorized `agea-original-20260908-v1` is now published; registration remains
provisional and final scientific acceptance remains Q19.
Compact virtual rows, deferred bounded cache admission, recent decoded-source
reuse, stride-based decoding and retained anatomy-tree rows reduce gene-switch
work; local before/after evidence is recorded in the preview runbook.
See [AGEA evidence](data/AGEA.md).

The separate development-only [AGEA coverage lab](data/AGEA_COVERAGE_LAB.md)
now loads the full pinned original experiment catalog, linked source-index
slices, coverage categories, mask comparison, voxel inspection, histograms,
aggregate measurement frequency and downloadable exploratory reports. It has
real-data Chromium interaction/failure/mobile coverage and no production
dataset or registration claim.

Its alignment mode uses the actual retained website projection viewports and
fixed source-transform evidence. The dark-theme guided review records judgments
across five starting locations, with optional original expression, additional
overlays and coordinate diagnostics. Exported judgments do not approve biological
registration; the CCF-derived reference image is not independent evidence of it.

The [AGEA stripe review report](data/AGEA_STRIPE_REPORT.md) adds deterministic
missing-slab/intensity diagnostics, full-catalog screening, six exact Allen
archive comparisons, Ptpru section-projection evidence and a reproducible
12-page PDF. Controls and source checks pass; flags remain unadjudicated
screening evidence. Scientific source/validity/registration choices remain Q19.

## Scalar exploration

Regional HTTP/local exploration is implemented end to end: dynamic feature and
parcellation discovery, region metadata/search/tree/ranking, shared list/SVG
selection and hover, descriptive summaries, global/selected distributions,
comparison tray/sheet, contextual CSV/artifact downloads, and URL state.

D050 is the sole implemented distribution contract. Linear, Log, and Signed
log are synchronized value scales; Full and Focused are independent domains
used by global, selected, and compact histograms with exact whole-population
tails. D053 preserves off-scale color bounds without clamping. D054 closes Q14
with complete owner-reviewed selections for all 155 feature/representation
entries, retaining D052 and D048 exactly. Four new immutable D054-bound
releases pass complete graph validation, byte-identical rebuilds,
dataset-specific Chromium acceptance, and integrated v4 bundle validation; the reviewed recipes have since been rebuilt and published for the D074 initial
deployment, including the D075 production volume release. See
[`data/DISTRIBUTION_AUDIT_EVIDENCE.md`](data/DISTRIBUTION_AUDIT_EVIDENCE.md).

The bounded D057 presentation follow-ups are implemented. Regional standard
deviation is selectable when present; one classified Matplotlib-derived
palette registry drives SVG, Canvas, and legends; Auto resolves a
representation preference with a Viridis fallback; and Coolwarm is available
only with an explicit finite release-owned diverging center. Shared piecewise
normalization covers regional, volume, and legend rendering without inventing
a midpoint. Region rows use shared-domain dot tracks rather than unlabelled
fill proportions. Q16 continues to retain every real-feature palette and
center selection; the implementation changes only synthetic fixtures.

D076 adds progressive nearby-first encoded SVG cache warming after visible
rendering, next-pack decoded SVG prefetch in the observed direction, bounded directional active-volume prefetch, and per-view updating
feedback that retains the previous pixels until replacement rendering completes.
User-directed SVG prefetch preempts an active generic cache-fill transfer, which resumes afterward. Foreground and background request budgets are assessed separately. Empty views show Loading atlas immediately, and
uncached slice navigation shows Loading slice without a delay; background
prefetch never holds the visible view busy.

## Volume exploration

The retained volume path supports `chunks3d` and `orthogonal_slice_packs`,
float16/float32, optional gzip, explicit storage axes, affine mapping,
sentinel/mask validity, transparent invalid voxels, nearest-neighbor paint and
inspection, atomic anatomy/scalar navigation, URL layer controls, consumer-safe
cancellation, and one 96 MiB active-feature decoded budget.
Pointer inspection suppresses tooltips for voxels classified exactly as
outside while preserving valid, missing, unsupported-validity, and out-of-grid
diagnostics.

D043 fixes the exact W26 reference space, grid, affine, voxel-center convention,
and `0.0` outside semantics. Full depth-4/depth-8 candidates and local/network-
profile evidence favor depth four. D075 now confirms depth four with the 180-trial real CloudFront slider matrix
and all-41-feature correctness sweep. See
[`data/VOLUME_2026_W26_EVIDENCE.md`](data/VOLUME_2026_W26_EVIDENCE.md).

## Local data and downloads

Share, Data details, current regional CSV, selected comparison CSV, and declared
immutable artifact downloads are implemented through the shared resource-reader
boundary. Published artifacts are verified before download; local artifacts
use the same interface after complete import validation.

D051 approves one `.ibl-ephys-atlas.zip` containing the schema-v1 graph, a
public `ibl-ephys-atlas` Python authoring package, `iblatlas` authority, and
persistent Local management. The single implemented `ibl-ephys-atlas`
distribution contains the public `ibl_ephys_atlas` and internal
`ephys_atlas_builder` namespaces plus an exact generated copy of schema v1.
The Allen regional API accepts explicit IDs or acronyms through a caller-owned
`BrainRegions`, distinguishes already-aggregated values from repeated
observations, requires explicit mean aggregation and hemisphere folding, emits
neutral Linear/Full releases, and writes deterministic independently validated
ZIPs. Wheel tests verify both namespaces, schema parity, dependencies,
metadata, and the retained internal CLI. The public API exactly regenerates the
committed `fixtures/authored-regional-v1.ibl-ephys-atlas.zip`, which a dedicated
Chromium test imports through the ordinary browser path.

The browser has a pinned zip.js strict reader and separates read-only preview
preparation from explicit local-only atomic IndexedDB admission. Its
preview/confirmation UI, Local identity, reload persistence, no-network local
resource reads, and duplicate rejection have automated Chromium evidence.
Repeated observations can also request Beryl/Cosmos outputs: the package folds
signed Allen identities, remaps every original row through `BrainRegions`, and
only then computes target means. Root/void mapping results fail closed, and
already-aggregated values remain Allen-only to avoid means of means.
The active local release can be deleted atomically after confirmation; the app
then selects a deterministic published fallback without retaining the deleted
history checkpoint. Deletion preserves other local releases and permits exact
reimport. Quota exhaustion gives atomic recovery guidance, and Share discloses
that a local URL transfers no data before accessing the clipboard.
The manager inventories every release with exact source identity, import time,
stored Blob bytes, resource count, and integrity state. Origin-wide browser
usage/quota and persistence are reported separately. Explicit verification
replays the complete schema graph and integrity checks from a retained root
manifest; legacy rows remain truthfully unverifiable, and damaged releases use
atomic delete/reimport recovery. Published browsing remains available when
local storage is unavailable. The measured campaign retained the 1 GiB ZIP,
20,000-entry, 1.5 GiB expanded-data, and 1000:1 ratio ceilings while raising
the aggregate declared decoded-resource budget to 3 GiB. Chromium and Firefox
passed the measured boundary archives; native Safari passed the real regional
and volume imports. Playwright WebKit on Linux previewed the archives but its
WPE IndexedDB implementation rejected Blob/File storage, so it is recorded as
a platform limitation rather than Safari evidence. Process-tree peak RSS and
native-Safari quota were not captured, and broadly supported capacity remains
provisional. See
[`data/LOCAL_IMPORT_CAPACITY_EVIDENCE.md`](data/LOCAL_IMPORT_CAPACITY_EVIDENCE.md).
Public volume authoring uses factory-verified geometry from an
already-created `AllenAtlas`, preserves float16/float32 values, requires
explicit mask or sentinel validity, and computes valid-only summaries. Its tiny
synthetic archive is exactly regenerable and has Chromium import, rendering,
navigation, and IndexedDB-only reload evidence. PyPI publication remains
incomplete. See the binding
[`data/CUSTOM_DATA_AUTHORING.md`](data/CUSTOM_DATA_AUTHORING.md) and
implemented-path [`data/CUSTOM_DATA_TUTORIAL.md`](data/CUSTOM_DATA_TUTORIAL.md).

## Publishing and deployment

The capability-token publishing service supports resumable private staging,
byte-size/SHA/schema validation, immutable publication, administrative aliases,
bounded requests, process-safe filesystem mutations, and external validation.
Its curator-owned compiler now promotes the cross-dataset project/edition
catalog explicitly, persists immutable edition identity history, and leaves the
last-known-good catalog visible when validation fails. Ordinary dataset
publication cannot grant public discovery, edition membership, or defaults.
D060 keeps that implementation as an optional future
multi-publisher path; no publishing server will run for the initial deployment.
The selected initial path is a local repository publisher using temporary,
least-privilege AWS credentials while preserving the same validation,
immutability, resumability, and catalog-last guarantees. The first S3 slice is
implemented in `tools/s3_publish.py`: offline plans, canonical preflight of a
private snapshot, complete declared-file inventory, private create-only
reservation/staging, SHA-256/size/header verification, immutable dependencies
before manifest, completion marker, and conditional dataset-index update last.
Retries reuse verified objects and preserve concurrent index changes. No AWS
mutation calls were made during implementation. The additional S3 curator path
uses the shared compiler, immutable cumulative edition history, unique public
catalog generations and a conditional catalog-last write. Pack/site transactions
reuse immutable verified staging; the production Vite wrapper excludes inherited
dev data/defaults and binds each build to explicit same-origin dependencies.
Its tracked optional `default_view` config supplies the approved feature and
2-D startup defaults after validation against the curator input. The
tested route function is deployed on the existing v2 distribution. D073's static landing at `/` and lazy
viewer at `/app/` share one mutable `site/index.html` entry and one immutable
build graph, preserving the existing conditional site-promotion transaction.
The landing reuses the app theme, a genuine reviewed-local 3-D capture and a
standalone SVG export of the viewer's regional slices. The visible caption
identifies the illustrated feature and vintage; source maturity remains recorded
with the assets. Visits load no viewer runtime or scientific data. The landing
credits the International Brain Laboratory, the Allen CCFv3 source and paper,
and the IBL supporters listed on iblcore.org. About/credits remain on the
landing, and `/app/#help` opens the existing guide. Responsive, navigation and
isolated production-build browser tests cover these routes. The owner approved
the landing design, revised copy, acknowledgements and vector slices at
`a3a88cd` on 2026-09-08. Dataset, pack, catalog and site transactions have now succeeded against S3;
multipart objects above 5 GB remain unimplemented. See
[Local publisher operations](publishing/LOCAL_PUBLISHER.md).
Public reads remain static and unauthenticated.

D040/D059/D060/D072 select private IBL-owned S3 and the existing CloudFront
origin `ephys-atlas.iblcore.org`. D074 authorizes initial IBL review and removes
a separate staging identity as a prerequisite. Distribution `ET6VJW8JWAGVR`
now serves the live landing/viewer and five scientific datasets. The existing
OAI, origin, aliases, certificate, DNS and shared bucket settings are preserved;
only distribution routing/cache fields and exact v2 object prefixes changed.
An existing private transaction object is denied through CloudFront and public
objects remain denied through anonymous S3.

The clean-Linux releases and packs identify source commit `62199f5`; the initial
site build `9fbcf5935cfe344374f9c0c84c2f35b8` identifies `db87240`. The latter
bundles hash-verified atlas region metadata and removes automatic speculative
volume pack requests. Full `just check` and CI pass. Live Chromium workflows
pass; Firefox completes the same workflows with six separately recorded
navigation cancellations and no HTTP or application errors. Native Safari on
this final origin remains unmeasured before wider promotion. Evidence:
[initial deployment](publishing/INITIAL_DEPLOYMENT_20260908.md) and
[live QA](publishing/initial-live-qa-20260908.json).

The subsequent D076 frontend update, including immediate SVG loading feedback,
is live as site build `26c142e513a9ff5ed842ecd9049e4b68` from `dd76aa5`. It restores bounded
directional volume prefetch, progressively persists all registered SVG packs,
and marks retained frames as updating during feature loads. Final Chromium and
Firefox checks pass; see the [prefetch deployment record](publishing/PREFETCH_DEPLOYMENT_20260908.md).

AGEA is included with provisional notes only in Data details. The D075 production volume release is now public in Ephys Atlas edition
`ibl-review-20260908-v2`. Benchmark bytes remain separate and outside discovery;
the existing v1 edition mapping is retained unchanged.
Q2/Q9 still govern the later paper freeze; Q19 remains final AGEA scientific
acceptance. No further administrator intervention is needed for the approved
initial deployment operations.

D056/D061 accept Project/Dataset/Release/Feature/View navigation, immutable
scoped project editions, curator-owned catalog promotion, explicit
edition/custom/local browser context, catalog-first exact URL resolution, and
responsive data selection refined by D063. The schema-v1 catalog/compiler cutover is
implemented across canonical and bundled schemas, Python and TypeScript
validators, publishing, synthetic Vite production, and distinct public/local
browser composition. Browser startup, Back/Forward, local inventory refresh,
and URL-v4 canonicalization now resolve that catalog to exact edition/custom/
local context before immutable release loading; unresolved published releases
are rejected. D063/D064 group project/dataset selection in Data, move rare version changes
into Data details, emphasize Feature, and place Display & parcellation alongside Data and Feature in the header (D065). The shared menus preserve atomic edition/custom/local
selection, bounded phone composition, live catalog status, and explicit
catalog/navigation recovery. No generic D056/D061 implementation slice remains.
Generic machinery may use synthetic edition values; Q9 blocks only the real paper
edition identity, scoped release mapping, defaults, aliases, and freeze
process. The binding product contract is
[`frontend/DATASET_NAVIGATION.md`](frontend/DATASET_NAVIGATION.md).

D055 accepts a distinct optional path for unlisted, expiring copies of locally
validated releases. Its first design uses anonymous browser uploads through a
separate CloudFront OAC boundary into private S3, create-only keys, supplied
checksums, a last-written completion marker, recipient-side full validation,
WAF/rate controls, Lifecycle expiry, monitoring, and a kill switch. It is not
implemented or deployed, is not private storage, and never updates the public
catalog. Q15 retains its exact operational limits and deployment values.

The committed complete development-bundle descriptor pins root manifests for
the current channel, cluster, Brain-Wide Map, volume, projection, and D042 mesh
artifacts. Its locked Python verifier checks bounded destinations, exact
identities, root bytes and hashes, full schema/pack graphs, copied provenance
inputs, and undeclared files. `just data` runs an atomic synchronizer followed
by that full validator: valid local artifacts cause no network request, while a
missing artifact with a resolved HTTPS source is downloaded into bounded
staging and installed only after encoded-byte integrity and its existing graph
validator pass. Failed staging is cleaned and accepted artifacts are left
unchanged. Each newly discovered graph layer is preflighted as a whole before
its resource requests. A repository-local advisory lock serializes cooperating
sync processes without requiring stale-lock-file recovery, while stable parent-directory
identity and directory-relative admission prevent parent swaps from redirecting
installation. A final destination check refuses a target already created by
another writer.

`just dev` and `just validate-local-full` consume the same descriptor but stay
read-only; no interactive compatibility recipes remain. Local Chromium
acceptance covers all four real datasets plus Summary, Top, Swanson, and the
optional 3-D context. The currently available graph contains 6 artifacts and
551,523,979 bytes. Every v4 origin remains explicitly unresolved,
so a fresh checkout receives actionable missing-origin errors. A new descriptor
can now pin the published production releases; the historical v4/v5 descriptors
must not be silently relabelled.
An absent optional mesh is reported but does not block launch-critical 2-D;
an invalid mesh already present fails closed.

`just data-refresh-local` refreshes channel/cluster upstream aliases and
proceeds only when their immutable source IDs match the reviewed bundle.
`just dev-latest` combines that check with startup. New upstream bytes require
audit and selection review; Brain-Wide Map and W26 volume stay pinned.

## Quality gates

CI and local `just check` use Python 3.12 through committed uv locks, Node 22,
repository-document integrity checks, a strict MkDocs Material/API-reference
build, executable synthetic authoring examples, Python builder/publishing
tests, strict TypeScript, web unit/rendering tests, production build, and
Chromium Playwright. An opt-in, single-worker local-import matrix also exercises
Chromium, Firefox, and Playwright WebKit; native `safaridriver` evidence is kept
distinct from Playwright WebKit. The generated documentation site is
local/CI-only; no Pages deployment is configured. Its reader path now includes
v2-native viewer and parcellation guides, while in-app Help links to those
guides without depending on a deployed documentation origin. The deterministic
golden fixture is synthetic and test-only. Broad Firefox/Safari release QA
remains part of the final matrix under D040; the optional 3-D local matrix was
completed on 2026-08-28 and the focused native-Safari local-import matrix on
2026-08-31.
Canonical documentation screenshot pixels are checked on Linux. macOS skips
only those host-dependent comparisons while retaining semantic browser tests.
The 2026-08-31 fixture, release, bundle, mesh, corrupt-cache, and warm-state
checks are recorded in
[`REPRODUCIBILITY_INTEGRITY_EVIDENCE.md`](REPRODUCIBILITY_INTEGRITY_EVIDENCE.md).

## Remaining launch sequence

1. Before wider promotion, complete the remaining general browser matrix,
   including native Safari and any compound launch-readiness gaps.
2. Treat Q2/Q9 as a separate paper freeze: select and publish its exact release
   set without changing the already exposed initial edition mappings.

The executable order and stop conditions live in
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md). Launch readiness remains
defined only by [`LAUNCH_SPEC.md`](LAUNCH_SPEC.md).

## Top-bar presentation

The grouped Data chooser, prominent searchable Feature, and workspace Display &
parcellation are implemented. D064 removes Release from the header. Data details
shows exact version identity and provenance, with a version picker only when
alternatives exist, a named snapshot return, and a current-dataset default action
where applicable. Data retains development/legacy/local status and navigation
recovery. Exact URLs, immutable mappings, and dataset-switch behavior continue
to use D061; Q9 configuration is unchanged.

Validation: `just check` passes on macOS (132 semantic browser tests; canonical
pixel comparisons skip on this host). The reviewed four-dataset local bundle
also passes `just validate-local-full` without browser errors. The manual
Documentation screenshots workflow provides Linux-generated, rechecked pixels
for review from macOS.
