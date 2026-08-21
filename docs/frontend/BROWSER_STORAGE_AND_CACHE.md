# Browser storage and cache policy

Status: implemented foundation plus launch follow-up roadmap.

This document separates browser storage concerns that are easy to conflate:

1. short-lived application memory;
2. persistent caching of published immutable HTTP resources;
3. user-imported local datasets stored in IndexedDB;
4. a possible future offline mirror of published datasets.

The first three serve different ownership and lifecycle requirements. They
should not be combined into one opaque cache.

## Invariants

- Published and local releases use the same schema-v0.1 scientific contract.
- Local storage changes transport only; it does not create a shadow schema.
- Published release files are immutable and addressed through an immutable
  release ID. Mutable catalogs and aliases remain outside release directories.
- Local data are never uploaded implicitly.
- A corrupt, incomplete, or evicted local release must fail explicitly rather
  than render partial or stale scientific data.
- Cache identity must include enough immutable context to prevent collisions
  across dataset, release, feature, representation, and resource path.
- Persistent storage is an optimization and local-data feature, not the source
  of scientific truth for a published release.

## Current implementation

### Published HTTP resources

`ResourceFetcher` provides:

- in-flight request coalescing by absolute URL;
- cache-first Cache Storage reads for resources whose catalog release is
  declared immutable;
- persistent writes to the versioned
  `ibl-ephys-atlas-v2-immutable-v1` cache;
- an API to clear that persistent cache;
- no service-worker dependency.

Catalogs are not persisted by this cache because they may contain mutable
aliases and release listings. `HttpDatasetSource` also keeps manifests, region
metadata, and feature URL resolutions in memory for the lifetime of the app.

The generated anatomy renderer uses browser `force-cache` requests for its
immutable pack-ID URLs. It fetches only the three visible v3 packs for initial
display, then schedules at most one pack ahead in the active navigation
direction. A persistent module worker owns a 32 MiB byte-bounded LRU of decoded
indexed packs and returns only requested SVG fragments; each view separately
retains eight parsed DOM layers.

### Decoded volume data

`VolumeSliceLoader` maintains a byte-bounded in-memory LRU of decoded chunks.
The current default is 96 MiB. Adjacent prefetch is cancellable and does not
make the LRU unbounded.

The final budget must be checked with real releases and representative desktop,
tablet, Safari, and Chromium devices. It is a measured runtime budget, not a
scientific storage-format constant.

### Imported local releases

`LocalDatasetSource` stores schema-v0.1 releases in IndexedDB. The current path:

- namespaces releases by source `dataset_id` and `release_id`;
- validates the complete browser-supported regional/volume resource graph;
- verifies every declared SHA-256 value with WebCrypto;
- performs validation before opening the write transaction;
- adds the manifest and resources in one transaction so an import either
  becomes visible in full or aborts;
- prevents an existing immutable release from being silently overwritten;
- exposes local resources through the same `DatasetSource` payload interfaces
  as published HTTP releases.

This is a sound persistence foundation. The remaining work is primarily
lifecycle management, quota handling, recovery, and user-facing controls.

## HTTP and CDN policy

Immutable release resources and versioned generated anatomy assets should be served with
a long lifetime, for example:

```http
Cache-Control: public, max-age=31536000, immutable
```

Catalogs and mutable aliases should revalidate rather than receive a permanent
cache lifetime, for example:

```http
Cache-Control: no-cache
ETag: "..."
```

The exact headers must be verified from the selected production origin under
Q8. Correct CDN headers complement the application's Cache Storage layer: they
support normal browser caching and avoid unnecessary transfers even where the
application cache is unavailable or evicted.

Immutable cache entries are currently keyed by absolute URL. This is safe only
when an immutable URL can never serve different bytes. Cache names must be
versioned when decoding or resource-identity assumptions change.

## Local dataset management UX

The dataset picker should expose `Import local dataset...` and a local-storage
manager. Before committing an import, show when available:

- source dataset and immutable release IDs;
- title, provenance summary, feature count, representations, and parcellations;
- selected-directory byte size;
- validation errors and warnings;
- estimated available browser quota.

The manager should list each imported release with its source identity, import
date, stored byte size, and a persistent `Local` badge. It should provide:

- explicit deletion of one immutable local release;
- a separate action to clear cached published resources;
- total local-data and remote-cache usage where the browser exposes it;
- clear messaging that a local-data URL does not embed or transfer the data;
- re-import only after explicit deletion, or a separately designed
  integrity-equivalent no-op path.

