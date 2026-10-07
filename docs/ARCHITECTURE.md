# Architecture

Status: active stable-boundary reference.

This document defines durable system boundaries. Exact schema fields, formulas,
asset inventories, codec mechanics, completed migrations, and benchmark values
belong in schema, decision, contract, or evidence documents linked from the
[`SYSTEM_OVERVIEW.md`](SYSTEM_OVERVIEW.md).

## System direction

Canonical scientific inputs pass through deterministic dataset-specific
builders into immutable schema-v1 releases. Public browser reads remain static
object-storage/CDN reads wherever possible. Publishing manages authorization,
staging, validation, publication, aliases, and catalogs; it never transforms
scientific data.

## Browser dependency boundaries

```text
UI -----------------\
                     -> application -> domain/core
rendering -----------/        |
                              data contracts

HTTP / IndexedDB adapters -> resource readers -> data materializers
```

- `core/` owns transport-, DOM-, and renderer-independent coordinates and
  calibration primitives.
- `domain/` owns typed application state, actions, and reducers.
- `application/` owns asynchronous dataset/release/feature lifecycle,
  reconciliation, and stale-work cancellation.
- `data/` owns schema-v1 validation, resource materialization, integrity,
  caching, and HTTP/local transport adapters.
- `rendering/` owns retained rendering runtimes and format adapters.
- `ui/` owns plain-DOM views/controllers; complex data shaping remains pure and
  testable.

`AtlasApp` composes these responsibilities. Avoid dependency-injection
frameworks, global service registries, or abstractions without an existing
product variation.

`AppShell` delegates downloads to `DownloadDialogController`, local import,
management, deletion and sharing dialogs to `LocalDatasetDialogs`, panel
preferences and resizing to `WorkspacePanelLayoutController`, and retained
slice/static loading state to `RetainedViewStatus`. The latter tracks
typed requested/displayed content and supersession; retained viewports remain
the geometry and asset-readiness boundary. `DatasetSession` guards catalog and
scientific payload commits by generation and cancels superseded foreground
feature work. `AtlasApp` additionally guards catalog-dependent navigation and
owns a single startup lifetime with terminal, idempotent teardown.

## Dataset and release model

A dataset ID is an opaque runtime identifier, not a closed frontend enum. A
dataset contains features, and a feature may independently expose `regional`,
`volume`, or future representations. Catalogs/manifests drive releases,
features, ordering, representations, and parcellations.

D056/D061 add a catalog/navigation layer above this runtime identity: projects
group scientifically distinct datasets, while a project edition coordinates
an explicit frozen scope of exact immutable releases selected for one
publication or other context. Each exposed project/edition mapping is
immutable even though its discovery catalog is mutable. Project membership and
edition mappings are curator-owned discovery metadata; they do not replace
dataset IDs, release provenance, or manifests. Browser navigation explicitly
distinguishes coordinated, custom-with-optional-baseline, and local context
rather than inferring an edition from matching releases. The accepted
interaction and catalog requirements are in
[`frontend/DATASET_NAVIGATION.md`](frontend/DATASET_NAVIGATION.md).

Schema v1 under `schema/v1/` is the sole producer/consumer release contract.
Published and local data use the same manifest, feature, representation,
statistics, volume, and resource contracts; IndexedDB changes only transport.
The independent Python and TypeScript validators execute one shared semantic
fixture corpus. Their semantic checks are grouped into common resource,
distribution/display, volume/grid, projection, and mesh modules behind the
existing schema-v1 validation entry points. The schema files remain the sole
release contract.

Immutable release contents include provenance and checksummed resources.
Mutable aliases and catalogs live outside release directories. Existing
immutable scientific releases are never changed to adopt a new contract or
selection; builders emit a new release ID.

## Scientific transformation and publication

Source acquisition/pinning, scientific recipe selection, transformation,
serialization, validation, and publication are separate steps. Dataset-specific
builders own scientific source loading and computation; shared builder code
owns actual common release mechanics. The ephys volume builder separates
explicit geometry/configuration from deterministic release writing and pinned
snapshot adaptation, retaining its public entry points. Development-bundle
machinery similarly separates descriptor parsing, graph acquisition, and local
validation behind its facade. Public authoring keeps model validation and the
atomic ZIP transaction in `Dataset`; release serialization is a separate
internal module. Do not introduce a generic scientific
pipeline DSL or move scientific choices into publishing.

Every release records source identity, vintage/release, source hashes,
population/QC, transformation/aggregation/validity semantics, builder command,
and relevant tool versions wherever the contract permits. Unresolved choices
fail closed rather than inheriting convenient defaults.

## Data access, integrity, and caching

HTTP and IndexedDB implement the same small resource-reader boundary and feed
shared materializers, including one volume-feature loader for both transports.
Local-release resource integrity and bounded decoding are separate from
release-graph validation. Only bytes matching declared served-byte size and SHA-256
may enter persistent cache or decode. A bad cached entry is evicted and may be
retried cleanly. Decoded-cache identity combines resource hash with the complete
decoding contract, never a feature-relative path alone. Failed in-flight loads
remain retryable and multi-consumer cancellation must not poison active work.

## Coordinate and asset identity

Coordinate compatibility has three independent levels:

- `reference_space_id` names the world frame and is the only equality required
  before independently gridded anatomy and volume layers composite;
- grid identity includes shape, ordered axes, affine, integer-index centers,
  and half-index voxel-edge extent;
- asset, pack, and release IDs identify immutable encodings and never prove
  scientific compatibility.

