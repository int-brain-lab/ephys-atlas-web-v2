# Open questions

This file records unresolved choices that an implementation agent must not guess. Resolve an item by citing authoritative evidence and, when the choice changes architecture/product behavior, recording the decision in `docs/DECISIONS.md`.

Status labels:

- **BLOCKER** — must be resolved before the affected production release/launch criterion can be completed.
- **DECISION** — does not necessarily block coding, but must be settled before production deployment.
- **FOLLOW-UP** — useful after launch and not currently blocking.

## Q1 — Channel features: raw or denoised?

Status: **RESOLVED (2026-08-20)**.

Evidence currently available:

- the private paper example uses project `ea_active` and vintage `2025_W28`;
- its comment says `load_denoised=False` is the raw-feature path;
- the actual example call to `read_features_from_disk(...)` omits `load_denoised`;
- the current `ibleatools` implementation defaults `load_denoised=True`, which loads `raw_ephys_features_denoised.pqt`; `False` loads `raw_ephys_features.pqt`.

Resolution: publish raw and denoised source variants as separately identified
features in the same immutable release, for example `rms_ap.raw` and
`rms_ap.denoised`. Raw values remain the audit/reference layer; validated
denoised values may be the default visualization. The builder reads the two
source parquet files explicitly and records the variant, source column, and
pinned tool commits rather than inheriting `read_features_from_disk()` defaults.

## Q2 — Channel source vintage

Status: **BLOCKER** for the paper-facing production release.

Current evidence: the private example uses `ea_active/2025_W28`; project guidance says development should use the latest available encoding/channel products and that a newer vintage is likely before submission.

Resolution needed: exact immutable `ea_active` vintage for the paper-facing release. Development may follow `latest` only if the resolved immutable vintage is recorded when a release is built.

Blocks: paper-facing channel release and final catalog defaults.

## Q3 — Channel QC / source population

Status: **RESOLVED (2026-08-20)**.

Resolution: use the explicit `inside` population. Exclude rows marked outside
the atlas by the source channel labels, then exclude non-finite observations
independently per feature. Apply no additional physiological label/QC filter,
clipping, winsorization, or silent alpha replacement. Fold bilateral atlas IDs
onto the left representation before regional aggregation and record counts and
the complete recipe in provenance.

## Q4 — Encoding-volume scientific transform and outside-brain semantics

Status: **BLOCKER** for the production `ephys_atlas_volumes` release.

Current official `ibleatools` documentation identifies the implementation input
as the `ea_active/2026_W26/brainwide_ephys_atlas_50um.npz` object: a 50 um,
`(228, 264, 160, 41)` float16 volume. It states that the stored values are raw
and unnormalized, optional `mean_per_feature`/`std_per_feature` z-scoring is not
pre-applied, and `0.0` denotes outside-brain voxels. Shape and resolution alone
are still not a scientific coordinate transform. The browser implementation
deliberately requires an explicit `index_to_world_um` transform.

A deterministic local review page now compares the eight direction candidates
allowed by the exact W26/Allen shape match in three linked views, with
voxel-center and half-voxel-shifted coordinate conventions. The current mask
evidence ranks the all-forward candidate first (Dice `0.9940758117`), but does
not prove handedness or the index-center convention. See
`docs/data/VOLUME_GEOMETRY_REVIEW.md`. No candidate has been selected.

Resolution needed: authoritative scientific axis mapping, origin/affine,
handedness/directions, and any missing-value semantics distinct from the
documented outside-brain zero. The measured C-order storage layout is a
transport fact and does not resolve the scientific axis mapping.

Blocks: scientifically valid volume navigation and production volume release.

## Q5 — Production volume transport

Status: **BLOCKER** for production volume packaging, not for golden-fixture development.

Schema v1 permits `chunks3d` and `orthogonal_slice_packs`. `chunks3d` is the deterministic reference implementation, but production selection must be based on real-volume browser measurements.

Resolution needed: benchmark representative real features and choose a layout using recorded request count, transferred bytes, decode latency, interaction latency, and memory. Benchmark multiple chunk/pack sizes as appropriate.

