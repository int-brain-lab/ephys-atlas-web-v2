# Decision log

Status: accepted append-only decision record with effective-status index.

Historical decision bodies below remain unchanged except for corrected
cross-references. Use this index to identify the effective scope before applying
an older decision. `Partially superseded` means the named replacement changes
only part of the body; the index states what remains effective.

| ID | Short title | Effective status | Date recorded | Effective scope or supersession |
| --- | --- | --- | --- | --- |
| D001 | Separate v2 | accepted | — | v1 separately deployable; no v2 runtime compatibility |
| D002 | Frontend stack | accepted | — | TypeScript, Vite, plain DOM |
| D003 | Launch datasets | accepted | — | launch scope |
| D004 | Descriptive statistics | accepted | — | no launch inferential tests |
| D005 | Immutable releases | accepted | — | aliases remain external |
| D006 | Legacy compatibility | accepted | — | clean v2 contract and separate v1 fallback |
| D007 | Curated SVG reuse | superseded | — | D023 replaces runtime; historical evidence retained |
| D008 | Renderer-agnostic 3-D | partially superseded | — | D032 lab renderer; D037 integration; D042 geometry/LOD |
| D009 | Publishing authentication | accepted | — | capability model |
| D010 | Canonical source vs transport | accepted | — | source and web layout remain separate |
| D011 | Dynamic feature catalog | accepted | — | manifest-driven catalog |
| D012 | Latest vs paper vintage | accepted | — | Q2 remains for paper freeze |
| D013 | Volume geometry vs layout | partially superseded | — | D031 replaces v0.1 wording; separation remains |
| D014 | `SliceRenderer` boundary | superseded | — | D031/D035 |
| D015 | Published/local parity | partially superseded | — | D031 replaces v0.1 wording; parity remains |
| D016 | Curated SVG identity/navigation | superseded | — | D023-D026/D031 runtime; pinned evidence remains |
| D017 | Single-main development | accepted | — | current workflow |
| D018 | Explicit scientific inputs | accepted | — | fail closed |
| D019 | Folded regional representation | accepted | — | current regional model |
| D020 | Channel variants/value preservation | accepted | — | Q1/Q3 authority |
| D021 | Cluster population/weighting | accepted | — | D038/D044 refine source/catalog |
| D022 | Anatomy vs feature colors | accepted | — | shared presentation |
| D023 | Generated anatomy authority | partially superseded | — | D024 pack/grid; D031 runtime compatibility |
| D024 | Bilateral 10 µm anatomy | partially superseded | — | D031/D033 runtime/URL; D034/D045 retain geometry |
| D025 | Retained SVG/indexed experiment | partially superseded | — | D026 transport; D031/D035 runtime boundary |
| D026 | Sparse indexed SVG packs | partially superseded | — | D034 projection pack replaces browser format; evidence remains |
| D027 | Layered browser/open IDs | partially superseded | — | D031 replaces v0.1 wording; boundaries remain |
| D028 | IBL visual identity | accepted | — | current brand contract |
| D029 | History checkpoints | partially superseded | — | D031/D033 migrations; history intent remains |
| D030 | Responsive comparison tray | accepted | — | current UI behavior |
| D031 | Projection/volume/schema reset | accepted | 2026-08-22 | implemented; D033-D036 refine |
| D032 | Independent 3-D lab | partially superseded | — | D037 integrates; D042 geometry/LOD |
| D033 | URL v4/workspace state | accepted | — | current URL/workspace contract |
| D034 | Projection-pack validation | accepted | — | D049 refines static inputs |
| D035 | Retained projection viewport | accepted | — | current 2-D boundary |
| D036 | Affine volume composition | accepted | — | current layering |
| D037 | 3-D sibling integration | partially superseded | — | integration retained; D042 asset/LOD |
| D038 | Cluster/BWM source freeze | accepted | 2026-08-22 | D044 refines cluster catalog |
| D039 | Smoothing review protocol | superseded | — | D045 closes investigation |
| D040 | S3/CloudFront/browser gate | accepted | 2026-08-22 | residual inputs remain Q8 |
| D041 | 3-D scope/regeneration | partially superseded | 2026-08-22 | D042 replaces regeneration; source scope remains |
| D042 | GLB-derived 3-D resource | accepted | 2026-08-24 | Q12 authority |
| D043 | W26 volume geometry | accepted | 2026-08-24 | exact-source Q4 authority |
| D044 | Complete cluster catalog | partially superseded | 2026-08-24 | catalog/units retained; D046-D050 presentation |
| D045 | Retain exact 2-D geometry | accepted | 2026-08-26 | closes smoothing lane |
| D046 | Linear/log histograms | partially superseded | — | D047/D050 expand; exact binning remains |
| D047 | One value scale | partially superseded | 2026-08-26 | synchronization retained; D048/D050 refine |
| D048 | Firing-rate Log range | accepted | 2026-08-26 | exact Log choices retained by D054 |
| D049 | Legacy Top/static MIT assets | accepted | 2026-08-27 | exact hashes only |
| D050 | Scale vs distribution domain | partially superseded | — | D053 replaces only compact-Full rule |
| D051 | Custom authoring/ZIP import | accepted | — | implementation pending |
| D052 | `peak_val.raw` Linear/Focused | accepted | 2026-08-29 | exact choice retained by D054 |
| D053 | Focused compact viewport | accepted | 2026-08-29 | current compact behavior |
| D054 | Complete audited distribution selections | accepted | 2026-08-29 | closes Q14; local rebuilds authorized |
| D055 | Unlisted expiring dataset shares | accepted | 2026-09-02 | optional sharing transport; separate from publication |
| D056 | Project/dataset/release navigation | accepted | 2026-09-02 | catalog hierarchy, coordinated editions, and top-bar terminology |
| D057 | Preferred palettes and explicit diverging centers | accepted | 2026-09-02 | infrastructure policy; Q16 retains real-feature selections |

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
selected only by Q5 evidence. D043 supplies the exact-source W26 production
affine and outside/missing-value semantics.

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
Top/Swanson normalization accepts paths only and resolves every mapping class
suffix through the pinned catalog's complete common BrainRegions `idx` domain,
then through its explicit signed Allen/Beryl/Cosmos `mapped_atlas_ids`; do not
use reduced-mapping array positions or assume the source row is itself a
reduced-mapping member. Production mode requires exact pinned source bytes and
the D049 hash-bound MIT notice; synthetic mode remains clearly test-only and is
not a scientific release.

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
`cells_aggregates/clusters.table.pqt`, retaining D021's equal-cluster,
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

