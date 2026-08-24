# 3-D main-application integration plan

Status: **Commits 0-6 complete on `main`; geometry/LOD resolved by D042;
immutable deployment remains optional (2026-08-24)**.

This document defines how to promote the completed independent brain-mesh lab
into the v2 application without importing its experimental composition into the
product architecture. It is the implementation authority for P3D integration.
`docs/rendering/3D_EVALUATION.md` remains the experiment evidence source.

The repository owner approved an optional, visibly experimental 3-D view in the
main application. D042 selects the frozen donor's complete GLB-derived resource
and retires D041's annotation-derived regeneration direction. Immutable
deployment and removal of the experimental label remain separate work.

## Evidence baseline and landing rule

The frozen donor is `experiment/brain-mesh-3d-lab` at
`ba1e2d129753bdc459bca7b23fa896f41ee13536`. At planning time it is 30 commits
ahead of and 6 commits behind remote `main`; local `main` is
`783eee80640ad2a3c3e83fb4b5030cce2062b9ad` and includes the independent anatomy
smoothing plan.

Do **not** merge or rebase the donor wholesale. It contains useful compiler,
rendering, interaction, and test evidence, but it also changes cutover-era files
and documents superseded on `main`. Treat it as a read-only source of behavior
and reconstruct the vertical slices below directly on current `main`.

Keep the donor worktree until the standalone lab on `main` has behavioral
parity and the integrated path passes the full gate. Remove it only in the final
cleanup slice.

### Commit 0 baseline record

The execution baseline was repeated on 2026-08-22 before any donor code was
copied. Current `main` was
`9624b05f7608b9c41b462534db5cd217e9fdffa9`, remote `main` was
`4130809cef827f59a45f4b7914d6b4c5038a7873`, and the frozen donor remained
`ba1e2d129753bdc459bca7b23fa896f41ee13536`. Their merge base was
`266a4216f44a7773d3da9bc42c3e7224abadc49e`; `git rev-list --left-right
--count main...experiment/brain-mesh-3d-lab` reported `13 30`.

The following reproducible gates were green:

- current `main`: `just check` (builder 172 passed/1 optional-real-input
  skipped; publishing 25 passed; web unit 139 passed; rendering 23 passed;
  browser 68 passed; typecheck and production build passed);
- frozen donor compiler: `uv run --project builder --extra anatomy --extra
  scientific --extra test --locked python -m pytest -q
  tests/test_mesh_pack.py` (5 passed);
- frozen donor web units: local TypeScript typecheck plus the five focused
  compiled-manifest, compiled-pack, presentation, binary-pack, and ontology
  suites (18 passed);
- frozen donor Chromium lab: `npm run test:3d` (4 passed, including the
  intentional missing-manifest fail-closed case).

The initial focused web command accidentally invoked a nonexistent global
`tsc` after the npm typecheck. Re-running through the donor's local npm
toolchain passed; this was an invocation/environment error, not a product
failure. The donor was neither modified nor rebased.

## Product boundary

The integrated first view shows brain-region surfaces with the application's
Allen/Beryl/Cosmos identities, colors, selection, and hover, plus camera motion
and grouped radial explode. It is lazy, optional, and non-blocking.

This integration does not include volume ray casting, surface sampling, point
clouds, probes, a general renderer switch, or a fifth permanent desktop panel.
It does not add runtime mesh transforms, a second dataset session, selection
store, URL controller, colormap, or regional-semantics implementation. For a
volume feature, 3-D is explicitly anatomy-only.

## Non-negotiable invariants

1. `ProjectionRegistry`, `ProjectionViewportFactory`, and retained projection
   viewports remain specifically 2-D.
2. `AtlasApp` remains the composition root and `DatasetSession` remains the one
   asynchronous scientific-data lifecycle.
3. Exact `reference_space_id` is the only coordinate compatibility check.
   Geometry/grid and pack identities remain separate.
4. Presentation uses signed bilateral IDs. A missing Beryl/Cosmos mapping stays
   `null`; it is never coerced to root `997` or a fine Allen identity.
5. Mapping, color, visibility, selection, hover, and explode do not fetch
   geometry or rebuild/re-upload position or index buffers.
