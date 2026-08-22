# Decision log

## D001 — Separate v2

Build v2 in this repository independently of the legacy `int-brain-lab/ephys-atlas-web`. Keep v1 deployable as fallback through launch.

## D002 — Frontend stack

Use TypeScript + Vite with plain web-platform UI code. Do not use React or another frontend framework by default.

## D003 — Launch dataset scope

Launch-critical: `ephys_atlas_channels`, `ephys_atlas_clusters`, `ephys_atlas_volumes`, `brainwide_map`, and `local`.

AGEA, MERFISH, and large point datasets can follow after launch.

## D004 — Statistics

Launch supports descriptive/basic statistics and visual comparison only. No inferential statistical tests are required. The design should permit more advanced tests later.

## D005 — Releases

Published dataset releases are immutable. Mutable aliases such as `latest` may point to an immutable release. The paper-facing default should resolve to an immutable publication snapshot.

## D006 — Legacy compatibility

Backward compatibility with old custom buckets/URLs is low priority because the existing site has had very limited use. Prefer a clean v2 contract. Keep v1 online temporarily rather than compromising v2 architecture.

## D007 — SVG slices

Reuse existing curated SVG assets where practical. Their manually tuned alignment is acceptable for display; document calibration explicitly and avoid treating it as canonical geometry.

## D008 — 3D

3D technology is undecided and explicitly renderer-agnostic. Datoviz is one candidate, not a requirement. 3D is lower priority than the regional/volume viewer and data pipeline.

Refined by D032 for the approved independent lab: Three.js WebGL2 is selected
for that prototype while the application-facing contract remains
renderer-agnostic.

## D009 — Publishing auth

Retain a capability-based publishing model for launch rather than introducing full user accounts/OAuth. Existing v1 auth should be studied and modernized rather than copied blindly.

## D010 — Canonical S3 sources versus browser transport

Treat the current `ea_active` S3 products as canonical scientific inputs for Ephys Atlas channel features and encoding volumes. Prefer direct HTTP/object-store consumption when the canonical object format meets browser performance, CORS, and access requirements. Do not require the browser to consume a canonical object directly if its physical layout causes excessive download, decode, or memory cost; in that case, derive a deterministic web-optimized representation with explicit provenance back to the pinned source object.

## D011 — Dynamic feature catalog

Do not hard-code the Ephys Atlas feature list into the frontend. The list may change with a new vintage before submission, so feature discovery, metadata, ordering, and availability must come from the dataset/release manifest or equivalent catalog.

## D012 — Development latest versus paper vintage

Development and staging may follow the latest available `ea_active` vintage. The paper-facing production release must pin an exact immutable source vintage and record it in provenance metadata.

## D013 — Volume geometry versus physical layout

Schema v0.1 keeps scientific volume geometry, dtype, axis order, and affine metadata independent of the browser storage layout. A volume release declares a physical `layout`; `chunks3d` is the current deterministic builder/reference layout and `orthogonal_slice_packs` is an allowed browser-optimized layout. Do not freeze 3-D chunks as the only launch transport until real-data browser benchmarks meet the rendering budgets.

## D014 — Frontend renderer boundary

The frontend-owned `SliceRenderer` / `SliceRenderModel` interface is the application boundary. SVG, volume, Canvas2D, and future 3-D implementations live below that facade. The lower-level rendering workstream must not introduce a competing application state or renderer facade.

Superseded by D031 for 2-D rendering and D032 for the higher-level 3-D
workspace seam. `SliceRenderer` is not a future 3-D integration boundary.

## D015 — One dataset contract for published and local data

Published HTTP releases and browser-imported local releases use the same schema-v0.1 manifest, feature metadata, regional binary arrays, statistics, and volume descriptors. Local storage changes transport only; it does not define a second scientific data format.

## D016 — Curated SVG identity versus navigation sampling

Treat the five deployed v1 curated SVG-fragment bundles as immutable display assets whose exact byte sizes, SHA-256 hashes, path counts, entry counts, and index coverage are pinned in the v2 repository. The orthogonal SVG bundles contain even indices only and therefore represent a display-downsampled anatomical layer. Preserve the full 10 um regional navigation/coordinate domains independently; the renderer may select the nearest curated display slice without changing URL state, scientific coordinates, or linked-guide state. Publish the exact pinned bytes into an immutable v2 asset location rather than regenerating them.

