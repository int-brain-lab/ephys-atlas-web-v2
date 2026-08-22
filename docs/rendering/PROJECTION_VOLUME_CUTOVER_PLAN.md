# Projection and volume architecture cutover

Status: **approved near-term implementation plan (2026-08-22)**.

This document is the focused handoff for the next rendering/data-contract unit
of work. It intentionally permits a breaking pre-launch cutover. The product
has no installed v2 user base whose old dataset schemas, anatomy manifests,
runtime adapters, or URL encodings must remain supported. Prefer one coherent
long-term contract over compatibility layers.

The ordered milestone remains `docs/IMPLEMENTATION_PLAN.md`. Scientific choices
that an agent must not invent remain in `docs/OPEN_QUESTIONS.md`, especially Q4
(volume geometry/outside semantics) and Q5 (production transport).

## Outcome

Implement one extensible 2-D projection workspace in which:

- coronal, sagittal, and horizontal are registered navigable planes;
- Top and Swanson are static regional projections;
- regional anatomy and scalar volumes are independently retained layers in the
  same orthogonal viewport rather than mutually exclusive renderers;
- all regional SVG projections share parsing, region identity, coloring,
  selection, hover, inspection, caching, and failure behavior;
- one ML/AP/DV world cursor is the only scientific bridge between atlas and
  volume grids;
- every producer and consumer uses one current dataset schema and one current
  projection-pack contract;
- obsolete schema, anatomy, renderer, legacy-host, and URL compatibility code
  is deleted after the cutover.

Rich 3-D rendering is not part of this unit. The independently approved 3-D lab
in `docs/rendering/3D_EVALUATION.md` may run concurrently, but integration waits
for this cutover's workspace seam and must not distort the 2-D projection
contract.

## Non-goals and scientific guardrails

- Do not choose Q4's affine, handedness, axis mapping, outside-brain sentinel,
  or missing-value semantics. Use synthetic fixtures until authoritative
  evidence resolves them.
- Do not choose Q5's production layout from architectural taste. Preserve the
  storage-neutral boundary and decide from real-data browser/CDN measurements.
- Do not infer world coordinates for Top or Swanson. They are static regional
  maps with no slice slider, wheel stepping, linked guide, or voxel inspection.
- Do not claim the curated Top/Swanson geometry was generated from the Allen
  annotation. Preserve its distinct source identity and hashes.
- Do not introduce a frontend framework, renderer framework, service registry,
  or generic pipeline DSL.
- Do not rewrite stable regional scientific semantics merely because a breaking
  cutover is allowed.

## Architectural invariants

### Projection is not slice axis

Keep `SliceAxis` limited to `coronal | sagittal | horizontal`. A projection is
a broader view definition with declared capabilities:

```ts
type ProjectionDescriptor =
  | {
      id: ProjectionId;
      kind: 'registered-slice-stack';
      axis: SliceAxis;
      supportsVolume: true;
      registration: PlaneRegistration;
    }
  | {
      id: ProjectionId;
      kind: 'static-regional-map';
      supportsVolume: false;
    };
```

Code branches on capabilities or the discriminant, never on names such as
`top` or `swanson`.

`ProjectionDescriptor`, `ProjectionRegistry`, and `ProjectionViewport` remain
2-D-specific. A small higher-level registry makes the future composition seam
explicit without forcing 3-D camera or scene concepts into projection code:

```ts
type WorkspaceViewDescriptor =
  | { id: WorkspaceViewId; kind: 'projection-2d'; projection: ProjectionDescriptor }
  | { id: WorkspaceViewId; kind: 'scene-3d' };
```

The cutover need not register or render a `scene-3d` view. It must keep view
state open to that declared variation rather than assuming every focused or
secondary view is a projection.

### The viewport owns retained layers

Replace the current `SliceRenderer` boundary and regional/volume renderer
switch with a projection viewport mounted once per visible view:

```text
projection viewport
  volume scalar canvas                 optional
  regional anatomy SVG                 optional
  selection and hover presentation
  linked guides/crosshair              registered planes only
  unified pointer/keyboard interaction
```

Regional mode shows feature or anatomy fills in the SVG layer. Volume mode
keeps the scalar Canvas visible while the registered anatomy SVG supplies
configurable outlines, region picking, hover, and selection. Top and Swanson
mount the same SVG layer without volume or navigation capabilities.

Suggested application boundary is instance-based: one viewport owns one frame,
its retained layers, cancellation, and lifecycle.

```ts
interface ProjectionViewportFactory {
  create(
    host: HTMLElement,
    projection: ProjectionDescriptor,
    sink: ProjectionInteractionSink,
  ): ProjectionViewport;
}

interface ProjectionViewport {
  update(model: ProjectionViewportModel): void | Promise<void>;
  resize(size: ViewportSize): void;
  dispose(): void;
}
```

Avoid a god renderer. Split source loading, scalar colorization, retained DOM
layers, presentation resolution, and interaction into focused collaborators.
Pass one atomic model to `update`; do not restore a separate
`updatePresentation` channel that can race geometry updates.

### World coordinates join independent grids

Application state supplies one world cursor. Each registered layer maps it
through its own declared transform:

```text
ML/AP/DV cursor
  atlas registration -> native atlas plane -> nearest display geometry
  volume affine      -> volume voxel plane -> declared storage encoding
```

Never pass an anatomy slice index to the volume source as if grids, resolutions,
directions, or storage axes were interchangeable. Display calibration must not
become volume geometry.

Canvas/SVG stacking is not registration. Define one explicit world-plane to
viewport transform per registered projection, including world extent,
pixel-center versus pixel-edge convention, axis direction, and flips. Each
anatomy, volume, guide, and inspection layer maps through that transform. Use
asymmetric, anisotropic, signed, non-zero-origin fixtures so swaps and flips
cannot pass accidentally. Require an exact coordinate-space compatibility ID
before compositing atlas and dataset layers.

### Share semantics, specialize heavy work

All representations share the colormap registry, range/scale state, missing
value policy, selection state, hover state, and tooltip conventions. They use
specialized applicators:

- regional values -> per-region CSS fills;
- volume values -> RGBA plane buffers;
- anatomy identity -> ontology fills;
- common overlays -> outlines, selection, hover, and guides.

Changing color settings for a cached volume plane must not refetch or redecode
it. The volume colorizer must remain movable to a worker or GPU without changing
application/domain state.

## Runtime modules after the cutover

Names may be refined during implementation, but ownership should remain clear:

- `ProjectionRegistry`: product/view metadata and capabilities, with no DOM or
  transport code;
- `WorkspaceViewRegistry`: higher-level `projection-2d | scene-3d` composition
  metadata, with only 2-D entries registered during this cutover;
- `ProjectionViewportFactory`: creates one retained viewport per frame;
- `ProjectionViewportController`: coordinates retained layers for one mount;
- `RegionalGeometrySource`: loads normalized projection geometry;
- `RegisteredAnatomySource`: resolves native cursor state and sparse orthogonal
  display geometry;
- `StaticProjectionSource`: loads Top/Swanson geometry;
- `RegionalSvgLayer`: parses/indexes paths and owns delegated regional pointer
  interaction;
- `RegionalPresentationResolver`: resolves parcellation IDs, folded/bilateral
  presentation, colors, selection, and hover once for every SVG projection;
- `VolumePlaneSource`: transport-neutral decoded scalar-plane API;
- layout-specific volume sources below it for chunk and slice-pack candidates;
- `VolumePlaneLocator`: maps world coordinates with the declared volume
  transform;
- `VolumeColorizer`: numeric plane plus coloring state to RGBA;
- `CanvasScalarLayer`: paints prepared buffers only;
- `GuideLayer`: registered-plane overlays only.

