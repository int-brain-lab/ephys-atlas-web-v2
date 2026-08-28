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

- Desktop is the primary layout; tablet remains usable; phone may use a reduced composition.
- Coronal, sagittal, and horizontal views remain linked through one scientific navigation state.
- All three projections use one ML/AP/DV cursor and the generated pack's native bilateral 10 µm affine grid.
- Top and Swanson are static regional projections in one discoverable secondary
  slot. They share coloring, hover, selection, and focus behavior without
  claiming slice, world-coordinate, or voxel navigation.
- The world cursor and its derived slice positions, dataset/release, feature,
  representation, parcellation, coloring, region selection, and relevant
  workspace view state are serializable into a shareable URL.
- Maximized views, drawers, and responsive composition remain keyboard-reversible and covered by browser tests.
- Current Chrome/Edge, Firefox, and Safari are the launch browser targets. Chromium CI is necessary but not sufficient for final release QA.

## 2. Regional feature exploration

For a schema-v1 regional feature, the viewer must:

- discover features dynamically from the selected immutable release;
- load parcellation region metadata and the region index from the release;
- search regions by loaded metadata rather than a hardcoded list;
- display the selected statistic for each region;
- color registered anatomical regions from the selected statistic/colormap/range;
- use one shared selection state for region-list and SVG interactions;
- persist selection in URL state;
- show global descriptive statistics and a distribution/histogram;
- expose available Linear, Log, and Signed-log value scales through one
  synchronized control for coloring, distributions, and range geometry;
- expose Full and Focused distribution domains independently across the global,
  comparison, and compact color-range histogram viewports, with exact
  underflow/overflow disclosure and whole-population normalization in Focused,
  without changing the selected color bounds;
- preserve explicit scale/domain choices in the URL without changing source
  observations, and obtain thresholds, focus bounds, availability, and defaults
  only from immutable representation-specific release metadata;
- compare selected-region statistics/distributions with the global population;
- clearly identify synthetic fixtures as non-scientific.

Launch statistics are descriptive only: mean, median, min, max, count, standard deviation/quantiles where present, histograms, and visual comparisons. Inferential tests are out of scope.

## 3. Volume exploration

For a schema-v1 volume feature, the viewer must:

- preserve scientific grid shape, dtype, axis semantics, validity rules, and
  index-to-world transform from authoritative metadata, deriving or strictly
  validating any redundant voxel-size/origin presentation;
- expose a whole-feature summary whose mutually exclusive valid, outside, and
  missing counts sum to the grid voxel count and whose statistics/histogram use
  valid voxels only;
- offer the same release-declared value-scale and distribution-domain controls
  as regional data where available, while keeping volume distributions global
  and valid-voxel-only rather than inventing regional comparison curves;
- map linked anatomical coordinates to the volume using the declared scientific transform, never the curated SVG display calibration;
- require the volume and anatomy to declare the same `reference_space_id`
  before compositing, while permitting distinct grid identities, resolutions,
  shapes, and affines;
- render coronal, sagittal, and horizontal scalar planes as retained Canvas
  layers in the shared projection viewport, with registered anatomy outlines,
  selection, hover, and guides layered independently;
- apply colormap/range controls consistently with regional scalar rendering where semantics overlap;
- use nearest-neighbor Canvas sampling and the same nearest-voxel rule for
  pointer inspection, including pixels with no overlying SVG region path;
- URL-persist user-adjusted volume opacity and anatomy-outline visibility
  without changing decoded values, inspection, statistics, or exports;
- bound decoded-data memory with an explicit cache policy;
- avoid downloading the entire production volume for ordinary single-slice navigation;
- verify immutable encoded volume resources by declared served-byte size and
  SHA-256 before persistent caching or decoding, evicting and cleanly retrying
  an invalid cached entry;
- report out-of-volume coordinates explicitly rather than clamping them to an
  edge voxel;
- support the physical layout selected by measured real-data browser benchmarks.

`chunks3d` is the deterministic reference/golden layout. It is not automatically the production transport. `orthogonal_slice_packs` remains an allowed browser-oriented layout until the real-data benchmark is resolved.

## 4. `ephys_atlas_channels`

The production channel release must be generated from a pinned `ea_active` source snapshot with explicit scientific choices.

Acceptance criteria:

- source project and exact vintage are recorded;
- raw versus denoised loading mode is explicit and recorded;
- population/QC recipe is explicit and recorded;
- feature catalog is discovered from the source/authoritative feature definition rather than copied into frontend code;
- Allen/Beryl/Cosmos regional outputs use one deterministic recipe;
- feature units, transforms, source columns, missing-value semantics, and population are represented in feature metadata;
- regional statistics and histograms validate against schema v1;
- source file hashes and builder version/command are recorded in provenance;
- a paper-facing release pins an immutable source vintage rather than resolving `latest` at consumption time.

A synthetic/deterministic test dataset may exercise this machinery before the scientific choices in `docs/OPEN_QUESTIONS.md` are resolved. It must not be labeled as a scientific production release.

## 5. `ephys_atlas_clusters`

Acceptance criteria:

- the launch cluster population and feature set are explicitly defined by an authoritative scientific recipe;
- provenance/QC requirements are equivalent in rigor to the channel release;
- the output uses the same schema-v1 regional contract where applicable;
- the viewer requires no cluster-specific hardcoded feature list.

D038 selects all rows from a content-addressed
`ibl_neuropixel_brainwide_01/clusters.table.pqt` snapshot. D044 resolves Q6 by
freezing all 14 scalar features and units from the pinned original website
repository. The machine-consumable selection, deterministic immutable build,
and local production-HTTP browser evidence are recorded under `docs/data/`.

