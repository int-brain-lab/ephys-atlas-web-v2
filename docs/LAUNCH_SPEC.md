# Launch specification

Status: active product specification for the first production release of IBL Ephys Atlas Web v2.

This document defines launch acceptance. Historical handoff documents provide evidence and implementation detail, but they do not override this specification or `docs/DECISIONS.md`.

## Product objective

Ship a credible production replacement for the core v1 Ephys Atlas browsing workflow while keeping v1 available as fallback during launch. The v2 viewer must load immutable, provenance-rich datasets efficiently in a browser and support the scientific exploration tasks below without requiring a backend for public reads.

## Launch scope

Launch-critical dataset IDs are:

- `ephys_atlas_channels`
- `ephys_atlas_clusters`
- `ephys_atlas_volumes`
- `brainwide_map`
- `local`

Launch-critical representations are regional scalar data and orthogonal volume
slices. The 2-D workspace includes coronal, sagittal, horizontal, Top, and
Swanson projections; rich 3-D rendering is optional and must not delay these
paths.

Supported parcellations for applicable regional data are Allen, Beryl, and Cosmos.

## 1. Application shell and navigation

Acceptance criteria:

- <a id="ls01-01"></a> **`LS01-01`** — Desktop is the primary layout; tablet remains usable; phone may use a reduced composition.
- <a id="ls01-02"></a> **`LS01-02`** — Coronal, sagittal, and horizontal views remain linked through one scientific navigation state.
- <a id="ls01-03"></a> **`LS01-03`** — All three projections use one ML/AP/DV cursor and the generated pack's native bilateral 10 µm affine grid.
- <a id="ls01-04"></a> **`LS01-04`** — Top and Swanson are static regional projections in one discoverable secondary
  slot. They share coloring, hover, selection, and focus behavior without
  claiming slice, world-coordinate, or voxel navigation.
- <a id="ls01-05"></a> **`LS01-05`** — The world cursor and its derived slice positions, dataset/release, feature,
  representation, parcellation, coloring, region selection, and relevant
  workspace view state are serializable into a shareable URL.
- <a id="ls01-06"></a> **`LS01-06`** — Maximized views, drawers, and responsive composition remain keyboard-reversible and covered by browser tests.
- <a id="ls01-07"></a> **`LS01-07`** — Current Chrome/Edge, Firefox, and Safari are the launch browser targets. Chromium CI is necessary but not sufficient for final release QA.
- <a id="ls01-08"></a> **`LS01-08`** — Public navigation clearly separates Project, Dataset, immutable Release,
  Feature, and display choices; the grouped Data chooser preserves project/dataset
  identity, and Display & parcellation sits above the visualization. Ephys Atlas
  and Brain-Wide Map are distinct projects,
  release versions remain user-selectable with exact IDs available, and a
  paper-facing project edition preserves its coordinated dataset-to-release
  mapping or explicitly discloses an individual-release override.

## 2. Regional feature exploration

For a schema-v1 regional feature, the viewer must:

- <a id="ls02-01"></a> **`LS02-01`** — discover features dynamically from the selected immutable release;
- <a id="ls02-02"></a> **`LS02-02`** — load parcellation region metadata and the region index from the release;
- <a id="ls02-03"></a> **`LS02-03`** — search regions by loaded metadata rather than a hardcoded list;
- <a id="ls02-04"></a> **`LS02-04`** — display the selected statistic for each region;
- <a id="ls02-05"></a> **`LS02-05`** — color registered anatomical regions from the selected statistic/colormap/range;
- <a id="ls02-06"></a> **`LS02-06`** — use one shared selection state for region-list and SVG interactions;
- <a id="ls02-07"></a> **`LS02-07`** — persist selection in URL state;
- <a id="ls02-08"></a> **`LS02-08`** — show global descriptive statistics and a distribution/histogram;
- <a id="ls02-09"></a> **`LS02-09`** — expose available Linear, Log, and Signed-log value scales through one
  synchronized control for coloring, distributions, and range geometry;
