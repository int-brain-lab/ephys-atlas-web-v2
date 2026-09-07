# Preserve native 3-D mesh components

Status: active under D066/D068; real native comparison pack and review lab implemented locally. Movement and boundary acceptance remain Q18.

## Resume here

### Current local review (2026-09-07)

Run `npm --prefix web run dev:3d` and open
`http://127.0.0.1:4194/?variant=native`. Geometry switches between the real
**Native intact** candidate and **Old cut · D042**. Use the flagged-component
selector and surrounding-anatomy toggle to review the 12 asymmetric cases.
Both variants use the same renderer and retain the explode/view state.
The candidate is a local review default only; D042 remains the selected
product geometry. No movement assignment or boundary convention has been accepted.

The native pack is `artifacts/mesh-native-review-v1`, purpose `review-only`,
with 966,645 source triangles in 1,140 shared-edge components from 566 source
objects. All original triangle indices/winding are verified through the local
component reindexing and encoded buffers. There are no cuts, caps, welding,
decimation or discarded in-scope triangles. The pack displays all 539 left,
516 right and 85 fixed proposed movements. The 12 exceptions remain unreviewed.

Resource SHA-256:
`b5f5abc7d0bb357520a65dacf33a24251e2bd6f75873d7d5ac650ef2cd271799`.
Served bytes: 14,055,506; decoded
EAM3 bytes: 24,433,484. The local raw-float32 encoding introduces at most
0.000244140625 µm coordinate rounding and zero original-ML side flips.
Classification tolerance 0.001 µm is retained as audit evidence; presentation
uses original decoded ML < 0 for left and exact zero for right, explicitly
provisional. Near-plane geometry is not adjusted. One near-plane source vertex
is reported. Production encoding/performance acceptance is not implied.

Build a new output directory from pinned local inputs:

```sh
uv run --project builder --extra test --locked python -m tools.mesh_pack.build_native_review \
  --glb ../ephys-atlas-web-v2-3d-lab/data/source/atlas-mesh-pack/meshes.glb \
  --baseline artifacts/mesh-d042-components-v1 \
  --proposal artifacts/native-components-audit/movement-proposal.json \
  --output artifacts/mesh-native-review-v1 \
  --builder-commit "$(git rev-parse HEAD)"
```

The builder verifies pinned source/proposal hashes, explicit assignments,
scope/transform, triangle correspondence and serialized arrays. It records
the builder source hash, environment and input identities in the report.
A second build to `artifacts/mesh-native-review-v1-repeat` matched every byte.
An existing output directory is rejected. Do not overwrite either D042 pack.

Validation: `just check` covers synthetic contract, original-side GPU/CPU
interaction, and lifecycle regressions. The explicit real-data browser gate is:

```sh
cd web
npx playwright test --config playwright.native-review.config.ts
```

Next: owner review of the real candidate's 12 exceptions and fixed medial
components; record Q18 choices before accepting or promoting the candidate.
The older implementation sequence below provides rationale, not current status.

Read the repository startup sequence, then D042/D066/D068, this handoff,
[AUDIT.md](AUDIT.md), and [MOVEMENT_REVIEW.md](MOVEMENT_REVIEW.md). The owner
originally handed off implementation before runtime changes. That implementation
is now available above. Do not restart the completed topology investigation or ask again
whether intact geometry and side-specific presentation are wanted.

Agreed: preserve source triangles; shared-edge connectivity without welding;
left-feature/right-anatomy colors and signed picking use original world ML,
independent of explode displacement. Movement is explicitly assigned per
component. Clearly medial components stay fixed; predominantly lateral
components may move intact after assignment review. D042 stays the default.

Proposed but **not approved**: use 0.001 µm classification tolerance and assign
exactly ML=0 to the right for coloring/picking. These were suggested after the
owner's agreement to D068, so that agreement must not be treated as approval of
these numerical conventions. Record the owner’s choice under Q18 before using
them as accepted real-candidate policy. Synthetic tests may exercise them as
explicitly labelled provisional conventions.

The movement report proposes 85 fixed and 12 right-moving components among the
97 spanning components. Across the whole source it proposes 539 left, 516 right,
and 85 fixed. All assignments remain unreviewed. Its 90% ML-extent threshold is
a review aid, not a tissue-volume fraction or accepted anatomical rule.

### Immediate implementation sequence

