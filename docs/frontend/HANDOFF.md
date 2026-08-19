# Frontend handoff

## Implemented architecture

`web/` is a plain TypeScript/Vite application with no frontend framework. The composition root is `src/app.ts`; domain state and data access do not depend on DOM components.

State uses an immutable `AppState` plus explicit `AppAction` values, a reducer, and direct store subscriptions. There is no hidden DOM event bus and no globally mutable state object. Shareable/view state is separated from runtime loading/error state.

URL state is versioned (`v=1`) and human-readable. Common state is represented with named query parameters (`dataset`, `release`, `feature`, `repr`, `parcel`, `stat`, `cmap`, `range`, `scale`, `cursor`, `slices`, `selected`). URL updates use `history.replaceState`, and `popstate` is supported.

Data loading is behind `DatasetSource` and `DatasetRepository`. `HttpDatasetSource` handles published immutable releases. `LocalDatasetSource` persists imported directory contents in IndexedDB but exposes the same `DatasetSource` contract. Local imports require `manifest.json` plus resources whose relative paths match the manifest.

Immutable HTTP resources have cache-first Cache Storage support plus in-flight request coalescing. `PrefetchQueue` provides small cancellable idle-time prefetch. No service worker is required.

Rendering is behind `SliceRenderer`/`SliceRenderModel`. Phase 1 does not call the renderer: the shell deliberately exposes only empty view surfaces until the UX layout is approved. The renderer interfaces remain unchanged for the rendering workstream.

## UX Phase 1 — responsive empty shell

Implemented the accepted `docs/ux/layout-implementation-spec.md` Phase 1. The five browser layouts were visually approved on 2026-08-19.

- semantic `atlas-app` / header / region pane / workspace / settings pane composition;
- four explicit responsive regimes at 1480, 1100, and 760px starting breakpoints;
- wide desktop: region + three unequal slice frames + settings;
- compact desktop: region + three slice frames, settings in a drawer;
- tablet/phone: regions and settings in drawers, one scientific view at a time, with immediate Coronal/Sagittal/Horizontal/Context switching;
- compact secondary/distribution context row and analysis band placeholders;
- viewport-height desktop shell with owned internal scrolling and no macro absolute positioning;
- drawer cleanup on Escape and responsive transitions;
- dark scientific-instrument tokens and restrained panel primitive;
- `styles.css` is now a cascade-layer import manifest with split token/reset/base/layout/component files.

No scientific data presentation, brain rendering, charts, 3D, real header controls, region rows, analysis content, or settings functionality was implemented in this phase. Existing application state/data modules are intentionally left in place behind the empty shell.

The five Phase-1 review viewports are encoded in `web/test/browser/app.spec.ts`. After visual approval, their `.app-body` viewport geometry became an explicit browser-regression contract. Phase-2/3 browser review preserves that macro geometry; screenshots remain review artifacts rather than repository goldens for now.

## UX Phase 2 — context header

Phase 2 was visually approved on 2026-08-19.

- the header is bound to the existing `ShellModel` dataset, release, feature, and representation state;
- release is rendered as deliberately secondary metadata and is omitted in narrow/tablet composition;
- Share, Download, and Info are explicit placeholder affordances only — no detailed action behavior has been implemented;
- compact desktop keeps Settings as a drawer trigger; tablet adds Regions as a drawer trigger;
- phone keeps dataset/feature/representation context visible while collapsing Share/Download/Info behind a small overflow control;
- phone drawer buttons use compact icon presentation while retaining accessible names;
- the overflow closes on Escape and is cleared when leaving phone composition or opening a drawer;
- all Phase-1 workspace geometry and pane behavior remains unchanged.

No anatomical rendering, chart content, analysis functionality, settings controls, 3D, feature catalogue, download implementation, share implementation, or info panel was added in Phase 2.

## UX Phase 3 — region browser

Phase 3 was visually approved on 2026-08-19.

- replaces the Phase-1 region-pane skeleton with a dense representative hierarchy of static region rows;
- representative rows cover nested hierarchy, long names, value bars, selected, active, missing-value, hover, and keyboard-focus states;
- search filters the representative rows locally by acronym or name and announces the result count;
- selected-region rows support local prototype add/remove/clear interaction so density and interaction states can be reviewed;
- Arrow Up/Down and Home/End move keyboard focus between visible region rows;
- the region list owns scrolling while search and selected-region areas remain stable within the pane;
- narrow/tablet/phone reuse the same component in the existing drawer, and opening the region drawer focuses search;
- Playwright coverage exercises all five review viewports plus search, selection, keyboard navigation, focus, and drawer cleanup.

The Phase-3 region labels and normalized value bars are explicitly UX-only representative content. They are not loaded from scientific datasets, are not used for scientific interpretation, do not dispatch selection into domain/URL state, and must be replaced when real region data is connected after visual approval.

No real Allen/Beryl/Cosmos region data, feature coloring, anatomical rendering, charts, 3D, analysis functionality, or settings functionality was added in Phase 3.

## UX Phase 4 — anatomical view frames

Implemented Phase 4 only; awaiting visual review before Phase 5.