Every asynchronous viewport update carries a revision and `AbortSignal`; only
the latest revision may commit. A failed volume layer leaves anatomy usable and
reports a layer-specific error. Shared caches must remain retryable after abort
or failure and use a global byte budget across feature switching rather than an
unbounded per-feature loader cache.

The application root composes these objects. Domain/core code must not depend
on their DOM, Canvas, SVG, worker, or transport implementations.

## Canonical projection asset contract

Create one logical `atlas-projection-pack-v1` manifest exposing all five 2-D
projections. It may reference multiple physical pack families and provenance
records; logical unification must not erase source differences.

Registered orthogonal projections retain:

- the validated bilateral 10 um Allen grid and affines;
- native scientific indices and one shared world cursor;
- an explicit sparse display inventory;
- immutable indexed SVG resources with byte sizes and SHA-256;
- topology, coverage, signed-ID, affine, and synchronization validation.

Top and Swanson retain:

- the exact pinned source-object identities and SHA-256 hashes;
- their source view boxes and path counts;
- an explicit `static-regional-map` classification;
- no affine or invented coordinate navigation.

The deterministic builder converts every path to the same runtime identity
attributes:

```html
<path data-allen-id="..." data-beryl-id="..." data-cosmos-id="..." d="..."/>
```

For curated source geometry, preserve each path's `d` bytes while resolving
legacy row/class identifiers at build time. The browser must not ship a legacy
crosswalk or contact the legacy atlas host. Validate safe SVG content, exact
source hashes, path counts, complete declared mappings, deterministic output,
compressed byte sizes, and output SHA-256.

The current validated anatomy artifacts may remain as reproducibility evidence
or deterministic generator inputs. They cease to be supported browser formats
after the new pack becomes active.

## Dataset schema cutover

Promote one schema v1 across Python builders/validators, browser data contracts,
HTTP and IndexedDB readers, publishing validation, fixtures, and downloads.
There is no requirement to consume schema v0.1 after the cutover.

Do not redesign the parts of v0.1 that are already sound: dynamic feature
catalogs, separate regional/volume representations, scientific provenance,
typed binary artifacts, and storage-neutral volume geometry remain useful.
Make only changes justified by imminent volume production:

1. Represent volume encodings as strict discriminated unions rather than a
   loose resource object or a misleading format name.
2. Keep scientific grid/array semantics separate from physical transport.
3. Make the authoritative index-to-world transform explicit and eliminate or
   strictly validate redundant origin/voxel fields.
   Define the convention as row-major `[i0, i1, i2, 1] -> [ml, ap, dv, 1]`,
   with integer indices at voxel centers and half-integers at voxel edges.
4. Constrain axis semantics to a machine-checkable contract rather than free
   strings.
   For the slice-pack launch path, validate a signed-permutation/axis-aligned
   affine profile unless Q4 evidence requires and implementation adds general
   resampling; do not claim arbitrary affine support that the renderer lacks.
5. Restrict volume value dtypes to the decoders actually implemented
   (`float16` and `float32`) unless support for another dtype lands in the same
   task. Broader binary dtypes may remain valid for other artifact kinds.
6. Add a dedicated volume-summary resource instead of interpreting volume
   statistics with the regional-statistics schema. It should support a stable
   whole-feature automatic color range without scanning whichever slice happens
   to be visible.
7. Add a checksummed served-resource index for volume chunks/packs so HTTP and
   local loaders can validate immutable encoded bytes by path, byte size, and
   SHA-256.
8. Add machine-readable validity/outside-brain semantics. The exact sentinel or
   mask remains blocked on Q4; synthetic fixtures may exercise both machinery
   paths without choosing production science.
9. Remove implementation assumptions about a fixed 25 um grid. Support the
   declared grid/affine generically, or explicitly validate any narrower launch
   transform contract once Q4 provides evidence.
   Mapping a world coordinate outside the declared extent returns an explicit
   out-of-grid result rather than a clamped edge plane.
10. Preserve raw/denoised identity in feature IDs and machine-readable
   provenance/value semantics, but do not append a redundant `Source variant:
   raw/denoised` sentence to the human feature description when releases are
   regenerated.

