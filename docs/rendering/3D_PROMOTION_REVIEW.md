# 3-D promotion candidate regeneration and review handoff

Status: **local candidate and automated evidence complete; owner visual/LOD
review pending (2026-08-24)**.

This is the single checklist for the next agent and the repository owner when
resuming Q12. It narrows Commit 7 of `3D_INTEGRATION_PLAN.md`; it does not
authorize publication, a default production descriptor, removal of the
experimental label, or donor retirement.

The fail-closed exact-input audit and its durable machinery landed on `main` in
`3e325ed`. A later agent must start from the then-current fetched `main`, not
detach or reset to that historical commit.

## Approved decisions

The repository owner has explicitly approved:

- deepest-active descendants of Allen root 8 (`grey`);
- explicit source exclusion of Allen 545 (`RSPd4`);
- the Allen 898 (`PCG`) open-midline exception;
- nullable Beryl and Cosmos mappings; and
- deterministic regeneration from the canonical bilateral 10 um annotation
  for positive Allen IDs 927 (`ACAd6b`), 526322264 (`FRP6b`), and 599626923
  (`SCO`); and
- deterministic bilateral regeneration for Allen 222 (`RO`) and 763 (`OV`),
  approved on 2026-08-24 after the frozen donor was found to contain only their
  negative/left surfaces.

Regenerate the complete bilateral source identity for each of those three
positive IDs, producing both signed hemispheres even where only one side failed
the audit. Do not combine old geometry on one side with canonical geometry on
the other. The remaining 561 positive source identities continue to come from
the pinned GLB.

Keep all generated packs, reports, screenshots, and measurements under ignored
`artifacts/`. Work locally on `main`. Do not deploy or publish during this
slice.

## Why regeneration is required

The first exact-input audit checked 1,130 signed surfaces. Four canonical
annotation centroids fell outside their pinned GLB bounds:

| signed Allen ID | region | maximum outside distance |
| ---: | --- | ---: |
| -927 | ACAd6b | 109.447 um |
| -526322264 | FRP6b | 52.930 um |
| +526322264 | FRP6b | 22.284 um |
| +599626923 | SCO | 1.608 um |

The audit is generated at
`artifacts/mesh-production-candidate/pack/canonical-centroid-audit.json`.
Candidate creation correctly stops before emitting a manifest. Never resolve
this by clamping centroids, substituting mesh-derived centroids, expanding
declared bounds, or marking bounds validation green.

The initially approved six-surface regeneration completed locally with exact pinned
inputs and topology-safe separation of ambiguous voxel contacts. Before pack
emission, a second fail-closed gate found a contradiction in the frozen donor:
Allen 222 (`RO`) and 763 (`OV`) each have only a negative/left signed surface.
The donor therefore contains 566 unique positive source IDs and 1,130 signed
surfaces, while the current schema and this checklist require 565 fully
bilateral source IDs and 1,130 signed regions. Canonical metadata contains both
signs for all 566 IDs (1,132 signed regions).

On 2026-08-24 the owner explicitly authorized canonical bilateral regeneration
for Allen 222 and 763. The resulting ten signed overrides produce 566 fully
bilateral positive identities and 1,132 signed regions. Candidate
`local-review-a60a248df394fc58` passes schema and complete-file-graph
validation and reproduces byte-for-byte. Compact is 1,538,309 bytes and high is
2,015,792 bytes. The review bundle, per-region metrics, retained-geometry
browser evidence, and 320/480/800 screenshots are under
`artifacts/mesh-production-candidate/review/`. Publication remains unapproved.

## Pinned inputs

Discover local paths rather than assuming another checkout layout, then verify
these identities before doing any geometry work:

| input | bytes | SHA-256 |
| --- | ---: | --- |
| public `atlas/meshes.glb` | 96,622,012 | `487a72172249acd4dba5b40c392fa8eb065b09bc8638f3195163c4cbf8f569db` |
| `annotation_10.nrrd` | 32,802,468 | `a9e9654ef491f0af107dc0a61bd720dabe7f36e8f3e9239532bf3dbdc94ef24c` |
| `annotation_10_lut_bilateral_v02.npy` | 2,407,680,128 | `f8c26e2eb972cbff5caa2101fda8b7c5c2a2bdb985e3faad6bf0e57defcc27cb` |
| Allen catalog `regions.json` | 475,154 | `71a878043aad6c4dbf7a4ca92bd643cad9910984ed81231784e96ff5829afa8b` |
| active sparse projection manifest | 27,576 | `4aeab256be79588fb6b9032bb9482479e227a1fa5499060db037318882e5fe9d` |

The active projection pack ID is
`allen-ccfv3-10um-bilateral-exact-599b5e0bbab1-display-80um-d8-f8277956e67a`.
Its parent is the immutable bilateral 10 um anatomy pack. The frozen donor is
read-only evidence at `ba1e2d129753bdc459bca7b23fa896f41ee13536`.

## Next-agent implementation contract

1. Start from a clean, fetched `main` and reproduce the existing failing audit.
2. Extend the offline builder with a deterministic canonical-annotation
   override for exactly the three approved positive IDs.
3. Build each override from the bilateral LUT mask assigned to that Allen
   source identity, including canonical descendants according to the same
   deepest-active selection used by `canonical_metadata.py`.
4. Extract geometry using the declared 10 um voxel-centre/voxel-edge and
   ML/AP/DV convention. Record the extraction algorithm and parameters. Do not
   add aesthetic smoothing, hole filling, manual vertex edits, or another
   ontology vintage.
5. Generate both hemispheres for each override. Preserve negative ML as left,
   positive ML as right, and use the canonical ML boundary rather than the
   legacy 5695/25 um workaround.
6. Retain the pinned GLB bytes and hash as the source for every unaffected
   identity. Record each override ID, annotation/LUT identity, extraction
   method, builder commit, and resulting source hash in provenance.
7. Run per-region adaptive simplification for the compact and high candidates,
   then 14-bit position/8-bit normal quantization, meshopt encoding, and
   deterministic gzip. Do not publish a full-resolution browser LOD.
8. Emit only the current snake_case `atlas-mesh-pack-v1` contract. Do not
   restore the donor lab manifest or add a compatibility schema.
9. Rebuild byte-for-byte, validate the complete file graph, and run
   `just check` before handing the candidate to the owner.

If exact canonical extraction cannot satisfy the existing topology, bounds,
coverage, or bilateral invariants, stop and record the evidence. Do not expand
the approved ID set or alter the scientific rule without new owner approval.

## Required automated evidence

The handoff is not ready for human review until it contains:

- a schema-valid manifest and validation report;
- deterministic rebuild equality for the manifest and every resource;
- all 566 approved positive source IDs and all 1,132 signed regions;
- explicit Allen 545 exclusion and Allen 898 exception evidence;
- ten regenerated signed surfaces identified separately in provenance;
- canonical region, explode-group, and whole-brain centroids from the LUT;
- every canonical centroid inside its actual full-resolution surface bounds;
- nonempty bilateral geometry, signed half-space checks, topology/component
  metrics, and no undeclared midline exception;
- per-region source/compact/high triangle counts, geometric error, fallback
  ratio, bounds, and component counts;
- immutable byte size/SHA-256 and decoded-size validation for both candidate
  LODs; and
- browser evidence that presentation, selection, picking, and explode change
  no geometry bytes and trigger no mesh fetch or re-upload.

Place the review bundle under:

```text
artifacts/mesh-production-candidate/
  pack/manifest.json
  pack/validation-report.json
  review/index.html
  review/review-summary.json
  review/metrics.json
  review/screenshots/
```

