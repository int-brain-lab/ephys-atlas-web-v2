# Preserve native 3-D mesh components

Status: planned handoff; no implementation has started.

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

### 1. Preserve the rollback asset before geometry work

- Validate the complete ignored D042 file graph with
  `just mesh-pack-validate artifacts/mesh-d042-schema-v1`.
- Copy the exact three-file graph to authorized durable content-addressed
  storage, retaining paths, byte sizes, hashes, D042 provenance, and recovery
  instructions. External upload requires an approved destination and
  credentials; do not invent or publish to a production location.
- Record a stable name such as `d042-cut-cap` outside the immutable directory.
- Never mutate or delete the local evidence until the durable copy has been
  fetched and revalidated independently.

### 2. Record the replacement decision and change the contract once

- Add a reviewed decision that preserves D042 as rollback while replacing its
  default geometry policy only after candidate approval.
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

### 3. Build the native-component candidate

- Start from the exact pinned public GLB selected by D042.
- Within each source Allen object, find triangle-connected components without
  clipping triangles or generating caps.
- Classify a component wholly left of ML=0 as `left`, wholly right as `right`,
  and a component spanning the plane as `neutral`.
- Preserve every in-scope source triangle and its winding. Multiple geometry
  ranges may map to the same regional presentation identity.
- Give neutral components zero explode displacement. Initially retain the
  current grouped radial explode vectors for lateral components so geometry
  preservation is evaluated separately from explode-direction redesign.
- Treat numerical tolerance as a recorded build parameter. Emit near-plane and
  classification-ambiguous cases for review rather than silently resolving a
  scientific/presentation choice.

### 4. Emit deterministic audit evidence

- Report source/output triangle counts and topology, component counts by
  lateralization, the complete neutral Allen inventory, mappings, bounds,
  integrity, and exact source/output hashes.
- Prove that the native candidate adds no triangles or planar caps and drops no
  in-scope source triangles.
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

1. Revalidate and durably archive the exact D042 file graph.
2. Draft the decision and revised single-contract shape with synthetic left,
   right, neutral, and repeated-presentation-component fixtures.
3. Land contract/validator/fixture parity before touching the real GLB builder.
4. Build and audit the real native-component candidate.
5. Integrate the shared renderer path, run A/B review, and request default
   selection.

## Relevant commits

- `073fbca` — Restore GLB-only 3D anatomy scope (D042).
- `d1249f7` — Recover the complete local development corpus and D042 repack.
- Planning handoff — the commit containing this file; locate with
  `git log -1 -- docs/tasks/2026-09-02-native-3d-mesh-components/README.md`.