## 6. `ephys_atlas_volumes`

Acceptance criteria:

- canonical encoding-volume source object(s) are pinned by vintage and object identity/hash when practical;
- source feature names and per-feature metadata are mapped deterministically into the release catalog;
- the scientific index-to-world transform and outside-brain semantics come from an authoritative producer/atlas source;
- the selected browser transport has recorded real-data request count, transferred bytes, decode latency, interaction latency, and memory measurements;
- the viewer can switch among volume features without an application reload;
- transport conversion, if used, records provenance back to the canonical source object.

## 7. `brainwide_map`

Acceptance criteria:

- the launch product faithfully preserves the five checksummed Beryl-only v1
  website Parquet families selected by D038;
- it is explicitly identified as a preserved legacy website snapshot and is
  not presented as a current paper-selection or regenerated paper release;
- feature values and aggregation/significance semantics validate against the
  pinned v1 generator through deterministic equivalence evidence;
- the dataset validates against the shared release contract and is discoverable through the public catalog.

## 8. Local datasets

Acceptance criteria:

- local browser imports consume the same schema-v1 manifest/feature/representation contract as published data;
- transport changes to IndexedDB/local blobs without introducing a shadow scientific schema;
- imported releases remain distinguishable from published releases in the UI;
- regional and supported volume resources resolve from local storage using the same viewer payload interfaces;
- invalid/incomplete imports fail explicitly rather than partially rendering misleading data.

## 9. Downloads

The launch viewer must provide practical access to underlying data.

Acceptance criteria:

- current-feature download is available or directly navigable from immutable release artifacts;
- selected-region/visible comparison data can be exported in a documented machine-readable form;
- immutable artifact URLs and current-feature/context-rich exports satisfy the
  initial launch; polished deterministic whole-release packaging is a
  non-blocking follow-up;
- downloads preserve enough metadata/provenance to identify dataset ID, release ID, feature, representation, statistic/parcellation, and source vintage.

## 10. Publishing and public reads

Acceptance criteria:

- public reads are static, unauthenticated files suitable for object storage/CDN delivery;
- public `catalog.json` follows the browser catalog contract;
- immutable releases are never mutated after publication;
- mutable aliases resolve to immutable release IDs outside release directories;
- publishing uses revocable capability credentials rather than a launch-blocking user/OAuth system;
- uploads are resumable and private until complete;
- byte size, SHA-256, and schema validation complete before atomic publication;
- publishing does not perform scientific transforms.

Remote publishing is desirable but may not block viewer launch if static release deployment is operationally sufficient.

## 11. Registered anatomical and static projection assets

Acceptance criteria:

- the production bilateral 10 µm registered geometry remains derived from
  pinned Allen annotation and LUT bytes by a clean pinned generator, retaining
  the validated parent evidence;
- one active `atlas-projection-pack-v1` manifest exposes registered coronal,
  sagittal, and horizontal slice stacks plus static Top and Swanson maps;
- the sparse registered display corpus is deterministically derived from the
  validated bilateral parent and records its identity;
- Top and Swanson record their exact distinct source identities, hashes, view
  boxes (`60 20 340 300` for both), path counts, and static-map status without
  an invented affine, slice index, or world coordinate;
- every compressed resource is immutable, byte-sized, SHA-256 verified, and
  explicitly decompressed by the browser;
- topology, source-voxel coverage, signed ID, boundary-error, IoU, and
  synchronization gates pass for all 3,260 native parent slices; the registered
  sparse runtime corpus preserves the accepted 407 selected SVG fragments;
- the parent projection affines define native bilateral 10 µm navigation and
  guide placement without hand-tuned display formulas, while the 80 µm runtime
  inventory affects display-plane selection only;
- production delivery preserves opaque compressed bytes without HTTP
  `Content-Encoding` where compressed-byte verification requires it;
- the browser has one normalized regional SVG identity contract and no legacy
  host, legacy crosswalk, old-pack parser, or runtime compatibility dependency.

## 12. Performance and reliability

Before production launch, record representative measurements for at least desktop Chromium and one non-Chromium browser.

Acceptance criteria:

- initial app shell becomes interactive without fetching full scientific datasets;
- feature switching and ordinary slice movement fetch only the resources required by the active representation plus bounded prefetch;
- production volume navigation meets a documented request/bytes/decode/memory budget selected from real-data benchmarks;
- asset/data failures produce explicit error states rather than stale or silently wrong visualizations;
- immutable resources use cache-friendly URLs and policies;
- no launch-critical interaction requires a mutation/backend API.

Exact performance thresholds should be recorded with the real-data volume benchmark rather than invented from the golden fixture.

## 13. Deployment and release

Acceptance criteria:

- production public domain/URL and storage/CDN arrangement are selected and documented;
- CORS and, where relevant, HTTP Range behavior are verified from the production origin;
- the paper-facing default resolves to a pinned immutable release set;
- deployment secrets and publisher credentials are not stored in the repository;
- backup/recovery expectations for publishing control state are documented if the publishing service is deployed;
- v1 remains available as fallback through the initial v2 launch window.

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

1. every un-deferred acceptance criterion above is either satisfied or explicitly waived in `docs/DECISIONS.md`;
2. every launch dataset has an immutable, provenance-valid release or an explicit documented waiver;
3. `just check` is green on the release commit;
4. browser QA and production-origin data/CORS checks are recorded;
5. `docs/OPEN_QUESTIONS.md` contains no unresolved item marked as a launch blocker;
6. `docs/INTEGRATION_STATUS.md` describes the actual shipped state rather than planned work.