- <a id="ls02-10"></a> **`LS02-10`** — expose Full and Focused distribution domains independently across the global,
  comparison, and compact color-range histogram viewports, with exact
  underflow/overflow disclosure and whole-population normalization in Focused,
  without changing the selected color bounds;
- <a id="ls02-11"></a> **`LS02-11`** — preserve explicit scale/domain choices in the URL without changing source
  observations, and obtain thresholds, focus bounds, availability, and defaults
  only from immutable representation-specific release metadata;
- <a id="ls02-12"></a> **`LS02-12`** — compare selected-region statistics/distributions with the global population;
- <a id="ls02-13"></a> **`LS02-13`** — clearly identify synthetic fixtures as non-scientific.

Launch statistics are descriptive only: mean, median, min, max, count, standard deviation/quantiles where present, histograms, and visual comparisons. Inferential tests are out of scope.

## 3. Volume exploration

For a schema-v1 volume feature, the viewer must:

- <a id="ls03-01"></a> **`LS03-01`** — preserve scientific grid shape, dtype, axis semantics, validity rules, and
  index-to-world transform from authoritative metadata, deriving or strictly
  validating any redundant voxel-size/origin presentation;
- <a id="ls03-02"></a> **`LS03-02`** — expose a whole-feature summary whose mutually exclusive valid, outside, and
  missing counts sum to the grid voxel count and whose statistics/histogram use
  valid voxels only;
- <a id="ls03-03"></a> **`LS03-03`** — offer the same release-declared value-scale and distribution-domain controls
  as regional data where available, while keeping volume distributions global
  and valid-voxel-only rather than inventing regional comparison curves;
- <a id="ls03-04"></a> **`LS03-04`** — map linked anatomical coordinates to the volume using the declared scientific transform, never the curated SVG display calibration;
- <a id="ls03-05"></a> **`LS03-05`** — require the volume and anatomy to declare the same `reference_space_id`
  before compositing, while permitting distinct grid identities, resolutions,
  shapes, and affines;
- <a id="ls03-06"></a> **`LS03-06`** — render coronal, sagittal, and horizontal scalar planes as retained Canvas
  layers in the shared projection viewport, with registered anatomy outlines,
  selection, hover, and guides layered independently;
- <a id="ls03-07"></a> **`LS03-07`** — apply colormap/range controls consistently with regional scalar rendering where semantics overlap;
- <a id="ls03-08"></a> **`LS03-08`** — use nearest-neighbor Canvas sampling and the same nearest-voxel rule for
  pointer inspection, including pixels with no overlying SVG region path;
- <a id="ls03-09"></a> **`LS03-09`** — URL-persist user-adjusted volume opacity and anatomy-outline visibility
  without changing decoded values, inspection, statistics, or exports;
- <a id="ls03-10"></a> **`LS03-10`** — bound decoded-data memory with an explicit cache policy;
- <a id="ls03-11"></a> **`LS03-11`** — avoid downloading the entire production volume for ordinary single-slice navigation;
- <a id="ls03-12"></a> **`LS03-12`** — verify immutable encoded volume resources by declared served-byte size and
  SHA-256 before persistent caching or decoding, evicting and cleanly retrying
  an invalid cached entry;
- <a id="ls03-13"></a> **`LS03-13`** — report out-of-volume coordinates explicitly rather than clamping them to an
  edge voxel;
- <a id="ls03-14"></a> **`LS03-14`** — support the physical layout selected by measured real-data browser benchmarks.

`chunks3d` is the deterministic reference/golden layout. It is not automatically the production transport. `orthogonal_slice_packs` remains an allowed browser-oriented layout until the real-data benchmark is resolved.

## 4. `ephys_atlas_channels`

The production channel release must be generated from a pinned `ea_active` source snapshot with explicit scientific choices.

Acceptance criteria:

