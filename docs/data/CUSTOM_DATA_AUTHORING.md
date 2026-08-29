# Custom data authoring and ZIP import

Status: active focused implementation plan; Allen regional authoring and ZIP
browser import implemented on 2026-08-29.

This document defines the planned workflow for scientists to prepare their own
regional or volumetric scalar data and import it into IBL Ephys Atlas Web v2.
It is the focused execution plan for the local-data portion of M5. D051 records
the binding product decisions.

## Product outcome

A scientist can now use the public Python API to turn scalar data associated
with Allen brain regions into one validated immutable archive, then select that
archive in the web application. The browser validates and stores the release
locally without sending its contents to a local server or a remote service.
Allen-CCF voxel authoring remains the next representation extension.

```text
NumPy arrays plus explicit scientific metadata
    -> ibl-ephys-atlas Python authoring API
    -> validated *.ibl-ephys-atlas.zip
    -> browser Import local dataset...
    -> complete validation and atomic IndexedDB admission
    -> ordinary viewer behavior with persistent Local identity
```

The authoring API is modality-neutral even though it retains the historical
IBL Ephys Atlas product name. Regional or voxel scalars may come from imaging,
gene expression, behavior, modeling, electrophysiology, or another scientific
source. The first contract is not an arbitrary neuroimaging viewer: it targets
the reference space and anatomical mappings the web application can render.

## Binding boundaries

- PyPI distribution: `ibl-ephys-atlas`.
- Python namespace: `ibl_ephys_atlas`.
- Reserved public CLI prefix: `ibl-ephys-atlas`; no public authoring CLI is
  exposed yet. The installed internal `ephys-atlas-data` command remains for
  repository builder operations.
- Local interchange artifact: `*.ibl-ephys-atlas.zip`.
- Schema v1 remains the sole scientific release contract. ZIP is a transport
  container around the existing release graph, not a second schema.
- The implementation lives in this repository beside the canonical schemas,
  serializers, validators, browser consumer, and publishing validation.
- `iblatlas` remains the anatomical authority for region ontology, acronyms,
  Allen/Beryl/Cosmos mappings, Allen atlas grids, and coordinate behavior.
- Local import is ZIP-only. Do not expose a parallel directory-import product
  flow once the ZIP path lands.
- Local data never leaves the device implicitly.
- Remote publication remains a separately authorized operation over
  already-built releases and performs no scientific transformation.
- `iblbrainviewer` remains the legacy v1 package. Do not add schema-v1
  authoring to it or reproduce its base64 JSON and bucket contracts.

## Repository and package structure

Keep public generic authoring and official dataset-specific recipes distinct
inside the existing builder project:

```text
builder/
  ibl_ephys_atlas/       public authoring, validation, and packaging API
  ephys_atlas_builder/   official channel/cluster/BWM/volume recipes
```

Both namespaces must use one underlying schema-v1 serializer and validator.
The extraction must not create a second manifest model or change official
release bytes accidentally. Existing official recipes should consume the same
generic mechanics where that removes real duplication without hiding their
dataset-specific scientific choices.

The initial public dependency set should remain small: Python 3.11+, NumPy,
`iblatlas`, `jsonschema`, and `referencing`. Accept NumPy-compatible arrays
rather than requiring pandas, xarray, nibabel, Zarr, or a publishing client.

Keep these identities separate:

- Python package version: semantic API version;
- release schema version: schema v1;
- dataset and immutable release IDs: chosen by the user and stored in the
  release manifest.

Retain the existing historical `ephys-atlas-*` schema format identifiers. The
package's wider modality scope does not justify a contract-wide product rename.

## Public object model

The implemented regional public model is:

```text
Dataset
  identity, immutable release metadata, provenance sources
  Feature
    value semantics
    Allen regional values or observations
```

A feature owns the scientific quantity, unit, transform, source population,
QC/filter description, and missing-value semantics. The public surface is
intentionally limited to `Dataset`, `Feature`, `ValueSemantics`, `Source`,
`ValidationIssue`, `ValidationReport`, and `BundleValidationError`. Display
authoring, `AllenCCFGrid`, `VoxelValidity`, and volume representations remain
future work.

### Regional authoring

The first public vertical slice supports scalar rows associated with Allen
region IDs or acronyms. The implemented API is:

```python
from iblatlas.regions import BrainRegions
from ibl_ephys_atlas import Dataset, Source, ValueSemantics

dataset = Dataset(
    dataset_id="smith_lab_decision_signal",
    release_id="2026-08-29",
    title="Regional decision-signal estimates",
    created_at="2026-08-29T00:00:00Z",
    sources=[Source.user_input(description="Smith lab model coefficients")],
)

feature = dataset.add_feature(
    id="decision_signal",
    label="Decision signal",
    unit="a.u.",
    semantics=ValueSemantics(
        quantity="fitted decision coefficient",
        transform="identity",
        source_population="one coefficient per animal-region fit passing QC",
        missing_values="non-finite coefficients are missing",
        qc_filter="analysis QC version 2",
    ),
)

feature.add_region_observations(
    region_ids=allen_ids,
    values=coefficients,
    ontology=BrainRegions(),
    source_mapping="Allen",
    output_mappings=("Allen", "Beryl", "Cosmos"),
    aggregation="mean",
)

dataset.validate().raise_for_errors()
dataset.write_zip("smith-decision-signal.ibl-ephys-atlas.zip")
```

Use `add_region_values()` for one already-aggregated scalar per folded logical
Allen region; duplicate identities are rejected. Use
`add_region_observations(..., aggregation="mean")` for repeated observation
rows. Mean is the only implemented observation aggregation.

Regional rules:

- accept exactly one of region IDs or acronyms; never infer the identity type
  from a NumPy dtype;
- use `BrainRegions` directly to validate identities and obtain names and
  mappings; do not copy its ontology or mapping tables;
- reject unknown identities, void, and root;
- preserve non-finite values as declared missing observations;
- require an explicit aggregation whenever multiple rows or source regions
  contribute to one output region;
- already-aggregated `add_region_values()` output remains Allen-only;
- repeated observations may request Allen/Beryl/Cosmos. Fold signed identities,
  remap each original row through `BrainRegions.remap`, verify cardinality and
  target identity, then aggregate; root or void targets fail closed;
- do not propagate parent values to descendants;
- compute exact descriptive statistics and every declared distribution from
  source observations;
- emit only the neutral Linear/Full presentation. Public display customization
  is not implemented.

The implemented regional viewer uses one folded logical regional value against
bilateral anatomy. The first authoring API therefore accepts positive,
non-lateralized regional identities by default. Signed input must require an
explicit `hemisphere_policy="fold"` and must disclose that both hemispheres
become observations of one logical region. Independent left/right regional
scalars are unsupported until the release and viewer contracts can represent
them faithfully. Volume data retains physical laterality.

### Volume authoring

Volume authoring follows the regional slice and must integrate explicitly with
`iblatlas`:

```python
import numpy as np
from iblatlas.atlas import AllenAtlas
from ibl_ephys_atlas import AllenCCFGrid, VoxelValidity

atlas = AllenAtlas(res_um=50)
values = volume.astype(np.float32, copy=False)

grid = AllenCCFGrid.from_iblatlas(
    atlas,
    array_axes=("ap", "ml", "dv"),
)

feature.add_volume(
    values=values,
    grid=grid,
    validity=VoxelValidity.mask(
        outside=atlas.label == 0,
        missing=(atlas.label != 0) & ~np.isfinite(values),
    ),
)
```

`AllenCCFGrid.from_iblatlas()` accepts an already-created `AllenAtlas`; it must
not trigger a hidden large atlas download. It translates and verifies the
actual `BrainCoordinates` and array-axis convention, records the installed
`iblatlas` version and relevant ontology/grid resource identities, and emits
the exact schema-v1 index-to-world transform. It must not infer an affine from
shape or nominal resolution alone.

Volume rules:

- initially accept precomputed three-dimensional float16 or float32 scalars;
- reject float64 rather than downcast silently;
- require an exact supported reference-space identity, shape, array-axis order,
  affine, and voxel-center convention;
- require explicit, disjoint outside/missing classification; zero is not an
  implicit outside value and no non-finite voxel may be classified valid;
- do not register, resample, interpolate, normalize, clip, or denoise input;
- compute summaries and distributions from valid voxels only;
- keep physical transport independent of scientific geometry. Deterministic
  `chunks3d` may be the initial authoring default, while advanced transport
  choices remain explicit and validated.

