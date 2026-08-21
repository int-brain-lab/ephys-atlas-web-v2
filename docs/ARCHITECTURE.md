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

Immutable-resource caching may be used for responsiveness, but failed in-flight loads must be retryable and persistent caches must remain explicitly clearable. Artifact identity and release immutability are part of the data contract, not inferred from URL conventions.

## Contracts and validation

Schema v0.1 remains explicit and versioned. Browser validation is organized by contract concern (primitive values, binary arrays, catalog/manifest, feature descriptors, statistics, decoded payloads, and complete local-release graphs) behind a stable public validation facade.

The Python builder validator and TypeScript runtime validator are independent implementations of the same contract. Shared valid/invalid fixture corpora should be used to prevent semantic drift; do not add a large runtime schema dependency solely to deduplicate validation code.

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

`SliceRenderer` is the application rendering boundary. Atlas/world-coordinate and slice-calibration primitives live outside rendering so domain state and URL migration do not depend on a renderer implementation.

The active regional anatomy path uses immutable sparse indexed SVG packs derived from the validated bilateral Allen CCFv3 parent pack. Manifest/version parsing is separated from the anatomy runtime so format compatibility can evolve without mixing schema rules into fetch/cache/worker code.

SVG remains the regional interaction representation because stable path IDs support delegated picking, selection, coloring, and linked guides. Expensive decode work belongs in workers and decoded geometry caches must be byte-bounded.

3D remains renderer-agnostic. Datoviz, custom WebGPU, Three.js/WebGPU/WebGL, or another suitable browser renderer can be evaluated without coupling the core application model to a specific 3D implementation.

## UI

Large UI controllers should be decomposed by ownership, not by arbitrary file-size targets. Data shaping/search/statistics calculations should be pure and testable; DOM controllers own events, focus, accessibility, and mutation.

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
- Keep compatibility adapters narrow and removable.
- Add architectural tests for dependency direction and contract parity where they prevent likely regressions.
