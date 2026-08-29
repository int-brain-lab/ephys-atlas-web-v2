# Integration status

Status: active pre-launch capability matrix.

Last reviewed: 2026-08-29 on `main` after the D050-D053 distribution work,
documentation authority repair, and Allen regional authoring/ZIP-import slice.

Code and tests are the implementation authority. This file summarizes current
capability and artifact maturity; it links to evidence instead of repeating
completed implementation diaries.

## Product architecture

| Capability | Implemented state | Evidence/maturity | Remaining production work |
| --- | --- | --- | --- |
| Release contract | Schema v1 is the sole builder, browser HTTP/local, publishing, fixture, and download contract; no v0.1 adapters remain. | Cross-language valid/invalid corpus and deterministic golden fixture are green. | None for contract machinery. |
| Browser boundaries | `core/domain`, `application`, `data`, `rendering`, and `ui` dependencies point inward; catalog IDs and feature catalogs remain open/data-driven. | Architecture tests and full gate are green. | None. |
| 2-D workspace | One retained `ProjectionViewport` per registered frame composites scalar Canvas, regional SVG, guides, interaction, and errors. Top/Swanson use affine-free retained static viewports. | Production projection pack is committed; Chromium browser coverage is green. | Deploy and verify immutable bytes at the Q8 origin. |
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
| `ephys_atlas_channels` | Dynamic raw/denoised discovery, explicit `inside` recipe, Allen/Beryl/Cosmos summaries, D050 distributions, provenance, HTTP acceptance. | Validated-real-local `2026_W32-d050-peak-val-raw-v2`; not paper-facing or published. | Q2 paper vintage; Q8 staging origin. Keep release/suite reproducible. |
| `ephys_atlas_clusters` | D038/D044 all-row 14-feature recipe, deterministic summaries, D048 presentation, D050 distributions, HTTP acceptance. | Validated-real-local `sha256-9b5e55215b306f26-d050-d048-v1`; owner-reviewed, not published. | Q8/Q9 publication/default authorization. |
| `brainwide_map` | D038 five-family Beryl-only legacy adapter, equivalence coverage, D050 distributions, HTTP acceptance. | Validated-real-local `legacy-v1-1d908bea-d050-linear-full-v1`; not published. | Q8/Q9 publication/default authorization. |
| `ephys_atlas_volumes` | Both schema transports, exact D043 mapping/validity, retained Canvas slices, inspection, summaries, D050 global-only distributions, full 41-feature builds. | Validated-real-local depth-4 candidate `2026_W26-candidate-depth4-d050-linear-full-v1`; explicitly non-production. | Q5 confirmation at the Q8 CloudFront origin, then immutable production build. |
| `local` | Same schema-v1 graph and materializers; public regional and explicit-grid volume `ibl_ephys_atlas` authoring; deterministic validated ZIP packaging; strict bounded two-phase browser import, atomic IndexedDB admission/deletion, inventory, and integrity recovery. | Regional/reduced-mapping and float16/float32 mask/sentinel volume tests, generated-schema parity, clean-wheel coverage, exact regeneration of both committed public-authored archives, and Chromium import/render/management tests are green. | Measure provisional limits across browsers/real archives; publish the Python distribution only after authorization. |

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
tails. D053 preserves off-scale color bounds without clamping. D052 approves
only regional channel `peak_val.raw`. Complete read-only source audits and
review tables now cover all four datasets; all other new Q14 choices await
owner review. The four D050 local candidates and integrated local catalog are
green; no remote publication occurred. See
[`data/DISTRIBUTION_AUDIT_EVIDENCE.md`](data/DISTRIBUTION_AUDIT_EVIDENCE.md).

## Volume exploration

The retained volume path supports `chunks3d` and `orthogonal_slice_packs`,
float16/float32, optional gzip, explicit storage axes, affine mapping,
sentinel/mask validity, transparent invalid voxels, nearest-neighbor paint and
inspection, atomic anatomy/scalar navigation, URL layer controls, consumer-safe
cancellation, and one 96 MiB active-feature decoded budget.

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
local storage is unavailable. Archive ceilings are provisional until
representative regional and volume bundles are measured in Chromium, Firefox,
and Safari. Public volume authoring uses factory-verified geometry from an
already-created `AllenAtlas`, preserves float16/float32 values, requires
explicit mask or sentinel validity, and computes valid-only summaries. Its tiny
synthetic archive is exactly regenerable and has Chromium import, rendering,
navigation, and IndexedDB-only reload evidence. PyPI publication remains
incomplete. See the binding
[`data/CUSTOM_DATA_AUTHORING.md`](data/CUSTOM_DATA_AUTHORING.md) and
implemented-path [`data/CUSTOM_DATA_TUTORIAL.md`](data/CUSTOM_DATA_TUTORIAL.md).

## Publishing and deployment

The capability-token publishing service supports resumable private staging,
byte-size/SHA/schema validation, immutable publication, aliases, catalog
generation, bounded requests, process-safe filesystem mutations, and external
validation. Public reads remain static and unauthenticated.

D040 selects IBL-owned S3 plus CloudFront. Q8 still requires concrete
bucket/distribution/domain and publishing-topology choices; Q9 still requires
the frozen paper release set and aliases. Nothing in the current repository
state authorizes remote publication.

## Quality gates

CI and local `just check` use Python 3.12 through committed uv locks, Node 22,
Python builder/publishing tests, strict TypeScript, web unit/rendering tests,
production build, and Chromium Playwright. The deterministic golden fixture is
synthetic and test-only. Manual Firefox/Safari remains part of final release QA
under D040; the optional 3-D local matrix was completed on 2026-08-28.

## Remaining launch sequence

1. Obtain owner review of the completed Q14 audit tables for any new choices.
2. Measure D051 ZIP import across representative real archives and browsers.
3. Resolve Q8 staging details and deploy immutable projection/data assets.
4. Confirm depth-four volume transport at that origin and resolve Q5.
5. Resolve Q2 and build the exact paper channel release.
6. Resolve Q9, publish the frozen release set, and configure defaults.
7. Run final production-origin, responsive, performance, failure, download,
   local-import, Chromium, Firefox, and Safari QA.

The executable order and stop conditions live in
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md). Launch readiness remains
defined only by [`LAUNCH_SPEC.md`](LAUNCH_SPEC.md).
