# Architecture

## Direction

Canonical scientific data is transformed by deterministic Python tooling into versioned, immutable web releases. Public browser reads should remain static/object-storage reads wherever possible.

```text
canonical scientific data
    -> Python scientific builders
    -> deterministic release serializers + validators
    -> immutable dataset release
    -> object storage / CDN
    -> browser resource adapters
    -> application sessions
    -> UI + rendering
```

The publishing API manages authorization, staging, validation, publication, aliases, and catalog generation. It does not perform scientific transformations.

## Dependency boundaries

The browser is intentionally framework-free. Modules should point inward toward stable concepts instead of letting infrastructure leak into domain code.

```text
UI -----------------\
                     -> application -> domain/core
rendering -----------/        |
                              data contracts

HTTP / IndexedDB adapters -> resource readers -> data materializers
```

Required boundaries:

- `core/` contains transport-, DOM-, and renderer-independent primitives such as atlas/world coordinates and slice calibration.
- `domain/` contains application state, actions, and reducers. It must not depend on rendering or UI implementations.
- `application/` owns asynchronous product workflows such as opening a dataset/release, switching parcellation, resolving features, and canceling stale work.
- `data/` owns release contracts, validation, resource materialization, caching, and transport adapters.
- `rendering/` owns rendering runtimes and their format-specific adapters. Parsing/version compatibility should be separated from runtime loading where practical.
- `ui/` owns DOM views/controllers. Pure view-model construction should be kept separate from DOM mutation for complex controls.

Avoid dependency-injection frameworks, global service registries, or abstractions that do not correspond to an existing product variation.

## Dataset model

A dataset identifier is an opaque published identifier, not a closed frontend enum. Launch configuration may name a fixed set of datasets, but the runtime must also accept publisher-defined datasets.

A dataset contains features. A feature may expose independent representations:

- `regional`
- `volume`
- `points` (future-facing; not launch-critical)

Do not force distinct representations into one physical format. Feature availability, parcellations, releases, and representation availability should be manifest-driven rather than duplicated as frontend enumerations.

## Data access

HTTP and local/IndexedDB data use the same format-level materializers. Transport adapters implement a small resource-reader boundary and are responsible only for locating and reading JSON/bytes/arrays. Regional values, statistics, histograms, and region metadata are decoded once in shared code.

Immutable-resource caching may be used for responsiveness, but failed in-flight
loads must be retryable and persistent caches must remain explicitly clearable.
Only bytes that match the resource's served-byte size and SHA-256 enter a
persistent cache. Cache hits are verified before decode; an invalid entry is
evicted and may be fetched once cleanly rather than poisoning every retry.
Decoded-cache keys combine the SHA-256 with the complete decoding contract
(codec, dtype, shape, byte order, axes/layout as applicable), never a
feature-relative path alone. Artifact identity and release immutability are
part of the data contract, not inferred from URL conventions.

## Contracts and validation

The completed data-contract phase of the pre-launch cutover established schema
v1 as the sole contract used by every producer and consumer. Browser validation remains organized by contract
concern (primitive values, binary arrays, catalog/manifest, feature descriptors,
statistics, decoded payloads, and complete local-release graphs) behind a
stable public validation facade. There is no v0.1 compatibility runtime.

The Python builder validator and TypeScript runtime validator are independent implementations of the same contract. Shared valid/invalid fixture corpora should be used to prevent semantic drift; do not add a large runtime schema dependency solely to deduplicate validation code.

## Scalar presentation and distributions

D050 separates the value transform from the analytical distribution domain.
Linear, Log, and Signed log are value scales; Full and Focused are independent
distribution domains. One resolved scale continues to synchronize color
normalization, both histogram presentations, range geometry, markers, and
interaction transforms as required by D047. Focused affects the global and
selected-region analytical distributions only. The compact color-range
histogram remains Full under the same scale so analytical focus cannot mutate
coloring or a manual range.