## D043 — Select the W26 all-forward voxel-center geometry

For the checksummed `ea_active/2026_W26` 50 um encoding volume, select stored
axes `(x, y, z)` as `(ML, AP, DV)` with all-forward array directions and integer
indices at voxel centers. Use `reference_space_id=allen-ccf-2017`,
`grid_id=allen-ccf-2017-50um`, shape `(228, 264, 160)`, and this row-major
`index_to_world_um` affine:

```text
[ 50,   0,   0, -5739 ]
[  0, -50,   0,  5400 ]
[  0,   0, -50,   332 ]
[  0,   0,   0,     1 ]
```

The repository owner, acting as scientific owner, inspected the linked
coronal, sagittal, and horizontal candidate review and authoritatively
confirmed `ml-forward_ap-forward_dv-forward` with the voxel-center convention
on 2026-08-24. The selected candidate has whole-mask Dice `0.9940758117`, IoU
`0.9882214021`, and W26 precision `1.0` against the hash-pinned Allen 50 um
annotation. Those measurements support the review but are not substituted for
the owner's authority. The complete confirmation and source hashes are
preserved in `docs/data/VOLUME_2026_W26_GEOMETRY_SELECTION.json`.

Retain the officially documented outside-brain sentinel `0.0`. A full streaming
audit of all 394,859,520 values in the pinned W26 object found zero NaNs and
zero infinities, so the schema-v1 `nonfinite` missing policy is explicit but
classifies no W26 source values. This resolves Q4 for this exact source object
only. It does not select the Q5 transport, authorize publication, or generalize
the affine to another volume vintage, resolution, or source hash.

