# Integration status

Status: active pre-alpha implementation on `main`. The repository is being optimized for rapid future extension rather than compatibility with an installed user base.

## Current architecture

The product is organized around five browser responsibilities:

- `core` / `domain`: renderer- and transport-independent state, atlas coordinates, slice calibration, actions, reducers;
- `application`: asynchronous dataset/release/feature lifecycle and stale-work cancellation;
- `data`: versioned contracts, validation, shared materialization, HTTP/local resource adapters, caching;
- `rendering`: anatomy/volume/mesh rendering and format-specific runtime adapters behind application rendering boundaries;
- `ui`: plain-DOM controllers and pure view models for complex data presentation.

Dataset IDs are runtime identifiers rather than a fixed launch enum. Dataset, feature, parcellation, release, and representation availability are expected to come from catalogs/manifests.

HTTP and local datasets share the same regional materializer through a transport-independent resource-reader interface. The validation implementation is split by contract concern behind the existing public validation facade.

## Completed architecture cutover

D031 and `docs/rendering/PROJECTION_VOLUME_CUTOVER_PLAN.md` define the completed
cutover and the gated production-volume follow-up. Schema v1 is the sole
implemented data contract, and the browser now mounts one retained layered
`ProjectionViewport` for each
registered frame. `SliceRenderer`, the hybrid facade, v1/v2/v3 anatomy-pack
readers, legacy renderer/crosswalk, and URL migrations have been removed. The
viewport now composites reference-compatible volume and registered anatomy
layers with background-capable voxel inspection, validity transparency, and
URL-persisted layer controls. Top and Swanson now use the same regional SVG
presentation and interaction path in the secondary workspace slot. The residue
audit, architecture guards, and final performance/size rebaseline are complete.

Commits 1 through 8 of the plan are implemented: `schema/v1/` defines the
strict dataset, resource, regional, volume, summary/index, and five-projection
contracts plus matching TypeScript types. Python and TypeScript semantic validators execute
one deterministic valid/invalid corpus covering all top-level schemas, both
volume transports, sentinel/mask validity, asymmetric signed affines and
derived extents/inverses, exact static-map evidence, and cache identity.
Builders, publishing, HTTP/local browser readers, IndexedDB namespaces,
downloads, and the deterministic test-only `golden-v1` fixture now use that
contract exclusively. The real `2026_W32` channel source has been pulled and
built into a validated ignored local schema-v1 release. Ordinary development
serves that release and has no synthetic ephys fallback; Playwright alone mounts
the golden fixture through the local-release server. Encoded resources are verified before persistent caching; corrupt
entries are evicted and retried, and decoded identity is SHA plus decode
contract rather than path. Schema-v0.1 runtime code, schemas, fixtures, and
compatibility tests are removed. Q4 and Q5 remain unresolved and continue to
block a purported production volume release.

The enabled 2-D projection registry exposes registered coronal, sagittal, and
horizontal views plus affine-free Top and Swanson maps. The distinct workspace
registry owns the three slice slots and responsive secondary slot; Summary,
Top, and Swanson are secondary content rather than fake workspace or slice
identities. `secondaryTab`, `activeCompactView`, and `maximizedView` are
independent typed reducer state rather than `AppShell` fields. A single snapped
ML/AP/DV cursor is stored; native indices, display
ordinals, coordinate labels, renderer inputs, and guides are derived from it.
URL v4 serializes the cursor and workspace state. Any non-current version is
reset wholesale to the canonical current URL, with no partial legacy-field
consumption. `AtlasApp` and `AppShell` depend only on the retained viewport
factory; each frame keeps one stable Canvas/SVG/guide/error layer stack across
navigation, and revisioned latest-only scheduling prevents stale geometry from
committing.

`tools/projection_pack/` builds and validates one self-contained immutable
five-view pack. Registered coronal/sagittal/horizontal resources are copied
losslessly only after validating their bilateral 10 um v2 scientific parent,
v3 sparse inventories, topology, coverage, synchronization evidence, encoded
hashes, and decoded indexed-SVG identity. Top and Swanson pass through a
path-only sanitizer and the pinned Allen/Beryl/Cosmos crosswalk before
deterministic gzip encoding. The graph validator follows the three registered
resource indexes and every static/registered resource and rejects integrity,
inventory, missing-file, and undeclared-file errors. Production invocation
requires explicit Q13 license evidence and exact pinned source bytes; no
production static asset has been asserted while that evidence remains open.