6. Mesh bytes are size/SHA-256 verified before persistent cache admission or
   decode. A bad cached resource is evicted and may be retried.
7. Decoded identity contains resource SHA-256 plus the full binary decoder and
   container contract, never only a URL or LOD label.
8. Initial application and 2-D interaction never wait for mesh bytes, decode,
   WebGL creation, or 3-D failure handling.
9. Hidden 3-D runs no continuous animation loop. Destruction cancels work,
   disconnects observers/listeners, and disposes every GPU resource.
10. Missing or invalid mesh assets fail closed locally with no generated
    fallback and no damage to 2-D.
11. Real packs and the 96.6 MB GLB remain outside Git. A tiny committed pack is
    deterministic, test-only, and clearly identified.
12. The product UI does not expose review LOD names. The immutable manifest
    chooses its default and optional upgrade resources.

## Fixed integration decisions

### Context-slot placement

3-D is content inside the existing secondary/context slot. Refactor the
hardcoded Summary/Top/Swanson tabs into a discriminated content registry:

```ts
type ContextContentDefinition =
  | { kind: 'summary'; id: 'summary'; label: string }
  | { kind: 'projection-2d'; id: StaticProjectionId; label: string; projectionId: StaticProjectionId }
  | { kind: 'scene-3d'; id: 'brain-3d'; label: string };
```

`SecondaryTabId` gains `brain-3d` (renaming it to `ContextContentId` is allowed
only atomically). `WORKSPACE_VIEW_REGISTRY` continues to describe four layout
slots: three orthogonal projections plus `secondary`. `PROJECTION_REGISTRY`
continues to contain only 2-D projections.

Desktop/tablet exposes a 3-D context tab and may maximize the secondary slot.
Compact layouts continue to use `activeCompactView='secondary'`; selecting 3-D
does not add another layout-state dimension.

### Sibling viewport boundary

The 3-D boundary is a sibling of, not a wrapper around,
`ProjectionViewportFactory`. Use technology-neutral contracts equivalent to:

```ts
interface BrainCameraPose {
  positionUm: readonly [number, number, number];
  targetUm: readonly [number, number, number];
  up: readonly [number, number, number];
}

interface Scene3DViewState {
  explode: number;
  camera: BrainCameraPose | null;
}

interface BrainScene3DViewport {
  setPresentation(presentation: RegionalPresentation): void;
  setViewState(state: Scene3DViewState): void;
  activate(): void;
  deactivate(): void;
  destroy(): void;
}

interface BrainScene3DViewportFactory {
  create(host: HTMLElement): BrainScene3DViewport;
  setInteractionSink(sink: BrainScene3DInteractionSink): void;
  destroy(): void;
}
```

Exact spelling may change if tests expose a smaller contract, but ownership may
not. The factory owns the shared mesh source. A retained viewport owns its
canvas, Three scene/camera/controls/materials, active GPU LOD, resize and
context-loss handling, and isolated error state. Its sink reports signed hover
and selection IDs, validated camera changes with interaction phase, and errors;
it never dispatches actions or imports UI code.

### Camera and URL state

The lab's `{target, position, zoom}` cannot reproduce arcball roll and its zoom
is unused. Persist a renderer-neutral position/target/up pose; field-of-view and
clip planes are renderer policy.

Extend URL v4 compatibly with optional fields:

- `secondary=brain-3d` selects the context content;
- `explode3d=<number>` stores explode in `[0,1]`;
- `camera3d=<nine finite comma-separated numbers>` stores position, target,
  and up.

Normalize and round camera output. Reject non-finite, coincident, degenerate,
or unreasonably unbounded poses as a whole. Camera drags use debounced
replace-history writes. Hover, loading, LOD, WebGL state, and diagnostics remain
runtime-only. These additive fields do not invalidate old v4 links; do not bump
the version without a separately approved incompatible reset.

## Target ownership and dependencies

### Domain

`web/src/domain/` owns `Scene3DViewState`, `BrainCameraPose`, defaults, actions,
reducer transitions, and pure validation. It imports no data, application,
rendering, or UI module.

### Shared regional presentation