## D017 — Single-main development after integration

The parallel exploration phase is over. `main` is the sole active product-development branch and durable source of truth. Routine data, viewer, rendering, publishing, documentation, and release work proceeds sequentially on `main` with CI/`just check` as the integration gate. Do not maintain persistent `work/*` or `agent/*` product branches or require pull requests for this project's routine workflow unless the repository owner explicitly changes this policy.

## D018 — Scientific release choices are explicit inputs

Dataset builders must not inherit scientifically material defaults when those defaults could change the meaning or reproducibility of a release. In particular, raw versus denoised channel features, source vintage, population/QC recipe, paper-snapshot status, and authoritative volume geometry are explicit release inputs/metadata. If an authoritative choice is unresolved, test the machinery with synthetic/pinned fixtures and block the scientific production release rather than guessing.

## D019 — Left-hemisphere regional representation

Match the deployed atlas product by showing a canonical left-hemisphere
regional representation. Fold bilateral source atlas IDs with `-abs(id)` before
aggregation. This is a folded bilateral summary, not a claim that observations
were acquired only in the left hemisphere. Scientific payloads, selection, and
URLs use atlas IDs; the legacy SVG renderer alone translates those IDs to
BrainRegions row indices.

## D020 — Channel variants and value preservation

Publish raw and denoised channel values as distinctly identified feature
variants in one immutable release. Use the `inside` source population, exclude
non-finite observations per feature, and apply no additional physiological QC,
clipping, or silent alpha outlier replacement. Preserve source values and use
robust display ranges rather than mutating observations.

## D021 — Cluster population and weighting

Cluster regional features use all rows of `clusters.table.pqt`, not the
good-cluster subset. Every finite cluster contributes equal weight to its
left-folded region; there is no insertion balancing or hidden unit-QC filter.
The project/source snapshot and feature catalog remain explicit production
inputs and must not be defaulted by the builder.

## D022 — Atlas identity colors versus feature colors

Treat Allen ontology identity and scientific feature encoding as two explicit,
URL-persisted region-fill modes. `Allen anatomy` uses RGB, names, hierarchy, and
stable atlas IDs from the pinned `iblatlas` ontology metadata. `Feature values`
uses the selected statistic, colormap, scale, and range. Geometry providers do
not own this choice, and selection/hover styling remains independent of both.

The legacy SVG BrainRegions row crosswalk is a versioned display-domain input,
not the authority for names or colors. See
`docs/frontend/ALLEN_REGION_METADATA.md`.

## D023 — Registered generated anatomy is the runtime authority

Supersede D007 and D016 for the v2 runtime. Use immutable
`anatomy-pack-v1` geometry recomputed from the pinned Allen CCFv3 25 µm
annotation and LUT, restricted to the physical left hemisphere. Paths carry
negative signed Allen/Beryl/Cosmos atlas IDs directly. The native 25 µm grid
and declared row-major `[slice,u,v] -> [ml,ap,dv]` affines are authoritative for
slice coordinates and cross-projection guides. URL v2 stores native indices;
v1 10 µm links migrate by world coordinate.

The accepted pack is
`allen-ccfv3-25um-left-t15-4a565958b938`, generated at 15 µm GEOS coverage
simplification tolerance from clean commit `d5d60ca`. It passed complete-corpus
topology and source-voxel coverage gates with minimum eligible-region IoU 1.0
and a conservative 3.125 µm boundary-error upper bound. The legacy renderer
remains modular source code and the pinned v1 bundles remain documented, but
neither is active or fetched by default. Reversion is a normal code/config
revert, not a user-facing provider switch.

## D024 — Bilateral 10 µm anatomy and bounded navigation work

Supersede D023's active pack and navigation grid with the exact bilateral
`anatomy-pack-v2` artifact
`allen-ccfv3-10um-bilateral-exact-599b5e0bbab1`. URL v3 and the linked cursor
use its native 10 µm affines; URL v1 10 µm and URL v2 25 µm links migrate by
world coordinate. The signed atlas IDs preserve physical left and right
hemispheres while folded regional feature values continue to color the left
hemisphere and use ontology color as the right reference.

Ordinary navigation must keep work proportional to the interaction. Initial
display fetches only the three visible depth-16 packs. Wheel events are
coalesced to animation frames, unchanged projections update guides without
reloading or restyling geometry, URL writes are deferred during navigation,
and idle prefetch loads at most one pack in the active direction. Decoded
anatomy packs use a byte-bounded LRU; immutable pack URLs use browser caching.

