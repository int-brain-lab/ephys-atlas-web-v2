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

## Dataset and release model

A dataset ID is an opaque runtime identifier, not a closed frontend enum. A
dataset contains features, and a feature may independently expose `regional`,
`volume`, or future representations. Catalogs/manifests drive releases,
features, ordering, representations, and parcellations.

Schema v1 under `schema/v1/` is the sole producer/consumer release contract.
Published and local data use the same manifest, feature, representation,
statistics, volume, and resource contracts; IndexedDB changes only transport.
The independent Python and TypeScript validators execute one shared semantic
fixture corpus.

Immutable release contents include provenance and checksummed resources.
Mutable aliases and catalogs live outside release directories. Existing
immutable scientific releases are never changed to adopt a new contract or
selection; builders emit a new release ID.

## Scientific transformation and publication

Source acquisition/pinning, scientific recipe selection, transformation,
serialization, validation, and publication are separate steps. Dataset-specific
builders own scientific source loading and computation; shared builder code
owns actual common release mechanics. Do not introduce a generic scientific
pipeline DSL or move scientific choices into publishing.

Every release records source identity, vintage/release, source hashes,
population/QC, transformation/aggregation/validity semantics, builder command,
and relevant tool versions wherever the contract permits. Unresolved choices
fail closed rather than inheriting convenient defaults.

## Data access, integrity, and caching

HTTP and IndexedDB implement the same small resource-reader boundary and feed
shared materializers. Only bytes matching declared served-byte size and SHA-256
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
regional SVG, interaction, guide, and error layers. A capability-driven
projection registry also exposes affine-free Top and Swanson static regional
views without slice, crosshair, world-coordinate, or volume claims.

One world cursor is the scientific bridge across registered views. SVG remains
the regional interaction representation because stable path IDs support
delegated picking, selection, coloring, and guides. The projection pack is the
only browser anatomy format; parent anatomy packs remain derivation and
reproducibility evidence.

The optional retained 3-D viewport is a sibling, not another 2-D facade. It
shares reference-space identity, regional presentation, selection, and hover,
while owning camera, explode, GPU resources, lifecycle, and failures. D042 fixes
its GLB-derived geometry/LOD direction. Encoding volumes remain linked 2-D
slices and are never converted into that anatomy mesh path.

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

Publishing retains revocable capability-style bearer authentication. Public
reads are lock-free static reads. Filesystem-backed staging/catalog/alias
mutations are serialized across WSGI processes and request bodies are bounded
separately for metadata and binary chunks. Add a database, queue, framework, or
OAuth platform only when an accepted requirement makes the current model
insufficient.

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
