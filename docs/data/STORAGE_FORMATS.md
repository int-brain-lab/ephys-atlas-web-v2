# Storage formats v0.1

## Regional data

Use dense raw typed arrays plus small JSON metadata.

The launch parcellations have hundreds, not millions, of regions. A dense
`float32` array is therefore tiny, has zero parsing overhead, and maps directly
to `Float32Array` in the browser. JSON numeric arrays are larger and slower to
parse; Parquet/Arrow would add a runtime dependency without a compensating
access-pattern benefit for one scalar per region.

Descriptive-statistic matrices use `float64`; histogram counts use `uint32`.
Region ids are stored once per parcellation as `int32` and shared across
features.

## Volumes

Do not reuse v1's base64-encoded gzip-NPY-inside-JSON representation. A 25 µm
4-D NPZ is roughly 500 MB and must not be fetched as a unit merely to view one
feature or one slice.

v0.1 stores each feature as a 3-D chunked array. Each chunk is raw C-order data,
optionally gzip-compressed, with explicit dtype and geometry metadata. A
production starting point is a chunk edge around 64 voxels, but chunk shape is
release metadata and should be benchmarked by the rendering workstream rather
than frozen in the schema.

Zarr was considered. It is a good long-term interoperability option, but for the
launch read path it adds metadata/codec/runtime surface beyond what is needed:
static URLs, typed arrays, and gzip chunks are sufficient. The dataset model does
not prevent adding a Zarr representation later.

## Downloads

Individual feature downloads are ordinary checksummed artifacts (CSV, NPZ,
Parquet, or another documented media type as appropriate). Whole-dataset
downloads are deterministic ZIPs of the immutable release directory with a
sidecar digest in the publication/index layer.
