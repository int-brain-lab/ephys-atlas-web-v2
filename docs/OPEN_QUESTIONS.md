# Open questions

This file records unresolved choices that an implementation agent must not guess. Resolve an item by citing authoritative evidence and, when the choice changes architecture/product behavior, recording the decision in `docs/DECISIONS.md`.

Status labels:

- **BLOCKER** — must be resolved before the affected production release/launch criterion can be completed.
- **DECISION** — does not necessarily block coding, but must be settled before production deployment.
- **FOLLOW-UP** — useful after launch and not currently blocking.

## Q1 — Channel features: raw or denoised?

Status: **BLOCKER** for the production `ephys_atlas_channels` release.

Evidence currently available:

- the private paper example uses project `ea_active` and vintage `2025_W28`;
- its comment says `load_denoised=False` is the raw-feature path;
- the actual example call to `read_features_from_disk(...)` omits `load_denoised`;
- the current `ibleatools` implementation defaults `load_denoised=True`, which loads `raw_ephys_features_denoised.pqt`; `False` loads `raw_ephys_features.pqt`.

Therefore the example text and effective current default are ambiguous. Do not silently preserve either interpretation.

Resolution needed: an authoritative scientific choice for the production/paper release, plus confirmation of the relevant `ibleatools` version if reproducing a historical run.

Blocks: production channel build, paper-facing channel provenance.

## Q2 — Channel source vintage

Status: **BLOCKER** for the paper-facing production release.

Current evidence: the private example uses `ea_active/2025_W28`; project guidance says development should use the latest available encoding/channel products and that a newer vintage is likely before submission.

Resolution needed: exact immutable `ea_active` vintage for the paper-facing release. Development may follow `latest` only if the resolved immutable vintage is recorded when a release is built.

Blocks: paper-facing channel release and final catalog defaults.

## Q3 — Channel QC / source population

Status: **BLOCKER** for the production `ephys_atlas_channels` release.

The builder now requires an explicit population rather than guessing. The exact launch recipe still needs authoritative confirmation, including whether outside-brain rows are excluded and what channel/QC labels are applied before regional aggregation.

Resolution needed: named, reproducible population/QC recipe with source columns and exclusion rules.

Blocks: production regional values/statistics/histograms.

## Q4 — Encoding-volume scientific transform and outside-brain semantics

Status: **BLOCKER** for the production `ephys_atlas_volumes` release.

Current source documentation establishes a 25 um volume and known array shape/feature metadata, but shape alone is not a scientific coordinate transform. The browser implementation deliberately requires an explicit `index_to_world_um` transform.

Resolution needed: authoritative axis order, origin/affine, handedness/directions, and outside-brain/missing-value semantics from the atlas/producer code or release metadata.

Blocks: scientifically valid volume navigation and production volume release.

## Q5 — Production volume transport

Status: **BLOCKER** for production volume packaging, not for golden-fixture development.

Schema v0.1 permits `chunks3d` and `orthogonal_slice_packs`. `chunks3d` is the deterministic reference implementation, but production selection must be based on real-volume browser measurements.

Resolution needed: benchmark representative real features and choose a layout using recorded request count, transferred bytes, decode latency, interaction latency, and memory. Benchmark multiple chunk/pack sizes as appropriate.

Blocks: final browser volume transport and production packaging recipe.

## Q6 — Cluster launch population and feature set

Status: **BLOCKER** for `ephys_atlas_clusters`.

Resolution needed: authoritative source snapshot, population/QC definition, launch feature catalog, units/transforms, and parcellation aggregation semantics.

Blocks: cluster dataset builder and production release.

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

Status: **DECISION**.

The exact legacy bytes are pinned and must be reused. Production v2 should not depend on `atlas.internationalbrainlab.org/data/json/` indefinitely.

Resolution needed: immutable/versioned v2 asset URL under the selected production origin. Copy bytes exactly; do not regenerate.

Blocks: removing the legacy-host runtime dependency.

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