## D044 — Publish the complete original cluster catalog

Publish all 14 scalar cluster features declared by the original
`int-brain-lab/ephys-atlas-web` repository at
`1d908bea095be2616a750d939d143f3b4db2a641`. Use the exact unit mapping in
`int-brain-lab/ephys-atlas-web/tools/ephys_units.py`: amplitudes in V, amplitude variability in
dB, drift in um/h, firing rate in Hz, spike/presence variability in counts,
noise cutoff in arbitrary units, and the remaining QC quantities as fractions.
This is the repository owner's authoritative scientific approval of the D038
catalog, including the audited negative, capped, binary, and heavy-tailed source
values.

Do not clip, winsorize, replace, filter, or reinterpret source observations.
Descriptions may explain the pinned upstream implementation, including that
`presence_ratio_std` is the standard deviation of raw binned spike counts,
`missed_spikes_est` is capped at 0.5, `noise_cutoff` is signed, drift is an
accumulated depth-change rate, and `slidingRP_viol=1` is the legacy pass value.
These explanations do not change the stored quantity.

Retire the legacy website's fixed `XLIMS` in favor of automatic robust v2
bounds. Use a presentation-only log default only for audited strictly-positive
heavy-tailed quantities; keep zero-bearing, signed, bounded, and capped metrics
linear so valid zeros are never hidden. The machine authority is
`docs/data/CLUSTERS_CATALOG_SELECTION.json`, and production builds must match
its source snapshot/table hash, pinned legacy source files, complete feature
catalog, units, descriptions, and display policy exactly. This resolves Q6.

## D045 — Retain exact 2-D anatomy geometry after human smoothing review

Close the anatomy smoothing investigation without a shortlist. On 2026-08-26,
the repository owner compared the exact option A against the visibly
consequential 7.5 um GEOS whole-coverage option B with the outer boundary fixed.
They selected `A clearly better` for the representative coronal, sagittal, and
horizontal views. The predeclared guided rule therefore stopped before the
stress round. Independently, B was already quantitatively rejected by the
provisional IoU/error gates, while the eligible 2.5 and 5 um configurations did
not move sampled geometry.

Retain `allen-ccfv3-10um-bilateral-exact-599b5e0bbab1` as the presentation,
scientific geometry, and affine authority. Do not run shortlist full-corpus
validation, implement a shared-chain smoother, create a smoothing derivative,
or migrate the active projection pack. Future smoothing work requires new
evidence and an explicit reopened decision. The machine-readable answers and
concise evidence are recorded in
`docs/rendering/ANATOMY_SMOOTHING_SELECTION.json` and
`docs/rendering/ANATOMY_SMOOTHING_REVIEW.md`.

## D046 — Offer exact linear/logarithmic histogram switching

For regional observation distributions, retain the complete linear histogram
and permit an additional complete logarithmic variant with its own edges,
global counts, and regional typed-binary count arrays. Never implement the
toggle by stretching counts already accumulated into another binning. A log
variant is valid only when all finite source observations are strictly
positive; otherwise the browser disables Log with an explanation.

The viewer defaults to the release-declared preferred axis, exposes Linear and
Log as immediate presentation choices, persists an explicit choice separately
from color scaling in URL v4, and records the selected axis in comparison CSVs.
This is presentation and descriptive binning only: source values, regional
summaries, statistics, coloring, and underlying-value downloads do not change.

For the D044 cluster catalog, generate both variants for the audited positive
heavy-tailed features and prefer Log. Other cluster features remain linear-only.
Regenerate under a new immutable output release ID while retaining the exact
content-addressed source snapshot identity; never mutate the validated earlier
candidate.

The independent color/histogram controls and D044's Firing-rate Log preference
are superseded by D047. The exact dual-histogram contract and immutable-release
requirements remain in force.

## D047 — Use one value scale and prefer Linear for firing rate