Current evidence: the checksummed `2026_W26` source was measured for `psd_lfp`,
`rms_ap`, and `polarity`. Depth-4 packs require three center-plane objects and
0.20–0.36 MiB gzip versus 36–136 cube objects and 1.35–4.56 MiB. Ten-trial local
Chromium measurements put depth-4 cold planes at 14.6–15.5 ms p50 and
29.5–40.0 ms p95, with cached navigation at 2.4–2.6 ms p50 and no requests.
Depth 8 roughly doubles cold bytes and raises cold p50 to 24.3–26.2 ms. Depth 4
remains the recommendation; Q5 still needs confirmation under production cache
headers and network profiles. Exact evidence is in
`docs/data/VOLUME_2026_W26_EVIDENCE.md`.

Blocks: final browser volume transport and production packaging recipe.

## Q6 — Cluster launch population and feature set

Status: **PARTIALLY RESOLVED; BLOCKER** for the production `ephys_atlas_clusters` release.

Resolved: use every row of `clusters.table.pqt`, not
`clusters_good.table.pqt`. Apply no good-unit filter or insertion balancing.
For every explicitly selected scalar feature, average all finite clusters in
each left-folded Allen/Beryl/Cosmos region with one equal-weight observation per
cluster; publish descriptive statistics, histograms, and counts.

Resolved by D038: use the `ibl_neuropixel_brainwide_01` project and create a
content-addressed snapshot of its otherwise unversioned `cells_aggregates`
source objects. Review the 14 legacy scalar cluster features named by D038 as
the initial launch-catalog candidate; waveform, ACG, STPC, and STLFP arrays are
not regional launch features.

Completed evidence: content-addressed snapshot `sha256-9b5e55215b306f26` and
the column/unit/missingness/range/distribution audit in
`docs/data/CLUSTERS_SOURCE_AUDIT.md`. All 14 candidates are present, but the
pinned schema declares no units and several distributions require scientific
review.

Still needed: record human approval or adjustment of the final scalar catalog,
units/descriptions, and any presentation-only log defaults. Units/transforms
must remain null rather than being guessed when absent.

Blocks: the final production cluster release, not the source pull/audit or
deterministic builder machinery.

## Q7 — Exact `brainwide_map` launch product

Status: **RESOLVED by D038 (2026-08-22)**.

The resolution deliberately selects the exact checksummed legacy website
snapshot. Do not substitute a different legacy export or paper-selection file
without a new decision and release identity.

Resolution: preserve the v1 website's five Beryl-only Parquet families
(`choice`, `feedback`, `stimulus`, `wheel_speed`, and `wheel_velocity`) as a
checksummed legacy snapshot and reproduce the pinned v1 generator semantics in
schema v1. Label it as a preserved legacy website product, not as a current
paper-pipeline regeneration. This unblocks the BWM builder, catalog entry, and
browser acceptance work.

## Q8 — Production public origin and storage

Status: **PARTIALLY RESOLVED by D040; DECISION**.

Resolved direction: use IBL-owned S3 for immutable objects with CloudFront as
the preferred HTTPS/browser origin. Do not use or modify `iblviz` without
explicit repository-owner permission.

Resolution still needed: final bucket, distribution and domain names, exact
cache/CORS policy, and whether the publishing service writes directly to S3 or
through an intermediate filesystem/object-sync layer.

Blocks: production-origin QA, generated v3 anatomy-pack deployment, and
deployment documentation.

## Q9 — Paper-facing release aliases/defaults

Status: **DECISION**.

The architecture supports mutable aliases such as `latest` and immutable release IDs. The paper-facing viewer default must resolve to a frozen release set.

Resolution needed: alias naming (`paper`, publication label, etc.), exact dataset releases, and when the freeze occurs.

Blocks: final production catalog/defaults and publication reproducibility statement.

## Q10 — Curated SVG v2 asset location

Status: **RESOLVED by D023**.

The registered generated pack is committed under its immutable pack ID and is
the default provider. Production v2 no longer contacts the legacy atlas host.
The legacy bytes remain pinned historical fallback inputs and need not be
copied for the default launch path.

## Q11 — Cross-browser release gate depth

Status: **RESOLVED by D040 (2026-08-22)**.

Chromium Playwright is automated. Launch targets also include Firefox and Safari.

