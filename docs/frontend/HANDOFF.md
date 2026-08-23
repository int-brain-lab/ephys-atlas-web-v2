# Frontend status and handoff

Status: current supporting summary. The authoritative product state and work
order remain `docs/INTEGRATION_STATUS.md` and `docs/IMPLEMENTATION_PLAN.md`.

## Implemented architecture

`web/` is a plain TypeScript/Vite application with no frontend framework. The composition root is `src/app.ts`; domain state and data access do not depend on DOM components.

State uses an immutable `AppState` plus explicit `AppAction` values, a reducer, and direct store subscriptions. Shareable/view state is separated from runtime loading/error state.

URL state is versioned (`v=4`) and human-readable. Common state is represented
with named query parameters (`dataset`, `release`, `feature`, `repr`, `parcel`,
`stat`, `cmap`, `range`, `scale`, `cursor`, `selected`, `secondary`, `compact`,
`max`). The ML/AP/DV `cursor` is the sole stored navigation authority; native
slice indices and sparse display ordinals are derived. The secondary tab,
responsive compact view, and maximized view are independent URL-persisted
state. User-committed dataset/release, feature, representation, and
parcellation changes use `history.pushState`; navigation, workspace,
selection, ordering, and color refinements use `history.replaceState`.
`popstate` hydrates without echoing a write. Unsupported or missing versions
with state parameters reset wholesale and are replaced by the canonical v4
URL; there is no legacy URL migration runtime. See D031 and D033.

Feature coloring offers the small sequential set Viridis, Cividis, and Magma.
One shared 256-step lookup-table registry drives regional SVG fills, volume
canvas pixels, and the color-range legend, so their colors do not drift. Do not
add a diverging palette until view state and normalization carry an explicit
scientifically meaningful center; the current min/max linear/log contract is
not sufficient.

Data loading is behind `DatasetSource` and `DatasetRepository`. `HttpDatasetSource` handles published immutable releases. `LocalDatasetSource` persists imported directory contents in IndexedDB but exposes the same scientific resource graph. Both consume schema v1 rather than a frontend-specific provisional data format.

Immutable HTTP resources have cache-first Cache Storage support plus in-flight request coalescing. `PrefetchQueue` provides small cancellable idle-time prefetch. No service worker is required.

The current storage layers, launch cache-header policy, local dataset management
UX, quota/eviction requirements, and ordered follow-up work are specified in
`docs/frontend/BROWSER_STORAGE_AND_CACHE.md`.

Rendering is behind the frontend-owned retained `ProjectionViewport` /
`ProjectionRenderModel` boundary. One shared factory creates a stable layered
viewport per registered frame and owns presentation plus interaction sinks.
`ProjectionPackSource` is the only browser regional-geometry source; it loads
schema-v1 projection resources derived from the validated bilateral 10 µm v2
parent. There is no legacy or anatomy-pack browser adapter.

Allen ontology identity is a separate pinned browser asset. The shared renderer
presentation supports URL-persisted `Feature values` and `Allen anatomy` fill
modes, so curated and generated anatomy providers receive the same colors and
selection state. See `docs/frontend/ALLEN_REGION_METADATA.md` and D022.

## UX Phase 1 — responsive empty shell

Implemented the accepted `docs/ux/layout-implementation-spec.md` Phase 1. The five browser layouts were visually approved on 2026-08-19.

- semantic app/header/region/workspace/settings composition;
- explicit responsive regimes at 1480, 1100, and 760px breakpoints;
- wide desktop: region + three unequal slice frames + settings;
- compact desktop: region + three slice frames, settings in a drawer;
- tablet/phone: regions and settings in drawers, one scientific view at a time;
- owned internal scrolling and stable viewport-height desktop composition;
- drawer cleanup on Escape and responsive transitions;
- split CSS token/reset/base/layout/component organization.

The five Phase-1 review viewports are encoded in `web/test/browser/app.spec.ts`; their `.app-body` geometry is now a browser-regression contract.

## UX Phase 2 — context header

Phase 2 was visually approved on 2026-08-19.

- the header is bound to dataset, release, feature, representation, and parcellation state;
- release is deliberately secondary metadata and is omitted in narrow/tablet composition;
- each scientific context field is its own accessible custom picker: dataset releases are grouped by dataset, the feature catalogue is searchable by label/unit/ID/semantics, and representation plus parcellation share one compact picker;
- anchored desktop popovers become bounded bottom sheets on phones; pointer-outside and Escape dismissal, focus restoration, listbox semantics, and arrow-key navigation are covered by browser tests;
- Share copies the complete deep link; Download exports the current regional statistic as provenance-bearing CSV; Info shows immutable release, feature semantics, and source/builder provenance;
- Help presents one responsive scientific-workflow guide with a faithful interface map, five expandable area explanations, concise definitions of interpretation-relevant terms, and an About & credits section with IBL Core attribution and future paper/data slots; keyboard shortcuts remain secondary reference;
- the visualization drawer contains only statistic and color encoding controls; dataset/release, feature, representation, and parcellation are no longer duplicated as native selects there;
- every option remains driven by the loaded catalog, manifest, and payload rather than a hardcoded feature list;
- compact/tablet/phone compositions expose the appropriate drawer triggers and overflow behavior;
- Phase-1 workspace geometry remains unchanged.