Add a pure resolver under `web/src/application/regional-presentation.ts`. It
accepts loaded regional data/metadata plus coloring, parcellation, selection,
and hover, and returns renderer-neutral semantics:

```ts
interface RegionalPresentation {
  mapping: 'allen' | 'beryl' | 'cosmos';
  anatomyColors: ReadonlyMap<number, string>;
  featureColors: ReadonlyMap<number, string> | null;
  visibleRegionIds: ReadonlySet<number>;
  selectedRegionIds: ReadonlySet<number>;
  highlightedRegionId: number | null;
  featureSide: 'left' | null;
}
```

This is not a renderer-specific frame. Registered 2-D, static 2-D, and 3-D
apply it according to their layer capabilities. Migrate duplicated bilateral
ID/color logic from `retained-projection-viewport.ts`,
`static-projection-viewport.ts`, and the lab helper in one coherent slice.

`AtlasApp` resolves one presentation from its existing session snapshot and
store, sends it to both factories, and remains the only place mapping renderer
interaction callbacks to application actions.

### Mesh source

`MeshPackSource` is DOM- and Three-free. It owns:

- a verified immutable manifest descriptor;
- lazy manifest/LOD loading with `AbortSignal`;
- injected `ResourceFetcher` use for verified persistent bytes, corrupt-entry
  eviction, and in-flight deduplication;
- explicit gzip and worker-owned EAM3/meshopt decode;
- decoded-key construction from SHA plus decoder/container contract;
- a byte-bounded decoded CPU LRU and consumer-aware cancellation;
- transport-neutral merged hemisphere chunks, ranges, mapping tables, and
  explode vectors.

The composition root supplies an immutable manifest URL/size/SHA descriptor.
An absent descriptor means 3-D is unavailable, not a cue for fallback.

### Rendering

Only `web/src/rendering/3d/` imports Three.js or meshoptimizer runtime APIs.
Upload each merged hemisphere's immutable geometry once per accepted LOD. Use
compact lookup textures/buffers and shader state for colors, visibility,
selection/focus, hover, and explode. Do not repeat the lab's per-region slice,
copy, and remerge path.

Start with raycasting against merged CPU geometry and filter hits through the
current mapping/visibility table. GPU ID picking is a later benchmark. An LOD
upgrade is atomic: verify, decode, upload, then swap; failure retains the
current LOD. Render on demand or continuously only during active interaction.

### UI

`AppShell` owns registry-driven context tabs, focus, accessibility, maximize,
responsive layout, status, and a host element. It never imports Three.js,
fetches mesh assets, interprets mappings, or owns camera objects. Create the
viewport lazily on first activation, deactivate it on another tab, and destroy
it during application shutdown.

## One mesh-pack contract

The donor contains two incompatible contracts: a placeholder Python/schema
path named `atlas-mesh-pack-v1` and the actual Node/EAM3 lab format named
`atlas-mesh-pack-v1-lab`. Do not land both.

Define one strict snake_case `atlas-mesh-pack-v1` manifest with JSON Schema,
Python and TypeScript semantic validators, and a shared deterministic
valid/invalid corpus. Prefer `schema/v1/` beside current asset contracts. It
must include:

- format, pack, geometry, and exact reference-space identities;
- source GLB URL/size/SHA and inventory;
- exact projection-pack, atlas catalog, annotation, and LUT identities/hashes;
- axes, units, handedness, full source-to-world transform, and its evidence;
- grey/deepest-active scope and all exclusions;
- each signed surface/feature ID, source Allen ID, hemisphere, nullable
  mappings, bounds, counts, and explode group;
- stable full-resolution group and whole-brain centroids;
- `default_lod_id` and optional `upgrade_lod_id`;
- LOD parameters, counts/error, encoded resource, decoded bytes, and decoder
  contract;
- builder version/commit/command and content-addressed validation report;
- rebuild, coverage, midline, topology, mapping, bounds, integrity, and
  complete-file-graph results.

EAM3 may remain if explicitly versioned and fully validated; its version is
separate from the manifest version. The builder emits no undeclared files and
graph validation follows every resource. The app uses only manifest-selected
default/upgrade LODs. A changed choice creates a new immutable pack.

