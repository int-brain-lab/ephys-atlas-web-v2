# Storage formats v0.1

D010 separates **canonical scientific storage** from **browser transport**.
Direct HTTP/object-store consumption is preferred when the canonical object
meets browser access and performance requirements; a derived format is justified
only when measurements show that it does not.

## Regional data

Use dense raw typed arrays plus small JSON metadata.

The launch parcellations have hundreds, not millions, of regions. A dense
`float32` array is therefore tiny, has zero numeric-text parsing overhead, and
maps directly to a typed array in the browser. JSON numeric arrays are larger
and slower to parse; Parquet/Arrow would add runtime surface without a useful
access-pattern benefit for one scalar per region.

Regional display arrays are promoted to `float64` when a finite mean exceeds
the `float32` range. Silently clipping it or serializing infinity would violate
the source-value preservation policy.

Descriptive-statistic matrices use `float64`; histogram counts use `uint32`.
Region ids are stored once per parcellation as `int32` and shared across
features.

## Volumes

### Canonical source

The scientific source remains the pinned/checksummed weekly object:

    s3://ibl-brain-wide-map-private/aggregates/atlas/encoding_volumes/ea_active/<vintage>/brainwide_ephys_atlas_25um.npz

The source object should remain available as a provenance/download artifact. It
is not rewritten merely to make the scientific release look like the web
layout.

### Measured browser suitability

`docs/data/VOLUME_HTTP_VALIDATION.md` records the 2026-08-19 validation.
Current findings are sufficient to reject direct browser use of the present NPZ:

- the private canonical URL requires authentication;
- the future public volume prefix is not populated yet;
- existing objects in the public IBL bucket support HTTP Range, but current
  responses do not expose browser CORS headers;
- `2026_W12` contains a `(456, 528, 320, 41)` float16 array: 6.32 GB raw;
- its logical feature axis is last in a measured C-order array, so feature values
  are interleaved rather than independently contiguous;
- the main NPY member is measured DEFLATE data: 6,317,752,448 bytes expand from
  1,636,732,282 compressed bytes, removing random access inside the member;
- one decoded feature alone is about 147 MiB.

Thus Range support alone does not make this NPZ incrementally browser-readable.

### Web representation for the current product

v0.1 derives one independently addressable 3-D array per feature. Each array is
split into C-order chunks of raw little-endian values, optionally gzip-compressed,
with explicit dtype and geometry metadata. The transform is deterministic and
its manifest provenance points back to the exact canonical NPZ vintage and
checksum.

Chunk shape is deliberately release metadata, not a schema constant. Cubic
chunks are a reasonable 3-D starting point but may overfetch for 2-D slices; the
rendering workstream should benchmark realistic feature switching and linked
slice navigation before the production shape/codec is frozen.

Zarr remains a possible interoperability option, but it is not required for the
launch reader. The small v0.1 contract needs only static URLs, explicit metadata,
typed arrays, and a documented codec.

### Re-evaluation gate

The derived representation is not an architectural requirement forever. If the
public canonical release later changes to a per-feature/chunked object layout or
a CDN exposes an equivalently efficient representation with correct CORS, add a
direct reader/representation and remove the redundant transform after measuring
it against the same interaction workloads.

## Downloads

Individual feature downloads are ordinary checksummed artifacts (CSV, NPZ,
Parquet, or another documented media type as appropriate). Whole-dataset
downloads are deterministic ZIPs of the immutable release directory with a
sidecar digest in the publication/index layer.