Use one user-facing value-scale selection for color normalization, the global
distribution x-axis, the compact range distribution, range handles, markers,
pointer inversion, keyboard adjustment, and whole-window translation. Both the
settings selector and distribution buttons edit the same URL-v4 `scale` state;
retire the independent `histScale` field without a migration because the viewer
is pre-alpha and unpublished. Exact linear and logarithmic histogram variants
remain separate release artifacts and underlying observations do not change.

Log is available only when the active presentation range is strictly positive
and, for regional data, the release contains an exact Log histogram. An invalid
explicit Log request reconciles canonically to Linear while preserving the
feature and manual range; it must never blank regional coloring. Logarithmic
range-window movement preserves width in transformed space, hence a
multiplicative ratio rather than an additive difference.

On 2026-08-26 the repository owner visually compared the exact Linear and Log
Firing-rate distributions and judged Linear better. Therefore Firing rate now
prefers Linear while retaining its exact Log alternative. The other five
audited positive heavy-tailed cluster features retain their existing Log
preference. Record availability separately from preference in the versioned
catalog selection and rebuild a new immutable candidate; preserve both earlier
candidates unchanged.

The one-scale architecture remains active, but the Firing-rate preference is
superseded by D048 after continued visual review.

## D048 — Default firing rate to the reviewed Log range

On 2026-08-26, after reviewing the synchronized implementation in the complete
atlas workspace, the repository owner superseded D047's Firing-rate Linear
preference. Default Firing rate to Log with the visually selected 3.73–17.8 Hz
display interval, retaining Viridis and regional Mean. Treat that interval as
the release-declared automatic default so Reset returns to it without writing a
manual URL range; explicit user overrides remain shareable.

This changes presentation metadata only. Retain the exact Linear and Log
histogram variants and all 925,251 source observations unchanged. Record the
new preference in another versioned catalog selection and build a fourth
immutable candidate without changing or deleting the earlier three.

## D049 — Retain legacy Top and authorize exact Top/Swanson assets under MIT

On 2026-08-27, after three guided reconstruction rounds, the repository owner
chose to retain the exact deployed legacy Top geometry. The 25 µm, canonical
10 µm, and shared-boundary smoothing experiments consistently improved
boundary continuity but were consistently worse than legacy for smoothing and
anatomical shape. Every shared-boundary candidate also failed the provisional
per-region IoU gate. Close P2T without a reconstructed shortlist; do not pursue
another Top reconstruction unless a future decision explicitly reopens it.

The repository owner also explicitly authorized the following exact official
IBL deployment artifacts under the MIT License of
`int-brain-lab/ephys-atlas-web`:

- `slices_top.json`, SHA-256
  `4dc788df3da667c8dde5a9f1b0abc258715a916cb8609542bdd849f793815c30`;
- `slices_swanson.json`, SHA-256
  `347ad18c2eb0fad1012d30432ff4abf8a09dc0acc0f33b57efbdd2790826acba`.

The complete authorization and MIT notice are committed at
`LICENSES/IBL-EPHYS-ATLAS-V1-STATIC-ASSETS-MIT.txt`, itself pinned by SHA-256
`f31adf14af0265cae0f866a515bda9b0750f7473d40cef5598c7f4305037ce37`.
This resolves Q13 only for those exact byte sequences. A production projection
pack must verify their pinned sizes, hashes, and path inventories; embed the
exact committed notice as a verified plain-text resource in its immutable file
graph; and record the evidence identity on both static sources. Missing,
modified, differently hashed, or free-form substitute evidence fails closed.

## D050 — Separate value scale from distribution domain

Use two independent presentation controls for scalar feature distributions:

- value scale: `linear`, `log`, or `symlog`, labelled Linear, Log, and Signed
  log in the viewer;
- distribution domain: `full` or `focused`, labelled Full and Focused.

One resolved value scale continues to govern color normalization, the global
distribution x-axis, the compact range distribution, range handles, markers,
pointer inversion, keyboard adjustment, and whole-window translation. This
preserves D047's synchronization invariant. Changing Full versus Focused
changes only the global distribution and selected-region comparison domain;
the compact color-range distribution remains Full under the resolved scale, so
changing the analytical view does not silently change coloring or a manual
color interval. D053 supersedes this compact-Full viewport rule while retaining
the invariant that a domain change never mutates the color interval or coloring.

