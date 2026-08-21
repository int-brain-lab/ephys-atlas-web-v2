# Encoding-volume HTTP validation

Validated on 2026-08-19 against the current IBL S3 endpoints. The canonical
`2026_W12` object was then pulled and inspected locally on 2026-08-20.

This report is historical benchmark evidence for the older 25 um object. New
volume implementation should use the documented `2026_W26` 50 um object and
official access recipe in `docs/DATA_SOURCES.md`, then repeat the relevant
measurements rather than treating the values below as current-source facts.

## Source under test

Canonical scientific source:

    s3://ibl-brain-wide-map-private/aggregates/atlas/encoding_volumes/ea_active/<YYYY_Www>/brainwide_ephys_atlas_25um.npz

The `2026_W12` object is a 25 um NPZ containing
`ephys_atlas_vol` with shape `(456, 528, 320, 41)` and dtype `float16`, plus
`feature_names`, `mean_per_feature`, `std_per_feature`, `grid_shape`, and
`res_um`. Those member names do not establish whether stored values are final
feature units, normalized values, or require another producer-defined transform.
That scientific semantic remains blocked under Q4.

The pulled object is exactly 1,636,734,203 bytes with SHA-256
`61987870fb1d0e3574f63c4b75f119b65778ef8a4521e592317b3aab9dcbe052`.
The header-only inspection is reproducible without decoding the main array:

```bash
just data-inspect-volume \
  data/source/ephys_atlas_volumes/2026_W12/brainwide_ephys_atlas_25um.npz
```

## HTTP observations

The standard public IBL bucket endpoint in `us-east-1` was probed from a GitHub
Actions runner.

- Listing `aggregates/atlas/encoding_volumes/ea_active/` in
  `ibl-brain-wide-map-public` returned HTTP 200 with `KeyCount=0`. The encoding
  volumes have not yet been mirrored at that public prefix.
- A known public object (`sample_data/cajal/cajal.zip`, 1,788,604,289 bytes)
  returned `Accept-Ranges: bytes`. A request for bytes `0-1023` returned HTTP
  206, an exact 1024-byte response, and the correct `Content-Range` header.
  S3 byte-range transport itself therefore works on existing public IBL objects.
- Requests to that known public object carrying browser `Origin` headers returned
  200/206 but no `Access-Control-Allow-Origin` header. CORS preflight requests
  returned 403. The current public bucket configuration is therefore not usable
  for cross-origin browser `fetch()` from the atlas site or local development.
- Unsigned HEAD, Range and OPTIONS requests to the current private `2026_W12`
  volume URL returned 403. Direct anonymous browser access to the canonical
  private object is not available.

The future public location and CORS policy must be re-tested after the encoding
volumes are published. The current result is a property of today's bucket
configuration, not a requirement on the eventual production bucket/CDN.

## NPZ access cost

For `2026_W12`:

- main array elements: `456 * 528 * 320 * 41 = 3,158,876,160`
- uncompressed float16 payload: 6,317,752,320 bytes (5.88 GiB)
- one feature volume: 154,091,520 bytes (146.95 MiB)

The main NPY header records C order (`fortran_order=False`). With the feature
axis last, every voxel's 41 feature values are contiguous and values for one
feature are interleaved across the full array. A contiguous source read for one
feature would therefore incur roughly 41x overfetch even without compression.

All six ZIP members use DEFLATE. The main `ephys_atlas_vol.npy` member is
6,317,752,448 bytes including its NPY header and compresses to 1,636,732,282
bytes (25.9%). Arbitrary interior voxels are not independently addressable: the
member must be streamed/inflated from its beginning. This is measured from the
canonical archive rather than inferred from a reported size.

Either physical case is poor for the required interaction model:

- the measured compressed member requires substantial transfer/decompression
  from its beginning;
- after decoding, one feature is about 147 MiB but is interleaved with the other
  40 features in the 5.88 GiB main-array payload.

`feature_names` is also an object array in the documented NPZ and is loaded by
the Python examples with `allow_pickle=True`, which is not a useful browser
metadata representation.

## Decision for v0.1

D010 remains the governing rule: use the canonical object directly when its
physical format and HTTP configuration satisfy browser requirements. The current
NPZ does not.

For the current encoding-volume product, v0.1 therefore uses a deterministic
web transform from a pinned/checksummed canonical NPZ into independently
addressable per-feature chunks with small JSON metadata. The source NPZ remains
the scientific authority and a downloadable provenance artifact; the chunks are
only browser transport.

Chunk shape and codec remain performance parameters to benchmark with the
rendering workstream. If a future public canonical artifact becomes directly
slice/feature-addressable with appropriate CORS, this decision should be
re-evaluated rather than preserving the transform by inertia.