The default development URL is a complete validated schema-v1 pack under
`web/public/atlas/projections/synthetic-static-registered-v1/`. Its registered
resources are the validated sparse bilateral geometry; its Top/Swanson inputs
are deterministic synthetic test paths exposed with an always-visible
non-scientific warning. Static resources use transport-opaque `.isvg.gz` names
so HTTP hosts do not transparently decode bytes before integrity verification.
`tools/projection_pack/build_web_fixture.py` reproduces this fixture. It is
neither a scientific release nor evidence that Q13 is resolved. Static maps
share regional feature/anatomy coloring, Allen/Beryl/Cosmos identities, hover,
selection, tooltips, responsive switching, and maximize/Escape restoration.
Volume features remain explicitly anatomy-only on affine-free maps.

The pre-Commit-1 contract is now explicit about separate reference-space,
grid, and asset identities; verified-only persistent caching; independent
secondary/compact/maximized workspace state; nearest-neighbor volume paint and
inspection; exhaustive validity counts; and affine-free Top/Swanson gzip SVG
fragments with pinned `60 20 340 300` view boxes. The deployed static fragment
license coverage still requires confirmation before production ingestion;
synthetic fixtures are unblocked.

An independent, non-production brain-mesh 3-D lab is implemented in the frozen
donor branch `experiment/brain-mesh-3d-lab` at `ba1e2d1`. It demonstrates the
offline compiler, verified EAM3/meshopt loading, merged bilateral rendering,
mapping/color/selection, press-referenced arcball controls, and grouped radial
explode. It has not been integrated on `main`, is not part of M2 or launch
acceptance, and must not be bulk merged because it predates final projection
cutover commits.

The approved main-integration Commits 0-6 are complete. The ordinary full gate
is required at each landing point; at the unchanged donor
`ba1e2d1`, the focused compiler (5), web unit (18), and Chromium lab (4) tests
passed. No donor history changed. Main now has one strict snake_case
`atlas-mesh-pack-v1` contract with Python/TypeScript parity, deterministic
offline GLB/clipping/ontology/EAM3 primitives, complete graph validation, and
a byte-reproducible tiny bilateral pack marked test-only. The browser now has
verified manifest/LOD transport, shared consumer-safe cancellation, a real
gzip/EAM3/meshopt module worker, strict malformed-input rejection, and a
decoder-identity-keyed bounded CPU LRU. A retained Three viewport now owns
merged bilateral GPU resources, press-referenced arcball controls, lookup-
texture presentation, shader-only explode, signed filtered picking, lazy atomic
LOD replacement, demand-only frames, resize, WebGL context loss, and complete
disposal. The thin `/3d-lab/` entry uses the canonical committed fixture through
a development/test-only server route; it is covered by the ordinary Chromium
gate and is not a production-data fallback. The obsolete exploratory renderer
facade is gone. Regional semantics now resolve once in the application layer
and feed registered 2-D, static 2-D, and retained 3-D applicators; renderer-
local bilateral color/selection resolution is gone, while static volume views
remain explicitly anatomy-only. Registry-driven context content and optional
URL-v4 3-D state are implemented: `brain-3d` is context-registry content, not a
projection or fifth workspace slot, and its null host performs no mesh request.
Camera poses are finite, bounded, nondegenerate, normalized as a whole, and
camera drag writes are debounced replacements; explode and camera fields are
optional additions to URL v4. The thin optional application adapter now lazily
creates an explicitly configured immutable viewport, pauses hidden work, shares
presentation, selection, and camera state, isolates failures, and owns teardown.
Without a descriptor the null host remains request-free. The canonical synthetic mesh is
injected only by the browser-test server, never as a runtime fallback.
D042 resolves the optional 3-D geometry and LOD direction using the frozen
donor's GLB-derived compiled-full resource: 4,958,039 bytes, SHA-256
`658d68d81619ef83f7dbd6b032533ecd751fb52d3e7dd734dc90b1086b95baaa`,
989,811 retained triangles, and 1,130 signed surfaces from 566 in-scope GLB
objects. It selects no smoothing, no triangle decimation, no voxel-derived
replacement surfaces, and no upgrade LOD. The experimental main adapter and
fixture-backed runtime remain implemented; immutable schema-v1 repackaging and
deployment are non-blocking operational follow-up. Encoding volumes remain a
separate linked 2-D slice path.