Signed log uses the exact natural-log transform
`T_c(x) = sign(x) * ln(1 + abs(x) / c)` and inverse
`T_c^-1(y) = sign(y) * c * (exp(abs(y)) - 1)`, where `c` is finite, strictly
positive, expressed in the feature's raw units, and owned by the immutable
release. The browser and URL must never estimate or override `c`. Signed log
does not imply a diverging colormap or a scientifically meaningful zero
center. Log is available only when every finite observation in the complete
representation population is strictly positive; focused bounds cannot make an
otherwise ineligible feature eligible for Log.

Every declared scale/domain combination is an exact binning computed from the
raw finite observations, or from valid voxels for a volume. Counts must never
be transformed or rebinned from another histogram. Focused binnings retain
exact underflow and overflow counts and percentages against the complete
population denominator; visible bins are not renormalized and may sum to less
than one. Stored edges are strictly increasing raw-unit values. Underflow is
`x < edges[0]`, overflow is `x > edges[-1]`, interior bins are left-closed and
right-open, and the final bin includes `edges[-1]`; a value exactly on either
domain endpoint is therefore visible. A reported tail percentage is exactly
its tail count divided by the applicable complete finite-population count. For
a regional feature, each selected region has exact counts over
the same edges and tails, and
`underflow + sum(bin_counts) + overflow` equals that region's finite
observation count. The corresponding global equality uses the global finite
count. A volume has a valid-voxel global distribution only, with the analogous
equality against `valid_voxel_count`; it does not acquire regional curves.
Full binnings cover the complete finite domain and therefore have zero tails.
Linear/Full remains mandatory for every nonempty scalar population.

Available scale/domain combinations form a rectangular cross-product so the
two controls remain independent. A representation has one release-owned
Signed-log threshold and, when Focused is offered, one release-owned raw-value
focus interval shared by its scale variants. Raw domain endpoints must agree
across all scale variants for a given domain. Scale availability, Signed-log
threshold, Focused availability/bounds, and preferred scale/domain are
feature-and-representation-specific release metadata. Regional and volume
preferences must not overwrite one another when a feature exposes both.

URL v4 persists only explicit user choices as `scale=linear|log|symlog` and
`dist=full|focused`; omitted values resolve through release defaults. Thresholds
and focus bounds are immutable release data and are not URL parameters. When a
feature or representation does not support an explicit choice, canonicalize
to Linear/Full while retaining the feature and any still-valid manual color
range. Distribution exports record the resolved scale and domain, exact raw
edges/counts/tails, complete-population denominator, Signed-log threshold when
applicable, and focus bounds when applicable. Underlying-value exports remain
unchanged.

Implement this as one coherent in-place schema-v1 cutover across regional
statistics, volume summaries, feature display metadata, Python and TypeScript
validators, builders, the golden fixture, published and local readers, viewer
state, and exports. Do not add compatibility adapters or a shadow distribution
schema. Rebuild affected scientific products under new immutable release IDs;
never mutate existing releases. D050 supersedes D046/D047 where they limit the
contract to Linear/Log or one full-domain histogram, while retaining D047's
single-scale synchronization and exact-binning requirements. D048's reviewed
cluster firing-rate Log preference and 3.73–17.8 Hz automatic color interval
remain the current release choice until an audited owner selection explicitly
supersedes them.

No per-feature Signed-log threshold, focus interval, availability set, or new
preferred scale/domain is selected by this decision. Read-only audits must
cover channel, cluster, `brainwide_map`, and volume source populations, with
owner-reviewed representation-specific selection artifacts resolving Q14
before scientific release rebuilds.

## D051 — Author custom data with `ibl-ephys-atlas` and import ZIP only

Retain the historical IBL Ephys Atlas product name for a public authoring
distribution even though its supported scalar inputs are modality-neutral.
Use PyPI distribution `ibl-ephys-atlas`, Python namespace
`ibl_ephys_atlas`, CLI prefix `ibl-ephys-atlas`, and local interchange suffix
`.ibl-ephys-atlas.zip`. Retain the existing historical `ephys-atlas-*` schema
format identifiers rather than performing a product-wide terminology reset.

