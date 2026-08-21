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

Resolution needed: authoritative scientific axis mapping, origin/affine,
handedness/directions, and any missing-value semantics distinct from the
documented outside-brain zero. The measured C-order storage layout is a
transport fact and does not resolve the scientific axis mapping.

Blocks: scientifically valid volume navigation and production volume release.

## Q5 — Production volume transport

Status: **BLOCKER** for production volume packaging, not for golden-fixture development.

Schema v0.1 permits `chunks3d` and `orthogonal_slice_packs`. `chunks3d` is the deterministic reference implementation, but production selection must be based on real-volume browser measurements.

Resolution needed: benchmark representative real features and choose a layout using recorded request count, transferred bytes, decode latency, interaction latency, and memory. Benchmark multiple chunk/pack sizes as appropriate.

Current evidence: real `2026_W12` offline benchmarks for `psd_lfp`, `rms_ap`,
and `polarity` measure 32³/64³ chunks and 4/8-slice packs. Packs need only three
center-plane objects and 0.83–3.32 MiB gzip versus 136/534 cube objects and
5.21–21.77 MiB. A ten-trial real-`rms_ap` Chromium benchmark of the implemented
adapter measured depth-4 cold planes at 37.8/54.1 ms p50/p95, cached navigation
at 0.8/1.5 ms with zero requests, and six-plane prepare+paint at 3.7/8.7 ms.
Depth 4 is the current recommendation; it still needs confirmation on more
feature distributions and the final HTTP/CDN origin before this question is
resolved.

Blocks: final browser volume transport and production packaging recipe.

## Q6 — Cluster launch population and feature set

Status: **PARTIALLY RESOLVED; BLOCKER** for the production `ephys_atlas_clusters` release.

Resolved: use every row of `clusters.table.pqt`, not
`clusters_good.table.pqt`. Apply no good-unit filter or insertion balancing.
For every explicitly selected scalar feature, average all finite clusters in
each left-folded Allen/Beryl/Cosmos region with one equal-weight observation per
cluster; publish descriptive statistics, histograms, and counts.

Still needed: the authoritative project/source snapshot and the explicit
launch feature catalog. Units/transforms must come from that pinned source
schema and remain null rather than being guessed when absent.

Blocks: production cluster source pull/release, not the deterministic builder machinery.

## Q7 — Exact `brainwide_map` launch product

Status: **BLOCKER** for `brainwide_map`.

Do not equate the intended launch dataset with whichever legacy website export or paper-selection file is easiest to find.

Resolution needed: authoritative source repository/object, population/selection, features, release/vintage, and expected regional/volume representations.

Blocks: BWM builder, catalog entry, launch acceptance for this dataset.

## Q8 — Production public origin and storage

Status: **DECISION**.

Resolution needed: final domain, object-storage/CDN location, cache policy, CORS configuration, and whether the publishing service writes directly to that storage or to an intermediate filesystem/object-sync layer.

Blocks: production-origin QA, final curated SVG relocation, deployment documentation.

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

Status: **DECISION**.

Chromium Playwright is automated. Launch targets also include Firefox and Safari.

Resolution needed: decide whether to add automated Firefox/WebKit Playwright jobs before launch or perform a documented manual release matrix for those browsers.

Blocks: final browser QA sign-off, not ordinary implementation.

## How to resolve an item

When authoritative evidence arrives:

1. update this file with the answer and evidence/source;
2. add or amend a decision in `docs/DECISIONS.md` when the choice is architectural/product-significant;
3. update `docs/IMPLEMENTATION_PLAN.md` to unblock the dependent milestone;
4. implement the production recipe/behavior with deterministic tests;
5. record the resolved choice in release provenance when scientifically relevant.
