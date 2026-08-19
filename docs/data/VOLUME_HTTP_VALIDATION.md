# Encoding-volume HTTP validation

Validated on 2026-08-19 against the current IBL S3 endpoints and the documented
`2026_W12` encoding-volume layout.

## Source under test

Canonical scientific source:

    s3://ibl-brain-wide-map-private/aggregates/atlas/encoding_volumes/ea_active/<YYYY_Www>/brainwide_ephys_atlas_25um.npz

The private paper repository documents `2026_W12` as a 25 um NPZ containing
`ephys_atlas_vol` with shape `(456, 528, 320, 41)` and dtype `float16`, plus
`feature_names`, `mean_per_feature`, `std_per_feature`, `grid_shape`, and
`res_um`. The stored feature values are already in their final units;
`mean_per_feature` and `std_per_feature` are optional z-scoring metadata, not a
denormalization recipe.

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

The logical feature axis is last, but the NPY header of the private object could
not be inspected, so its `fortran_order` flag must not be guessed. If the array
is C-contiguous, values for one feature are interleaved with the other 40
features and contiguous Range reads incur roughly 41x overfetch. If it is
Fortran-contiguous, one complete feature could be contiguous, but it is still
154,091,520 bytes (146.95 MiB) before compression, far too large for the desired
fast feature-switching path.

The published NPZ is documented as approximately 500 MB, far smaller than the
6.32 GB raw main array. That strongly suggests compression of the large NPY
member. With ordinary ZIP/NPZ compression there is no independent random access
to arbitrary interior voxels of a deflated member: the compressed member must be
streamed/inflated from its beginning. The exact ZIP member compression method of
the canonical object could not be inspected without authenticated access, so
this compression detail is an inference rather than a measured property.

Either physical case is poor for the required interaction model:

- uncompressed member: at best a complete feature is about 147 MiB; depending on
  the recorded NPY memory order, slice/feature access may additionally be
  strided and require large overfetch;
- compressed member: switching to one feature requires substantial compressed
  transfer/decompression and the decoded full array is far beyond a reasonable
  browser memory budget.

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