- the three anatomical frames now expose calibrated AP/ML/DV coordinates, slice-index sliders, renderer status, and maximize/restore affordances;
- initial regional slice indices match the legacy viewer defaults (`coronal=660`, `sagittal=550`, `horizontal=400`), corresponding to AP -1.20 mm, ML -0.24 mm, DV -3.67 mm;
- exact 10 um regional calibration, legacy SVG view boxes, and linked-guide projection constants are taken from the tested `work/rendering` implementation rather than re-derived in frontend code;
- `LegacyCuratedSvgSliceRenderer` implements the existing frontend-owned `SliceRenderer` facade and targets the deployed v1 curated bundles at `https://atlas.internationalbrainlab.org/data/json/slices_{axis}.json`;
- axis bundles are loaded lazily, cached in memory, and the nearest available curated index is used when a requested index is absent;
- view frames have explicit loading, ready, and error states; asset failure does not substitute a fake atlas;
- linked cross-view guides use the rendering workstream's legacy display calibration and remain visually distinct from scientific coordinates;
- maximize is a genuine view overlay and closes with Escape; the approved macro shell geometry remains unchanged when not maximized;
- Playwright routes the external legacy asset requests to a deterministic SVG fixture for hermetic browser tests and review screenshots. The fixture is test-only and is not shipped as scientific anatomy.

This is an intentionally transitional asset integration. The v1 curated slice JSON is deployed but is not present in the legacy source repository. Integration/data build still needs to copy those curated assets, without regeneration, into a versioned immutable v2 asset release. Once `work/rendering` is integrated, its lower-level `SvgSliceRenderer` should sit below the frontend facade; Phase 4 does not duplicate region hit-testing or scientific feature coloring.

No real feature coloring, renderer-driven region selection/hover, volume slices, secondary-view content, charts, 3D, analysis functionality, or settings functionality was added in Phase 4.

## Public interfaces

Primary interfaces intended for other workstreams:

- `AppState`, `ViewState`, `AppAction`, `AppStore` in `web/src/domain/`
- `DatasetCatalog`, `DatasetManifest`, `FeatureDescriptor`, `FeaturePayload`, `DatasetSource` in `web/src/data/contracts.ts`
- `DatasetRepository` in `web/src/data/repository.ts`
- `SliceRenderer`, `SliceRenderModel`, `RendererInteractionSink` in `web/src/rendering/interfaces.ts`
- `parseViewState()` / `serializeViewState()` in `web/src/url/url-state.ts`

## Data-schema assumptions

`work/data-schema` was inspected before implementation and was still empty apart from the shared repository skeleton. The frontend therefore uses `schemaVersion = "0.1-provisional"` locally until the schema workstream publishes a contract.

Provisional assumptions are deliberately narrow:

1. A catalog lists datasets and immutable releases; each release points to a manifest.
2. A manifest lists features and independent `regional` and/or `volume` representations.
3. Regional resources are JSON keyed by parcellation and contain region IDs plus named descriptive-statistic arrays.
4. Volume resources are represented separately and are not forced into the regional physical format.
5. Published and local data use the same manifest/resource graph; only transport/storage differs.
6. Relative resource paths are resolved from the manifest URL/directory.

The fixture under `web/public/fixtures/` is synthetic frontend test data, not a proposal for canonical scientific values or packaging.

## Unresolved questions

- Replace provisional contracts with the data-schema workstream's shared/generated types and golden fixture as soon as they land.
- Decide whether volume payloads use JSON metadata plus binary chunks, Zarr, NPY-derived blocks, or another transport. The current provisional `VolumeFeaturePayload` is only a boundary placeholder.
- Regional slice bounds/coordinates now use the tested 10 um calibration from `work/rendering`; volume/grid affine semantics still come from the data/rendering contract and must not be inferred from SVG display calibration.
- The deployed v1 curated SVG JSON must be copied unchanged into a versioned immutable v2 asset release; the Phase-4 direct legacy-host URL is transitional.
- Decide whether URL `selected` should persist stable numeric Allen IDs, acronyms, or another canonical region key. It currently stores opaque strings.
- Decide cache version/eviction budgets once real release sizes are known. Current persistent caching is intentionally simple and only used for immutable resources.
- OPFS may be preferable to IndexedDB blobs for very large local volume resources; the logical `DatasetSource` contract should stay unchanged if storage changes.
- UX must visually approve the Phase-4 anatomical frame screenshots before frontend proceeds to Phase 5 secondary-view/distribution work.

## Integration decisions needed

1. Data/schema: confirm catalog + manifest resolution, representation descriptors, canonical region identifiers, feature statistic metadata, and local package layout.
2. Rendering/integration: merge the `work/rendering` low-level SVG renderer below the existing frontend facade and publish the curated SVG assets as a v2 immutable release; do not duplicate or regenerate the hand-tuned assets.
3. UX: review the five Phase-4 anatomical-frame layouts before Phase 5.
4. Integration: decide whether browser E2E belongs in default `npm test`; currently `npm test` is fast (typecheck + unit) and Playwright is `npm run test:browser`.