## D025 — Retained SVG navigation and indexed-fragment experiment

Keep SVG as the regional anatomy representation. Preserve exact native 10 µm
indices in application state, URLs, coordinates, and linked guides, but make a
wheel navigation step four slices (40 µm); interactive display cadence need not
materialize every scientific index crossed by an input burst.

The active renderer retains up to eight parsed slice `<g>` layers per view and
reuses both their DOM nodes and region-path indexes on a warm revisit. Geometry
requests use a latest-only scheduler with at most one request in flight and no
artificial minimum start interval; superseded requests that have not started do
no source or DOM work. Picking, selection, coloring, and guide synchronization
remain within the existing `SliceRenderer` boundary and continue to use stable
SVG region attributes. A controlled browser benchmark showed that the former
40 ms interval delayed already-decoded and retained navigation enough to cap it
at roughly 25–30 frames per second.

Fetch and compressed-byte SHA verification remain in the anatomy source. A
persistent module worker receives the verified buffer by transfer and performs
gzip decompression, UTF-8 decoding, JSON parsing, and structural/affine
validation. The decoded pack is returned to the source's existing byte-bounded
LRU, so transport and worker details remain below `SliceRenderer`.

Prototype an indexed binary transport containing a fixed little-endian header,
projection/pack identity, fixed-width slice entries, and concatenated UTF-8 SVG
fragments. This format is experimental and is not an active anatomy-pack or
schema contract yet. Production adoption requires a complete-corpus builder,
manifest/SHA integration, worker/browser timing, memory measurements, and the
existing anatomy topology and coverage gates.

## D026 — Sparse indexed SVG anatomy display packs

Accept the indexed SVG transport from D025 as `anatomy-pack-v3`. SVG remains
the regional display and interaction representation. The canonical validated
`anatomy-pack-v2` remains the scientific parent: v3 copies selected SVG
fragments byte-for-byte and records the parent manifest SHA-256, source,
provenance, validation, and synchronization sentinels.

Application state, URL state, cursor coordinates, guides, and projection
affines remain on the exact native 10 µm grid. Interactive anatomy is a
separate explicit inventory sampled every 80 µm. Its lattice is anchored at
the native plane nearest fixed-axis world coordinate zero, so the inventory is
deterministic and aligned across rebuilds. Slider controls operate over display
ordinals and map them back to native indices before changing application state,
but the UI presents and announces the scientifically meaningful calibrated
ML/AP/DV coordinate rather than the implementation ordinal. Exact native
indices loaded from URLs resolve to the nearest displayed plane for geometry
only, with the lower native index winning a tie.

Use depth-eight gzip-compressed ISVG packs. Fetch and compressed-byte SHA
verification stay in the browser source. A persistent module worker owns a
byte-bounded LRU of decompressed indexed packs and sends only the requested
UTF-8 SVG fragment to the main thread. Worker eviction is reported to the
source so residency cannot become stale. The immutable v2 corpus remains the
fallback and derivation authority; v3 changes display sampling and transport,
not atlas geometry or scientific calibration.

## D027 — Layered browser responsibilities and open dataset identity

Organize browser dependencies inward around stable product concepts:

- `core` contains transport-, DOM-, and renderer-independent primitives;
- `domain` contains typed application state, actions, and reducers;
- `application` owns asynchronous dataset/release/feature workflows and stale
  work cancellation without depending on concrete UI or renderers;
- `data` owns release contracts, validation, transport-neutral
  materialization, caching, and resource adapters;
- `rendering` and `ui` remain outer implementations composed by the
  application root.

Dataset identifiers are opaque published identifiers at runtime, not a closed
frontend enum. The launch dataset list remains explicit product configuration,
while catalogs and manifests drive available releases, features,
representations, and parcellations.

HTTP and local/IndexedDB sources share format-level materializers through a
small resource-reader boundary. Transport adapters locate and read resources;
they do not duplicate schema-v0.1 regional or volume semantics. Preserve these
boundaries with focused dependency and cross-language contract tests rather
than a dependency-injection framework or a second scientific schema.

## D028 — IBL Core visual identity

