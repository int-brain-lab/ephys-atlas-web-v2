# Frontend handoff

## Implemented architecture

`web/` is a plain TypeScript/Vite application with no frontend framework. The composition root is `src/app.ts`; domain state and data access do not depend on DOM components.

State uses an immutable `AppState` plus explicit `AppAction` values, a reducer, and direct store subscriptions. Shareable/view state is separated from runtime loading/error state.

URL state is versioned (`v=3`) and human-readable. Common state is represented with named query parameters (`dataset`, `release`, `feature`, `repr`, `parcel`, `stat`, `cmap`, `range`, `scale`, `cursor`, `slices`, `selected`). URL updates use `history.replaceState`, and `popstate` is supported. Historical v1 10 µm and v2 25 µm slice links migrate through world coordinates.

Data loading is behind `DatasetSource` and `DatasetRepository`. `HttpDatasetSource` handles published immutable releases. `LocalDatasetSource` persists imported directory contents in IndexedDB but exposes the same scientific resource graph. Both consume schema v0.1 rather than a frontend-specific provisional data format.

Immutable HTTP resources have cache-first Cache Storage support plus in-flight request coalescing. `PrefetchQueue` provides small cancellable idle-time prefetch. No service worker is required.

The current storage layers, launch cache-header policy, local dataset management
UX, quota/eviction requirements, and ordered follow-up work are specified in
`docs/frontend/BROWSER_STORAGE_AND_CACHE.md`.

Rendering remains behind the frontend-owned `SliceRenderer` / `SliceRenderModel` facade. `LegacyCuratedSvgSliceRenderer` is the application adapter for curated anatomy and delegates actual SVG region rendering/interactions to the lower-level `SvgSliceRenderer` integrated from the rendering workstream.

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

- the header is bound to dataset, release, feature, and representation state;
- release is deliberately secondary metadata and is omitted in narrow/tablet composition;
- Share copies the complete deep link; Download exports the current regional statistic as provenance-bearing CSV; Info shows immutable release, feature semantics, and source/builder provenance;
- dataset/release, feature, representation, parcellation, statistic, colormap, scale, and robust/manual range controls are driven by the loaded manifest and payload rather than a hardcoded feature list;
- compact/tablet/phone compositions expose the appropriate drawer triggers and overflow behavior;
- Phase-1 workspace geometry remains unchanged.

## UX Phase 3 — region browser

Phase 3 was visually approved on 2026-08-19.

- the real pinned Allen hierarchy covers nesting, long names, ontology colors, value bars, selection, missing values, hover, and keyboard focus;
- local search, keyboard navigation, animated branch disclosure, and expand/collapse-all controls are implemented;
- one selection and hover state drives both the region tree and all anatomical projections;
- narrow/tablet/phone reuse the same component in the region drawer.

Schema-v0.1 regional values come from the active dataset release. The pinned ontology remains independently available for anatomy colors and hierarchy containers even when a feature has no value for a row.

## UX Phase 4 — anatomical view frames

Phase 4's layout remains implemented, while D024 defines the active scientific
geometry. The viewer uses the committed exact bilateral 10 µm pack with native
ranges `1320/1140/800`, direct signed atlas IDs, and manifest affines for exact
cross-projection synchronization.

- three anatomical frames expose calibrated AP/ML/DV coordinates, full-resolution slice-index sliders, renderer status, and maximize/restore affordances;
- one ML/AP/DV cursor and the registered manifest affines drive slices and guides without visual calibration formulas;
- feature mode colors folded feature values on the left and official Allen ontology colors on the right; anatomy mode colors both hemispheres by ontology identity;
- pack bytes are lazy, integrity checked, explicitly decompressed, prefetched directionally, and held in bounded caches;
- view frames retain the previous valid anatomy while a replacement loads and report failures explicitly;
- the generated and legacy providers remain modular below the shared `SliceRenderer`; legacy assets are code-level rollback inputs, not runtime dependencies.

## Public interfaces

Primary interfaces:

- `AppState`, `ViewState`, `AppAction`, `AppStore` in `web/src/domain/`;
- schema-v0.1 browser contracts and decoders in `web/src/data/`;
- `DatasetRepository` in `web/src/data/repository.ts`;
- `SliceRenderer`, `SliceRenderModel`, `RendererInteractionSink` in `web/src/rendering/interfaces.ts`;
- curated legacy asset inventory/helpers in `web/src/rendering/legacy-slice-assets.ts`;
- lower-level SVG/volume renderer contracts in `web/src/rendering/`;
- `parseViewState()` / `serializeViewState()` in `web/src/url/url-state.ts`.

## Integrated data contract

The previous frontend provisional schema has been removed from the active path. Published and local datasets both use schema v0.1:

1. catalog resolves an immutable release manifest;
2. manifest provides feature descriptors and parcellation region-index resources;
3. regional features resolve typed value/statistics/histogram resources;
4. volume features resolve explicit scientific grid metadata plus a physical-layout descriptor;
5. transport differences do not redefine the scientific contract.

`web/public/fixtures/ephys_atlas_channels/golden-v0.3/` is the browser-served golden fixture used to exercise this contract end-to-end. It is synthetic test data whose signed IDs intersect all three default anatomy planes.

## Current next work

1. Publish the validated real channel development release through an authorized non-production catalog; `just dev-real` validates and defaults to immutable `2026_W32` plus `rms_ap.denoised` locally.
2. Deploy the committed generated anatomy pack with opaque gzip delivery and verify its immutable public URLs.
3. Benchmark real encoding-volume layouts before selecting the launch physical representation; keep volume scientific geometry independent of SVG display calibration.
4. Keep 3-D behind the regional and volume launch-critical vertical slices.

## Remaining decisions / external inputs

- exact scientific feature/QC/unit choices for real channel and cluster releases;
- authoritative encoding-volume index-to-world affine and outside-brain semantics;
- production public object-storage/domain arrangement;
- cache/eviction budgets once real release sizes are measured.

Browser E2E is now part of repository CI in addition to typecheck, unit tests, and the production build.