1. Implement the coherent synthetic producer/consumer slice under D068, with
   explicitly provisional boundary choices where necessary. Cover intact
   crossing geometry, repeated regional identities, independent movement, and
   the D042 contract repack/configuration transition. Do not commit a schema
   change with broken consumers or a broken configured baseline.
2. Test coloring, hover, selection and visibility on both sides of a crossing
   triangle. Test that explode can move geometry across ML=0 without changing
   its original presentation side. GPU shading and CPU picking must use the
   same original-coordinate boundary after quantization/decoding; no centroid
   coloring, blended side colors, cuts, or caps may substitute for this.
3. Build a clearly labelled local review candidate alongside D042 with explicit
   provisional assignments. An unreviewed assignment may be displayed for
   comparison but must never be promoted as accepted provenance or a production
   default. Resolve numerical conventions before accepting the real candidate.
4. Visually compare the 12 asymmetric exceptions, the proposed fixed components,
   and ordinary lateral pairs at zero and nonzero explode. Accept or revise the
   source-bound assignments and record the selection before changing defaults.

Do not wait for visual approval of the 12 cases before creating the machinery
needed to show them. The one retained renderer and one schema-v1 contract remain
mandatory; the review path is not a second runtime architecture.

### Files and local evidence

- Topology/audit/proposals: `tools/mesh_pack/components.py`, `audit_native.py`,
  and `propose_movement.py`; tests are `tests/test_mesh_components.py`,
  `tests/test_mesh_movement_proposal.py`, and `tests/test_mesh_pack.py`.
- Contract/compiler: `schema/v1/mesh-pack.schema.json`, bundled builder schema,
  Python/TypeScript semantic validators, `tools/mesh_pack/build.py`, `binary.py`,
  `validate.py`, `web/scripts/repack-d042-mesh.mjs`, and `fixtures/mesh-pack-v1/`.
- Browser: `web/src/rendering/3d/mesh-pack-source.ts`, `mesh-pack-codec.ts`,
  `mesh-pack-worker.ts`, `brain-scene-viewport.ts`, shared
  `web/src/application/regional-presentation.ts`, and the mesh/scene browser tests.
- Ignored baseline: `artifacts/mesh-d042-schema-v1/`; original donor evidence:
  `artifacts/mesh-d042-donor/`. Audit/proposal reports and repeat outputs:
  `artifacts/native-components-audit/`. Exact hashes and reproduction commands
  are in the two linked evidence documents. Git does not preserve these bytes.
- The source was last available at
  `/home/cyrille/GIT/IBL/ephys-atlas-web-v2-3d-lab/data/source/atlas-mesh-pack/meshes.glb`.
  Verify the pinned SHA before use. This is a read-only source location, not
  permission to resume the frozen donor branch. Recover the same pinned public
  bytes if that local path is absent; never require donor code for implementation.

AGEA integration is being handled independently. Inspect current status before
editing shared schemas, semantic validators, startup code, or status documents.
Preserve other work and commit only the intended 3-D changes; do not assume a
later checkout has the same clean/dirty state as this handoff.

### Validation at handoff

`ead6626` passed `just check`, including browser tests and Linux documentation
screenshots. The focused mesh suites passed 34 tests. Both the source audit and
movement proposal repeated byte-for-byte. These gates validate existing audit
and proposal machinery; they do not establish correctness of the unimplemented
native runtime or approve any movement assignment. Re-run targeted suites and
`just check` after the next implementation slice.

## Context

- D042 currently selects 1,130 signed surfaces produced from 566 pinned GLB
  objects by an exact ML=0 cut plus planar caps.
- The cut supports hemisphere-specific explode behavior, but it also bisects
  connected medial and asymmetric subcortical anatomy.
- The requested direction is to preserve original GLB triangles, assign
  explode behavior independently, and keep genuinely medial components fixed.
- The existing D042 pack must remain available as an immutable rollback and
  comparison asset. Do not overwrite it or reuse its `pack_id`/`geometry_id`.

## Completed work

- D068 records owner agreement on shared-edge connectivity, side-specific
  presentation using original world ML, and independent reviewed movement.
  [Movement proposals](MOVEMENT_REVIEW.md) are prepared; exact Q18 assignments
  and midline boundary handling remain open.

- The 2026-09-06 [baseline/component audit](AUDIT.md) validates D042 and
  compares edge/vertex connectivity and three explicit tolerance probes.
  Pure topology machinery and synthetic tests are implemented; Q18 remains
  open, including strongly asymmetric spanning components.

- The design discussion established that geometry, presentation identity,
  lateralization, and explode displacement must be separate concepts.
