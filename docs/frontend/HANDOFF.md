# Frontend handoff

## Implemented architecture

`web/` is a plain TypeScript/Vite application with no frontend framework. The composition root is `src/app.ts`; domain state and data access do not depend on DOM components.

State uses an immutable `AppState` plus explicit `AppAction` values, a reducer, and direct store subscriptions. Shareable/view state is separated from runtime loading/error state.

URL state is versioned (`v=1`) and human-readable. Common state is represented with named query parameters (`dataset`, `release`, `feature`, `repr`, `parcel`, `stat`, `cmap`, `range`, `scale`, `cursor`, `slices`, `selected`). URL updates use `history.replaceState`, and `popstate` is supported.

Data loading is behind `DatasetSource` and `DatasetRepository`. `HttpDatasetSource` handles published immutable releases. `LocalDatasetSource` persists imported directory contents in IndexedDB but exposes the same scientific resource graph. Both consume schema v0.1 rather than a frontend-specific provisional data format.

Immutable HTTP resources have cache-first Cache Storage support plus in-flight request coalescing. `PrefetchQueue` provides small cancellable idle-time prefetch. No service worker is required.

The current storage layers, launch cache-header policy, local dataset management
UX, quota/eviction requirements, and ordered follow-up work are specified in
`docs/frontend/BROWSER_STORAGE_AND_CACHE.md`.

Rendering remains behind the frontend-owned `SliceRenderer` / `SliceRenderModel` facade. `LegacyCuratedSvgSliceRenderer` is the application adapter for curated anatomy and delegates actual SVG region rendering/interactions to the lower-level `SvgSliceRenderer` integrated from the rendering workstream.

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
- Share, Download, and Info remain explicit placeholder affordances;
- compact/tablet/phone compositions expose the appropriate drawer triggers and overflow behavior;
- Phase-1 workspace geometry remains unchanged.

## UX Phase 3 — region browser

Phase 3 was visually approved on 2026-08-19.

- representative hierarchy rows cover nesting, long names, value bars, selection, missing values, hover, and keyboard focus;
- local search and keyboard navigation are implemented;
- selected-region prototype interactions are local-only;
- narrow/tablet/phone reuse the same component in the region drawer.

The Phase-3 region labels and value bars are still UX-only representative content. They are not scientific data and must now be replaced by real parcellation metadata and schema-v0.1 regional values as the first integrated viewer milestone.

## UX Phase 4 — anatomical view frames

Phase 4 is implemented. The refreshed real-curated-asset screenshots remain the next visual review point before proceeding with later UX blocks.

- three anatomical frames expose calibrated AP/ML/DV coordinates, full-resolution slice-index sliders, renderer status, and maximize/restore affordances;
- initial indices match the legacy defaults (`coronal=660`, `sagittal=550`, `horizontal=400`), corresponding to AP -1.20 mm, ML -0.24 mm, DV -3.67 mm;
- exact 10 um regional calibration, legacy SVG view boxes, and linked-guide projection constants come from the tested rendering implementation;
- `LegacyCuratedSvgSliceRenderer` defaults to the deployed v1 curated bundles at `https://atlas.internationalbrainlab.org/data/json/` while accepting a replacement immutable `baseUrl`;
- the five deployed curated bundles were validated and pinned by byte size, SHA-256, path count, entry count, and index coverage in `web/src/rendering/legacy-slice-assets.ts` and `docs/frontend/LEGACY_CURATED_ASSETS.md`;
- real orthogonal SVG coverage is coronal even indices `2..1316`, sagittal `54..1086`, and horizontal `16..754`;
- scientific/navigation state remains on the full 10 um domains (`coronal 0..1319`, `sagittal 0..1139`, `horizontal 0..799`) with slider `step=1`;
- coordinates, URL state, and linked guides use requested full-resolution indices while the renderer independently selects the nearest available curated SVG and exposes that display choice as `data-asset-index`;
- loaded orthogonal bundles are checked against the pinned entry-count/range/step inventory before rendering;
- axis bundles load lazily and are cached in memory;
- view frames have explicit loading/ready/error states; asset failure never substitutes fake anatomy;
- the lower-level `SvgSliceRenderer` is now below the frontend facade, so region-class parsing, selected-region styling, and renderer interaction machinery are not duplicated;
- hermetic Playwright tests generate the complete pinned key inventory using short path fragments sampled from the real bundles.

The 83.44 MiB of generated curated deployment artifacts are intentionally not duplicated in normal Git history. Launch publication still needs to copy those exact five files, unchanged, into a versioned immutable v2 asset release and configure the renderer to use it. The SHA-256 values in `docs/frontend/LEGACY_CURATED_ASSETS.md` are the acceptance check.

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

`web/public/fixtures/ephys_atlas_channels/golden-v0.1/` is the browser-served golden fixture used to exercise this contract end-to-end. It is synthetic test data.

## Current next work

1. Replace representative Phase-3 rows with real region metadata/value arrays from the golden schema-v0.1 release, then the chosen real `ephys_atlas_channels` release.
2. Wire region hover/selection through `RendererInteractionSink` and application state/URL state.
3. Color curated SVG paths from real regional feature values for Allen/Beryl/Cosmos.
4. Drive distribution/histogram/comparison UI from the schema-v0.1 statistics resources.
5. Publish the five pinned curated bundles to an immutable v2 asset location and remove the runtime dependency on the legacy host.
6. Benchmark real encoding-volume layouts before selecting the launch physical representation; keep volume scientific geometry independent of SVG display calibration.
7. Keep 3-D behind the regional and volume launch-critical vertical slices.

## Remaining decisions / external inputs

- canonical region key for persisted selection (numeric Allen IDs versus another stable identifier);
- exact scientific feature/QC/unit choices for real channel and cluster releases;
- authoritative encoding-volume index-to-world affine and outside-brain semantics;
- production public object-storage/domain arrangement;
- cache/eviction budgets once real release sizes are measured.

Browser E2E is now part of repository CI in addition to typecheck, unit tests, and the production build.