Resolution: retain automated Chromium Playwright and perform a documented
manual Firefox and Safari release matrix. Automated Firefox/WebKit jobs are not
required for launch.

## Q12 — 3-D production promotion and final LOD

Status: **FOLLOW-UP**; does not block the independent lab or launch.

D032 fixes the lab direction: Three.js WebGL2, a pinned derived mesh pack,
14-bit position quantization, meshopt compression, a conservative default LOD,
one optional higher LOD, dynamic regional presentation, and genuine radial
explode. These are sufficient to implement and measure the experiment.

The repository owner approved integration as an optional, visibly experimental
main-application context view on 2026-08-22. This resolves whether integration
machinery may be built. On the same date, the owner approved the deepest-active
grey-matter scope, the explicit Allen 545 (`RSPd4`) source exclusion, the Allen
898 open-midline exception, and nullable reduced mappings. D041 records those
choices; they do not approve a final LOD, production asset, or scientific
release.

All exact local inputs have now been found and SHA-256 verified. A canonical
10 um bilateral LUT audit checked all 1,130 signed source surfaces and found
four annotation centroids outside the pinned GLB bounds: Allen -927,
-526322264, +526322264, and +599626923. The largest axis discrepancy is
109.447 um. Candidate generation fails closed and writes its audit outside Git
under `artifacts/mesh-production-candidate/pack/`; it does not clamp the
centroids or claim a valid production pack.

On 2026-08-22 the owner approved deterministic canonical-annotation
regeneration of the complete bilateral source identities for Allen 927,
526322264, and 599626923. That exact regeneration is implemented locally. A
subsequent fail-closed scope gate found that the frozen donor contains only the
left signed surfaces for Allen 222 (`RO`) and 763 (`OV`): 566 unique positive
IDs produce 1,130 donor surfaces, whereas schema v1 requires every source to be
bilateral and the approved checklist expects 565 positive IDs / 1,130 signed
regions. Canonical LUT metadata instead has 566 / 1,132. On 2026-08-24 the
owner authorized canonical bilateral regeneration for those two identities.
Candidate `local-review-a60a248df394fc58` now passes schema, graph, integrity,
coverage, topology, bounds, and byte-rebuild gates with 566 / 1,132. Its local
review UI, metrics, browser evidence, and screenshots are complete; owner
geometry/LOD review remains pending. The exact handoff is in
`docs/rendering/3D_PROMOTION_REVIEW.md`.

Resolution still needed before production promotion: the recorded 320/480/800
px owner review; Chrome/Edge,
Firefox, and Safari transfer/decode/first-frame/memory/picking results; final
default/upgrade LODs; and the public immutable asset origin.

Blocks: production 3-D asset publication and removal of the experimental label,
not implementation of the optional context view with deterministic fixtures.

## Q13 — Top/Swanson deployed-fragment license coverage

Status: **BLOCKER** for publishing the derived production static maps, not for
schema/runtime work with synthetic fixtures.

The official v1 source repository at
`1d908bea095be2616a750d939d143f3b4db2a641` is MIT licensed and pins both view
boxes to `60 20 340 300`. The deployed `slices_top.json` and
`slices_swanson.json` bytes, hashes, and path counts are recorded in
`docs/frontend/LEGACY_CURATED_ASSETS.md`, but the deployed JSON contains no
separate license declaration and is not tracked in that source commit.

Resolution needed: authoritative confirmation that the repository MIT license
covers those official deployed curated artifacts, plus preservation of the
required notice in the derived asset release. If it does not, provide an
authorized equivalent source. Do not infer coverage merely from the hosting
domain.

Blocks: production Top/Swanson asset ingestion/publication only. Synthetic
static-map contract, builder, renderer, and interaction work remains unblocked.

## How to resolve an item

When authoritative evidence arrives:

1. update this file with the answer and evidence/source;
2. add or amend a decision in `docs/DECISIONS.md` when the choice is architectural/product-significant;
3. update `docs/IMPLEMENTATION_PLAN.md` to unblock the dependent milestone;
4. implement the production recipe/behavior with deterministic tests;
5. record the resolved choice in release provenance when scientifically relevant.