Use the official 2026 IBL Core identity for the viewer. Vendor the complete
colored-negative SVG lockup from `iblcore.org` without editing its internal
geometry, colors, gradient, or proportions. Present it with the required clear
space on the viewer's dark header without a separate background block. Keep the
adjacent product name as accessible HTML rather than modifying the lockup.

Expose the institutional blue `#004D89`, cyan `#009FD7`, and magenta `#CE2C97`
as explicit brand tokens. Cyan is the primary interface accent, while magenta
is reserved for restrained brand emphasis. Branding must not override Allen
ontology identity colors, scientific feature colormaps, or categorical
selection identity colors governed by D022. Prefer Ubuntu Sans Condensed for
brand typography when an approved local font is available; do not introduce a
runtime font-CDN dependency.

See `docs/frontend/BRAND_IDENTITY.md` for the asset identity and usage rules.

## D029 — Browser history records scientific context checkpoints

Keep the versioned URL as the authoritative shareable view state, but do not
treat browser history as a general application undo stack. Explicit
user-committed dataset/release, feature, representation, and parcellation
changes create history entries. Cursor/slice navigation, region selection and
ordering, and color/statistic refinements replace the current entry. Runtime
loading state and local interface preferences do not write URL state.

View actions carry explicit history intent so an asynchronous derived change,
such as selecting the first valid feature after opening a dataset, can replace
the user-created dataset checkpoint rather than adding a second entry. A
context checkpoint first flushes pending debounced navigation into the prior
entry. Startup normalization and v1/v2 migration replace the current entry;
`popstate` hydrates the complete view without echoing another write. Back and
Forward therefore traverse meaningful scientific contexts while every current
URL remains reloadable and shareable.

## D030 — Selected-region comparison is a responsive tray

Present selected-region comparison as a nonmodal tray anchored above its
persistent launcher on desktop and tablet. Comparison is part of atlas
exploration rather than a blocking task: the region browser and scientific
views remain available, the workspace does not resize, and global shortcuts
remain active. Make the overlay state explicit through a distinct elevated
surface, accented top edge, selected-region count, short slide-up transition,
and visible minimize control. Preserve Escape dismissal and launcher focus
restoration.

On phones, present the same content as a modal bottom sheet with a backdrop,
because the reduced viewport cannot support simultaneous comparison and atlas
interaction reliably. Keep comparison data, export behavior, and selection
state identical across presentations.

## D031 — Pre-launch projection, volume, and schema reset

Use the repository's pre-alpha status to make one breaking architectural
cutover before production volume releases. There is no requirement to retain
runtime readers, validators, adapters, fixtures, or URL migrations for the
current schema v0.1, anatomy pack versions, legacy curated host, or pre-cutover
URL encodings. Update every producer and consumer coherently, regenerate
development/synthetic releases, and delete the superseded paths rather than
maintaining adapters.

Replace D014's `SliceRenderer` boundary with a retained layered 2-D projection
viewport. Coronal, sagittal, and horizontal are registered slice stacks that
can compose scalar-volume Canvas, regional-anatomy SVG, selection/hover, and
guide layers. Top and Swanson are static regional maps using the same SVG
presentation and interaction implementation without an affine, slice control,
crosshair, or volume capability. A projection registry and declared
capabilities drive desktop, secondary-slot, responsive, and focus behavior;
`SliceAxis` remains limited to the three scientific orthogonal axes.

One ML/AP/DV world cursor remains authoritative. Registered anatomy and volume
layers independently map it through their own declared transforms; an anatomy
slice index or display calibration must never stand in for volume geometry.
Volume transport remains independent from scientific geometry and is still
selected only by Q5 evidence. Q4 continues to block production affine and
outside/missing-value semantics.

Separate coordinate identity into `reference_space_id`, grid identity, and
asset/pack identity. Only an exact reference-space match permits compositing;
grids may differ in resolution, shape, and affine, and pack identity is never
scientific evidence. The launch affine profile is an axis-aligned signed
permutation with a homogeneous `[0, 0, 0, 1]` row, exactly one finite nonzero
spatial coefficient per row and column, integer indices at voxel centers, and
half-index voxel-edge extents. Validate or derive its inverse rather than
trusting two unrelated matrices.

Adopt one schema v1 for builders, browser HTTP/local data, publishing,
fixtures, and downloads. Retain the sound v0.1 concepts—dynamic feature
catalogs, independent representations, provenance, typed binary data, and
storage-neutral volume geometry—while making imminent volume requirements
strict: dedicated volume summary metadata, immutable encoded-resource indexes,
machine-readable validity/outside semantics, supported dtype/axis contracts,
and honest affine validation. Do not redesign transports without benchmark
evidence.

