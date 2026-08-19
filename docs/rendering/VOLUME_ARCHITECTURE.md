# Volume rendering and loading architecture

## Launch recommendation

Use a dependency-free Canvas2D renderer for the three orthogonal 25 um volume slices behind a storage-neutral `VolumeSliceSource`. Do not download/materialize a full feature volume in the browser and do not make WebGPU a prerequisite for volume viewing.

The browser boundary is deliberately layered:

- `VolumeSliceSource` is what the application consumes: `loadSlice(axis, index)`.
- `VolumeChunkSource` is one possible physical adapter. It turns an eventual storage format into decoded logical chunks, potentially using workers, byte ranges, shards, OPFS, or IndexedDB.
- `VolumeSliceLoader` implements `VolumeSliceSource` on top of logical 3-D chunks, limits fetch concurrency, maintains a byte-bounded LRU, and assembles canonical planes.
- another source can implement orientation-specific slice packs without changing the app or renderer.
- `scalarToRgba` applies the active scalar range/palette.
- `CanvasVolumeSliceRenderer` paints prepared RGBA pixels only.

This separation is intentional because the physical volume layout is still under cross-workstream review.

## Real launch source dimensions and dtype

The private paper source documents vintage `2026_W12` as:

- array shape `(456, 528, 320, 41)`;
- 25 um resolution;
- `float16` values;
- 41 feature volumes;
- per-feature means/stds stored separately.

A single 3-D feature therefore contains 77,045,760 voxels: **147.0 MiB raw float16**. Decoding an entire feature to float32 for browser computation would be **293.9 MiB**. The renderer prototype therefore normalizes decoded chunks to `Float32Array` but records the physical `storageDtype` separately.

Eager full-feature loading is rejected: it leaves too little safety margin for typed-array copies, RGBA planes, regional assets, application state, browser internals, and tablet/Safari constraints.

## 3-D cubic chunks: measured access-pattern problem

`benchmarks/rendering/volume-layout.mjs` evaluates cubic logical chunks using the real shape and float16 storage size, deliberately assuming one independently fetched object per chunk:

| logical chunk | raw/chunk | coronal cold slice | sagittal cold slice | horizontal cold slice | union of 3 current planes |
| --- | ---: | ---: | ---: | ---: | ---: |
| 32^3 | 0.063 MiB | 150 req / 9.4 MiB | 170 / 10.6 MiB | 255 / 15.9 MiB | 33.4 MiB |
| 48^3 | 0.211 MiB | 70 / 14.8 MiB | 77 / 16.2 MiB | 110 / 23.2 MiB | 48.5 MiB |
| 64^3 | 0.500 MiB | 40 / 20.0 MiB | 45 / 22.5 MiB | 72 / 36.0 MiB | 68.0 MiB |
| 96^3 | 1.688 MiB | 20 / 33.8 MiB | 24 / 40.5 MiB | 30 / 50.6 MiB | 101.3 MiB |

This is the central launch issue. Small cubes reduce voxel overfetch but explode request count; large cubes reduce requests while loading tens of MiB for each cold slice.

The current `work/data-schema` v0.1 draft uses one raw/gzip `path_template` per 3-D chunk and suggests ~64 voxels as a production starting point. The renderer benchmark does **not** support freezing that physical layout yet: the 64^3 candidate touches 157 chunk objects / 78.5 MiB summed across the three views before overlap, or 136 unique chunks / 68.0 MiB raw for their union.

## Simpler launch candidate: orientation-specific slice packs

For a static publication dataset, storage duplication may be a better trade than browser request/overfetch complexity. Store the same exact float16 volume in three orientations, each divided into packs of neighboring 2-D slices. A current view then needs one object per axis.

Measured raw costs:

| slices per pack | three-view startup | decoded float32 cache | full feature storage | immediately warm steps |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 1.06 MiB | 2.12 MiB | 440.9 MiB | 1 |
| 4 | 4.24 MiB | 8.48 MiB | 440.9 MiB | 4 |
| 8 | 8.48 MiB | 16.96 MiB | 440.9 MiB | 8 |
| 16 | 16.96 MiB | 33.91 MiB | 440.9 MiB | 16 |

