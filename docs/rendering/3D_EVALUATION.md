# 3-D brain-mesh evaluation and implementation plan

Status: **approved independent non-production lab (2026-08-22)**. Production
promotion remains optional and is tracked by Q12.

This document is the focused handoff for iterating on a browser 3-D view in
parallel with the projection/volume cutover. It records inspected IBL assets,
exploratory compression measurements, the first implementation contract, and
the boundary that prevents the lab from becoming a second application.

## Product outcome

The first useful lab must show Allen brain-region surface meshes with:

- Allen, Beryl, and Cosmos mapping choices;
- the same signed bilateral regional identity and colors as the 2-D views;
- feature colors on the left hemisphere and anatomical colors on the right by
  default;
- per-region visibility, hover, selection, and picking;
- orbit/arcball camera controls;
- a continuous genuine radial explode control;
- fast loading and interaction in a typically small 3-D viewport;
- explicit asset provenance, integrity, coordinate identity, and failure
  behavior.

Point clouds and volume rendering are not part of the first lab. The scene
contract may remain extensible to points. Volume rendering later shares the
scientific coordinate space and a global download/cache policy, not this mesh
encoding or implementation schedule.

## Evidence from existing IBL projects

### Public region mesh scene

`../ibl-datoviz/ibl_datoviz/meshes.py` downloads
`atlas/meshes.glb` from the public IBL brain-wide-map bucket and loads geometry
named `<positive Allen ID>.obj`. The inspected object is:

- URL:
  `https://ibl-brain-wide-map-public.s3.us-east-1.amazonaws.com/atlas/meshes.glb`;
- byte size: `96,622,012`;
- SHA-256:
  `487a72172249acd4dba5b40c392fa8eb065b09bc8638f3195163c4cbf8f569db`;
- GLB 2.0 with 840 region meshes, 1,864,235 vertices, and 3,678,546
  triangles;
- vertex positions in CCF `(AP, DV, ML)` micrometres;
- vertex colors that match the inspected legacy and current canonical ontology
  colors for every shared source ID.

This source is suitable pinned geometry input. It is not a suitable production
web transport: it is monolithic, full resolution, unsigned/bilateral, and does
not contain the integrity, LOD, mapping, centroid, or coordinate metadata the
viewer requires.

The active projection corpus contains 672 absolute Allen, 307 Beryl, and 11
Cosmos IDs, or 741 unique absolute IDs. The source GLB covers 740 of those 741.
Allen 545 (`RSPd4`) is absent; the legacy ontology marked it as non-existing,
while the canonical current 10 um projection corpus contains it. A production
mesh pack must generate and validate this surface from the canonical annotation
or record an authoritative exclusion. The lab must not silently omit it.

### Coordinates and hemispheres

The mesh source uses CCF `(AP, DV, ML)` micrometres. Convert it once during the
offline build to the browser's IBL `(ML, AP, DV)` micrometre space:

```text
ml_um = ccf_ml - 5739
ap_um = 5400 - ccf_ap
dv_um = 332 - ccf_dv
```

The mesh manifest must name an exact coordinate-space ID rather than relying on
the unit/axis prose alone. The builder validates the transform and signed
hemisphere assignment against the canonical bilateral 10 um annotation and
LUT. Negative ML is left and positive ML is right.

`ibl-datoviz` currently slices hemispheres using a hard-coded CCF ML value of
5695 described as a 25 um workaround. Do not copy it. Split/cap source meshes
offline at the boundary derived from the canonical grid, and validate the
resulting signed IDs and extents.

### Legacy Unity behavior

The inspected `../atlas` checkout contains the tracked `Build/`,
`StreamingAssets/`, and `Unity/Assets/` trees. `js/unity.js` sends acronym,
color, visibility, and exploded-percentage strings through Unity
`SendMessage`. `Unity/Assets/Scripts/MiniBrainManager.cs` moves every fine
region by one of ten manually placed Cosmos-parent vectors and mirrors that
vector for the other hemisphere. It computes Cosmos mesh centers but does not
use them for the translation.

The lab deliberately does not reproduce that grouping. It defines genuine
per-region radial displacement from canonical annotation centroids:

```text
translation(region) = explode * (region_centroid - whole_brain_centroid)
explode in [0, 1]
```

Centroids come from the canonical annotation, not from the decimated mesh, so
changing LOD cannot move a region. The vertex shader applies the translation;
the geometry buffers do not need rebuilding when the slider moves.

## Renderer decision

Use Three.js `WebGLRenderer`/WebGL2 for the first lab. `GLTFLoader`,
`OrbitControls`, meshopt decoding, buffer attributes, and ray/ID picking cover
the required initial surface with the least project-owned graphics machinery.
Keep Three.js below technology-neutral scene, state, and interaction inputs.