- The current implementation seams were inspected:
  `schema/v1/mesh-pack.schema.json`, the Python/TypeScript semantic validators,
  EAM3 ranges/chunks, `MeshPackSource`, and `RetainedBrainScene3DViewport` all
  currently couple signed hemisphere identity to explode groups.
- The ignored local D042 schema-v1 pack was rechecked on 2026-09-02:
  - `manifest.json`: 495,323 bytes,
    SHA-256 `49d58f1893ce9978f41c13fd445f5ff2bd34b18b737aa5b763291b6774b34b2c`;
  - `compiled-full.eam3.gz`: 4,957,983 bytes,
    SHA-256 `c7bb3a88157c42cc8290c0f9d91a976b7555f13977d56eb710cec46a43585de9`;
  - `validation-report.json`: 1,076 bytes,
    SHA-256 `70256d4d3f78a9650ec900fedaec7e28df1575f941bc0bab8bdaed32fe4db231`.

## Current state

- Exact local evidence is under ignored
  `artifacts/mesh-d042-schema-v1/`; Git does not preserve these bytes.
- The browser accepts one verified mesh-manifest descriptor through
  `VITE_BRAIN_MESH_MANIFEST_URL`, `VITE_BRAIN_MESH_MANIFEST_BYTES`, and
  `VITE_BRAIN_MESH_MANIFEST_SHA256`. Selecting a different immutable pack can
  therefore remain configuration-driven.
- D042 and `docs/rendering/3D_SELECTED_ASSET.md` remain authoritative until a
  new reviewed decision changes the default geometry policy.
- No new production pack, default, publication, or scientific claim is
  approved by this handoff.

## Plan

### 1. Establish the baseline and preserve rollback evidence

- Validate the complete ignored D042 file graph with
  `just mesh-pack-validate artifacts/mesh-d042-schema-v1`.
- Copy the exact three-file graph to authorized durable content-addressed
  storage, retaining paths, byte sizes, hashes, D042 provenance, and recovery
  instructions. External upload requires an approved destination and
  credentials; do not invent or publish to a production location.
- Remote archival is required before destructive cleanup or replacement, but
  does not block additive contract work, synthetic tests, or candidate builds
  in distinct directories. If local evidence is absent, record the limitation
  and continue synthetic work; real A/B review needs a recovered, verified
  baseline. Do not treat this task as authorization for external upload.
- Record a stable name such as `d042-cut-cap` outside the immutable directory.
- Never mutate or delete the local evidence until the durable copy has been
  fetched and revalidated independently.

### 2. Specify and implement one coherent candidate contract

- Follow D066 for candidate authorization. Record a separate default-selection
  decision after owner review; contract scaffolding does not supersede D042.
- Keep one schema-v1 producer/consumer contract. Update the canonical schema,
  bundled schema, Python and TypeScript validators, shared contract corpus,
  builder, codec, source, renderer, and fixtures together; do not add a
  renderer-specific shadow schema or compatibility facade.
- Model these independently:
  - source Allen identity and Allen/Beryl/Cosmos presentation mappings;
  - geometry component/range identity;
  - lateralization: `left`, `right`, or `neutral`;
  - explicit explode displacement, allowing `[0, 0, 0]`;
  - immutable geometry policy and provenance.
- Re-encode the D042 cut geometry under the revised contract so current code
  can select either geometry policy. Preserve the exact original D042 graph as
  archival evidence even if this compatibility repack has new bytes/identity.

Before committing a contract change, make the synthetic producer, validators,
codec/source, renderer, and fixtures agree in the same green vertical slice.
Do not land a schema-only change that breaks current readers or configured
D042 loading. Prepare and validate its new contract repack and configuration
transition together; preserve the original bytes without adding a legacy reader.

D068 settles shared-edge connectivity without welding and original-world-ML
side-specific coloring, picking, selection and visibility on intact geometry.
Specify the residual [Q18](../../OPEN_QUESTIONS.md) boundary behavior and review
[movement assignments](MOVEMENT_REVIEW.md). Exact ML=0, near-plane handling,
and encoding must not make the shader and picking disagree. Keep component
ordering deterministic and tied to original source triangle ordinals.

### 3. Build the native-component candidate

- Start from the exact pinned public GLB selected by D042.
- Within each source Allen object, find triangle-connected components without
  clipping triangles or generating caps.
- Classify a component wholly left of ML=0 as `left`, wholly right as `right`,
  and a component spanning the plane as `neutral` for geometric reporting only.
  This classification does not prescribe movement or signed presentation.