An **8-slice pack** is the strongest launch candidate to benchmark on real data: three requests for the current linked views, an 8.48 MiB raw upper bound before compression, and only ~17 MiB decoded working data. Its cost is 3x physical volume storage: 440.9 MiB raw per feature, ~17.7 GiB raw for all 41 `2026_W12` features before compression. For immutable object storage this may be acceptable; it must be weighed against build time/storage/whole-dataset packaging.

This representation can use ordinary static gzip-compressed objects without range addressing because each requested pack is independently useful. It also keeps the browser implementation trivial.

### Cross-workstream request to `work/data-schema`

Do not freeze v0.1 as only one independently fetched 3-D chunk URL. Benchmark at least these two real-data candidates:

1. existing 32^3/64^3 cube chunks, including real browser request fan-out and three-plane startup transfer;
2. orientation-specific packs, especially depth 4 and 8, including total stored bytes and gzip ratios.

A compatible schema direction is to make physical `layout` explicit and allow either `chunks3d` or `orthogonal_slice_packs`, while keeping scientific grid/dtype/affine metadata common. Another acceptable direction is an indexed shard that empirically achieves comparable request and byte budgets. The renderer does not require a specific container.

If 3-D chunks remain, the physical format needs a way to coalesce many logical chunks without 100+ independent round trips. Do not rely on whole-object HTTP `Content-Encoding` alone for byte-addressed shards; independently addressed payloads must remain independently decodable.

## Compression benchmark

The committed synthetic smooth float16 field is only a codec sanity check, not a data-format decision. Gzip ratios were ~0.72 for 32^3 and ~0.85 for 64^3; Brotli compressed further but had much slower offline encoding in this Node run. Real ephys-atlas features may have very different distributions and must decide the codec.

For independent slice-pack objects, ordinary HTTP gzip/Brotli content encoding is practical. For random-access shards, use independently decodable internal chunk payloads instead.

## Cache and scheduling

The current 3-D chunk prototype uses:

- 96 MiB decoded-chunk LRU default;
- 8 concurrent logical chunk loads maximum;
- exact reuse while navigation remains inside the same chunk slab;
- optional adjacent-slice prefetch through the same bounded cache;
- `AbortSignal` for stale feature/slice requests.

A slice-pack source should use the same policies with a much smaller decoded cache. The physical source should deduplicate in-flight object/range requests.

## Slice orientation contract

A source normalizes data to canonical `(coronal, sagittal, horizontal)` order before assembly. `VolumeSliceSource` returns:

- coronal: width sagittal, height horizontal;
- sagittal: width coronal, height horizontal;
- horizontal: width sagittal, height coronal.

Display flips/orientation belong to the view adapter, not hidden physical indexing. Scientific coordinates come from schema geometry / `slice-calibration.ts`, never from SVG guide calibration.

## Canvas2D evidence

`benchmarks/rendering/volume-render.mjs` maps all three full-resolution planes (555,648 pixels) through a 256-entry RGBA palette with reusable buffers. Local Node 22 results:

- p50: 4.79 ms
- p95: 5.35 ms
- max: 5.68 ms

This is not a browser paint benchmark, but it makes network/decode the dominant architectural concern. Canvas2D has the lowest launch risk. If browser profiling misses the frame budget, `VolumeSliceRenderer` permits OffscreenCanvas/worker or GPU replacement without changing data/application state.

## Provisional performance budgets

| operation | target |
| --- | --- |
| app shell + metadata to interactive, warm CDN | <= 2 s desktop |
| first regional linked slices, excluding feature table | <= 2 MiB transferred |
| regional feature switch after metadata loaded | <= 100 ms local processing; <= 500 ms including network |
| warm slice navigation | <= 50 ms p95 input-to-paint |
| cold volume boundary/navigation | <= 250 ms p95 typical broadband |
| scalar recolor of all three volume views | <= 10 ms p95 CPU before paint |
| decoded volume cache | <= 96 MiB default; prefer much less for slice packs |
| total steady-state viewer JS heap | aim <= 192 MiB; review at 256 MiB |
| initial volume feature data for three current planes | <= 8-10 MiB raw/transfer target before opportunistic prefetch |
| background/prefetch | bounded, cancellable; never fetch a whole 147 MiB float16 feature implicitly |

Re-run these budgets with real release artifacts and browser/network traces before schema freeze/launch.
