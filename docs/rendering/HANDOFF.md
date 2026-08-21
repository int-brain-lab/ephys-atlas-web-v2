# Rendering / volumes / 3D handoff

## Implemented renderer interfaces

Branch: `work/rendering`.

- `web/src/rendering/types.ts`
  - immutable `RegionalSliceFrame` / `RegionalSliceRenderer`;
  - `SvgSliceAssetSource` boundary for curated assets;
  - `VolumeSliceFrame` / `VolumeSliceRenderer`;
  - technology-neutral `Renderer3D` with separate scene geometry and visual state.
- `web/src/rendering/svg-slice-renderer.ts`
  - DOM/SVG adapter only; no application state ownership;
  - region colors, selected/highlighted CSS state, linked guide painting, region pointer events;
  - mapping changes invalidate the path index correctly.
- `web/src/rendering/volume.ts`
  - storage-neutral `VolumeSliceSource` application boundary;
  - optional logical `VolumeChunkSource` adapter;
  - canonical orthogonal plane assembly, bounded LRU, concurrency limit, adjacent prefetch;
  - decoded chunks normalized to float32 while physical `storageDtype` remains explicit.
- `web/src/rendering/canvas-volume-renderer.ts`
  - dependency-free Canvas2D final paint path.
- `web/src/rendering/scene3d.ts`
  - Allen-region mesh + future dense-point geometry contract, validation, memory estimation.

Tests are dependency-free Node TypeScript tests under `tests/rendering/`. Current total: 12 passing. The rendering source also compiles with the frontend branch's strict settings (`moduleResolution: Bundler`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) and emitted ES modules pass a runtime smoke test.

## Frontend integration boundary

`work/frontend` landed its own application-level `web/src/rendering/interfaces.ts` during this run. Keep that `SliceRenderer`/`SliceRenderModel` facade as the frontend-owned boundary rather than replacing it with the lower-level rendering interfaces here.

Integration should:

1. use frontend `domain/types.ts` as the canonical source for `SliceAxis` and parcellation types after merge;
2. add a small adapter from `SliceRenderModel` to `RegionalSliceFrame`/`SvgSliceRenderer`;
3. route SVG region pointer events into the frontend `RendererInteractionSink`;
4. keep `VolumeSliceSource` below the facade so physical volume layout remains invisible to application state;
5. preserve `.js` import specifiers in TypeScript source, matching the frontend Vite/Bundler convention.

This avoids two competing application-level renderer abstractions while retaining the technology-neutral low-level renderers and volume source boundary.

## SVG findings

Reuse the curated v1 SVG slices; do not regenerate them casually.

V1's historical processing pipeline includes MATLAB slice extraction, RDP simplification, Inkscape simplification, SVGO, region-id cleanup, and later additional manual processing. Source comments explicitly warn that the generated `slices.json` received further manual processing.

Two coordinate systems were identified for the historical W12/legacy path:

1. **historical scientific coordinates**: regional slices at 10 um and the W12
   volume at 25 um used Allen origins (`AP +5400`, `ML -5739`, `DV +332` um);
   do not apply this mapping to the current W26 volume without authoritative
   affine/axis evidence;
2. **display registration**: one exact coronal/sagittal/horizontal SVG view-box envelope and orientation per curated v1 projection; slice indices first pass through the scientific Allen-coordinate calibration.

Never use display calibration for scientific lookup. Exact constants and tests are in `slice-calibration.ts`; rationale is in `SVG_CALIBRATION.md`.

V1 preloads all slice JSON for all views. The active v2 renderer instead lazy-loads immutable depth-16 generated anatomy packs and verifies compressed bytes before explicit decompression. The legacy renderer remains an inactive fallback.

## Historical W12 volume findings and benchmark decision

The paper source documented `2026_W12` as `(456, 528, 320, 41)`, float16,
25 um, 41 features. One feature is 147.0 MiB raw float16; a whole decoded
float32 feature is 293.9 MiB. Eager full-feature materialization is rejected.
The current implementation input is W26/50 um; see `docs/DATA_SOURCES.md` and
repeat these measurements before making a production transport choice.

Committed benchmark scripts/results:

- `benchmarks/rendering/volume-layout.mjs`
- `benchmarks/rendering/volume-layout-results.txt`
- `benchmarks/rendering/volume-render.mjs`
- `benchmarks/rendering/volume-render-results.txt`

Key results:

- one-object-per-64^3 chunk: 40/45/72 requests and 20.0/22.5/36.0 MiB raw for a cold coronal/sagittal/horizontal slice; three-plane union 68.0 MiB;
- one-object-per-32^3 chunk: 150/170/255 requests; three-plane union 33.4 MiB;
- orientation-specific 8-slice packs: three current views = 3 requests / 8.48 MiB raw / 16.96 MiB decoded float32 cache, with 8 warm steps; physical storage is 3x (440.9 MiB raw per feature);
- scalar-to-RGBA mapping of all three full-resolution views: local Node 22 runs were approximately 3.4-4.8 ms p50 and 4.2-5.4 ms p95, comfortably below the provisional 10 ms CPU budget.

Recommendation: **Canvas2D + `VolumeSliceSource` for launch. Benchmark orientation-specific 4/8-slice packs on real data before freezing the volume physical format.** 3-D chunk storage remains a valid canonical/interoperability representation, but current per-chunk static URLs do not meet the slice-view access pattern without substantial request/byte cost.

## Cross-workstream volume conflict requiring Integration/data-schema decision

`work/data-schema` advanced during this run. Its current `schema/v0.1/volume.schema.json` requires a 3-D chunk `path_template`, with codec `none|gzip`; `docs/data/STORAGE_FORMATS.md` says static URLs + typed arrays + gzip chunks are sufficient and suggests ~64-voxel chunks as a starting point.

Rendering evidence conflicts with freezing that as the only launch physical layout. Do **not** silently merge these assumptions.

Requested resolution:

1. run the data builder on several real `2026_W26` features;
2. compare 32^3 and 64^3 chunk URL layouts against orientation-specific 4/8-slice packs;
3. measure actual gzip bytes, build/storage size, first-three-view transfer, request count, and adjacent navigation;
4. either extend volume schema with an explicit physical `layout` (`chunks3d` vs `orthogonal_slice_packs`) or adopt an indexed/sharded scheme that demonstrably meets the same access budgets;
5. keep common scientific grid/dtype/axis/affine metadata independent of layout.

The current rendering code deliberately consumes `VolumeSliceSource`, so this decision can change without rewriting the UI/renderers.

## 3D comparison and recommendation

Detailed evidence: `3D_EVALUATION.md`.

- **Three.js WebGL2**: recommended first v2 3D spike. Current official APIs directly provide GLB loading, mesh/point raycasting, orbit controls, and point clouds. Lowest implementation risk.
- **Three.js WebGPURenderer**: promising second measurement; it has WebGL2 fallback, but Three.js still documents it as experimental.
- **Datoviz WebGPU/WASM**: serious second candidate. Current browser code has meshes, picking, arcball/controllers, retained updates, and dense-point evidence, but its compatibility note still calls the runner a strict subset and has generic/brain volume later in promotion. Runtime/build integration is heavier than needed for the initial 3D mesh panel.
- **custom WebGPU**: reject for launch; no viewer requirement justifies owning GLB/material/control/picking/fallback infrastructure.
- **legacy Unity**: emergency fallback only. V1's build assets are deployed separately and absent from source; JS state crosses a string `SendMessage` bridge.

Current `ibl-datoviz` already sources Allen meshes from `meshes.glb`, geometry keyed by Allen region id. Reuse that asset/provenance for a web release where practical.

A technology-neutral 500k-point fixture estimates 9.54 MiB for float32 xyz + float32 scalar + uint32 id before GPU duplication. The size is realistic; point picking strategy still needs measurement.

## Performance budgets

Provisional launch budgets are in `VOLUME_ARCHITECTURE.md`. Important ones:

- warm slice input-to-paint <= 50 ms p95;
- cold volume boundary <= 250 ms p95 typical broadband;
- all-three-view recolor <= 10 ms p95 CPU before paint;
- initial three current volume views <= 8-10 MiB target before background prefetch;
- decoded volume cache <= 96 MiB, preferably far lower with slice packs;
- steady-state viewer JS heap aim <= 192 MiB, review at 256 MiB;
- never implicitly download a whole 147 MiB float16 feature.

These require browser/network validation with real artifacts before launch.

## Unresolved questions

1. **Volume physical layout** — blocking integration of a real volume source adapter; see conflict above.
2. **Exact scientific affine/axis semantics** — producer/origin/directions of
   the current `2026_W26` 50 um object still require authoritative confirmation.
   Rendering will consume schema geometry and must not infer it from SVGs.
3. **Curated SVG artifact publication** — actual v1 slice JSON is not in the source repo; integration/data build needs the deployed curated assets copied into a versioned immutable v2 asset release without regeneration.
4. **3D mesh artifact metadata** — verify `meshes.glb` size/license/provenance and browser node naming before adding it to a v2 release.
5. **3D dependency decision** — intentionally deferred until regional + volume vertical slices work. First empirical follow-up should use the exact same real GLB fixture across Three WebGL2, Three WebGPU, and Datoviz.
