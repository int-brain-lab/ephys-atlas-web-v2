# Integration status

Status: active pre-launch capability matrix.

Last reviewed: 2026-08-29 on `main` after the D050-D053 distribution work and
documentation authority repair.

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
| `local` | Same schema-v1 graph, complete integrity validation, atomic IndexedDB admission, shared materializers, explicit local/published distinction. | Deterministic golden import and corruption coverage. | Implement D051 ZIP authoring/import and local management UI. |

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
only regional channel `peak_val.raw`; all other new Q14 choices await audit and
owner review. The four D050 local candidates and integrated local catalog are
green; no remote publication occurred.

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
persistent Local management. That user-facing authoring/import path is planned,
not implemented. The binding plan is
[`data/CUSTOM_DATA_AUTHORING.md`](data/CUSTOM_DATA_AUTHORING.md).

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

1. Complete read-only Q14 audits and obtain owner review for any new choices.
2. Implement D051 regional authoring and ZIP import, then local management.
3. Resolve Q8 staging details and deploy immutable projection/data assets.
4. Confirm depth-four volume transport at that origin and resolve Q5.
5. Resolve Q2 and build the exact paper channel release.
6. Resolve Q9, publish the frozen release set, and configure defaults.
7. Run final production-origin, responsive, performance, failure, download,
   local-import, Chromium, Firefox, and Safari QA.

The executable order and stop conditions live in
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md). Launch readiness remains
defined only by [`LAUNCH_SPEC.md`](LAUNCH_SPEC.md).