Regenerate the canonical golden fixture and browser-served copy from one
builder output. Rebuild development releases rather than adding v0.1 readers.
Remove v0.1 validators, fixtures, constants, and tests in the same completed
cutover unit.

## Application state and UI

Move workspace-view state out of private `AppShell` fields and into typed
domain state/actions:

```ts
interface WorkspaceState {
  secondaryPanel: 'summary' | WorkspaceViewId;
  focusedView: WorkspaceViewId | null;
}
```

`summary` is a secondary tab, not a projection ID. Prefer distinct
`SecondaryTabId`, `WorkspaceViewId`, `ProjectionId`,
`OrthogonalProjectionId`, and `StaticProjectionId` types.
Keep one ML/AP/DV cursor as navigation authority and derive registered native
indices, display ordinals, slider positions, guides, and volume indices. Do not
persist a second independently mutable slice triple.

The registry generates:

- the three unequal-width primary projection frames;
- the `Summary | Top | Swanson` secondary slot;
- responsive single-view switching;
- coordinate labels, sliders, wheel navigation, and guide availability;
- maximize/restore controls;
- representation and layer availability.

The Feature Summary remains the default secondary tab. Top and Swanson use the
same generic view frame and regional interaction path as orthogonal SVG views.
When the active feature has only a volume representation, static maps may show
anatomical identity and shared selection, but must not imply that volume scalars
were projected or regionally aggregated.

Use one new current URL-state encoding. Old URL migrations may be deleted, and
an unsupported version resets explicitly to a canonical current URL instead of
partially consuming stale fields. Persist the active secondary tab and focused
projection where useful; never persist hover or runtime loading state.

## Planned commits

The exact file count is not a reason to combine unrelated behavior. Conversely,
a producer/consumer contract change must be coherent even if that makes one
commit larger. Every commit below ends green and updates durable status when
repository reality changes.

### Commit 0 — Record the approved cutover

This documentation-only commit:

- records the decision and focused plan;
- puts the cutover into the active implementation order;
- removes contradictory compatibility requirements from higher-priority docs;
- does not claim the new runtime is already implemented.

### Commit 1 — Define schema v1 and projection-pack contracts

- add strict dataset-v1 and `atlas-projection-pack-v1` schemas/types;
- add volume summary, validity semantics, coordinate-space identity, signed
  axis-aligned affine profile, and immutable resource index contracts;
- add Python/TypeScript valid-invalid parity fixtures, including asymmetric
  signed transforms and static maps with no affine;
- leave the current runtime temporarily untouched so this definition commit is
  green; these parallel definitions are staging, not supported compatibility.

Targeted gates: cross-language contract corpus, `just test-python`, and
`just test-web`; finish with `just check`.

### Commit 2 — Cut every dataset producer and consumer to schema v1

- update builder serialization, Python/TypeScript validators, publishing
  validation, HTTP/local readers, IndexedDB namespace, and download metadata;
- regenerate a newly identified canonical synthetic release and browser copy;
- rebuild development releases under new release IDs rather than mutating
  immutable outputs;
- migrate deterministic channel/cluster tests and keep raw/denoised identity in
  structured metadata without redundant description prose;
- delete schema-v0.1 consumers, fixtures, and compatibility tests before
  handoff.

Targeted gates: deterministic fixture parity, local import, publishing,
`just test-python`, and `just test-web`; finish with `just check`.

### Commit 3 — Make projection and navigation state data-driven

- add the discriminated 2-D projection registry, higher-level workspace-view
  registry, and separate secondary-tab type;
- make the world cursor the sole navigation authority and derive slice/display
  indices and guides;
- move secondary/focused view state into domain actions/reducers;
- replace the URL migration stack with one current codec and explicit reset for
  unsupported versions;
- initially expose only the existing three orthogonal frames so visible
  behavior remains stable.

Targeted gates: core affine/navigation, reducer, history, URL, and responsive
view-model tests; finish with `just check`.

