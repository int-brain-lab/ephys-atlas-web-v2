# Rendering status and handoff

Status: current supporting summary. The authoritative implementation state,
decisions, and task order are `docs/INTEGRATION_STATUS.md`,
`docs/DECISIONS.md`, and `docs/IMPLEMENTATION_PLAN.md`.

## Application boundary

`web/src/rendering/projection-viewport.ts` owns the application-facing 2-D
boundary. `AtlasApp` provides a `ProjectionRenderModel` containing one axis,
derived native slice, world cursor, parcellation, and active feature. A shared
`ProjectionViewportFactory` owns presentation and interaction sinks and creates
one retained `ProjectionViewport` per registered frame.

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
The static maps are deliberately hidden until Commit 7 and must never be
presented as scientific or licensing evidence. Rebuild it with
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

Volume display is intentionally still exclusive in the current handoff. The
next unit, Commit 6, must load anatomy and volume independently into the same
viewport, require matching `reference_space_id`, register each through its own
transform, preserve anatomy when volume fails, and implement the specified
nearest-neighbor screen/world/voxel inspection path. Opacity and outline-only
changes must repaint without fetching or decoding.

The first Commit 6 slice is implemented: orthogonal volume planes are located
by applying the declared `world_to_index` matrix to the shared world cursor.
Voxel-edge bounds return an explicit `out-of-grid` result; the runtime no
longer clamps an outside cursor to an edge plane or fetches that plane.

Q4 still blocks authoritative production volume geometry/outside semantics,
and Q5 still blocks the production transport choice. Use synthetic fixtures
until those questions are resolved; do not infer a production affine.

## Performance evidence

`just benchmark-anatomy` exercises cold indexed-pack navigation, another slice
in the same decoded pack, and a retained-layer revisit. The 2026-08-22 Linux
Chromium sanity run measured median cold commits of 10.0–13.4 ms, same-pack
commits of 1.4–2.7 ms, retained revisits of 0.6–1.0 ms, no long tasks, and a
16.8 ms maximum frame gap. Full measurements and the earlier v3 baseline are
in `docs/rendering/ANATOMY_NAVIGATION_PERFORMANCE.md`.

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

The immediate next action is Commit 6 in
`docs/rendering/PROJECTION_VOLUME_CUTOVER_PLAN.md`.