The approved anatomy smoothing investigation has completed its first three
implementation slices. A deterministic registry exposes exact geometry, GEOS
whole-coverage simplification with explicit outer-boundary policy, and a
permanently unsafe independent-ring RDP control. Failure-preserving results
measure coverage, geometry validity, components, holes, adjacency, source
voxel centres, background topology, per-region IoU/area change, symmetric
boundary error, and complexity across deterministic synthetic stress planes.
The self-contained report builder validates pinned real annotation, LUT,
average-template, exact-parent, and active sparse identities; chooses recorded
stress samples deterministically; compares regenerated exact paths with
verified parent bytes; and keeps all generated output under ignored
`artifacts/`. The pinned real narrow run passed for all three projections. This
is offline evidence machinery only; it does not alter the active anatomy or
choose a production smoothing budget. Its interactive report now supports
linked exact/candidate and anatomy views, overlay/blink/boundary modes,
magnified inspection, clearly separated presentation controls, permanent
reference/eligible/rejected/unsafe status, full sortable per-region evidence,
JSON/CSV exports, provenance, and fragment-persisted review location. Synthetic
wide/tablet and pinned-real coronal visual checks passed. Slice 4 is intentionally
paused at human qualitative review and shortlisting.

Optional main-application integration is approved through D037 and
`docs/rendering/3D_INTEGRATION_PLAN.md`. The target is a `brain-3d` content kind
inside the existing secondary/context slot, backed by a sibling retained 3-D
viewport and the application's one regional-presentation/state lifecycle.
`ProjectionRegistry` remains 2-D-specific. The optional application integration
is complete through Commit 6. D042 fixes its GLB-derived geometry/LOD direction;
production asset deployment and removal of the experimental label remain
non-blocking operational work.

The regional UI keeps DOM concerns in its controller while region search/value/statistics derivation is pure/testable. Large dynamic tree interaction uses delegated events.
The region browser defaults to the expandable anatomical hierarchy and offers
URL-persisted ascending or descending value rankings as a flat selectable list.
Its compact icon control cycles anatomy, descending value, then ascending value.
Finite values rank globally, missing values remain last, and returning to
anatomical order restores the prior expansion state.
The feature color range is edited on a histogram-backed dual-handle colorbar.
Pointer or keyboard interaction switches automatic bounds to a URL-persisted
manual range, exact selected values follow the handles in collision-aware labels,
and the stable data-domain endpoints remain below the histogram. Reset restores
the robust automatic range without exposing permanent numeric fields.
The colormap is confined to the selected interval, and dragging that interval
translates both bounds together without changing its width. Feature magnitude
statistics (`mean`, `median`, `min`, and `max`) are colorable; observation count
remains supporting sample-size metadata in tooltips, comparisons, summaries,
and exports rather than a feature-color statistic.
Color scale selection defaults to `Auto`: the browser resolves optional
feature-level `display.scale` metadata and otherwise uses linear color
normalization. Explicit linear/logarithmic overrides persist in URLs, while
values, statistics, histograms, tooltips, and exports remain unchanged.
Regional SVGs, volume canvases, and the interactive color legend share one
registry of full 256-step Matplotlib lookup tables. The concise sequential
choice is Viridis, Cividis, or Magma; Cividis provides an accessibility- and
grayscale-oriented alternative. A diverging palette remains intentionally
unavailable until the coloring contract exposes an explicit scientifically
meaningful center instead of inferring one from the displayed range.

## Brand identity

The application header uses the official 2026 IBL Core colored-negative SVG
lockup directly on the dark header without a separate background block. The
institutional cyan is the primary interface accent; blue and magenta remain
brand tokens. Scientific feature colormaps, Allen ontology colors, and
categorical selection colors remain independent of branding. Asset identity
and usage constraints are recorded in `docs/frontend/BRAND_IDENTITY.md` and
D028.