### Commit 4 — Generate the unified five-projection pack

- implement the projection-pack generator/validator from Commit 1;
- carry forward registered orthogonal geometry, affine, sparse-display,
  topology, coverage, and synchronization evidence;
- ingest, sanitize, and normalize pinned Top/Swanson source geometry;
- emit deterministic immutable resources and a synthetic/focused test pack;
- verify every declared region ID, source/output hash, path count, compressed
  size, provenance record, and static map's absence of an affine.

If source acquisition or licensing is not established, record the exact blocker
and use synthetic static maps rather than publishing asserted production assets.

Targeted gates: anatomy generator/contract/integrity tests and
`just test-anatomy`; finish with `just check`.

### Commit 5 — Atomically cut registered anatomy to retained viewports

- add the viewport factory and atomic revisioned update model;
- implement independently tested regional SVG, scalar Canvas, guide,
  selection/hover, interaction, and error layers;
- centralize regional presentation and common color normalization while keeping
  regional and voxel applicators specialized;
- implement the common world-plane-to-screen registration contract;
- migrate all three orthogonal regional views and application composition;
- preserve selection, hover, inspection, guides, sliders, sparse display,
  worker/LRU behavior, failure handling, and measured navigation performance;
- switch the browser to the new projection pack;
- delete `SliceRenderer`, the hybrid switch, superseded SVG/anatomy renderers,
  and old pack parsers in the same commit instead of staging a parallel facade.

Targeted gates: strict typecheck, layer conformance, transform sentinels,
cancellation/race and DOM-retention tests, anatomy integrity/navigation,
regional Playwright, and benchmark sanity run; finish with `just check`.

### Commit 6 — Composite volume planes in registered world space

- split volume loading, location, colorization, and Canvas paint;
- map the shared world cursor independently through the volume transform and
  return an explicit out-of-grid result;
- retain anatomy outlines/picking/selection above the volume layer;
- implement voxel/world/region inspection, validity transparency, and explicit
  invalid-transform, integrity, stale-load, and unsupported-capability states;
- enforce a global decoded byte budget across feature switching while
  preserving in-flight deduplication, cancellation, retry, and adjacent prefetch;
- prove recolor, opacity, outlines, selection, and hover cause no fetch/decode.

Use synthetic data until Q4 is resolved. Benchmark both Q5 candidates without
selecting production transport prematurely.

Targeted gates: volume unit/contract tests, both layout adapters, browser volume
suite, cache/memory assertions, layer-alignment sentinels, and benchmark sanity
run; finish with `just check`.

### Commit 7 — Expose Top and Swanson through shared workspace state

- replace hardcoded view construction with the registry;
- add `Summary | Top | Swanson` in the existing secondary slot;
- add responsive switching and generic focus/maximize behavior;
- cover feature/anatomy coloring, all declared parcellations, hover, selection,
  tooltip, failure isolation, reload, Escape restore, and responsive layouts;
- keep volume-only semantics explicit on static maps.

Targeted gates: domain/URL/UI unit tests and Playwright at desktop, compact, and
narrow layouts; finish with `just check`.

### Commit 8 — Delete residue and rebaseline evidence

- delete remaining old schema, URL migration, legacy-host, crosswalk, anatomy
  parser, hybrid renderer, dead CSS, and stale compatibility tests/docs;
- add dependency/architecture tests that prevent old boundaries from returning;
- regenerate performance and size records affected by the new pack/viewport;
- update durable docs and deployment instructions to describe only the shipped
  contract;
- verify no production code or test fixture references deleted formats.

Run `rg` audits, `just check`, representative visual review, and the explicit
anatomy/volume benchmarks. This commit is not complete if a compatibility path
is merely renamed or left unused.

### Commit 9 — Build and validate the production volume release

This commit waits for Q4 and Q5. After authoritative resolution:

- encode the approved grid, affine, axis, outside, and missing-value semantics;
- publish the benchmark-selected transport with resource hashes and provenance;
- build the immutable real release;
- run production-origin, performance, memory, failure, and cross-browser QA;
- record the evidence and resolve Q4/Q5 in durable docs.