### Commit 1 contract/compiler record

Commit 1 landed the single snake_case `atlas-mesh-pack-v1` contract under
`schema/v1/`; neither donor manifest was retained. Independent Python and
TypeScript semantic validators run the shared v1 corpus. The contract records
all identities, source evidence, affine, scope/exclusions, signed surfaces,
nullable mappings, bounds/counts/centroids, selected LODs, encoded resources,
decoder identity, builder identity, and content-addressed gate results required
above.

The offline Python machinery implements deterministic GLB parsing, deepest-
active grey selection, exact ML half-space clipping, closed-loop caps,
open-path evidence, mapping resolution, merged bilateral EAM3 raw encoding,
and complete-file-graph validation. The tiny committed fixture is explicitly
`test-only`, regenerates byte-for-byte, includes one intentional null Beryl
mapping and one non-grey exclusion, and rejects missing, undeclared, size-
mismatched, hash-mismatched, and decoder-inconsistent resources. Real inputs
and outputs remain outside Git; no production asset or Q12 choice was made.

## Ordered implementation commits

Each numbered item is one reviewable commit unless tests require a finer split.
Run targeted tests and then `just check` for every commit; never hand off red.

### Commit 0 — Freeze evidence and establish baselines

Status: complete in `25e1539`.

- Fetch `main`, verify the worktree, and record changed ancestry.
- Run current-main gates and donor-focused unit/browser gates.
- Separate environment failures from product failures.
- Copy no code; do not rebase/merge the donor.

Exit: both baselines are reproducible and the donor remains intact.

### Commit 1 — Converge contract and offline compiler

Status: complete; exact landing commit is recorded by repository history.

- Port only useful compiler/clipping/ontology/binary primitives.
- Replace both donor manifests with the single v1 contract.
- Add tiny bilateral source fixtures and a tiny committed encoded pack marked
  test-only; keep real inputs/output ignored.
- Add Python/TypeScript schema and semantic parity plus graph validation.

Tests cover deterministic rebuild; reference-space/transform; signed
hemispheres; exact midline/open-path evidence; mapping/null, scope, exclusion,
centroid, bounds, and LOD gates; the shared valid/invalid corpus; and missing,
undeclared, size/hash-mismatched resources.

Stop short of production if canonical annotation/LUT evidence is unavailable.

### Commit 2 — Add verified source and decode worker

Status: complete; exact landing commit is recorded by repository history.

- Implement `MeshPackSource` over injected `ResourceFetcher`.
- Add cancellation, shared loads, gzip, decoded-size checks, worker meshopt
  decode, transferable buffers, decoded identity, and CPU LRU.
- Return merged transport-neutral chunks without Three types.

Tests cover no premature LOD load; corrupt-cache eviction/refetch; cancellation
without poisoning another consumer; URL/SHA/decoder identity isolation;
malformed headers/ranges/codecs/sizes/meshopt; and memory eviction.

The implemented `MeshPackSource` requires an injected `ResourceFetcher` and a
verified immutable manifest descriptor. Discovery loads no geometry; public
loads expose only the manifest-selected default and optional upgrade. Shared
loads preserve independent consumer cancellation, and disposal aborts work and
terminates the module worker. Encoded bytes are verified before transfer to the
worker, which owns explicit gzip plus strict raw/meshopt EAM3 decode and returns
transport-neutral merged chunks. The decoded LRU is byte-bounded and keyed by
resource SHA plus codec/container/encoding/quantization identity. Unit coverage
includes corrupt persistent-cache recovery and every failure class above; a
Chromium test exercises the real module worker against the tiny committed pack.

### Commit 3 — Extract retained renderer and thin lab

- Port arcball, lighting, framing, picking, explode, and LOD swap behind the
  retained boundary.
- Upload merged buffers directly and use lookup/shader presentation.
- Implement listener/observer/RAF/GPU disposal and context loss.
- Rebuild `/3d-lab/` as a thin client using the committed tiny pack.
- Make its Playwright suite self-contained and part of `just check`/CI, or move
  equivalent coverage into the normal browser suite.

