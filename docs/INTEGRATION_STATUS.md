# Integration status

Status: active pre-launch capability matrix.

Last reviewed: 2026-09-04 on `main` after the D056/D061 catalog/compiler cutover.

Code and tests are the implementation authority. This file summarizes current
capability and artifact maturity; it links to evidence instead of repeating
completed implementation diaries.

## Product architecture

| Capability | Implemented state | Evidence/maturity | Remaining production work |
| --- | --- | --- | --- |
| Release contract | Schema v1 is the sole builder, browser HTTP/local, publishing, fixture, and download contract; no v0.1 adapters remain. | Cross-language valid/invalid corpus and deterministic golden fixture are green. | None for contract machinery. |
| Browser boundaries | `core/domain`, `application`, `data`, `rendering`, and `ui` dependencies point inward; catalog IDs and feature catalogs remain open/data-driven. | Architecture tests are green; the [frontend lifecycle audit](FRONTEND_LIFECYCLE_AUDIT.md) records race fixes and bounded follow-ups. | None for current launch behavior. |
| 2-D workspace | One retained `ProjectionViewport` per registered frame composites scalar Canvas, regional SVG, guides, interaction, and errors. Top/Swanson use affine-free retained static viewports. Bounded, locally persisted desktop pane resizing/collapse gives space back to the retained workspace without changing share URLs or mobile drawers. | Production projection pack and responsive pane/keyboard Chromium coverage are green. | Deploy and verify immutable bytes at the Q8 origin. |
| Scientific navigation | One URL-v4 ML/AP/DV cursor drives the native bilateral 10 µm grid; sparse 80 µm SVG sampling changes display only. | Parent/sparse/projection-pack validation and performance evidence are complete. | Production-origin delivery verification. |
| Optional 3-D context | A sibling retained Three.js viewport shares regional presentation/selection and owns camera, explode, GPU lifecycle, and failure isolation. Volume features remain anatomy-only in 3-D. | D042 real pack is losslessly repackaged and ready locally; Chromium plus owner Safari/Firefox review passed. | Optional immutable public deployment and experimental-label decision; not launch-blocking. |
| Integrity/cache | Encoded resources are byte-size/SHA verified before persistent admission; corrupt entries are evicted/retried; decoded identity includes hash plus decode contract. | HTTP/local/mesh/projection/volume tests are green. | Verify final CDN headers and cache behavior. |

Stable boundaries and end-to-end flow are in
[`SYSTEM_OVERVIEW.md`](SYSTEM_OVERVIEW.md) and
[`ARCHITECTURE.md`](ARCHITECTURE.md). Rendering evidence is indexed by
[`rendering/README.md`](rendering/README.md).

## Scientific datasets

| Dataset | Builder and browser machinery | Current real artifact maturity | Blocker/next action |
| --- | --- | --- | --- |
| `ephys_atlas_channels` | Dynamic raw/denoised discovery, explicit `inside` recipe, Allen/Beryl/Cosmos summaries, D050 distributions, provenance, HTTP acceptance. | D054-reviewed, deterministic validated-real-local technical revision `2026_W32-d050-q14-v1`; not paper-facing or published. | Q2 paper vintage; Q8 staging origin. Keep release/suite reproducible. |
| `ephys_atlas_clusters` | D038/D044 all-row 14-feature recipe, deterministic summaries, D048/D054 presentation, D050 distributions, HTTP acceptance. | D054-reviewed, deterministic validated-real-local technical revision `sha256-9b5e55215b306f26-d050-d048-q14-v1`; not published. | Q8/Q9 publication/default authorization. |
| `brainwide_map` | D038 five-family Beryl-only legacy adapter, equivalence coverage, D050 distributions, HTTP acceptance. | D054-reviewed, deterministic validated-real-local technical revision `legacy-v1-1d908bea-d050-q14-linear-full-v1`, rebuilt from all six exact hash-pinned Parquets; not published. | Q8/Q9 publication/default authorization. |
| `ephys_atlas_volumes` | Both schema transports, exact D043 mapping/validity, retained Canvas slices, inspection, summaries, D050 global-only distributions, full 41-feature builds. | D054-reviewed, validated-real-local depth-4 deterministic technical revision `2026_W26-candidate-depth4-d050-q14-linear-full-v1`; explicitly non-production. | Q5 confirmation at the Q8 CloudFront origin, then immutable production build. |
| `local` | Same schema-v1 graph and materializers; public regional and explicit-grid volume `ibl_ephys_atlas` authoring; deterministic validated ZIP packaging; strict bounded two-phase browser import, atomic IndexedDB admission/deletion, inventory, and integrity recovery. | Real regional and 467 MiB/6,807-entry volume archives pass Chromium, Firefox, and native Safari import/reload checks; near-1 GiB and 20,000-entry boundaries pass Chromium/Firefox; adversarial, cancellation, quota, rollback, reload, delete, and recovery regressions are recorded. | Supported capacity remains provisional pending native-Safari quota/RSS and representative end-user-device evidence; publish the Python distribution only after authorization. |