Implement the public authoring API in this repository beside the canonical
schema-v1 serializers, validators, browser consumer, and publishing validation;
do not add v2 authoring to the legacy `iblbrainviewer` package. Keep public
generic mechanics distinct from official dataset-specific recipes, but make
both consume the same release contract rather than maintaining two serializers.

Use `iblatlas` as the anatomical authority. Regional identity validation,
acronyms, metadata, and Allen/Beryl/Cosmos mappings come from `BrainRegions`;
supported Allen volume grids and coordinate conversions come from explicit
`AllenAtlas`/`BrainCoordinates` adapters. Do not copy those authorities or infer
an affine from a volume's shape/resolution. Record the installed atlas/tool and
relevant source identities in provenance.

The browser local-import product accepts one ZIP, not a directory tree. The ZIP
contains the existing schema-v1 release graph directly at its root and is only
an ingestion container. Validate its bounded safe inventory, complete
transitive graph, served-byte sizes, and SHA-256 values before one atomic
IndexedDB admission; store individual resources and discard the outer archive
so runtime access stays transport-neutral and efficient.

Make local identity persistent and explicit. Local data is never uploaded
implicitly, local URLs do not transfer the release, duplicate immutable
releases require explicit deletion, and local deletion remains separate from
published-resource cache clearing. The current folded regional presentation
cannot represent independent left/right feature values, so the first API is
non-lateralized by default and requires explicit hemisphere folding. Volumes
retain spatial laterality through an exact supported reference-space identity,
grid, affine, and validity policy.

The first vertical slice is regional scalar authoring plus ZIP import; explicit
`iblatlas`-backed volume authoring follows. Remote publishing remains a
separately authorized operation over already-built releases and never becomes
part of scientific transformation. The binding detailed plan is
`docs/data/CUSTOM_DATA_AUTHORING.md`.

## D052 — Default regional channel `peak_val.raw` to Linear/Focused

For the pinned `2026_W32` regional channel population, expose `peak_val.raw`
with Linear and Signed-log value scales, using the exact raw-unit Signed-log
linear threshold `1.23`. Expose Full and Focused analytical domains, using the
exact Focused raw-value bounds
`[-9.467077467918395, 2.5583932574651715]`. Prefer Linear and Focused when the
URL contains no explicit scale or distribution-domain override.

This owner-reviewed choice follows a complete finite-population audit: 380,884
finite values span `-4221.428899850252` to `1341.0694115214876`; the approved
Focused interval is the exact 1st-to-99th percentile interval and has 3,809
observations in each tail. Under Full Linear, the largest bin contains
99.8534987030172% of observations, which obscures the central distribution.
Ordinary Log is unavailable because the population contains both negative and
positive values.

Apply this choice only to `peak_val.raw` in the regional channel
representation. Retain the D050 Linear/Full baseline for every other channel
feature, keep representation-specific selections independent, and build a new
immutable local release rather than changing an existing release. This is a
partial Q14 resolution and does not authorize remote publication.

## D053 — Apply Full/Focused to the compact range viewport

Use the resolved Full/Focused distribution binning for the compact color-range
histogram as well as the global and selected-region distributions. This makes a
Focused viewport useful for highly skewed populations instead of compressing a
robust color interval into an effectively immovable Full-domain slider. Show
the exact focused underflow and overflow counts beside the compact histogram.

Changing the distribution domain changes only histogram content and interaction
coordinates. It must not change automatic or manual color bounds, colormap
normalization, source values, or brain coloring. When an existing bound lies
outside the current viewport, preserve and label its exact value, show an
off-scale edge marker, and disable track dragging to prevent an accidental
clamp. Exact numeric entry remains available, and selecting Full restores drag
editing over the complete release-declared domain.

This is a viewer interaction decision and requires no schema or release rebuild.
It supersedes only D050's requirement that the compact histogram remain Full;
D047/D050 scale synchronization, exact release-owned binnings, whole-population
Focused normalization, URL state, and scientific selections remain unchanged.