## Optional subagent strategy

Subagents are useful for bounded audits and disjoint implementation surfaces;
they do not own product decisions, shared integration, commits, or pushes. The
lead agent remains responsible for reading all authoritative instructions,
freezing interfaces, reviewing every diff, resolving overlaps, running the full
gate, and committing on `main`.

Use at most the available concurrency and prefer waves:

### Contract/audit wave

- Frontier/high-reasoning agent (for example `gpt-5.6-sol`, high or xhigh):
  audit schema v1, affine semantics, projection discriminants, and cross-language
  invariants. Prefer read-only output until the lead freezes interfaces.
- Balanced agent (for example `gpt-5.6-terra`, medium or high): inventory every
  schema/anatomy/URL producer and consumer and propose the deletion matrix.
- Fast agent (for example `gpt-5.6-luna`, low or medium): enumerate fixtures,
  tests, imports, docs, and generated copies with `rg`; report omissions rather
  than making architectural choices.

### Implementation wave after contracts are frozen

- Schema agent: own only `schema/`, builder serializers/validators, publishing
  validation, cross-language fixtures, and their tests.
- Projection-pack agent: own only anatomy/static-projection generator, pack
  contracts, generated test assets, and integrity tests.
- Lead agent: own shared browser domain/application/rendering interfaces and
  integrate both outputs.

These agents may work concurrently only when their path ownership is explicit.
Do not let multiple agents edit shared contracts, `app.ts`, `app-shell.ts`, or
the same generated fixture. Agents should not commit independently in the
shared worktree; the lead stages reviewed paths and creates coherent commits.

### Verification wave

- Balanced/high agent: browser behavior and accessibility review, including
  responsive and failure states.
- Fast/medium agent: deletion audit, stale-name scan, generated-copy parity, and
  targeted test execution.
- Frontier/high agent: final scientific/architectural review of world-coordinate
  mapping, outside semantics, provenance, and cache/resource integrity.

Treat subagent findings as review input. Reproduce important claims locally;
never merge an inferred scientific choice.

## Acceptance criteria for the completed cutover

- One runtime dataset schema and one runtime projection-pack contract exist.
- No browser, builder, local-import, publishing, fixture, or test compatibility
  path remains for deleted schemas/formats.
- All five SVG projections use one regional layer and one presentation resolver.
- Orthogonal volume rendering and anatomy overlays coexist in one retained
  viewport without target replacement.
- Atlas and volume layers independently map the same world cursor through their
  authoritative transforms.
- Atlas/volume compositing requires matching coordinate-space identity and
  tested world-plane-to-screen registration, not equal CSS dimensions.
- Top and Swanson expose no fabricated slice/voxel navigation.
- Volume resource bytes are immutable and verifiable; caches are byte-bounded,
  globally bounded across feature switches, cancellation-safe, and retry after
  failure.
- Volume automatic color range is feature-global and stable across plane
  navigation; invalid/outside voxels are transparent and non-inspectable.
- Rapid updates cannot commit stale layers, and a volume-layer failure leaves
  registered anatomy usable.
- URL/domain/UI view state is registry-driven and responsive.
- Regional, volume, local, publishing, download, and projection fixtures validate
  under the same current contract.
- Regenerated feature descriptions do not repeat raw/denoised source-variant
  metadata already expressed by feature identity and structured provenance.
- Q4/Q5 remain explicit until authoritative evidence resolves them.
- `just check` is green, focused benchmarks are recorded, and durable docs state
  the actual implementation rather than this plan.

## First action for the next agent

Start Commit 1 only from a clean, current `main`. Read the required documents,
run the baseline gate, then inventory every schema-v0.1 producer/consumer and
write the proposed v1 schema plus valid/invalid corpus before editing runtime
materializers. Resolve contract questions in tests and documentation first; do
not start the viewport refactor while schema ownership is still moving.