- <a id="ls04-01"></a> **`LS04-01`** — source project and exact vintage are recorded;
- <a id="ls04-02"></a> **`LS04-02`** — raw versus denoised loading mode is explicit and recorded;
- <a id="ls04-03"></a> **`LS04-03`** — population/QC recipe is explicit and recorded;
- <a id="ls04-04"></a> **`LS04-04`** — feature catalog is discovered from the source/authoritative feature definition rather than copied into frontend code;
- <a id="ls04-05"></a> **`LS04-05`** — Allen/Beryl/Cosmos regional outputs use one deterministic recipe;
- <a id="ls04-06"></a> **`LS04-06`** — feature units, transforms, source columns, missing-value semantics, and population are represented in feature metadata;
- <a id="ls04-07"></a> **`LS04-07`** — regional statistics and histograms validate against schema v1;
- <a id="ls04-08"></a> **`LS04-08`** — source file hashes and builder version/command are recorded in provenance;
- <a id="ls04-09"></a> **`LS04-09`** — a paper-facing release pins an immutable source vintage rather than resolving `latest` at consumption time.

A synthetic/deterministic test dataset may exercise this machinery before the scientific choices in `docs/OPEN_QUESTIONS.md` are resolved. It must not be labeled as a scientific production release.

## 5. `ephys_atlas_clusters`

Acceptance criteria:

- <a id="ls05-01"></a> **`LS05-01`** — the launch cluster population and feature set are explicitly defined by an authoritative scientific recipe;
- <a id="ls05-02"></a> **`LS05-02`** — provenance/QC requirements are equivalent in rigor to the channel release;
- <a id="ls05-03"></a> **`LS05-03`** — the output uses the same schema-v1 regional contract where applicable;
- <a id="ls05-04"></a> **`LS05-04`** — the viewer requires no cluster-specific hardcoded feature list.

D038 selects all rows from a content-addressed
`ibl_neuropixel_brainwide_01/clusters.table.pqt` snapshot. D044 resolves Q6 by
freezing all 14 scalar features and units from the pinned original website
repository. The machine-consumable selection, deterministic immutable build,
and local production-HTTP browser evidence are recorded under `docs/data/`.

## 6. `ephys_atlas_volumes`

Acceptance criteria:

- <a id="ls06-01"></a> **`LS06-01`** — canonical encoding-volume source object(s) are pinned by vintage and object identity/hash when practical;
- <a id="ls06-02"></a> **`LS06-02`** — source feature names and per-feature metadata are mapped deterministically into the release catalog;
- <a id="ls06-03"></a> **`LS06-03`** — the scientific index-to-world transform and outside-brain semantics come from an authoritative producer/atlas source;
- <a id="ls06-04"></a> **`LS06-04`** — the selected browser transport has recorded real-data request count, transferred bytes, decode latency, interaction latency, and memory measurements;
- <a id="ls06-05"></a> **`LS06-05`** — the viewer can switch among volume features without an application reload;
- <a id="ls06-06"></a> **`LS06-06`** — transport conversion, if used, records provenance back to the canonical source object.

## 7. `brainwide_map`

Acceptance criteria:

- <a id="ls07-01"></a> **`LS07-01`** — the launch product faithfully preserves the five checksummed Beryl-only v1
  website Parquet families selected by D038;
- <a id="ls07-02"></a> **`LS07-02`** — it is explicitly identified as a preserved legacy website snapshot and is
  not presented as a current paper-selection or regenerated paper release;
- <a id="ls07-03"></a> **`LS07-03`** — feature values and aggregation/significance semantics validate against the
  pinned v1 generator through deterministic equivalence evidence;
- <a id="ls07-04"></a> **`LS07-04`** — the dataset validates against the shared release contract and is discoverable through the public catalog.

## 8. Local datasets

Acceptance criteria:

- <a id="ls08-01"></a> **`LS08-01`** — local browser imports consume the same schema-v1 manifest/feature/representation contract as published data;
- <a id="ls08-02"></a> **`LS08-02`** — transport changes to IndexedDB/local blobs without introducing a shadow scientific schema;
- <a id="ls08-03"></a> **`LS08-03`** — imported releases remain distinguishable from published releases in the UI;
- <a id="ls08-04"></a> **`LS08-04`** — regional and supported volume resources resolve from local storage using the same viewer payload interfaces;
- <a id="ls08-05"></a> **`LS08-05`** — invalid/incomplete imports fail explicitly rather than partially rendering misleading data.

## 9. Downloads

The launch viewer must provide practical access to underlying data.

Acceptance criteria:

- <a id="ls09-01"></a> **`LS09-01`** — current-feature download is available or directly navigable from immutable release artifacts;
- <a id="ls09-02"></a> **`LS09-02`** — selected-region/visible comparison data can be exported in a documented machine-readable form;
- <a id="ls09-03"></a> **`LS09-03`** — immutable artifact URLs and current-feature/context-rich exports satisfy the
  initial launch; polished deterministic whole-release packaging is a
  non-blocking follow-up;
- <a id="ls09-04"></a> **`LS09-04`** — downloads preserve enough metadata/provenance to identify dataset ID, release ID, feature, representation, statistic/parcellation, and source vintage.

## 10. Publishing and public reads

Acceptance criteria:

- <a id="ls10-01"></a> **`LS10-01`** — public reads are static, unauthenticated files suitable for object storage/CDN delivery;
- <a id="ls10-02"></a> **`LS10-02`** — public `catalog.json` follows the browser catalog contract;
- <a id="ls10-03"></a> **`LS10-03`** — immutable releases are never mutated after publication;
- <a id="ls10-04"></a> **`LS10-04`** — mutable aliases resolve to immutable release IDs outside release directories;
- <a id="ls10-05"></a> **`LS10-05`** — initial publication uses temporary, revocable, least-privilege AWS credentials through the approved local publisher; any future hosted multi-publisher service uses independently revocable capability credentials rather than a launch-blocking user/OAuth system;
- <a id="ls10-06"></a> **`LS10-06`** — uploads are resumable and private until complete;
- <a id="ls10-07"></a> **`LS10-07`** — byte size, SHA-256, and schema validation complete before atomic publication;
- <a id="ls10-08"></a> **`LS10-08`** — publishing does not perform scientific transforms.

Remote publishing is desirable but may not block viewer launch if static release deployment is operationally sufficient.

The initial deployment deliberately has no hosted publishing API. The approved
local publisher must preserve the same validation, private-staging,
immutability, resumability, and catalog-last guarantees.

## 11. Registered anatomical and static projection assets

Acceptance criteria:

- <a id="ls11-01"></a> **`LS11-01`** — the production bilateral 10 µm registered geometry remains derived from
  pinned Allen annotation and LUT bytes by a clean pinned generator, retaining
  the validated parent evidence;
- <a id="ls11-02"></a> **`LS11-02`** — one active `atlas-projection-pack-v1` manifest exposes registered coronal,
  sagittal, and horizontal slice stacks plus static Top and Swanson maps;
- <a id="ls11-03"></a> **`LS11-03`** — the sparse registered display corpus is deterministically derived from the
  validated bilateral parent and records its identity;
- <a id="ls11-04"></a> **`LS11-04`** — Top and Swanson record their exact distinct source identities, hashes, view
  boxes (`60 20 340 300` for both), path counts, and static-map status without
  an invented affine, slice index, or world coordinate;
- <a id="ls11-05"></a> **`LS11-05`** — every compressed resource is immutable, byte-sized, SHA-256 verified, and
  explicitly decompressed by the browser;
- <a id="ls11-06"></a> **`LS11-06`** — topology, source-voxel coverage, signed ID, boundary-error, IoU, and
  synchronization gates pass for all 3,260 native parent slices; the registered
  sparse runtime corpus preserves the accepted 407 selected SVG fragments;