Anatomy and volume independently map the one ML/AP/DV cursor through their
declared transforms. Coincident dimensions, resolution labels, or pack IDs are
not alignment evidence. Physical volume transport stays below a storage-neutral
decoded-plane source and remains independent of scientific geometry.

## Rendering boundaries

`ProjectionViewportFactory` is the retained 2-D application boundary. Each
registered coronal/sagittal/horizontal viewport owns stable scalar Canvas,
regional SVG, interaction, guide, and error layers. Pure registered volume
placement and slice coloring live outside the viewport lifecycle; render
scheduling, cancellation, and layer coordination remain viewport-owned. A capability-driven
projection registry also exposes affine-free Top and Swanson static regional
views without slice, crosshair, world-coordinate, or volume claims.

One world cursor is the scientific bridge across registered views. SVG remains
the regional interaction representation because stable path IDs support
delegated picking, selection, coloring, and guides. The projection pack is the
only browser anatomy format; parent anatomy packs remain derivation and
reproducibility evidence.

The optional retained 3-D viewport is a sibling, not another 2-D facade. It
shares reference-space identity, regional presentation, selection, and hover,
while owning camera, explode, GPU resources, lifecycle, and failures. D070 selects
native GLB-derived geometry and D042 remains rollback evidence. Encoding volumes remain linked 2-D
slices and are never converted into that anatomy mesh path.

Opaque anatomy uses a single pass. Translucent regional context uses retained
[weighted blended OIT targets](rendering/3D_TRANSPARENCY.md), with opaque depth
occlusion and one final display-colour conversion; it does not sort or alter
source triangles.

## Scalar presentation

The immutable release owns representation-specific scale/domain availability,
Signed-log threshold, focus bounds, and defaults. One resolved value scale
synchronizes color normalization, all histograms, range geometry, markers, and
interaction transforms. Full/Focused changes analytical viewport/binning, not
source values or selected color bounds. Exact formulas, bin/tail rules, and
selection procedure are defined by D047/D050/D052/D053, schema v1, and
[`data/DISTRIBUTION_AUDIT.md`](data/DISTRIBUTION_AUDIT.md).

## Frontend and UI

The frontend uses strict TypeScript, Vite, semantic HTML/CSS, plain DOM,
explicit state/actions, workers for expensive decode work, and Playwright for
browser contracts. Projection/workspace registries drive desktop, responsive,
navigation, maximize, and focus behavior. Large UI controllers are decomposed
by ownership rather than arbitrary file size; event delegation is preferred
for large dynamic lists.

## Publishing

Scientific release, pack and catalog publication uses an operator-invoked local
command with temporary, least-privilege AWS credentials. It publishes already-built
releases to private S3, preserves resumable private staging, verifies complete
size/SHA/schema graphs, prevents immutable-key overwrite, and updates mutable
catalogs last. Public reads are lock-free static CloudFront reads; there is no
runtime publication backend.

Browser deployment is separate: successful CI on `main` automatically publishes
the exact clean Linux site build using a site-only OIDC role. The shared browser
artifact profile in `web/artifact-profiles.json` selects its navigation companion.
`tools.site_compatibility` verifies that companion's exact pack/hash, native grid,
affine and signed mappings against the deployment configuration and hash-addressed
served manifest snapshots. Catalog/pack schema validation and mesh reference-space
checks reuse schema v1. The compatibility evidence is recorded in the site receipt
and revalidated before apply. Projection root bytes are also verified by the browser.

CI checks the unpublished build against the production origin before changing the
site entry and checks the live viewer afterward. Synthetic packaging tests retain
their test-only scope. Catalog discovery remains mutable; a site receipt records
the catalog at publication, without freezing subsequent discovery. Catalog
promotion must validate the proposed graph against the running site and synchronize
tracked deployment descriptors/snapshots afterward.

Cross-dataset project, edition, release-presentation, and default metadata is
owned by a repository-versioned curator configuration rather than any one
dataset publisher. One shared compiler validates that configuration against
the immutable published inventory, rejects remapping an exposed edition ID,
and conditionally promotes the complete catalog last while retaining the
last-known-good catalog on failure. The local S3 publisher and optional hosted
service use the same compiler and promotion rules. `CatalogManager` owns
compilation and local catalog/history writes; `PublicationStore` retains its
API, mutation lock, and audit ordering. Public catalog writes precede private
edition-history writes, and exposed editions seed recovery if the latter fails.

The implemented filesystem-backed WSGI service retains revocable
capability-style bearer authentication, serialized staging/catalog/alias
mutations, and separate metadata/chunk body bounds. It is a future
multi-publisher option, not part of the initial deployment. Add its server,
database, queue, framework, or OAuth platform only when an accepted requirement
makes the local publisher insufficient.

D055 defines a separate optional sharing lifecycle for already-validated local
releases. Shared copies are opaque, unlisted, expiring CloudFront/S3 resources;
they never enter the public catalog or acquire published-release status. The
first design has no trusted application backend: CloudFront OAC signs narrowly
scoped create-only S3 requests, S3 checks conditional writes and supplied
checksums, and recipients replay the complete schema-v1 validation before use.
Operational abuse controls and fixed expiry bound this convenience path but do
not turn it into authenticated or private storage. Sharing must not weaken or
reuse the official publication lifecycle implicitly.

## Engineering guardrails

- Preserve scientific provenance and deterministic serialization during
  refactors.
- Treat URLs, release formats, and asset contracts as explicit versioned
  interfaces.
- Update producers and consumers coherently; do not add compatibility shadows.
- Prefer deleting duplication to inventing a generic framework.
- Add dependency and cross-language contract tests where they prevent likely
  boundary drift.