## Anatomy rendering

The active regional anatomy display is the registered portion of
`atlas-projection-pack-v1`. Its indexed-SVG bytes and 80 µm display inventories
are copied losslessly from the validated sparse v3 artifact, whose bilateral
10 µm v2 parent remains the scientific geometry and affine authority.
Application/URL/cursor state remains in native 10 µm coordinates and display
selection alone snaps to the nearest sparse plane.

The immutable v2/v3 artifacts, schemas, generators, and validators remain as
build/reproducibility evidence. They are no longer browser runtime formats;
the browser has only the schema-v1 projection-pack source.

## Scientific data/builders

Schema v1 is the sole browser, builder, and publishing release contract.
Regional release serialization is shared by channel and cluster builders;
scientific source selection and computation remain dataset-specific.

Current launch-critical dataset families are:

- `ephys_atlas_channels`
- `ephys_atlas_clusters`
- `ephys_atlas_volumes`
- `brainwide_map`

The final paper-facing source vintages and unresolved scientific choices remain governed by `docs/OPEN_QUESTIONS.md`, `docs/LAUNCH_SPEC.md`, and focused data/source documentation. The browser must not hard-code the eventual feature catalog.

The Python release validator and TypeScript runtime validator use a shared
valid/invalid manifest corpus. Both enforce calendar-valid RFC 3339 release
timestamps, unique feature/parcellation identities, safe binary descriptors,
and matching manifest/feature relationships. The browser also rejects duplicate
catalog dataset/release identities, mismatched production catalog/manifest
dataset IDs, feature-reference mismatches, undeclared regional parcellations,
and malformed display ranges. The deterministic golden fixture is the sole
explicit catalog-identity exception: it may exercise launch selectors while
retaining `golden_fixture` as its visible synthetic identity.

### `ephys_atlas_channels`

The deterministic channel-release recipe is implemented with explicit source
project/vintage, raw and denoised variants, `inside` source population, no
additional physiological QC, left-folded Allen/Beryl/Cosmos aggregation,
source-value preservation, dynamic feature discovery, descriptive
statistics/histograms, presentation-only log-color feature configuration, and
pinned source/tool/builder provenance.

The immutable `2026_W32` source snapshot has been pulled and built as a
validated development release. Its real-release Playwright suite exercises all
70 discovered features, all three parcellations, and promoted `float64` raw
alpha arrays through the production HTTP loader. It is not the paper-facing
release: Q2 still requires the final immutable `ea_active` vintage. See
`docs/data/DEVELOPMENT_RELEASE.md`.

### `ephys_atlas_clusters`

The cluster builder accepts an explicit content-addressed project snapshot and
nonempty scalar feature catalog. It aggregates every finite row of
`clusters.table.pqt` with equal cluster weight after left folding; it does not
use `clusters_good.table.pqt`, insertion balancing, or hidden good-unit/QC
filters. Its build inputs can separately declare presentation-only log-color
defaults. D038 selects the frozen `ibl_neuropixel_brainwide_01` project and the
legacy 14-feature scalar list as the review candidate. Content-addressed
snapshot `sha256-9b5e55215b306f26` and the all-row source audit are complete:
all candidates exist, all source dtypes are double, four columns contain
missing values, and the pinned schema declares no units. Production now waits
on human catalog review/freeze under Q6; see
`docs/data/CLUSTERS_SOURCE_AUDIT.md`.

### `brainwide_map`

The deterministic local builder preserves the five D038-selected Beryl-only v1
website families. It verifies every pinned family and the legacy Beryl metadata
before Parquet decoding, rejects nonexistent local builder-commit pins,
reproduces left lateralization, arithmetic aggregation, six-significant-digit
serialization, and the legacy significance encoding, and emits explicit
preserved-snapshot provenance. Synthetic deterministic/schema tests and an
exact-input local comparison cover all 30 features and 210 regions. A validated
ignored local release was built from commit `9d2d37b`; it has not been published
or added to a public catalog. The development server now exposes its manifest
title/description through a test-only one-release catalog and the production
HTTP reader. Opt-in Chromium acceptance covers the dynamic 30-feature catalog,
automatic Beryl reconciliation, legacy `0.5`/`1.0` significance values,
provenance, feature switching, 201/210-region populations, and contextual CSV
download.

