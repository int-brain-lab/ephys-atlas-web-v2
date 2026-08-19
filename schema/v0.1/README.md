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
  `float32`, aligned to the dataset-level region index.
- Regional descriptive statistics: `float64` dense matrices so counts and
  quantiles share one simple browser-readable array without precision loss for
  realistic counts.
- Histogram region x bin counts: dense little-endian `uint32` arrays. Bin edges
  and global counts remain in the small statistics JSON.
- Current web volume representation: one feature per chunked array; chunks are
  C-order little-endian raw numeric bytes, optionally gzip-compressed. Chunk
  coordinates are substituted into `path_template`.

The chunked volume contract is browser transport, not a declaration that the
canonical scientific source must be chunked. Under D010 the pinned S3 NPZ remains
canonical. `docs/data/VOLUME_HTTP_VALIDATION.md` records why the current NPZ is
not directly browser-suitable. If a future canonical public object becomes
feature/slice-addressable and passes browser access/performance checks, the
contract may be extended with a direct representation instead of preserving a
redundant transform.

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