## Structured validation

Public model validation returns structured issues with severity, stable code,
location, message, and optional corrective hint. `raise_for_errors()` raises a
`BundleValidationError` retaining that report. Input identity and aggregation
mistakes fail immediately as `TypeError` or `ValueError`; incomplete model and
scientific-semantics fields are structured errors. The warning channel exists,
but no size or missingness warning policy has been selected yet. Volume
geometry and validity validation remain future work.

The implemented `write_zip()`:

1. validate the in-memory scientific model;
2. build into a temporary release directory;
3. run the independent schema-v1 and complete-graph validator;
4. create the deterministic ZIP;
5. reopen and validate its inventory and contents;
6. atomically replace the requested destination only after success.

Failure leaves an existing destination unchanged and no partial output archive.

## ZIP container contract

The ZIP root is the release root, with no enclosing directory:

```text
manifest.json
parcellations/...
features/...
```

The deterministic writer uses sorted POSIX paths, a fixed timestamp and file
mode, fixed compression settings, canonical JSON, no symlinks, no duplicate or
unsafe paths, and no encryption. Already-compressed resources need not be
deflated again when stored compression produces smaller and cheaper packages.
The filename is presentation metadata; dataset/release identity comes from
`manifest.json`.

The browser ZIP reader must be selected for bounded `Blob`/streaming behavior,
not only library size. It must reject:

- absolute, traversal, backslash-ambiguous, empty, or duplicate paths;
- symlinks, encrypted entries, unsupported compression, and nested archives;
- missing `manifest.json`, an enclosing root directory, undeclared files, and
  incomplete transitive resource graphs;
- entries whose encoded size, decoded size, or compression ratio exceeds
  explicit admission limits;
- any declared byte-size or SHA-256 mismatch.

The importer reads the manifest and inventory, displays a preview when
possible, validates every supported transitive regional/volume resource, then
stores the manifest and individual resource blobs in one atomic IndexedDB
admission. The outer ZIP is discarded after success so ordinary feature and
volume access retains efficient per-resource reads.

### Browser ZIP reader and provisional admission limits

The implemented browser reader pins `@zip.js/zip.js` `2.8.60`. It was selected
because its Blob reader exposes the central-directory metadata needed for a
bounded inventory before extraction, supports per-entry Blob extraction and
cancellation, and provides strict parsing with CRC-32 and overlapping-entry
checks. The browser imports the native entry point dynamically and disables
library workers for the first implementation so cancellation, memory behavior,
and failures remain under one application-owned lifecycle. This is the current
engineering rationale, not yet cross-browser performance evidence.

Before extracting any entry, the reader requires normalized portable root
paths and rejects control characters, backslashes, percent-ambiguous names,
absolute/drive/colon paths, empty or dot segments, nested ZIP names, duplicate
paths, directory entries, symlinks and other non-regular Unix file types,
encryption, split or Zip64 entries, and compression methods other than Store
and Deflate. Strict extraction rechecks CRC-32, overlap, cancellation, and the
declared expanded size. The existing complete local schema-v1 graph validator
then rejects missing, undeclared, corrupt, or semantically invalid resources
before IndexedDB is opened for mutation.

The first implementation uses these deliberately provisional limits:

| Limit | Current value |
| --- | ---: |
| Archive bytes | 1 GiB |
| Entry count | 20,000 |
| Compressed bytes per entry | 256 MiB |
| Expanded bytes per entry | 256 MiB |
| Aggregate expanded bytes | 1.5 GiB |
| Expansion ratio per entry | 1,000:1 |
| UTF-8 path bytes | 512 |
| UTF-8 path-segment bytes | 128 |
| Expanded `manifest.json` bytes | 8 MiB |

These values are safety ceilings, not accepted product capacity or performance
targets. Measure representative regional and volume authoring archives in
Chromium, Firefox, and Safari, including peak memory, preview latency,
cancellation, extraction failures, and IndexedDB quota behavior, before
freezing or advertising supported limits.