## Regional viewer

The schema-v1 regional path is implemented end to end for published HTTP and
browser-local releases: catalog, immutable manifest, feature descriptors,
parcellation metadata/index, typed values/statistics/histograms, region
search/tree, scalar coloring, shared SVG/list selection and hover, URL state,
provenance, and CSV export. The compact distribution overlays independently
sum-normalized selected-region shapes on the global distribution. The expanded
comparison places each selected region's normalized distribution and
descriptive statistics in one aligned table, with the global population as a
distinct reference row on the same axes, and exports selected regions with
context, raw bins, normalized probabilities, and sample sizes. Histogram curves use presentation-only,
shape-preserving interpolation while bin hover/export retains exact values. The
comparison remains behind a compact launcher until opened. Desktop and tablet
use a nonmodal tray anchored above that launcher, preserving interaction with
the atlas and region browser while keeping scientific view geometry stable.
The tray uses a strong top edge, elevation, selected-region count, slide-up
motion, and an explicit minimize control to make the overlay state clear.
Phones use a modal bottom sheet with a backdrop. Both presentations close with
their minimize control or Escape, restore focus to the launcher, and scroll
large comparisons internally; tapping the phone backdrop also closes the
sheet. Synthetic fixtures are visibly identified as non-scientific.

`DatasetSession` owns asynchronous catalog/release/region/feature lifecycle,
generation-based stale-work suppression, and cancellable idle prefetch. Active
prefetch aborts propagate through repositories, HTTP/local resource readers,
and regional materialization without poisoning a foreground request for the
same immutable resource. Dataset-derived feature/representation repair and
explicit feature switching atomically reconcile unsupported parcellation state
before requesting resources, with a replace-history URL update. Explicit URL
and parcellation choices remain authoritative. This permits Beryl-only releases
without retaining the global Allen default or issuing a misleading empty
payload. Dataset/parcellation changes clear stale hover, and
regional-tree rerenders preserve current hover presentation. Projection and
region-list hover also place a transient labeled marker at the hovered region's
current statistic on the global observation histogram when the statistic shares
that histogram's value axis. The histogram x-axis exposes its minimum and
maximum bin edges together with the feature unit. It also mirrors the effective
color interval with boundary guides, a subtle selected-range tint, and dimmed
out-of-range tails; colorbar dragging and reset update this read-only analytical
view immediately.

The header Help action opens one scientific-workflow guide with a responsive,
faithful map of the actual viewer layout. Five concise expandable sections
cover the top-bar scientific context, region search/ranking/selection, linked
slice navigation, visualization parameters, and global/selected-region
distributions and exports. The structure can accept future representation
guidance without splitting Help into separate guides. App-specific definitions
clarify dataset/release identity, features, representations, parcellations,
populations, statistics, and presentation-only color mapping without attempting
to teach general neuroscience. A collapsed About & credits section links to
IBL Core, names Cyrille Rossant, Mayo Faulkner, Olivier Winter, Gaelle Chapuis,
and Dan Birman, and reserves clearly non-clickable forthcoming entries for the
paper and data release. Keyboard shortcuts remain
available as a collapsed secondary reference. The
global keyboard layer opens feature search with `/`, moves to adjacent
manifest-ordered features with `Shift + Down` / `Shift + Up`, and opens Help
with `?`. It is suppressed during text/form entry and modal dialogs, does not
wrap feature boundaries, announces feature position, and keeps every action
available through visible controls. Feature loading prefetches the immediate
next and previous catalogue neighbours.

Release-provided scientific feature descriptions are visible during discovery
and after selection. Feature-picker results retain compact unit/representation
metadata and add a two-line description that participates in search. The
selected regional feature repeats that description above its global summary,
while the Info dialog remains the complete view of value semantics and
provenance. The frontend does not maintain a feature-description dictionary.
The pinned channel-development release has authoritative upstream descriptions
for 25 of 35 source features; the ten unresolved waveform descriptions and
units are audited in `docs/data/CHANNELS_RECIPE.md` and must not be guessed by
the browser or builder.

