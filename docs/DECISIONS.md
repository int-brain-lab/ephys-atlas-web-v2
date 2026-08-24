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

## D033 — URL v4 and independent workspace state

Implement D031's pre-launch URL reset as one v4 codec. Persist the ML/AP/DV
world cursor directly and derive native anatomy indices, sparse display
ordinals, coordinates, guides, and renderer compatibility inputs. Do not store
an independently mutable slice triple.

Keep `secondaryTab`, `activeCompactView`, and `maximizedView` as three distinct
typed state dimensions. A secondary tab is content within the secondary slot;
the secondary slot is a workspace view; maximization does not change either
selection. The enabled projection registry initially contains only coronal,
sagittal, and horizontal so this state refactor does not expose unfinished
Top/Swanson views.

Treat any URL version other than v4 as unsupported and reset the complete view
to current defaults before replacing the location with a canonical v4 URL. Do
not partially consume old `slices` or other stale fields, and do not retain the
v1/v2/v3 migration stack. This implements the URL portion of D031 and
supersedes D029's migration behavior and D024's URL-v3 runtime requirement.

## D034 — Projection-pack derivation and complete validation

Use `allen-ccf-2017` as the local reference-space identity and
`allen-ccf-2017-10um` as the registered grid identity for the canonical
bilateral anatomy carried into `atlas-projection-pack-v1`. These identifiers
name the already validated v2 geometry; they do not replace its source hashes,
affines, topology, coverage, or synchronization evidence. Convert the legacy
v3 display `slice_shape` height/width order explicitly to schema v1's
`[slice, u, v]` affine order and derive the inverse and voxel-edge extent from
the forward signed-permutation matrix.

Registered v1 descriptors point to gzip-compressed
`atlas-registered-svg-resource-index-v1` documents. A pack is valid only when
its manifest, three indexes, every transitive indexed-SVG/static resource,
decoded inventories, and exact declared file graph validate together.
Top/Swanson normalization accepts paths only and resolves legacy row indices
through the pinned Allen/Beryl/Cosmos catalog. Production mode requires exact
pinned source bytes and explicit Q13 license evidence; synthetic mode remains
clearly test-only and is not a scientific release.

## D035 — Atomic retained projection-viewport boundary

Replace the application-level `SliceRenderer` and hybrid switch atomically
with one `ProjectionViewportFactory` and one retained `ProjectionViewport` per
registered frame. A viewport owns a stable scalar Canvas, regional SVG, guide,
interaction, and error layer stack. It accepts the one world cursor and derived
native slice rather than a separately mutable slice triple. Revisioned
latest-only scheduling permits at most one geometry request in flight, skips
superseded pending work, and prevents stale completions from committing.

Use `ProjectionPackSource` as the sole browser regional-geometry source. It
consumes `atlas-projection-pack-v1`, verifies immutable encoded resources
before persistent cache admission, and retains worker-owned indexed-SVG decode
and bounded parsed-layer caches. Delete legacy curated/anatomy-pack browser
readers, crosswalks, and renderer facades; keep v2/v3 artifacts only as
validated projection-pack build and reproducibility evidence.

The checked-in web fixture may combine validated registered geometry with
deterministic synthetic Top/Swanson paths so the complete graph can be tested.
Those static resources remain hidden until the shared static workspace work and
must never be described as production, scientific, or licensing evidence.

## D036 — Affine-registered volume composition preserves anatomy

Composite scalar planes only when their volume grid and the registered anatomy
projection declare the exact same `reference_space_id`; grid or asset identity
is not compatibility evidence. Perform this check before fetching plane bytes.
Map the raw plane's half-index voxel-edge corners through its
`index_to_world_um` affine and the projection's `world_to_plane_index` affine,
then place and orient a nearest-neighbor Canvas in an SVG layer sharing the
anatomy viewBox. Keep the retained regional SVG above it for outlines, guides,
picking, hover, and selection.

Load anatomy independently and preserve it with an explicit error if volume
compatibility, extent, integrity, or loading fails. The deterministic golden
volume declares a small Allen CCF 2017 subgrid so the composition machinery is
exercised, but its values remain synthetic and scientifically meaningless.

## D037 — Integrate 3-D through context content and a sibling viewport

Promote the completed brain-mesh experiment into the main application as an
optional, visibly experimental context view while production assets remain
gated by Q12. Treat the frozen experiment branch as donor evidence and rebuild
reviewed vertical slices on current `main`; do not bulk merge its stale
cutover-era application and documentation changes.