## D054 — Approve the complete audited Q14 distribution selections

On 2026-08-29, the repository and scientific owner approved the exact
hash-bound 155-feature Q14 human-review record: all 34
`q14-agent-candidate-policy-v1` proposals were accepted and the other 121
feature/representation choices were explicitly retained unchanged. No proposal
was edited and no feature remained unreviewed. The normalized review record has
SHA-256
`6224edf1c495e573dc83045e2a85ec3a234e3d98f3d8a35637dc13a0150295de`.

The authoritative choices are enumerated completely in
[`data/CHANNELS_DISTRIBUTION_SELECTION.json`](data/CHANNELS_DISTRIBUTION_SELECTION.json),
[`data/CLUSTERS_DISTRIBUTION_SELECTION.json`](data/CLUSTERS_DISTRIBUTION_SELECTION.json),
[`data/BRAINWIDE_MAP_DISTRIBUTION_SELECTION.json`](data/BRAINWIDE_MAP_DISTRIBUTION_SELECTION.json),
and
[`data/VOLUME_2026_W26_DISTRIBUTION_SELECTION.json`](data/VOLUME_2026_W26_DISTRIBUTION_SELECTION.json).
The channel inventory has 25 Focused domains (18 preferred), 7 Log scales,
and 17 Signed-log scales, with Linear preferred throughout. The cluster
inventory has 10 Focused domains (8 preferred), retains the six reviewed D048
Log scales, and adds preferred Signed-log for `noise_cutoff` using the lowest
audited positive threshold candidate. D052 `peak_val.raw` is retained exactly.
All 30 Brain-Wide Map and 41 volume features remain Linear/Full.

These are representation-specific presentation choices. They do not change
source observations, geometry, validity, palettes, or color ranges. Rebuild
the exact source binnings into new immutable local releases and retain every
prior release. This decision resolves Q14 and authorizes the necessary local
selection, build, validation, and development-default work only. It does not
authorize remote publication, remote aliases/origins, a paper vintage, or the
production volume transport.

## D055 — Share local datasets as unlisted expiring CloudFront/S3 objects

Add an optional browser-only sharing path for already-imported, fully validated
schema-v1 releases. A share is an informal, unlisted copy for collaboration; it
is not an official publication, does not enter `catalog.json`, does not acquire
an alias, and must be labelled **Shared** rather than **Published**. Anyone with
the link may read or forward it. This is not a confidentiality mechanism.

Use a separate private IBL-owned S3 bucket or rigorously isolated prefix as the
durable share store and a separate CloudFront data origin as the only browser
read/write boundary. Configure CloudFront Origin Access Control to sign S3
origin requests. Do not expose anonymous S3 access, permanent AWS credentials,
Cognito identities, Lambda, EC2, user accounts, or the capability-based
publishing API in the first sharing version. Official publishing retains D009,
D040, schema validation before exposure, immutable release/catalog semantics,
and its separately authorized lifecycle.

The sender generates at least 256 random bits with the Web Crypto API and
uploads the already-validated individual IndexedDB resources beneath an opaque
`shares/<share-id>/` prefix. Each object upload supplies the declared checksum
and `If-None-Match: *`; S3 policy must enforce create-only conditional writes so
an existing share cannot be overwritten. Upload the root manifest and a small
completion marker last. A recipient must require the marker and then replay the
ordinary complete schema-v1 graph, served-byte, SHA-256, path, and semantic
validation before rendering. The marker is only a completion convention: with
no trusted control plane, it is not proof that the uploader supplied a valid
release.

Anonymous upload capability must be isolated and bounded operationally. The
CloudFront behavior and S3 policy grant only the minimum object creation and
read actions under the share namespace, deny deletion/listing/ACL/bucket
administration and all unwanted HTTP methods, and retain S3 Block Public Access.
Use AWS WAF method filtering and rate-based rules, fixed S3 Lifecycle expiry,
client-side release/resource ceilings for honest users, a non-executable data
origin with restrictive response headers and viewer-origin CORS, storage/request
monitoring, budget alarms, and a documented emergency switch that disables
uploads. Initial shares have no user-managed deletion, ownership recovery,
catalog discovery, or indefinite-retention promise.