The registered projection-pack content carries the immutable 80 µm v3 inventory: 165
coronal, 142 sagittal, and 100 horizontal display planes in 52 depth-eight
indexed packs totaling 5,604,696 compressed bytes. It is derived byte-for-byte
from the validated bilateral 10 µm v2 parent, which remains the scientific and
reproducibility authority. State, URLs, cursor coordinates, guides, and affines
remain on the exact native 10 µm grid; display-plane selection alone snaps to
the nearest sparse SVG with lower-index tie breaking.

The projection-pack source verifies compressed bytes before cache admission. A
module worker owns a 32 MiB decoded LRU and returns only requested fragments;
each retained view caches parsed SVG layers. The current Linux Chromium sanity
run measured 10.0–13.4 ms median cold commits, 1.4–2.7 ms same-pack commits,
0.6–1.0 ms retained revisits, no long tasks, and a 16.8 ms maximum frame gap.
See
`docs/rendering/ANATOMY_NAVIGATION_PERFORMANCE.md`.

## Volume viewer

The browser/golden volume path supports `chunks3d` and
`orthogonal_slice_packs`, float16/float32 decoding, optional gzip, explicit
storage-axis permutation, declared `index_to_world_um` mapping, bounded decoded
caches and Canvas2D scalar slices inside the retained viewport. A scalar Canvas
is hosted in an SVG coordinate layer beneath the retained registered anatomy
SVG. The runtime requires exact `reference_space_id` equality before requesting
volume bytes, transforms half-index voxel edges through the volume and
projection affines, preserves signed display orientation, and uses pixelated
nearest-neighbor paint. Anatomy outlines, guides, picking, and selection remain
available above the scalar plane.
Published and local releases share the same transport-independent volume
payload contract.

Volume plane selection applies the declared inverse affine to the shared world
cursor and checks half-index voxel-edge bounds. An outside cursor fails
explicitly before any plane resource request; it is never clamped to the
nearest edge slice. Volume failures preserve the loaded anatomy with an
explicit error instead of clearing the frame. The golden fixture's synthetic
values occupy an explicitly declared small Allen CCF 2017 subgrid solely to
exercise compositing; they have no scientific interpretation. Pointer
inspection follows the nearest-neighbor
screen-to-projection-to-world-to-voxel chain even where no anatomical SVG path
exists. Sentinel and checksummed mask validity produce the same
valid/outside/missing classification used for transparent Canvas
paint. URL v4 persists volume opacity and anatomy-outline visibility; opacity,
outlines, recoloring, hover, and selection repaint retained layers without
fetching or decoding. The active volume source owns one 96 MiB decoded budget
shared by mask and scalar caches, is disposed on feature switching, and uses
consumer-aware in-flight deduplication so obsolete-render or prefetch
cancellation cannot poison a current consumer.

This proves the browser architecture, not the production science. Q4 still
blocks the authoritative affine/axis mapping and any remaining missing-value
semantics. Q5 remains open until the final HTTP/CDN origin confirms the
transport choice.

A standalone, ignored local review artifact now compares the eight direction
candidates permitted by the exact W26/Allen grid-shape match in linked
orthogonal views. It also exposes voxel-center versus half-voxel-shifted
coordinates and exports a reviewer choice without changing production state.
The all-forward mask candidate currently ranks first, but no transform has been
selected; procedure and limitations are in
`docs/data/VOLUME_GEOMETRY_REVIEW.md`.

The current implementation input is the private immutable `ea_active`
`2026_W26` 50 um object. Its exact URI and official `ibleatools` access recipe
are recorded in `docs/DATA_SOURCES.md`. The authenticated snapshot is
238,954,924 bytes with SHA-256
`1f7509fe9e368a90704173bdb5c385827b199a7d5fa4b0aaa8fec5aca5402253`.

Current W26 evidence favors depth-four orthogonal slice packs. Offline
measurements for `psd_lfp`, `rms_ap`, and `polarity` require three center-plane
objects and 0.20–0.36 MiB gzip, versus 36–136 cube requests and 1.35–4.56 MiB.
Ten-trial local Chromium measurements put depth-4 cold planes at 14.6–15.5 ms
p50 and 29.5–40.0 ms p95, cached navigation at 2.4–2.6 ms p50 with no requests,
and six-plane paint at 1.7–2.3 ms p50. Depth 8 roughly doubles center bytes and
raises cold p50 to 24.3–26.2 ms. The committed raw reports and limitations are
summarized in `docs/data/VOLUME_2026_W26_EVIDENCE.md`.

