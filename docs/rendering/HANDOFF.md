# Rendering status and handoff

Status: current supporting summary. The authoritative implementation state,
decisions, and task order are `docs/INTEGRATION_STATUS.md`,
`docs/DECISIONS.md`, and `docs/IMPLEMENTATION_PLAN.md`.

## Application boundary

`web/src/rendering/projection-viewport.ts` owns the application-facing 2-D
boundary. `AtlasApp` provides a `ProjectionRenderModel` containing one axis,
derived native slice, world cursor, parcellation, and active feature. A shared
`ProjectionViewportFactory` owns presentation and interaction sinks and creates
one retained `ProjectionViewport` per registered frame plus affine-free static
viewports for Top and Swanson in the secondary workspace slot.

Each viewport mounts one stable Canvas/SVG/guide/error stack. Navigation uses
revisioned latest-only scheduling: at most one geometry request is active,
superseded pending requests are skipped, and stale completions cannot commit.
Presentation-only updates reuse prepared SVG layers. There is no parallel
`SliceRenderer` or hybrid facade.

## Registered projection source

`ProjectionPackSource` is the only browser regional-geometry source. It loads
`atlas-projection-pack-v1`, validates its registered resource indexes, verifies
immutable compressed bytes before persistent caching, and transfers indexed
SVG packs to the existing worker-owned 32 MiB decoded LRU. It resolves native
10 µm indices to the nearest declared sparse display plane with lower-index
tie breaking and derives guides from the manifest affine.

The checked-in development fixture at
`web/public/atlas/projections/synthetic-static-registered-v1/` combines the
validated registered geometry with deterministic synthetic Top/Swanson paths.
The static maps are exposed with an always-visible synthetic warning and must
never be presented as scientific or licensing evidence. Their transport-opaque
`.isvg.gz` names prevent HTTP hosts from decoding bytes before SHA verification.
Rebuild the fixture with
`tools/projection_pack/build_web_fixture.py` and validate it with
`just projection-pack-validate <path>`.

The immutable v2/v3 anatomy artifacts remain the scientific and reproducible
inputs to projection-pack generation, not supported browser formats. The
registered resources retain their exact geometry, affine, sparse inventories,
topology, coverage, synchronization evidence, and hashes.

## Layer state

The retained viewport already owns independently mounted regional SVG and
scalar Canvas layers. Regional features preserve Allen/Beryl/Cosmos identity,
bilateral coloring, hover, selection, pointer inspection, guides, wheel
navigation, failure display, and parsed-layer reuse. Existing schema-v1
`chunks3d` and `orthogonal_slice_packs` sources still terminate at one decoded
volume-plane boundary.

Commit 6 compositing is implemented. Each volume render first retains the
registered anatomy slice, requires exact anatomy/volume `reference_space_id`
equality, and locates the scalar plane by applying the volume's declared
`world_to_index` matrix to the shared cursor. Half-index voxel-edge bounds
return explicit `out-of-grid`; no edge plane is clamped or fetched.

The Canvas is hosted in a scalar SVG layer sharing the registered anatomy
viewBox. Its four voxel-edge corners pass through `index_to_world_um` and the
projection's `world_to_plane_index`; this positions and flips the raw plane
without assuming equal grid resolutions. CSS nearest-neighbor paint is fixed,
while the retained anatomy SVG supplies outlines, guides, picking, hover, and
selection above it. A failed volume request leaves anatomy visible with an
explicit error.

Commit 6 is complete: background-capable screen/world/voxel inspection,
sentinel/mask validity classification and transparency, URL-persisted opacity
and outline controls, one active-feature decoded-memory budget, cancellation,
and consumer-aware in-flight deduplication are implemented. Presentation-only
changes remain fetch- and decode-free.

Commit 7 is complete: Summary, Top, and Swanson are URL-persisted secondary
tabs; the static maps share regional feature/anatomy coloring, all declared
parcellation IDs, hover, selection, and tooltips. Responsive secondary switching
and maximize/Escape restoration use the existing workspace state. Volume
features are explicitly anatomy-only on affine-free maps.

Q4 still blocks authoritative production volume geometry/outside semantics,
and Q5 still blocks the production transport choice. Use synthetic fixtures
until those questions are resolved; do not infer a production affine.

## Performance evidence

`just benchmark-anatomy` exercises cold indexed-pack navigation, another slice
in the same decoded pack, and a retained-layer revisit. The final 2026-08-22
Linux Chromium sanity run measured median cold commits of 19.8–31.8 ms,
same-pack commits of 5.0–12.7 ms, retained revisits of 1.6–2.1 ms, no long
tasks, and a 16.8 ms maximum frame gap. Full measurements, asset/bundle sizes,
and the earlier v3 and Commit 5 baselines are in
`docs/rendering/ANATOMY_NAVIGATION_PERFORMANCE.md`.

The checked-in real-volume browser evidence remains the 2026-08-20 transport
benchmark against the historical `2026_W12` object. Commit 8 could not repeat
it because neither the private source object nor prepared benchmark directory
is present in this checkout. Treat it only as physical-format evidence; Q4/Q5
still require the documented `2026_W26` object and eventual deployment origin.

## 3-D

The independent 3-D lab remains outside this viewport and the M2 acceptance
path. It may share reference-space and regional presentation contracts later,
but must not import or fork `AtlasApp`, dataset sessions, URL reducers, or 2-D
projection layers. See `docs/rendering/3D_EVALUATION.md`.

## Verification

- `just test-web` covers strict TypeScript, unit/rendering tests, and build.
- `just test-browser` covers user-visible regional and volume behavior.
- `just test-anatomy` covers v1/v2/v3 build evidence and projection-pack gates.
- `just benchmark-anatomy` and `npm run benchmark:real-volume` are explicit
  measurements, not default CI gates.

The cutover through Commit 8 is complete. The next rendering action is to
obtain the authoritative Q4 volume geometry/validity semantics and Q5 real-data
transport evidence before building Commit 9's production volume release.