- Preserve every in-scope source triangle and its winding. Multiple geometry
  ranges may map to the same regional presentation identity.
- Use D068 explicit reviewed movement assignments: fixed components have zero
  displacement; lateral movement uses the assigned side’s current grouped radial
  vector, even when the component crosses ML=0. Do not derive an accepted
  movement assignment from geometric classification or an unreviewed threshold.
- Treat numerical tolerance as a recorded build parameter. Emit near-plane and
  classification-ambiguous cases for review rather than silently resolving a
  scientific/presentation choice.

### 4. Emit deterministic audit evidence

- Report source/output triangle counts and topology, component counts by
  lateralization, the complete neutral Allen inventory, mappings, bounds,
  integrity, and exact source/output hashes.
- Prove that the native candidate adds no triangles or planar caps and drops no
  in-scope source triangles using source object/triangle correspondence and
  winding checks, not counts alone. Separate topology preservation from encoded
  position error and record quantization explicitly.
- Keep source scope and source-to-world transform fixed. Audit disconnected,
  duplicated-position, degenerate, and near-plane source cases without silently
  repairing source defects.
- Build twice and require byte-identical manifests, resources, and reports.
- Fail closed on an unclassified component, mapping inconsistency, undeclared
  file, or source-identity mismatch.

### 5. Integrate one renderer path and compare variants

- Keep one retained 3-D viewport and one verified resource path. The selected
  descriptor chooses `d042-cut-cap` or `native-components`; geometry policy is
  not an LOD.
- Upload geometry once and continue applying explode through vertex/range
  attributes without rebuilding buffers or fetching on interaction.
- Add a development/review-only named selector or URL field if it materially
  improves A/B review. Production should have one configured default, while
  the alternate remains a documented rollback target.
- Expose the active `pack_id`, `geometry_id`, and geometry policy in diagnostics
  so review screenshots are attributable.

### 6. Review before changing the default

- Compare both packs at several explode values, focusing on thalamic and other
  subcortical structures, commissural/medial anatomy, paired lateral regions,
  seams, overlaps, and unexpected fixed components.
- Verify Allen/Beryl/Cosmos coloring, hover, picking, selection, visibility,
  URL state, resource integrity, and GPU lifecycle.
- Select `native-components` as the default only after repository-owner visual
  review. Switching back must require only descriptor/configuration selection,
  not a geometry rebuild or a second renderer.

### 7. Finish coherently

- Run targeted mesh-pack Python tests, schema parity tests, web unit tests, and
  the 3-D Playwright suite during development.
- Run `just check` before completion.
- Update `DECISIONS.md`, `3D_SELECTED_ASSET.md`, `INTEGRATION_STATUS.md`, and
  this task record with the accepted result, immutable identities, evidence,
  rollback procedure, and commits.

## Risks and blockers

- **Durable preservation:** the exact D042 pack is ignored local data. A future
  agent must not assume Git can recover it; an authorized archive destination
  is needed before destructive cleanup or replacement.
- **Contract coupling:** signed identities, hemisphere chunks, explode groups,
  validation, picking, and presentation currently assume only left/right
  surfaces. Partial contract edits would leave producers and consumers
  inconsistent.
- **Classification ambiguity:** centroid sign is explicitly insufficient for
  asymmetric medial anatomy. Use component topology relative to ML=0 and audit
  near-plane cases.
- **Presentation multiplicity:** several components may share one Allen
  identity. Picking/color/visibility logic must support that without duplicating
  scientific observations.
- **Decision boundary:** this plan authorizes a candidate and comparison path,
  not publication or a new production default.

## Next steps

Use the immediate implementation sequence above: synthetic contract/renderer
slice, local A/B candidate, assignment review, then default selection. Q18
retains exact numerical boundary and real assignment approval. Arrange durable
external preservation before destructive replacement; additive local work is
not blocked by missing archive authorization.

## Relevant commits

- `5270116` — Link the active task and record D066/Q18.
- `ebb25b5` — Implement the native component audit and synthetic topology tests.
- `ead6626` — Record D068 and generate deterministic movement proposals.
- `073fbca` — Restore GLB-only 3D anatomy scope (D042).
- `d1249f7` — Recover the complete local development corpus and D042 repack.
- Planning handoff — the commit containing this file; locate with
  `git log -1 -- docs/tasks/2026-09-02-native-3d-mesh-components/README.md`.