## Local data and downloads

Local imports validate the complete supported regional/volume resource graph
and every declared SHA-256 before an atomic IndexedDB write. Storage is
namespaced by source dataset and immutable release, and the viewer distinguishes
local from published content without a shadow scientific schema.

Share copies complete URL state; Info exposes immutable release, feature
semantics, and source/builder provenance; current regional statistics and
selected-region comparisons export as context-rich CSV. Schema-v1 release and
feature artifact metadata now survives runtime validation instead of being
discarded. The Download action presents the contextual regional CSV alongside
declared feature/release artifacts and remains available for volume features.
Published artifacts pass through the verified immutable resource fetcher;
browser-local artifacts use the same repository boundary after complete import
validation. Encoded gzip bytes are preserved, and integrity failures remain
visible without producing a corrupt download. Direct immutable URL display,
polished whole-release packaging, and broader local-dataset management are
non-blocking follow-ups under D040.

## Publishing

Publishing remains capability-token based with public reads and authenticated mutations. The implementation supports resumable staged uploads, byte-size/SHA verification, immutable releases, aliases, catalog generation, and external validation hooks.

Mutation handling is designed for multi-process WSGI deployment with a filesystem lock around state-changing requests. JSON metadata and binary upload chunks have independent request-size limits. No OAuth/user platform, database, or queue is required for the current launch architecture.

Metadata requests are bounded at a configurable 32 MiB by default, which
accommodates representative 41-feature volume inventories and the supported
100,000-artifact descriptor limit with measured headroom. Binary chunks retain
a separate configurable 16 MiB cap. CLI, WSGI environment, systemd, nginx, and
tests describe the same limits. Stale staging cleanup uses the same process-wide
mutation lock as WSGI mutations.

## Quality gates

CI uses uv 0.12 with the committed builder and publishing locks, Python 3.12,
and Node 22. The local Justfile uses the same uv boundary and never installs
into system Python. CI runs Python builder/publishing tests plus
TypeScript typechecking, browser unit/rendering tests, a production build, and
Chromium Playwright tests. Architectural tests protect important dependency
directions so domain/core code cannot silently acquire renderer/UI
dependencies. `just check` remains the local completion gate.

## Remaining launch work

The ordered source of truth is `docs/IMPLEMENTATION_PLAN.md`. In summary:

1. expose the validated `2026_W32` channel development release through an
   authorized non-production origin and repeat real-value browser acceptance;
   freeze the paper release after Q2;
2. extend volume browser/HTTP benchmarks, resolve Q4-Q5 authoritatively, and
   build the real immutable volume release on the completed projection/schema
   foundation;
3. review the completed `ibl_neuropixel_brainwide_01` audit, freeze the approved
   scalar catalog, and build the production cluster release;
4. keep the validated D038 preserved five-family BWM release and opt-in local
   browser acceptance green; online catalog publication remains deferred until
   authorized;
5. retain the completed artifact-backed and contextual current-feature exports;
   direct URL display and broader package/local-management UX are non-blocking;
6. stage immutable assets on S3/CloudFront and finalize catalog/origin/default
   alias/publishing choices in Q8-Q9;
7. run final production-origin, performance, responsive, automated Chromium,
   and documented manual Firefox/Safari QA under resolved Q11.

Production promotion of the independent 3-D lab, AGEA, MERFISH, large point
clouds, inferential statistics, full OAuth, and broad legacy custom-bucket
compatibility remain deferred unless explicitly promoted.

## Source of truth

Use these documents in order when deciding what to build next:

1. `AGENTS.md`
2. `docs/LAUNCH_SPEC.md`
3. `docs/IMPLEMENTATION_PLAN.md`
4. `docs/OPEN_QUESTIONS.md`
5. `docs/ARCHITECTURE.md`
6. `docs/DECISIONS.md`
7. this status document and focused implementation/source docs

Historical implementation detail remains available in Git history; this file intentionally records the current integrated state rather than an append-only development diary.