Expose all five 2-D views through one logical `atlas-projection-pack-v1`.
Registered orthogonal geometry retains the validated bilateral 10 um parent,
affines, sparse display evidence, hashes, and topology/coverage gates. Top and
Swanson use exact pinned curated source bytes with distinct provenance and are
normalized to the same Allen/Beryl/Cosmos path-identity contract at build time.
Validated older anatomy artifacts may remain as immutable reproducibility/build
evidence but are not supported browser formats after cutover.

Represent Top and Swanson as affine-free, deterministic gzip-compressed UTF-8
SVG fragment resources, not slice entries. Both use the legacy source view box
`60 20 340 300`; neither has a slice index or `world_coordinate_um`. Persist
workspace composition as three independent states: selected secondary tab,
active compact view, and maximized view.

Verify served bytes before decoding or persistent cache admission. Evict and
retry an invalid cached response, and key decoded resources by SHA-256 plus the
decoding contract so equal relative paths in different releases cannot alias.

This decision supersedes D014; the schema-version-specific parts of D013,
D015, and D027; the runtime compatibility/fallback portions of D023-D026; and
the URL-migration requirement in D029. Their scientific provenance,
immutability, coordinate, performance, public/local parity, and history-intent
principles remain in force. The complete execution and test plan is
`docs/rendering/PROJECTION_VOLUME_CUTOVER_PLAN.md`.

## D032 — Independent 3-D brain-mesh lab and web asset direction

Permit the brain-region 3-D view to iterate concurrently with D031 as an
isolated, non-production lab. Use a short-lived worktree and standalone Vite
entry, keep the lab outside `AtlasApp` and the 2-D projection viewport, and land
small reviewed green commits on `main`. Integration occurs only through the
higher-level `scene-3d` workspace-view discriminant, shared coordinate-space
identity, and regional presentation inputs. `ProjectionRegistry` remains a
2-D registry. This refines D008 without making 3-D launch-critical.

Use Three.js `WebGLRenderer`/WebGL2 for the first lab. This selects a low-risk
prototype implementation, not a renderer-specific application model; Datoviz
or WebGPU may be benchmarked later behind the same inputs. Do not extend or
embed the legacy Unity runtime.

Derive an immutable `atlas-mesh-pack-v1` from the pinned public IBL
`atlas/meshes.glb`, recording exact bytes/hash and validating identity,
coordinates, hemispheres, centroids, colors, and coverage against the canonical
bilateral 10 um Allen annotation/LUT. Split hemispheres offline using the
canonical grid boundary. Preserve signed Allen presentation IDs and
Allen/Beryl/Cosmos mappings; do not copy the hard-coded 25 um midline workaround
from `ibl-datoviz`.

The default web asset is deliberately lossy and screen-oriented: per-region
triangle decimation with small-region retention, 14-bit position and 8-bit
normal quantization, meshopt GPU-buffer compression, then deterministic gzip.
Keep one conservative default LOD and one optional higher LOD. Merge geometry
into a few chunks with per-vertex regional feature IDs; do not bake colors or
ship one request/draw call per region. Region colors, visibility, selection,
hover, bilateral feature/anatomy presentation, and explode vectors remain
dynamic.

Define genuine radial explode from canonical annotation centroids:
`translation = explode * (region_centroid - whole_brain_centroid)`, with
`explode` in `[0, 1]`. This deliberately differs from Unity's ten manually
placed Cosmos-parent vectors. Mapping changes do not change fine geometry or
require a download.

Load a tiny manifest first, then one union default-LOD resource when 3-D opens;
an optional low-priority prefetch may run only after critical 2-D work and must
respect reduced-data/network signals. Load the higher LOD as one second
immutable resource only on sustained or maximized use and swap atomically.
Verify served bytes before decode/persistent caching. Do not use hundreds of
region requests, and do not ship the full-resolution source GLB initially.

Future volume rendering is a separate asset and renderer workstream. It may
share coordinate-space identity and a global download/cache budget but does not
change this mesh transport decision. Evidence, measured budgets, and promotion
gates are in `docs/rendering/3D_EVALUATION.md`; final production promotion and
LOD acceptance remain Q12.