Dataset source, recipe, selection, release, and audit ownership is indexed by
[`data/README.md`](data/README.md). The final paper-facing source vintage and
all remaining choices are governed by [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md).

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
dataset-specific Chromium acceptance, and integrated v4 bundle validation; no
remote publication occurred. See
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
profile evidence favor depth four. Q5 remains open only because the provisional
recommendation has not been repeated at the eventual CloudFront origin. See
[`data/VOLUME_2026_W26_EVIDENCE.md`](data/VOLUME_2026_W26_EVIDENCE.md).

## Local data and downloads

Share, Info, current regional CSV, selected comparison CSV, and declared
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
immutability, resumability, and catalog-last guarantees. This S3 publisher is
not implemented yet. Public reads remain static and unauthenticated.

D040 selects IBL-owned S3 plus CloudFront. Authenticated terminal reads and a
non-mutating conditional-write authorization probe now pass against the
private candidate `us-east-1` location recorded in
[`docs/publishing/S3_DEPLOYMENT.md`](publishing/S3_DEPLOYMENT.md). D059 selects
isolated staging and production roots there plus
`ephys-atlas.iblcore.org` as the planned initial viewer domain. D060 selects
CloudFront for both the S3-hosted compiled Vite viewer and same-origin public
data, with no Cloudflare Pages deployment. Q8 still requires the exact
distribution/origin configuration, isolated staging hostname, DNS/ACM,
cache/CORS choices, publisher IAM policy and implementation, and first staging
artifact authorization; Q9 still requires the frozen paper release set and
aliases. No remote publication has occurred.

D056/D061 accept Project/Dataset/Release/Feature/View navigation, immutable
scoped project editions, curator-owned catalog promotion, explicit
edition/custom/local browser context, catalog-first exact URL resolution, and
a staged narrow Data chooser. The schema-v1 catalog/compiler cutover is
implemented across canonical and bundled schemas, Python and TypeScript
validators, publishing, synthetic Vite production, and distinct public/local
browser composition. The current application state and top bar remain flat, so
the resolved-navigation, desktop/tablet, and narrow/accessibility slices remain.
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
optional 3-D context. The descriptor validates 8,164 files and 534,262,861
bytes in the current workspace. Every v3 origin remains explicitly unresolved,
so a fresh checkout receives actionable missing-origin errors and remote
distribution remains blocked on Q8 despite the completed downloader machinery.
An absent optional mesh is reported but does not block launch-critical 2-D;
an invalid mesh already present fails closed.

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
The 2026-08-31 fixture, release, bundle, mesh, corrupt-cache, and warm-state
checks are recorded in
[`REPRODUCIBILITY_INTEGRITY_EVIDENCE.md`](REPRODUCIBILITY_INTEGRITY_EVIDENCE.md).

## Remaining launch sequence

1. Resolve Q8 staging details and deploy immutable projection/data assets.
2. Confirm depth-four volume transport at that origin and resolve Q5.
3. Resolve Q2 and build the exact paper channel release.
4. Resolve Q9, publish the frozen release set, and configure defaults.
5. Run final production-origin, responsive, performance, failure, download,
   local-import, Chromium, Firefox, and Safari QA.

The executable order and stop conditions live in
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md). Launch readiness remains
defined only by [`LAUNCH_SPEC.md`](LAUNCH_SPEC.md).