Preparation and admission are separate. `prepareArchive()` retains validated
Blobs in memory and returns identity, feature/representation/parcellation, and
stored/decoded-size preview data without changing IndexedDB. Only an explicit
`admitPrepared()` call writes the manifest and individual resources in one
local IndexedDB transaction. The path performs no upload or other network
request. The application/UI wiring for that confirmation boundary is
implemented: the dataset picker exposes one ZIP input, the modal shows validated
identity and inventory before confirmation, successful admission selects a
persistent `Local` release, and duplicate immutable identities fail without
replacement. Automated Chromium coverage verifies preview-before-mutation,
reload persistence, and local resource reads without the published release
origin. Cross-browser real-archive capacity evidence is still outstanding.

## Browser experience

Expose `Import local dataset...` from the dataset picker and accept one
`.ibl-ephys-atlas.zip`. Before committing, show dataset/release identity,
title, provenance summary, feature/representation/parcellation inventory,
archive and declared expanded sizes, storage estimate, and validation errors or
warnings. After success, refresh the catalog, select the imported release, and
display a persistent `Local` badge.

The manager lists exact source identity, import time, stored Blob bytes,
resource count, and integrity state for every local release. It reports origin-
wide browser usage/quota and persistence separately from per-release bytes.
New imports retain the validated root manifest so explicit verification can
replay the complete graph, hashes, and decoding checks outside the IndexedDB
transaction. Older rows without that record are truthfully unverifiable.
Damaged releases recover through confirmed atomic deletion and reimport; other
local releases remain isolated. Clearing published-resource cache and deleting
local data remain separate operations. Duplicate immutable releases are
rejected until the existing local release is explicitly deleted.

A URL referencing local data does not contain or transfer that data and works
only where the exact local release is already present. The UI must state this
when sharing a local view. Missing or evicted local resources fail explicitly
and never fall through to a similarly named published dataset.

## Publishing boundary

The public authoring API ends at a validated ZIP. Do not put `publish()` on the
core `Dataset` object. A future separately installed or invoked publishing
command may accept the same ZIP, unpack it into private staging, and use the
existing capability-authenticated resumable publisher. Public origins still
serve individual immutable resources rather than the ZIP as their runtime
layout.

Self-service hosted buckets, user accounts, ownership transfer, quotas,
moderation, discovery, and deletion policy are outside this plan. The legacy
shared-key/custom-bucket protocol is not a compatibility requirement.

## Explicit non-goals

The first public contract does not support:

- arbitrary atlases, reference spaces, custom anatomy, or custom ontology;
- independent left/right regional values;
- point clouds or legacy dots-to-volume conversion;
- categorical, vector, tensor, timeseries, or connectivity representations;
- weighted observations, inferential statistics, or scientific preprocessing;
- NIfTI/TIFF/Zarr/Parquet-specific ingestion APIs;
- implicit conversion of legacy `iblbrainviewer` JSON payloads;
- remote publication or public dataset administration.

## Ordered implementation slices

Each slice ends with targeted tests and `just check`; do not land an unused
public abstraction without its consumer or deterministic evidence.

### Slice 0 — Contract and baseline

Status: implemented on 2026-08-29 for the Python bundle boundary and canonical
synthetic fixture; browser-reader measurement remains part of Slice 1.

- retain D051 and this plan as the binding direction;
- capture a green baseline and deterministic schema-v1 ZIP fixture;
- choose and pin a bounded browser ZIP reader, with the dependency rationale
  recorded in the implementation;
- define provisional archive limits and deterministic capability/error behavior.

The implemented `ephys-atlas-data bundle` command validates the source graph,
requires the controlled bundle tree to contain only transitively declared
resources, writes sorted root-level members with deterministic metadata,
reopens and independently validates the archive, and atomically replaces its
destination only after success. `fixtures/golden-v1.ibl-ephys-atlas.zip` is the
exact regenerable synthetic contract fixture. The public
`ibl_ephys_atlas.Dataset.write_zip()` implementation now uses this same shared
bundle machinery rather than a second serializer or validator.

### Slice 1 — ZIP-only browser import

Status: implemented for the user-facing synthetic vertical slice on 2026-08-29.
The pinned reader, strict bounded inventory/extraction, complete-graph
validation, two-phase preview/admission UI, persistent Local identity,
duplicate rejection, and automated Chromium persistence/no-network evidence
are green. Representative real-archive cross-browser and quota measurement
remains required before the provisional limits become supported capacity.

