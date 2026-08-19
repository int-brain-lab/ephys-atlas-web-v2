# Frontend handoff

## Implemented architecture

`web/` is a plain TypeScript/Vite application with no frontend framework. The composition root is `src/app.ts`; domain state and data access do not depend on DOM components.

State uses an immutable `AppState` plus explicit `AppAction` values, a reducer, and direct store subscriptions. There is no hidden DOM event bus and no globally mutable state object. Shareable/view state is separated from runtime loading/error state.

URL state is versioned (`v=1`) and human-readable. Common state is represented with named query parameters (`dataset`, `release`, `feature`, `repr`, `parcel`, `stat`, `cmap`, `range`, `scale`, `cursor`, `slices`, `selected`). URL updates use `history.replaceState`, and `popstate` is supported.

Data loading is behind `DatasetSource` and `DatasetRepository`. `HttpDatasetSource` handles published immutable releases. `LocalDatasetSource` persists imported directory contents in IndexedDB but exposes the same `DatasetSource` contract. Local imports require `manifest.json` plus resources whose relative paths match the manifest.

Immutable HTTP resources have cache-first Cache Storage support plus in-flight request coalescing. `PrefetchQueue` provides small cancellable idle-time prefetch. No service worker is required.

Rendering is behind `SliceRenderer`/`SliceRenderModel`. The default `NullSliceRenderer` only marks renderer slots as unconnected; it does not implement a fake atlas. Rendering work can replace this interface without taking ownership of app state or data loading.

The shell is semantic HTML with labeled controls, status live region, keyboard-native inputs, three renderer slots, selection list, and responsive structure. Visual design is intentionally minimal for UX iteration.

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
- Rendering needs canonical slice bounds/index/coordinate metadata; frontend sliders currently use a neutral 0–1000 range because that contract is not available yet.
- Decide whether URL `selected` should persist stable numeric Allen IDs, acronyms, or another canonical region key. It currently stores opaque strings.
- Decide cache version/eviction budgets once real release sizes are known. Current persistent caching is intentionally simple and only used for immutable resources.
- OPFS may be preferable to IndexedDB blobs for very large local volume resources; the logical `DatasetSource` contract should stay unchanged if storage changes.

## Integration decisions needed

1. Data/schema: confirm catalog + manifest resolution, representation descriptors, canonical region identifiers, feature statistic metadata, and local package layout.
2. Rendering: confirm `SliceRenderer` input contract and provide slice bounds/coordinates so UI range controls are data-driven.
3. UX: iterate layout/control grouping without moving domain state into DOM modules.
4. Integration: decide whether browser E2E belongs in default `npm test`; currently `npm test` is fast (typecheck + unit) and Playwright is `npm run test:browser`.