Three.js `WebGPURenderer` remains a later benchmark because its API/backend is
still a higher-change surface than the established WebGL renderer. Datoviz
WebGPU/WASM remains a credible later alternative for dense scientific scenes,
but its scene ABI and build/runtime surface are unnecessary for the first mesh
view. A custom WebGPU implementation and an extended Unity integration are not
approved for this lab.

Official implementation references:

- Three.js GLTFLoader:
  `https://threejs.org/docs/#examples/en/loaders/GLTFLoader`;
- meshoptimizer glTF pipeline:
  `https://github.com/zeux/meshoptimizer/blob/master/gltf/README.md`;
- meshoptimizer compression and simplification:
  `https://github.com/zeux/meshoptimizer`.

## Web mesh-pack contract

Create one immutable `atlas-mesh-pack-v1` manifest. It records:

- pack ID, format/version, creation tool/version/commit, and deterministic build
  command;
- source GLB URL, byte size, SHA-256, and geometry inventory;
- canonical annotation/LUT identities and hashes used for coordinate,
  hemisphere, mapping, centroid, color, and coverage validation;
- coordinate-space ID, source/output axes, units, transform, handedness, and
  canonical brain center;
- one record per geometry identity: positive source Allen ID, signed
  presentation ID, Allen/Beryl/Cosmos mapping membership, hemisphere,
  canonical centroid, bounds, vertex/triangle counts, and LOD presence;
- each LOD's simplification/quantization parameters, encoded and decoded byte
  sizes, SHA-256, and meshopt decoder contract;
- validation totals for active IDs, components, nonempty geometry, bounds,
  mapping/color equality, and deterministic rebuilds.

Use the union of geometry needed by the current Allen/Beryl/Cosmos mappings so
mapping switches do not fetch geometry. Merge geometry into one or a few
GPU-friendly primitives with a per-vertex `_FEATURE_ID_0` that indexes the
manifest region/hemisphere table. Keep source IDs and mapping tables explicit;
do not infer presentation identity from mesh order.

Do not bake colors. Upload compact palette/visibility/selection/explode lookup
textures or buffers keyed by feature ID. This avoids hundreds of draw calls,
keeps feature recoloring cheap, and lets picking return the same signed regional
identity consumed by the 2-D presentation path.

Serve deterministic `.glb.gz` resources as opaque bytes without HTTP
`Content-Encoding`. The browser verifies the declared served-byte size and
SHA-256, decompresses explicitly, passes meshopt data to `GLTFLoader` with
`setMeshoptDecoder`, and only then admits verified bytes to persistent cache.
Content-hashed immutable URLs make repeat visits cacheable.

## Lossy geometry and measured budgets

The useful size reduction has three layers:

1. triangle decimation is intentionally lossy and provides the largest saving;
2. position/normal quantization is mildly lossy; use 14-bit positions and 8-bit
   normals for the first visual review;
3. meshopt coding and outer gzip are lossless after quantization.

Prefer meshopt to Draco for this first pack. The measured files are already
small, meshopt preserves GPU-friendly vertex/index ordering, decodes directly
to GPU-ready buffers, and preserves the custom feature-ID attribute.

An exploratory `gltfpack` 1.2.0 run measured the 740-mesh mapping union before
the missing Allen 545 surface is added. Its extracted position/index payload
was 57,257,140 bytes with 2,158,754 triangles. Results below use 14-bit position
quantization and gzip; they are planning evidence, not accepted production
artifacts:

| target triangles | triangles | gzip bytes | approximate transfer |
| ---: | ---: | ---: | ---: |
| 100% | 2,158,754 | 6,860,109 | 6.86 MB |
| 25% | 539,094 | 1,926,804 | 1.93 MB |
| 15% | 323,044 | 1,219,757 | 1.22 MB |
| 10% | 216,478 | 862,392 | 0.86 MB |

Use 15% as the first default-LOD target and 25% as the optional high-LOD
target. Allowing for signed/mapping metadata, the generated missing surface,
and small-region retention, budget approximately:

| LOD | intended use | transfer budget | decoded CPU buffer budget |
| --- | --- | ---: | ---: |
| default, about 15% | ordinary embedded view | 1.3-1.6 MB | <= 6 MB |
| high, about 25% | maximized or sustained use | 2.0-2.5 MB | <= 10 MB |

Do not initially publish a browser full-resolution LOD.

Global permissive simplification is not a valid production builder. The
exploratory run dropped tiny source meshes, including active Allen 911. Build
and validate per region/hemisphere, retain every active nonempty identity, set
minimum triangle/component rules, and fall back to a less aggressive ratio for
small or topology-sensitive regions. Review silhouettes and picking at actual
320, 480, and 800 px viewport sizes. Record Hausdorff/surface error or an
equivalent geometric bound in addition to visual review; triangle ratio alone
is not an acceptance criterion.