The review page must load the exact candidate pack, expose compact/high and
source/reference comparison, isolate a signed Allen ID, reset the camera, and
link each screenshot/metric to pack and builder hashes.

## What the repository owner must review

The next agent should serve the ignored bundle through the explicit local-only
review plugin, then guide the owner through these checks:

```bash
cd web
EPHYS_ATLAS_MESH_REVIEW_ROOT=../artifacts/mesh-production-candidate \
  npm run dev -- --host 127.0.0.1 --port 4178
```

Open `http://127.0.0.1:4178/__mesh-review/review/index.html`. Record pass/fail
and a short note for every row; do not accept a blanket “looks good.”

### A. Regenerated scientific geometry

For both left and right hemispheres of RO (222), OV (763), ACAd6b (927), FRP6b
(526322264), and SCO (599626923):

- compare the full-resolution canonical surface with its annotation mask in
  coronal, sagittal, and horizontal reference cuts;
- inspect the compact and high silhouettes from multiple camera angles;
- check for spikes, artificial bridges, holes, missing islands, inverted
  normals, collapsed thin structures, or obvious voxel/grid displacement;
- verify isolation and picking report the correct signed Allen ID; and
- compare explode 0 and explode 1 to ensure the canonical centroid produces a
  stable radial direction.

Also inspect Allen 898 at the midline and confirm its already approved open
intersection remains isolated to that ID. Confirm Allen 545 is visibly listed
as excluded in evidence rather than silently absent.

### B. LOD choice at real display sizes

Review the whole brain and each regenerated ID at actual CSS viewport widths
of 320, 480, and 800 px, in embedded and maximized layouts where applicable.
At each size compare compact against high with identical camera, mapping,
visibility, and explode state.

Choose and record:

- `default_lod_id`: normally `compact` if silhouettes, thin structures, and
  picking remain acceptable at 320/480 px;
- `upgrade_lod_id`: normally `high` only if it provides a visible benefit at
  800 px or maximized size; otherwise choose no upgrade; and
- any rejected LOD, view size, region, or camera with the reason.

The planning budgets remain:

| candidate | transfer | decoded CPU buffers |
| --- | ---: | ---: |
| compact/default | 1.3–1.6 MB | at most 6 MiB |
| high/upgrade | 2.0–2.5 MB | at most 10 MiB |

Exceeding a budget is not silently acceptable. Record the measured value and
either reject the candidate or make a new explicit product decision.

### C. Interaction and application integration

Using Allen, Beryl, and Cosmos in turn:

- orbit, zoom, reset, resize, maximize, restore, and Escape;
- select and hover the regenerated regions from both the 3-D scene and region
  list, checking signed identity and synchronized 2-D presentation;
- change visibility, anatomy/feature color, mapping, and explode without a
  geometry request or upload;
- verify volume mode keeps 3-D anatomy-only;
- force default/high resource failure and WebGL context loss, confirming 2-D
  remains usable and the current/default LOD is retained where specified; and
- reload a persisted camera/explode URL and verify the same view returns.

### D. Final sign-off record

The owner should provide one explicit result in the review summary:

```text
regenerated_geometry: approve | reject
default_lod_id: compact | high | reject
upgrade_lod_id: high | none | reject
local_cross_browser_review: complete | incomplete
publication: not-approved | approve-separately
notes: <specific observations>
```

Local review may approve geometry and LODs while leaving cross-browser or
publication incomplete. Publication remains a separate authorization.

## Work that remains outside this local slice

- Chrome/Edge, Firefox, and Safari transfer/decode/upload/first-frame/frame,
  memory, picking, cache, and context-loss evidence;
- immutable non-production origin configuration and header/hash checks;
- public production asset publication;
- making the production descriptor a default;
- removing the experimental/anatomy-only notice; and
- retiring the frozen donor worktree/branch.

Update Q12, D041, the implementation plan, and integration status with the
actual review outcome. Do not rely on chat history.