- replace the dormant directory/FileList import seam with one archive input;
- implement safe ZIP inventory/extraction above the existing complete local
  graph validator;
- add preview/progress/error presentation, atomic IndexedDB storage, automatic
  dataset selection, and visible `Local` identity;
- cover valid regional import, persistence after reload, duplicate release,
  corrupt hash, missing/undeclared resource, unsafe ZIP path, and no-network
  behavior in unit and Chromium tests.

The user-facing slice is closed, but its capacity-evidence follow-up remains:
measure the provisional limits and reader behavior with representative real
regional and volume archives across the launch browsers. Record any revised
ceilings and the evidence for them here rather than treating the initial
constants as final support claims.

### Slice 2 — Public regional authoring

Status: implemented for Allen regional values and observations on 2026-08-29.
The single `ibl-ephys-atlas` distribution contains both the public
`ibl_ephys_atlas` and internal `ephys_atlas_builder` namespaces. The bundled
schema is generated from and byte-identical to the repository schema, and the
wheel test verifies both namespaces, schema bytes, dependencies, metadata, and
the retained internal CLI entry point.

Implemented behavior includes dataset/feature semantics, provenance,
structured validation, explicit `BrainRegions`, mutually exclusive Allen ID or
acronym input, already-aggregated values, repeated observations with explicit
mean aggregation, explicit hemisphere folding, neutral Linear/Full display,
deterministic regional serialization, independent complete-graph validation,
and atomic `write_zip()`. The concise tutorial is
[`CUSTOM_DATA_TUTORIAL.md`](CUSTOM_DATA_TUTORIAL.md).
`fixtures/authored-regional-v1.ibl-ephys-atlas.zip` is generated byte-for-byte
through this public API, checked for exact regeneration, and imported by a
dedicated Chromium test through the ordinary browser path.

### Slice 3 — Reduced mappings and management

Status: implemented on 2026-08-29.

- observation-level Allen-to-Beryl/Cosmos remapping and aggregation are tested
  against pinned `iblatlas`, including unequal replicate weighting, target
  metadata, per-feature mapping subsets, aligned empty groups, signed folding,
  and fail-closed root targets;
- atomic per-release deletion is tested for confirmation/cancellation,
  resource cleanup, survivor isolation, published fallback, history behavior,
  and exact reimport;
- Share states the local-URL limitation before clipboard access, and quota
  exhaustion reports that admission retained no partial import;
- inventory, exact per-release byte/resource inspection, separately labeled
  origin-wide quota/persistence reporting, explicit integrity verification,
  legacy-state disclosure, and damaged-entry delete/reimport recovery are
  covered by unit and Chromium browser tests.

### Slice 4 — Volume authoring

Status: not implemented.

- implement and independently test `AllenCCFGrid.from_iblatlas()` axis/affine
  conversion and explicit-grid validation;
- implement float16/float32 volume resources and mask/sentinel validity without
  silent conversion or geometric inference;
- import and navigate a deterministic authored volume through the same ZIP and
  IndexedDB path;
- run ordinary Chromium plus owner/manual Safari and Firefox acceptance before
  declaring volume authoring ready.

### Slice 5 — Distribution and release hardening

Status: partially implemented. Neutral Linear/Full regional output,
deterministic rebuilds, bundled-schema parity, and clean wheel construction are
green. Volume round trips, final public documentation/naming review, and PyPI
publication remain unfinished.

- support only release-declared scale/domain combinations and retain the Q14
  boundary for scientific choices;
- build and validate the distributable wheel from a clean environment;
- prove deterministic rebuilds and complete Python/TypeScript contract parity;
- publish the Python distribution only after regional and volume round trips,
  documentation, and final naming checks are green.

Remote publishing and any explicit legacy converter are independent follow-ups.

## First vertical-slice acceptance

The Allen regional authoring and browser-import machinery now satisfy the first
synthetic end-to-end milestone: a clean wheel contains the public API and exact
schema; the public API exactly regenerates the committed authored regional ZIP;
and a dedicated Chromium test imports that archive through the ordinary viewer
path, fully validates and persists it, and reads its resources without network
access. Before advertising production capacity, representative real authored
archives still need cross-browser memory/quota measurement.