## Download and cache behavior

3-D never blocks initial application or 2-D interactivity:

1. load only the small mesh manifest during 3-D discovery;
2. after critical 2-D work, the application may low-priority prefetch the one
   default union LOD when network conditions allow; respect `saveData`, reduced
   data preferences where available, slow connections, and a shared byte
   budget;
3. when the user opens 3-D, fetch the default LOD in one immutable request if
   it is not already cached;
4. switch Allen/Beryl/Cosmos, colors, visibility, selection, hover, and explode
   entirely from local lookup data;
5. after the view remains open or becomes maximized, fetch the high LOD in one
   second immutable request and swap only after verification, decode, and GPU
   upload succeed;
6. on failure, keep the current LOD or show an isolated 3-D error; never impair
   the 2-D viewer.

Do not fetch region-by-region. Hundreds of files increase request scheduling,
cache metadata, failure modes, and draw-call pressure without helping a first
view that normally displays most of the brain. If a later full-detail workflow
needs selective loading, benchmark a small number of spatial/coarse bundles or
byte ranges rather than one object per region.

## Scene and presentation boundary

The current `Renderer3DScene`/`Renderer3DState` types are an exploratory seed,
not the complete production contract. Before the lab, revise them so geometry
loading is independent from dynamic state and the scene declares coordinate
identity. The technology-neutral inputs need at least:

```ts
interface BrainScene3DState {
  mapping: 'allen' | 'beryl' | 'cosmos';
  regionColors: ReadonlyMap<number, string>;
  visibleRegionIds: ReadonlySet<number>;
  selectedRegionIds: ReadonlySet<number>;
  highlightedRegionId: number | null;
  explode: number;
  camera: OrbitCameraState;
}
```

Regional IDs in presentation state are signed. The same
`RegionalPresentationResolver` eventually supplies colors, visibility,
selection, and hover to SVG and 3-D applicators. The lab may use deterministic
synthetic values behind that input while M2 is moving, but it must not create a
second dataset session, URL codec, colormap implementation, or regional
semantics.

## Independent iteration workflow

The repository owner has authorized a short-lived isolated worktree for this
lab. It is a development convenience, not a second integration branch.

- Put the standalone entry/controller/styles under
  `web/experiments/brain-mesh-3d/`, exposed locally as `/3d-lab/` by a dedicated
  Vite script/config.
- Put reusable technology-neutral contracts, verified pack loading, and Three.js
  rendering modules under `web/src/rendering/3d/`.
- Put deterministic mesh tooling and schemas under focused
  `tools/mesh_pack/`, `schema/`, and fixture paths; never commit the 96.6 MB
  source download or generated production packs.
- Do not import `AtlasApp`, `AppShell`, projection viewport implementations,
  dataset sessions, or main-app styles into the lab.
- Add Three.js and meshopt dependencies in one early, coordinated lockfile
  commit. Rebase the worktree frequently and land small green vertical slices
  on `main`; do not accumulate a long-lived merge.
- Keep `just check` green. Add a focused `just dev-3d`, deterministic builder
  tests, rendering unit tests, and a small Playwright lab suite as the slices
  land.

This path permits camera, lighting, LOD, explode, and picking iteration while
the main refactor changes application composition. Final integration should be
small: register a `scene-3d` workspace descriptor, map shared presentation state
to `BrainScene3DState`, and persist only approved view/camera/explode state in
the current URL codec.

## Promotion measurements and acceptance

Record the same fixture on representative desktop Chromium and at least Firefox
and Safari:

- encoded and verified bytes per LOD;
- fetch, explicit gzip, meshopt decode, GPU upload, and first-frame latency;
- draw calls, triangle/vertex counts, JS decoded bytes, and estimated GPU
  memory;
- orbit/zoom frame timing in embedded and maximized sizes;
- palette/visibility/explode update latency without geometry rebuild;
- picking latency and signed-ID correctness;
- default-to-high atomic swap and failure fallback;
- cold, warm HTTP-cache, and persistent-cache behavior.

The lab slice is complete when:

- every active signed region is present or explicitly blocked by Q12;
- source, coordinate, mapping, centroid, color, compression, and output hashes
  validate deterministically;
- the default LOD meets the small-view visual review and interaction remains
  responsive on target browsers;
- mapping/color/explode changes fetch no geometry and rebuild no mesh buffers;
- default loading is one request, high loading is at most one additional
  request, and 2-D remains usable under every 3-D failure;
- the standalone lab and reusable modules are tested and `just check` is green;
- main-workspace promotion remains a separate explicit Q12 decision.