Place `brain-3d` inside the existing secondary/context slot through a
discriminated content registry. Keep the four workspace layout slots and the
2-D `ProjectionRegistry` unchanged. A retained `BrainScene3DViewport` and
factory are siblings of the retained projection viewport boundary; do not add
a combined renderer facade. `AtlasApp` remains the composition root and maps
the one dataset session, regional presentation, selection, hover, and URL store
to both boundaries.

Converge the experiment's placeholder and EAM3 lab manifests into one strict
`atlas-mesh-pack-v1` producer/validator/consumer contract before application
wiring. Load it through the existing verified immutable resource machinery,
worker decode, a byte-bounded decoded cache, and complete lifecycle disposal.
Upload merged hemisphere geometry once per LOD; mapping, color, visibility,
selection, hover, and explode must not rebuild geometry buffers or fetch bytes.

Persist optional explode and a complete renderer-neutral position/target/up
camera pose as backward-compatible URL-v4 fields. Keep LOD, loading, hover, and
GPU state runtime-only. The manifest chooses the default and optional upgrade
LOD. Volume features are anatomy-only in 3-D. Production publication, final
LOD, scientific exclusions, and removal of the experimental label remain Q12.

The complete ownership, contract, commit order, tests, stop conditions, and
donor-retirement protocol are in
`docs/rendering/3D_INTEGRATION_PLAN.md`.

## D038 — Freeze clusters from the BWM project and preserve the legacy BWM product

Use the current `ibleatools` frozen project
`ibl_neuropixel_brainwide_01` as the launch source namespace for
`ephys_atlas_clusters`. Build from every row of a content-addressed snapshot of
`cells_aggregates/clusters.table.pqt`, retaining D006's equal-cluster,
feature-wise finite population with no good-unit filter or insertion
balancing. The S3 project prefix is not an immutable release identity: the
puller must record every source object and hash and derive the release identity
from the fetched contents.

Review the 14 scalar features historically exposed by the atlas cluster path
as the initial launch-catalog candidate: `amp_max`, `amp_min`, `amp_median`,
`amp_std_dB`, `contamination`, `contamination_alt`, `drift`,
`missed_spikes_est`, `noise_cutoff`, `presence_ratio`,
`presence_ratio_std`, `slidingRP_viol`, `spike_count`, and `firing_rate`.
Before freezing that catalog, produce a source audit of column presence, dtype,
units, finite/missing counts, ranges, and distributions for human review.
Waveform, ACG, STPC, and STLFP arrays are not launch regional features.

Define the launch `brainwide_map` dataset as a faithful schema-v1 preservation
of the v1 website's five Beryl-only regional analysis families: `choice`,
`feedback`, `stimulus`, `wheel_speed`, and `wheel_velocity`. Pin and checksum
the five existing Parquet inputs and the v1 `generate.py` implementation at
commit `1d908bea095be2616a750d939d143f3b4db2a641`. Preserve the legacy feature
values and aggregation/significance semantics through equivalence fixtures;
do not silently reinterpret this snapshot as a regeneration from a newer BWM
paper release. A later scientifically refreshed BWM product requires a new
immutable release and explicit decision.

## D039 — Review smoothing against pinned anatomy images and complete metrics

The anatomy smoothing lab is a pre-release visual investigation whose output
is evidence, not an automatic production cutover. Compare every candidate with
the exact bilateral 10 um label geometry and with a separately pinned,
SHA-256-verified Allen 10 um average-template intensity volume on the same
grid. The report must offer anatomy-only, exact-over-anatomy,
candidate-over-anatomy, exact/candidate overlay, blink, side-by-side, and
magnified modes. It may also show the exact annotation-label raster as a
registration diagnostic. Image contrast, opacity, and stroke controls are
presentation aids and never scientific metrics.

Human review chooses a shortlist. Eligibility still requires deterministic
topology, coverage, label, component/hole, adjacency, source-voxel, IoU,
area-change, and boundary-error evidence. Report raw SVG, gzip-9, optional
Brotli, vertex/path/ring complexity, generation time, and representative
browser parse/render/picking measurements per candidate. A shortlisted
configuration must then pass the complete 3,260-plane corpus and report actual
407-plane sparse-pack sizes and worst slices/regions before a separate
promotion decision may replace the active presentation asset.

## D040 — Stage static delivery on S3/CloudFront and use a manual cross-browser gate