Deletion should remove a manifest and all namespaced resources atomically.
Deleting cached published data must never delete imported local datasets, and
deleting a local dataset must never clear unrelated HTTP cache entries.

## Quota, persistence, and eviction

Use `navigator.storage.estimate()` when available to report quota and current
usage. Sum selected file sizes before import and leave safety headroom for
transactional writes and browser bookkeeping. Do not invent one universal hard
limit: quotas depend on browser, device, free disk, and browsing mode.

`navigator.storage.persist()` may be offered or requested at an appropriate
user-initiated point, but the application must remain correct when persistent
storage is denied or unsupported.

Handle these conditions explicitly:

- insufficient quota before or during import;
- IndexedDB unavailable in private/restricted browsing modes;
- a blocked or failed database upgrade;
- browser eviction of Cache Storage or IndexedDB content;
- a manifest whose resource records are missing;
- an obsolete application cache namespace;
- an interrupted deletion or transaction abort.

At startup or selection time, a local manifest with missing resources should be
reported as damaged and offered for deletion/re-import. It must not silently
fall through to similarly named published data.

## Persistent remote volume caching

Cache Storage already persists immutable HTTP responses, including volume
resources fetched through `ResourceFetcher`. Do not add a second IndexedDB or
OPFS copy merely in anticipation of performance problems.

First benchmark the selected real production layout with normal HTTP caching
and the existing Cache Storage path. Record:

- cold and warm request counts and transferred bytes;
- cache-hit navigation latency;
- Cache Storage size;
- decoded LRU peak memory;
- eviction behavior under realistic browsing;
- Safari/WebKit and Chromium behavior.

Consider OPFS, IndexedDB sharding, or an explicit download-for-offline feature
only if those measurements reveal a concrete limitation. If introduced, raw or
compressed immutable bytes should generally persist longer than large decoded
arrays, while decoded arrays remain governed by the in-memory LRU.

## Offline scope

Imported local releases should work without a network connection once the app
itself is loaded. Cached published resources may produce opportunistic warm
behavior, but this is not yet a complete offline product: the mutable catalog
and application shell are not managed by a service worker.

Full offline mirroring of a published release, application-shell precaching,
service-worker upgrades, and background cache synchronization are deferred
until an explicit product requirement justifies their lifecycle complexity.
No service worker is required for launch.

## Integrity and privacy

- Local imports retain full graph, byte-size, shape, and declared SHA-256
  validation before storage.
- Publishing validates immutable release bytes before exposure; browser
  decoders continue to enforce declared shapes and byte sizes.
- Local paths and metadata remain on the device unless the user explicitly
  exports or uploads them through a future, separately specified flow.
- Error telemetry, if later added, must not include local scientific payloads
  or local filesystem path information by default.

## Implementation sequence

1. Verify and document production `Cache-Control`, ETag, CORS, and Range headers
   for catalogs, aliases, immutable releases, and generated anatomy assets.
2. Add local-store inventory APIs: list release metadata, stored byte size, and
   atomic per-release deletion.
3. Build the import preview and local dataset manager UI, including distinct
   `Local` labeling and separate local-data/cache clearing actions.
4. Add quota estimation, persistence capability reporting, and actionable
   quota/private-mode/blocked-upgrade errors.
5. Add Cache Storage inventory/version cleanup and expose the existing clear
   operation through settings.
6. Exercise missing-record recovery and database/cache version migrations with
   deterministic unit and Playwright tests.
7. Benchmark real regional and volume releases before changing the 96 MiB LRU
   or adding OPFS/another persistent remote-data layer.
8. Run the final behavior matrix in Chromium, Firefox, and Safari/WebKit.

## Acceptance checks

- A valid local regional or supported volume release imports atomically and
  remains usable after reload.
- A duplicate, corrupt, incomplete, or oversized import produces an actionable
  error and leaves no partial visible release.
- Users can inspect and delete one local release without affecting any other
  release or the published-resource cache.
- Users can clear cached published resources without deleting local releases.
- Immutable HTTP resources are reused on warm navigation; mutable catalog and
  alias changes can still be discovered.
- Decoded volume memory remains bounded during extended slice navigation.
- Storage eviction or unavailable persistence fails explicitly without showing
  stale scientific state.
- No local dataset is uploaded without an explicit future user action.
