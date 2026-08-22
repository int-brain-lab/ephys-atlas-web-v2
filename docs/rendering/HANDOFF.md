# Rendering status and handoff

Status: current supporting summary. The authoritative implementation state,
decisions, and task order are `docs/INTEGRATION_STATUS.md`,
`docs/DECISIONS.md`, and `docs/IMPLEMENTATION_PLAN.md`.

## Application boundary

`web/src/rendering/interfaces.ts` owns the application-level `SliceRenderer` /
`SliceRenderModel` boundary. Regional SVG, generated anatomy, volume Canvas2D,
legacy fallback, and future 3-D details stay below it. Renderer implementations
must not introduce separate application state or infer scientific transforms
from display calibration.

This is current implementation state, not the next target. D031 and
`docs/rendering/PROJECTION_VOLUME_CUTOVER_PLAN.md` approve a coordinated
breaking replacement with one retained layered projection viewport, schema v1,
and a five-projection pack. Do not extend the current facade or add compatibility
adapters while executing that cutover.

## Active regional anatomy

The default renderer uses sparse indexed-SVG `anatomy-pack-v3` with immutable
pack ID
`allen-ccfv3-10um-bilateral-exact-599b5e0bbab1-display-80um-d8-f8277956e67a`.
Its 407 display planes are copied byte-for-byte from the validated bilateral
10 µm v2 parent. Scientific cursor, URL, affine, signed atlas-ID, and guide
state stays on the parent's 3,260-slice grid; only displayed geometry snaps to
the nearest 80 µm inventory plane.

Compressed bytes are fetched and SHA-256 verified by the anatomy source. A
persistent worker decompresses indexed packs, retains a byte-bounded LRU, and
returns only the requested UTF-8 fragment. Each view retains eight parsed SVG
layers. The default page does not fetch the legacy atlas host or curated v1
bundles.

Normative and measured evidence:

- `docs/rendering/BILATERAL_ANATOMY_PACKS.md` — canonical v2 parent;
- `docs/rendering/ANATOMY_PACK_V3_CONTRACT.md` — sparse derivation and runtime
  contract;
- `docs/rendering/ANATOMY_NAVIGATION_PERFORMANCE.md` — controlled Chromium
  measurements;
- `docs/frontend/LEGACY_CURATED_ASSETS.md` and
  `docs/rendering/SVG_CALIBRATION.md` — inactive historical fallback only.

The next anatomy work is deployment-origin validation under M6/M7: serve the
committed v3 `.isvg.gz` bytes without HTTP `Content-Encoding`, verify immutable
URLs/cache headers/SHA checks, and record throttled network and wheel-burst
behavior.

Commit 4 of D031 also implements `tools/projection_pack/`: a deterministic
five-view pack builder and complete graph validator. It verifies the v3/v2
scientific evidence and copies orthogonal indexed-SVG bytes losslessly into
schema-v1 resources. It sanitizes Top/Swanson to canonical path-only fragments
with stable Allen/Beryl/Cosmos IDs. `just projection-pack-validate <path>`
checks every transitive compressed resource and rejects undeclared files.
Production static generation requires exact pinned bytes plus explicit Q13
license evidence; only synthetic static inputs are exercised today.

## Volume rendering

The browser implements both schema-v1 physical layouts through explicit,
checksummed resource indexes:

- `chunks3d` through a bounded chunk LRU and canonical slice assembly;
- `orthogonal_slice_packs` with float16/float32 decoding, optional gzip,
  in-flight deduplication, adjacent prefetch, and a bounded decoded LRU.

Both terminate at the same storage-neutral volume slice boundary and render via
Canvas2D. Declared storage-axis permutation and `index_to_world_um` drive
mapping; generated or legacy SVG calibration never does.

The older `2026_W12` 25 µm benchmarks favor slice packs, and implemented
Chromium evidence currently favors depth four. These are transport results,
not scientific geometry. New production work must use the documented private
`2026_W26` 50 µm object, obtain the authoritative affine/outside semantics
under Q4, and confirm layout against representative features plus the final
HTTP/CDN origin under Q5. See `docs/rendering/VOLUME_ARCHITECTURE.md` and
`docs/DATA_SOURCES.md`.

## 3-D

`web/src/rendering/scene3d.ts` retains a technology-neutral scene contract, but
3-D is deferred and renderer choice remains open. Do not add a large 3-D
dependency until the launch-critical regional, volume, data, and deployment
paths are secure. Historical candidate evidence is in
`docs/rendering/3D_EVALUATION.md`.

## Verification

- `just test-web` covers strict TypeScript, unit/rendering tests, and build.
- `just test-browser` covers user-visible anatomy and volume paths.
- `just test-anatomy` covers v1/v2/v3 contracts, generators, integrity, and
  comparison gates.
- `just benchmark-anatomy` and `npm run benchmark:real-volume` are explicit
  measurement commands, not default CI gates.

Production scientific and transport blockers remain Q4-Q5; production origin
and cross-browser release checks remain Q8 and Q11.