Use IBL-owned S3 as the immutable object store and CloudFront as the preferred
HTTPS/browser delivery boundary for staging and production scientific
releases, projection packs, mesh packs, and catalogs. Keep immutable objects
on content/release-specific keys with long-lived immutable caching; keep
catalogs and mutable aliases separate with appropriate short-lived caching.
Use an S3 REST origin with controlled bucket access rather than relying on an
HTTP-only S3 website endpoint. Configure and verify CORS, MIME types, opaque
gzip serving, byte sizes, SHA-256 values, and cache behavior at the actual
origin before launch. Exact bucket, distribution, domain, and alias names
remain deployment inputs under Q8. Do not access or modify the existing
`iblviz` EC2 host without explicit repository-owner permission.

Treat depth-four orthogonal slice packs as the primary Q5 production candidate,
while retaining both schema-v1 transports until representative `2026_W26`
features pass browser/HTTP measurements at the selected CloudFront origin.
This recommendation does not by itself resolve Q5.

For initial launch downloads, artifact URLs and current-feature/context-rich
exports are sufficient. Polished whole-release packaging and broader local
dataset management may follow without blocking launch. Keep automated
Chromium Playwright as the continuous browser gate and complete a documented
manual Firefox and Safari matrix for release sign-off; automated
Firefox/WebKit CI is not required for launch.

## D041 — Approve the 3-D scientific scope and fail closed on source mismatch

For the optional 3-D context, use deepest-active descendants of the Allen 8
`grey` root. Record Allen 545 (`RSPd4`) as an explicit unavailable-source
exclusion, accept Allen 898 as the one reviewed open-midline source exception,
and preserve nullable Beryl/Cosmos mappings. The repository owner approved
these four choices on 2026-08-22. This resolves those parts of Q12 only; it does
not select final LODs, approve publication, or remove the experimental label.

Derive active inventory from the exact active sparse projection pack and derive
region, whole-brain, and explode centroids from the canonical bilateral 10 um
LUT. Fail candidate generation when canonical centroids lie outside source
surface bounds. The first exact-input audit found four failing signed surfaces
across Allen 927, 526322264, and 599626923, with a maximum axis discrepancy of
109.447 um. Do not clamp, substitute mesh centroids, or mark bounds validation
green. Reconcile or regenerate the affected source geometry before production
promotion.

The repository owner subsequently approved deterministic regeneration from the
same canonical bilateral 10 um annotation for the complete bilateral source
identities of positive Allen 927, 526322264, and 599626923. Regenerate both
hemispheres for each ID so provenance is not mixed within a source identity;
leave every unaffected identity pinned to the GLB. This approval is local-only
and does not authorize smoothing/manual repair, additional IDs, final LOD
selection, publication, a default descriptor, removal of the experimental
label, or donor retirement. The binding handoff is
`docs/rendering/3D_PROMOTION_REVIEW.md`. D042 subsequently supersedes this
regeneration direction.

## D042 — Freeze 3-D anatomy to the complete GLB-derived lab resource

Supersede D041's canonical-annotation regeneration direction. The optional 3-D
view exists only to show the Allen region surfaces supplied by the pinned
public `atlas/meshes.glb`; it is not a geometric representation of an ephys
feature volume and is not required to match the separately generated 2-D
projection inventory region-for-region. Missing or unilateral GLB geometry is
recorded as source provenance and is not synthesized from annotation voxels.

Select the frozen donor lab's `source.eamh.gz` compiled-full resource as the
geometry and LOD evidence baseline: 4,958,039 served bytes, SHA-256
`658d68d81619ef83f7dbd6b032533ecd751fb52d3e7dd734dc90b1086b95baaa`,
989,811 triangles, and 1,130 signed surfaces derived from 566 deepest-active
grey-matter GLB objects. It retains every triangle after the already-reviewed
product scope, exact ML=0 bilateral cut, and planar midline caps. Its 14-bit
position and 8-bit normal quantization plus meshopt/gzip transport remain
accepted; triangle decimation, smoothing, voxel-derived replacement geometry,
and an upgrade LOD are not selected.

The current snake_case schema-v1 runtime may repackage these exact selected
surfaces into its EAM3 transport, but that conversion must preserve the
selected source inventory and triangle topology and must not reopen scientific
geometry review. Publication location and immutable deployment remain
operational follow-up work. Ephys encoding volumes remain a separate product
path rendered only as linked coronal, sagittal, and horizontal 2-D slices.