Signed log is the invertible transform
`sign(x) * ln(1 + abs(x) / c)`, with inverse
`sign(y) * c * (exp(abs(y)) - 1)`. Its finite positive `c` is expressed in raw
feature units and belongs to the immutable release; it is neither estimated by
the browser nor persisted as mutable URL state. Log requires the complete
finite population to be strictly positive. A focus interval cannot change
scale eligibility.

Every available scale/domain combination is binned directly from raw finite
observations, or from valid voxels for volumes. Focused distributions preserve
whole-population normalization and expose exact underflow and overflow counts;
they never renormalize the visible bins. Edges are raw-unit values: underflow
is below the first edge, overflow is above the last edge, bins are left-closed
and right-open except that the final bin includes the last edge. Regional
payloads additionally carry per-region counts over the same bins and tails.
Volume distributions remain global valid-voxel summaries and do not synthesize
regional curves. Full distributions cover the complete finite domain and have
zero tails.

Availability, the Signed-log threshold, focus bounds, and preferred
scale/domain are release-owned per feature and representation. They are chosen
from read-only source-population audits and owner-reviewed selection artifacts,
not inferred at runtime. Regional and volume preferences therefore remain
independent even when they describe the same feature. Linear/Full is mandatory
for a nonempty scalar population; all additional choices form a rectangular
scale-by-domain cross-product.

This architecture requires one coherent schema-v1 contract cutover across all
producers, validators, transports, materializers, UI state, and exports. There
is no legacy adapter or parallel distribution model. Existing immutable
releases remain readable only by the code version matching their contract;
affected scientific data is rebuilt under new immutable release IDs.

## Frontend

- TypeScript
- Vite
- plain DOM / lightweight native components; no React or other frontend framework by default
- semantic HTML/CSS
- explicit typed application state and actions
- application-session objects for asynchronous workflows
- Web Workers for expensive decoding/transforms
- IndexedDB and/or Cache Storage for persistent local datasets/cache where justified
- Playwright for browser-level tests

`AtlasApp` is a composition/presentation root, not a data-loading service. Long-lived workflows belong in `application/` objects such as `DatasetSession`.

## Rendering

The application rendering boundary is one retained layered 2-D
projection viewport. It composes optional scalar-volume Canvas, regional SVG,
selection/hover, and guide layers without replacing the mounted view. The
previous `SliceRenderer`/hybrid boundary has been removed rather than wrapped.

A projection registry distinguishes registered orthogonal slice stacks from
static regional maps by capabilities. `SliceAxis` remains a scientific type
for coronal/sagittal/horizontal only. Top and Swanson use the same regional SVG
layer but declare no affine, volume, slider, wheel-navigation, or crosshair
capability.

The active regional anatomy content remains derived from validated bilateral
Allen CCFv3 geometry. One logical projection-pack contract exposes all five 2-D
views while preserving separate provenance for registered and curated static
geometry. The completed browser supports only the current contract; older pack
artifacts may remain build/reproducibility evidence rather than runtime formats.

SVG remains the regional interaction representation because stable path IDs support delegated picking, selection, coloring, and linked guides. Expensive decode work belongs in workers and decoded geometry caches must be byte-bounded.

One ML/AP/DV world cursor is the only scientific bridge among registered
layers. Anatomy and volume sources independently map it through their declared
transforms and then into screen space through an explicit plane registration;
coincident CSS dimensions are not proof of scientific alignment. Physical
volume transport remains below a storage-neutral decoded-plane source.

Scientific coordinate identity has three deliberately separate levels:

- `reference_space_id` names the world reference frame and is the only equality
  required before compositing independently gridded layers;
- grid identity includes shape, ordered index axes, affine, integer-index voxel
  centers, and half-index voxel-edge extent, and normally differs between
  anatomy and volume resolutions;
- asset/release/pack IDs identify immutable encodings and are never scientific
  compatibility evidence.