- <a id="ls11-07"></a> **`LS11-07`** — the parent projection affines define native bilateral 10 µm navigation and
  guide placement without hand-tuned display formulas, while the 80 µm runtime
  inventory affects display-plane selection only;
- <a id="ls11-08"></a> **`LS11-08`** — production delivery preserves opaque compressed bytes without HTTP
  `Content-Encoding` where compressed-byte verification requires it;
- <a id="ls11-09"></a> **`LS11-09`** — the browser has one normalized regional SVG identity contract and no legacy
  host, legacy crosswalk, old-pack parser, or runtime compatibility dependency.

## 12. Performance and reliability

Before production launch, record representative measurements for at least desktop Chromium and one non-Chromium browser.

Acceptance criteria:

- <a id="ls12-01"></a> **`LS12-01`** — initial app shell becomes interactive without fetching full scientific datasets;
- <a id="ls12-02"></a> **`LS12-02`** — feature switching and ordinary slice movement fetch only the resources required by the active representation plus bounded prefetch;
- <a id="ls12-03"></a> **`LS12-03`** — production volume navigation meets a documented request/bytes/decode/memory budget selected from real-data benchmarks;
- <a id="ls12-04"></a> **`LS12-04`** — asset/data failures produce explicit error states rather than stale or silently wrong visualizations;
- <a id="ls12-05"></a> **`LS12-05`** — immutable resources use cache-friendly URLs and policies;
- <a id="ls12-06"></a> **`LS12-06`** — no launch-critical interaction requires a mutation/backend API.

Exact performance thresholds should be recorded with the real-data volume benchmark rather than invented from the golden fixture.

## 13. Deployment and release

Acceptance criteria:

- <a id="ls13-01"></a> **`LS13-01`** — production public domain/URL and storage/CDN arrangement are selected and documented;
- <a id="ls13-02"></a> **`LS13-02`** — CORS and, where relevant, HTTP Range behavior are verified from the production origin;
- <a id="ls13-03"></a> **`LS13-03`** — the paper-facing default resolves to a pinned immutable release set;
- <a id="ls13-04"></a> **`LS13-04`** — deployment secrets and publisher credentials are not stored in the repository; every published scientific release is built and preflighted on clean Linux `main`, records the exact builder commit plus OS/Python/NumPy environment, and is never promoted from a macOS local/candidate build;
- <a id="ls13-05"></a> **`LS13-05`** — backup/recovery expectations for publishing control state are documented if the publishing service is deployed;
- <a id="ls13-06"></a> **`LS13-06`** — v1 remains available as fallback through the initial v2 launch window.

## Explicitly deferred

The following are not launch blockers unless later promoted by an explicit decision:

- AGEA
- MERFISH
- large point-cloud workflows
- advanced/inferential statistical tests
- a full replacement 3-D stack
- full OAuth/user identity
- broad compatibility with legacy custom-bucket URLs

The optional 3-D anatomy view uses only the pinned GLB-derived compiled-full
surface resource selected by D042. It remains failure-isolated and outside
launch acceptance. It must not trigger voxel-derived mesh generation or delay
the launch-critical linked 2-D volume workspace.

## Definition of launch-ready

The release is launch-ready when:

1. <a id="dlr-01"></a> **`DLR-01`** — every un-deferred acceptance criterion above is either satisfied or explicitly waived in `docs/DECISIONS.md`;
2. <a id="dlr-02"></a> **`DLR-02`** — every launch dataset has an immutable, provenance-valid release or an explicit documented waiver;
3. <a id="dlr-03"></a> **`DLR-03`** — `just check` is green on the release commit;
4. <a id="dlr-04"></a> **`DLR-04`** — browser QA and production-origin data/CORS checks are recorded;
5. <a id="dlr-05"></a> **`DLR-05`** — `docs/OPEN_QUESTIONS.md` contains no unresolved item marked as a launch blocker;
6. <a id="dlr-06"></a> **`DLR-06`** — `docs/INTEGRATION_STATUS.md` describes the actual shipped state rather than planned work.