This design deliberately accepts a residual abuse risk: without a trusted
component, aggregate bytes, per-person quotas, ownership, validity before
storage, and an absolute spending cap cannot be enforced reliably. Q15 retains
the exact deployment names, expiry, limits, WAF thresholds, alarms, and kill
switch as choices that an implementation agent must not invent. Evidence of
abuse or requirements for durable shares, revocation, ownership, quotas, or
private access triggers a fresh decision on a trusted control plane; it does
not silently expand this MVP into publishing.

## D056 — Organize datasets by project, release, feature, and view

Organize public scientific navigation as **Project -> Dataset -> Release ->
Feature -> Representation**. Use Project as the durable user-facing grouping,
not Paper: Ephys Atlas contains channel features, cluster features, and
encoding volumes, while Brain-Wide Map is a clearly separate project. Present
browser-local imports under **My data**, which is a UI section rather than an
official public project or publication claim.

Add a project edition concept for a named coordinated mapping from the datasets
in one project to exact immutable release IDs. A paper-facing edition is frozen
and reproducible. Switching datasets inside an edition selects the mapped
release; explicitly selecting a different dataset release leaves that edition
and must be disclosed as a custom version or outside the named edition. Mutable
aliases and defaults resolve before loading and URL commitment; share URLs,
exports, and downloads retain exact immutable dataset/release identity.

Use the desktop top-bar order **Project, Dataset, Feature, View**. Keep release
selection attached to Dataset, display a concise friendly release label plus
status, and expose the exact release ID as secondary technical information.
Rename the user-facing Representation control to **View**, combining the
release-declared representation and applicable parcellation, while retaining
`representation` as the schema/domain term.

Implement project membership, friendly release presentation, and edition
mappings through the public catalog contract rather than frontend hardcoding.
Preserve project/edition or disclosed custom-version context in URL history
when it affects dataset switching, alongside the exact active dataset and
release. The complete accepted interaction and catalog requirements are in
[`frontend/DATASET_NAVIGATION.md`](frontend/DATASET_NAVIGATION.md). Q9 retains
the exact paper-facing edition/alias names, release IDs, default, and freeze
process; this decision does not invent them.

## D057 — Use release-preferred palettes with explicit diverging centers

Treat the existing representation-level scalar-display `colormap` as a
release-owned preferred palette. The viewer's default selection is Auto: it
resolves the active feature representation's preference and otherwise falls
back to Viridis. An explicit user palette overrides Auto across feature
changes and is persisted in URL v4; omitted `cmap` means Auto, and Reset returns
to Auto. Regional and volume representations may prefer different palettes.

Use one classified registry for SVG, Canvas, gradients, legends, and controls:
the sequential Viridis, Cividis, Magma, Plasma, Inferno, Blues, and YlOrRd
palettes plus the diverging Coolwarm palette. A diverging palette is available
only when the representation declares an explicit finite release-owned
`diverging_center`; never infer that center from the arithmetic midpoint, a
Signed-log threshold, or zero. A preferred diverging palette requires such a
center, while a representation with a sequential preference may still declare
one to permit an explicit diverging user choice.

When the active range straddles the center, normalize the lower and upper sides
independently onto the lower and upper halves of the palette. When a manual
range lies wholly on one side, use only that side's half-palette; a range bound
equal to the center maps to the neutral midpoint. Apply this identically across
all scalar presentation surfaces.

This decision approves the viewer and schema machinery only. Q16 retains every
real channel, cluster, Brain-Wide Map, and volume feature/representation
preferred-palette and diverging-center choice. Implement and test the machinery
with synthetic fixtures without editing D054 selections or rebuilding real
releases. The bounded implementation tasks and UI follow-ups are recorded in
[`tasks/2026-09-02-scalar-presentation-followups/`](tasks/2026-09-02-scalar-presentation-followups/README.md).