Tests prove no geometry upload on presentation/explode; signed filtered picks;
drag-not-click; camera reset/round-trip; resize, deactivate/reactivate, context
loss, disposal; failed-upgrade retention; and bounded lab requests.

### Commit 4 — Share presentation and migrate 2-D first

- Implement the semantic resolver.
- Migrate registered and static 2-D applicators before connecting 3-D.
- Remove duplicate bilateral selection/color resolution.

Tests cover all mappings, signed selection/hover, feature/anatomy color,
missing/null values, left-feature/right-anatomy semantics, anatomy-only volume,
and all existing projection/static/regional/volume suites.

Stop if the resolver acquires renderer-specific types.

### Commit 5 — Registry-drive context content and URL state

- Replace hardcoded secondary branching with the content registry.
- Add `brain-3d` with a null scene host; do not connect Three yet.
- Add scene state/actions/reducer/defaults/validation and optional URL-v4 fields.
- Preserve independent secondary, compact, and maximize state.

Tests cover registry exhaustiveness, no 3-D projection, URL defaults and
canonical/invalid camera behavior, debounced history, Back/Forward/reload,
desktop/compact/maximize/Escape/focus behavior.

### Commit 6 — Wire the thin application adapter

- Optionally inject the scene factory and immutable asset descriptor.
- Lazily create the viewport on first `brain-3d` activation.
- Feed shared presentation/state and route interaction through existing actions.
- Pause hidden work, isolate failures, dispose cleanly, and show the
  experimental/anatomy-only notices.

Browser tests prove zero mesh requests before opening; one default request;
zero geometry requests for presentation/state updates; synchronized 3-D/2-D/
list interactions; preserved null mappings; anatomy-only volume; isolated
manifest/LOD/WebGL failure; responsive/maximize/Escape/URL/history/teardown.

### Commit 7 — Produce and review a promotion candidate

Status: **geometry and LOD selection complete by D042**.

- Preserve the pinned GLB-derived inventory and all 989,811 selected triangles.
- Use the 4,958,039-byte compiled-full resource as the evidence baseline.
- Do not smooth, decimate, regenerate surfaces, or add an upgrade LOD.
- A schema-v1 EAM3 repackaging may change only the container/manifest contract,
  not the selected geometry or topology.
- Immutable deployment and cross-browser release checks remain optional
  operational work and must not delay production volume slices.

### Commit 8 — Close docs and retire donor

- Update all status/spec/decision documents to match code.
- Run `just check` from a clean checkout plus cross-browser gates.
- Audit duplication, dependencies, generated assets, and lifecycle.
- Remove the disposable worktree/branch only after parity exists on `main`.

## Architecture gates

Add durable tests enforcing:

- no Three imports outside `rendering/3d/` and the standalone lab entry;
- domain/application dependency rules remain intact;
- `AtlasApp` sees viewport factories, not Three, meshopt, EAM3, or sources;
- `ProjectionRegistry` has no 3-D kind;
- exactly one active mesh manifest contract exists;
- no raw GLB URL, runtime scientific mesh transform, or synthetic fallback;
- hidden/destroyed lifecycle is observable;
- presentation-only actions cause zero geometry fetch/upload.

## Anti-patterns and stop conditions

Reject a combined `SceneRenderer` facade; Three types outside rendering; shadow
mesh schemas; direct unverified fetch; URL-only cache keys; one request/mesh/
draw per region; interaction-time geometry rebuilds; a fifth panel; hidden RAF
or leaked resources; 3-D-owned data/selection/URL/color state; compatibility
inferred from units/shape/pack ID; silent substitution for null mappings,
  RSPd4, Allen 898, or non-grey scope; and any unreviewed production label.

When blocked, retain testable machinery with the tiny fixture and stop before a
misleading release.

## Handoff protocol

For each slice, read the required docs and this plan; inspect/fetch a clean
`main`; confirm prior slices are green; restate invariants; consult the donor
only for named behavior; implement one coherent slice; run targeted tests and
`just check`; update only factual status; and commit intended files. Repair an
incomplete earlier slice before advancing—never hide a missing contract behind
an adapter or runtime fallback.