The application remains renderer-agnostic for 3-D, while the first isolated
brain-mesh lab uses Three.js WebGL2 to minimize implementation and browser risk.
The secondary/context content registry distinguishes summary,
`projection-2d`, and `scene-3d` content while the workspace retains its three
orthogonal slots plus one secondary slot. `ProjectionRegistry` and
`ProjectionViewport` remain specifically 2-D. A sibling retained 3-D viewport
shares coordinate-space identity, regional presentation, selection, and hover
through technology-neutral inputs, but owns camera, explode, GPU resources,
lifecycle, and failure state. `AtlasApp` remains the composition root; neither
the standalone lab nor the retained 3-D viewport duplicates its dataset
session, URL reducer, colormap, or projection layers. D037 and
`docs/rendering/3D_INTEGRATION_PLAN.md` define the integration boundary.

Production mesh geometry is an immutable derived web asset, not the raw source
GLB. Its manifest records source hashes, coordinate axes/units/transform,
canonical signed regional IDs, hemisphere, centroids, LOD parameters, resource
sizes, and SHA-256. Geometry may be merged into a few GPU-friendly chunks with
a per-vertex feature ID; colors, visibility, selection, hover, and explode
vectors remain dynamic presentation data. Future volume rendering shares the
coordinate-space contract and global download/cache budget, not the mesh
transport or renderer implementation.

The sole implemented geometry asset contract is the snake_case
`atlas-mesh-pack-v1` schema under `schema/v1/`. Its independent Python and
TypeScript semantic validators share the release-contract corpus. Offline
compiler primitives emit versioned merged EAM3 resources; complete-graph
validation follows every declared resource and rejects undeclared files. The
committed fixture is synthetic and test-only. No production mesh is selected
until Q12 is closed.

Mesh discovery begins from an application-supplied immutable manifest
descriptor and an injected verified `ResourceFetcher`; it does not fetch an
LOD. Manifest-selected geometry is verified before worker transfer, explicitly
gunzipped and decoded in a module worker, and returned as transport-neutral
merged hemisphere chunks. Shared requests preserve per-consumer cancellation.
Decoded retention is byte-bounded and keyed by resource SHA plus the complete
codec/EAM3/encoding/quantization contract, never by a relative path.

## UI

Large UI controllers should be decomposed by ownership, not by arbitrary file-size targets. Data shaping/search/statistics calculations should be pure and testable; DOM controllers own events, focus, accessibility, and mutation.

Projection definitions drive view construction, supported layers, navigation
controls, secondary-panel membership, responsive switching, and focus behavior.
Do not maintain separate hardcoded desktop/mobile projection inventories.

Event delegation is preferred for large dynamic lists such as the regional tree to avoid rebuilding large listener graphs on every render.

## Builder

Scientific source loading/computation stays dataset-specific. Deterministic release-format mechanics are shared.

```text
channels.py / clusters.py / future scientific builders
                    |
             regional_release.py
                    |
          binary/json release files
```

Do not introduce a generic scientific pipeline DSL. Shared code should represent an actual common output contract, not erase scientifically meaningful differences between datasets.

## Publishing

Publishing retains capability-style bearer authentication rather than introducing a user/OAuth platform. The service is intentionally small and stdlib-based.

Filesystem publication is safe only if catalog/index/upload mutations are serialized across WSGI processes, not merely across threads. Request bodies are bounded separately for JSON metadata and binary chunks. Public reads remain lock-free static reads; mutation handlers acquire the process-wide filesystem lock.

A database, ORM, queue, or web framework should be added only when deployment or product requirements make the filesystem model insufficient.

## Engineering guardrails

- Prefer deleting duplication to introducing a generic framework.
- Preserve scientific provenance and deterministic serialization during refactors.
- Treat URLs and persisted release formats as explicit versioned contracts.
- During the approved pre-launch reset, update producers and consumers together
  and delete superseded compatibility adapters before handoff.
- Add architectural tests for dependency direction and contract parity where they prevent likely regressions.
