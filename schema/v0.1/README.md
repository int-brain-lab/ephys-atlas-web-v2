# Dataset schema v0.1

`manifest.json` is the small entry point. It lists immutable release metadata,
provenance, parcellation region indices, feature metadata files, and downloadable
artifacts. Feature metadata then points to independent `regional` and/or `volume`
representations.

The manifest `features` array is the release's feature catalog. It deliberately
has no Ephys Atlas feature enum: ids, metadata, ordering and representation
availability are discovered from the pinned release so a new `ea_active` vintage
may add or remove features without a frontend build.

## Physical formats

Small metadata uses JSON. Large numeric payloads do not.

- Regional scalar values: dense little-endian raw typed arrays, normally
  `float32` and promoted to `float64` when required by the finite value range,
  aligned to the dataset-level region index.
- Regional descriptive statistics: `float64` dense matrices so counts and
  quantiles share one simple browser-readable array without precision loss for
  realistic counts.
- Histogram region x bin counts: dense little-endian `uint32` arrays. Bin edges
  and global counts remain in the small statistics JSON.
- A volume declares its physical `layout` independently of its scientific grid.
  `chunks3d` stores one feature as C-order 3-D chunks. The schema also permits
  `orthogonal_slice_packs`, where each anatomical axis has packed consecutive
  slices for low-request interactive access.

`chunks3d` remains the deterministic builder/golden-fixture layout. It is not
frozen as the only launch browser transport: rendering benchmarks show that a
naive static 3-D chunk URL layout can exceed the request/transfer budget for
orthogonal slice navigation. Real encoding-volume artifacts must be benchmarked
before the production volume layout is selected.

The volume contract is browser transport, not a declaration that the canonical
scientific source has the same layout. Under D010 the pinned S3 NPZ remains
canonical. `docs/data/VOLUME_HTTP_VALIDATION.md` records why the current NPZ is
not directly browser-suitable. A future canonical public object that becomes
feature/slice-addressable and passes browser access/performance checks may be
consumed directly with explicit provenance.

All binary array metadata includes dtype, shape, order, and endianness. No
consumer should infer these from a filename.

## Histogram convention

Only finite values contribute to descriptive statistics and histograms. Bins
are left-closed/right-open, except the last bin is closed on both sides. Missing
counts are reported separately.

## Volume geometry

Volume metadata deliberately requires explicit coordinate-system, axis-order,
voxel-size, origin, and 4x4 index-to-world transform. Shape matching is not a
scientific alignment contract and must never be used to guess orientation.

## Release and aliases

`release.release_id` identifies an immutable directory. Mutable names such as
`latest` are aliases maintained outside that directory. Development/staging may
advance `latest`; a paper-facing alias must resolve to a specific immutable
release whose source vintage is recorded in provenance.

A whole-release ZIP can be built deterministically from the immutable directory.
Its digest belongs in the publication/index layer rather than inside the ZIP's
own manifest, avoiding a self-referential checksum.
