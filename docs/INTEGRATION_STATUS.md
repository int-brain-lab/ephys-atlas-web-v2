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

The regional UI keeps DOM concerns in its controller while region search/value/statistics derivation is pure/testable. Large dynamic tree interaction uses delegated events.
The region browser defaults to the expandable anatomical hierarchy and offers
URL-persisted ascending or descending value rankings as a flat selectable list.
Its compact icon control cycles anatomy, descending value, then ascending value.
Finite values rank globally, missing values remain last, and returning to
anatomical order restores the prior expansion state.
The feature color range is edited on a histogram-backed dual-handle colorbar.
Pointer or keyboard interaction switches automatic bounds to a URL-persisted
manual range, exact values remain available from the bound labels, and reset
restores the robust automatic range without exposing permanent numeric fields.
The colormap is confined to the selected interval, and dragging that interval
translates both bounds together without changing its width. Feature magnitude
statistics (`mean`, `median`, `min`, and `max`) are colorable; observation count
remains supporting sample-size metadata in tooltips, comparisons, summaries,
and exports rather than a feature-color statistic.
Color scale selection defaults to `Auto`: the browser resolves optional
feature-level `display.scale` metadata and otherwise uses linear color
normalization. Explicit linear/logarithmic overrides persist in URLs, while
values, statistics, histograms, tooltips, and exports remain unchanged.

## Brand identity

The application header uses the official 2026 IBL Core colored-negative SVG
lockup directly on the dark header without a separate background block. The
institutional cyan is the primary interface accent; blue and magenta remain
brand tokens. Scientific feature colormaps, Allen ontology colors, and
categorical selection colors remain independent of branding. Asset identity
and usage constraints are recorded in `docs/frontend/BRAND_IDENTITY.md` and
D028.

## Anatomy rendering

The active regional anatomy display is the immutable sparse `anatomy-pack-v3`, derived byte-for-byte from the validated bilateral 10 µm `anatomy-pack-v2` parent. Application/URL/cursor state remains in native 10 µm coordinates while display geometry uses the sparse 80 µm inventory.

Anatomy manifest/version validation is separate from runtime fetch/cache/worker behavior. The v1/v2 compatibility paths remain explicit where they are still useful for validation or rollback; format-specific code should not be unified merely to reduce file count.

## Scientific data/builders

Schema v0.1 is the current browser/publishing release contract. Regional release serialization is shared by channel and cluster builders; scientific source selection and computation remain dataset-specific.

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
defaults. Production remains blocked on Q6's authoritative project/snapshot
and launch feature catalog.

## Regional viewer

The schema-v0.1 regional path is implemented end to end for published HTTP and
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
comparison remains behind a compact launcher until opened as a native modal
dialog. Desktop uses a dimmed, blurred backdrop and inset floating surface;
phones use a bottom sheet. The dialog traps interaction, closes with its close
control, backdrop, or Escape, restores focus to its launcher, and scrolls large
comparisons internally. Synthetic fixtures are visibly identified as
non-scientific.

`DatasetSession` owns asynchronous catalog/release/region/feature lifecycle,
generation-based stale-work suppression, and cancellable idle prefetch. Active
prefetch aborts propagate through repositories, HTTP/local resource readers,
and regional materialization without poisoning a foreground request for the
same immutable resource. Dataset/parcellation changes clear stale hover, and
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
to teach general neuroscience. Keyboard shortcuts remain
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

The active anatomy display is the immutable 80 µm `anatomy-pack-v3`: 165
coronal, 142 sagittal, and 100 horizontal display planes in 52 depth-eight
indexed packs totaling 5,604,696 compressed bytes. It is derived byte-for-byte
from the validated bilateral 10 µm v2 parent, which remains the scientific and
reproducibility authority. State, URLs, cursor coordinates, guides, and affines
remain on the exact native 10 µm grid; display-plane selection alone snaps to
the nearest sparse SVG with lower-index tie breaking.

Fetch and compressed-byte verification remain in the anatomy source. A module
worker owns a 32 MiB decoded LRU and returns only requested fragments; each view
retains eight parsed SVG layers. The committed Chromium benchmark measured
9.3–10.6 ms median cold commits, 2.2–3.4 ms same-pack commits, no long tasks,
and a 17.6 ms maximum frame gap. See
`docs/rendering/ANATOMY_NAVIGATION_PERFORMANCE.md`.

## Volume viewer

The browser/golden volume path supports `chunks3d` and
`orthogonal_slice_packs`, float16/float32 decoding, optional gzip, explicit
storage-axis permutation, declared `index_to_world_um` mapping, bounded decoded
caches, Canvas2D scalar slices, and renderer switching below `SliceRenderer`.
Published and local releases share the same transport-independent volume
payload contract.

This proves the browser architecture, not the production science. Q4 still
blocks the authoritative affine/axis mapping and any remaining missing-value
semantics. Q5 remains
open until representative features and the final HTTP/CDN origin confirm the
transport choice.

The current implementation input is the private immutable `ea_active`
`2026_W26` 50 um object. Its exact URI and official `ibleatools` access recipe
are recorded in `docs/DATA_SOURCES.md`; existing `2026_W12` 25 um results are
historical transport evidence that must be repeated against the newer object.

Current evidence favors depth-four orthogonal slice packs. Offline real-volume
measurements for `psd_lfp`, `rms_ap`, and `polarity` require three center-plane
objects and 0.83–3.32 MiB gzip, versus 136–534 cube requests and 5.21–21.77 MiB.
The implemented real-`rms_ap` Chromium adapter measured 37.8/54.1 ms p50/p95
for three cold planes, 0.8/1.5 ms cached neighbor navigation, and 3.7/8.7 ms for
six-plane prepare-and-paint.

## Local data and downloads

Local imports validate the complete supported regional/volume resource graph
and every declared SHA-256 before an atomic IndexedDB write. Storage is
namespaced by source dataset and immutable release, and the viewer distinguishes
local from published content without a shadow scientific schema.

Share copies complete URL state; Info exposes immutable release, feature
semantics, and source/builder provenance; current regional statistics and
selected-region comparisons export as context-rich CSV. Volume-feature
navigation/download and broader whole-release/local-dataset UX remain in M5.

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

CI uses Python 3.12 and Node 22. It runs Python builder/publishing tests plus
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
   build the real immutable volume release;
3. resolve Q6 and build the production cluster release;
4. define and build the exact `brainwide_map` product after Q7;
5. finish M5 downloads and local-dataset management UX;
6. deploy the immutable v3 anatomy assets and finalize catalog/origin/default
   alias/publishing choices in Q8-Q9;
7. run final production-origin, performance, responsive, and cross-browser QA,
   resolving Q11.

3-D, AGEA, MERFISH, large point clouds, inferential statistics, full OAuth, and
broad legacy custom-bucket compatibility remain deferred unless explicitly
promoted.

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