## UX Phase 3 — region browser

Phase 3 was visually approved on 2026-08-19.

- the real pinned Allen hierarchy covers nesting, long names, ontology colors, value bars, selection, missing values, hover, and keyboard focus;
- local search, keyboard navigation, animated branch disclosure, and expand/collapse-all controls are implemented;
- a URL-persisted order control cycles anatomy hierarchy, descending feature
  value, and ascending feature value; ranked modes are flat and keep missing
  values last;
- one selection and hover state drives both the region tree and all anatomical projections;
- narrow/tablet/phone reuse the same component in the region drawer.

Schema-v1 regional values come from the active dataset release. The pinned ontology remains independently available for anatomy colors and hierarchy containers even when a feature has no value for a row.

## UX Phase 4 — anatomical view frames

Phase 4's layout remains implemented. D024 defines the scientific geometry and
D031/D034 define the active projection transport. The viewer uses the sparse
80 µm inventory repackaged losslessly in `atlas-projection-pack-v1` from the
exact bilateral 10 µm v2 parent, whose native ranges `1320/1140/800`, signed
atlas IDs, and affines remain the authority for state and synchronization.

- three anatomical frames expose calibrated AP/ML/DV coordinates,
  display-plane ordinal sliders mapped back to native indices, renderer status,
  and maximize/restore affordances;
- one ML/AP/DV cursor and the registered manifest affines drive slices and guides without visual calibration formulas;
- feature mode colors folded feature values on the left and official Allen ontology colors on the right; anatomy mode colors both hemispheres by ontology identity;
- projection-pack bytes are lazy, integrity checked before persistent cache
  admission, explicitly decompressed in a persistent worker, prefetched
  directionally, and held in bounded worker/DOM caches;
- view frames retain the previous valid anatomy while a replacement loads and report failures explicitly;
- revisioned latest-only viewport scheduling skips superseded pending geometry
  and retains stable layer DOM across navigation.

## Public interfaces

Primary interfaces:

- `AppState`, `ViewState`, `AppAction`, `AppStore` in `web/src/domain/`;
- schema-v1 browser contracts and decoders in `web/src/data/`;
- `DatasetRepository` in `web/src/data/repository.ts`;
- `ProjectionViewport`, `ProjectionRenderModel`, and
  `ProjectionInteractionSink` in `web/src/rendering/projection-viewport.ts`;
- `ProjectionPackSource` in `web/src/rendering/projection-pack-source.ts`;
- retained composition and lower-level SVG/Canvas layers in
  `web/src/rendering/`;
- `parseViewState()` / `serializeViewState()` in `web/src/url/url-state.ts`.

## Integrated data contract

The previous frontend provisional schema and schema-v0.1 compatibility path have been removed. Published and local datasets both use schema v1:

1. catalog resolves an immutable release manifest;
2. manifest provides feature descriptors and parcellation region-index resources;
3. regional features resolve typed value/statistics/histogram resources;
4. volume features resolve explicit reference-space/grid/affine metadata,
   exhaustive validity/summary metadata, and a checksummed physical resource index;
5. transport differences do not redefine the scientific contract.

`fixtures/golden-v1/` is mounted only by the Playwright development server to
exercise this contract end-to-end. It is never part of `web/public` and never a
runtime fallback. Ordinary development uses the ignored real `2026_W32`
release and fails explicitly if that release has not been pulled and built.
The separate `just test-brainwide-map-release` command mounts the ignored
`legacy-v1-1d908bea` Beryl-only release through the same development catalog
and production HTTP reader. It is opt-in because clean checkouts do not contain
the generated release.

## Current next work

1. Expose the validated local schema-v1 `2026_W32` development release through
   an authorized non-production object-store catalog and repeat acceptance
   checks against its real CORS and cache headers.
2. Deploy the committed projection pack with immutable caching and opaque
   `.isvg.gz` delivery: do not attach HTTP `Content-Encoding`, because the
   browser verifies the compressed bytes before explicit decompression.
3. Use the `2026_W26` 50 um object and official access recipe in
   `docs/DATA_SOURCES.md` to repeat the real encoding-volume layout benchmarks
   before selecting the launch physical representation; keep volume scientific
   geometry independent of SVG display calibration.
4. Keep 3-D in its independent lab until the shared workspace seam is ready.

## Remaining decisions / external inputs

- final channel paper vintage, plus the authoritative cluster source snapshot
  and launch feature catalog;
- authoritative encoding-volume index-to-world affine/axis mapping and any
  missing-value semantics beyond the documented outside-brain zero;
- production public object-storage/domain arrangement;
- cache/eviction budgets once real release sizes are measured.

Browser E2E is now part of repository CI in addition to typecheck, unit tests, and the production build.
