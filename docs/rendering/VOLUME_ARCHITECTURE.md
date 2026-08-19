# Volume rendering and loading architecture

## Launch recommendation

Use a dependency-free Canvas2D renderer for the three orthogonal 25 um volume slices, fed by a storage/codec-neutral logical chunk loader. Do not download/materialize a full feature volume in the browser and do not make WebGPU a prerequisite for volume viewing.

The renderer and loader are deliberately separate:

- `VolumeChunkSource` translates the dataset's eventual physical storage format into decoded logical chunks. It may use object fetches, HTTP ranges, shards, OPFS/IndexedDB, and worker decoding.
- `VolumeSliceLoader` plans intersecting chunks, limits fetch concurrency, maintains a byte-bounded LRU, and assembles canonical coronal/sagittal/horizontal planes.
- `scalarToRgba` applies the active scalar range/palette to a plane.
- `CanvasVolumeSliceRenderer` only paints prepared RGBA pixels.

The source adapter is the only component that should know the schema team's physical format.

## Why eager full-volume loading is rejected

The launch Allen-grid shape is 528 x 456 x 320 = 77,045,760 voxels. A single float32 feature is 293.9 MiB before transport compression. Holding that complete array plus decoded payloads, RGB(A) buffers, regional assets, application state, and caches is an unnecessary browser-memory risk, particularly on Safari/tablets.

V1 currently materializes the whole volume and loops over every displayed pixel on the UI thread. V2 keeps only the chunks needed for current/nearby slices.

## Logical chunks versus physical objects

`benchmarks/rendering/volume-layout.mjs` evaluates cubic logical chunks assuming, deliberately pessimistically, that every chunk is a separately fetched object:

| logical chunk | raw/chunk | coronal cold slice | sagittal cold slice | horizontal cold slice |
| --- | ---: | ---: | ---: | ---: |
| 32^3 | 0.125 MiB | 150 req / 18.8 MiB | 170 / 21.3 MiB | 255 / 31.9 MiB |
| 48^3 | 0.422 MiB | 70 / 29.5 MiB | 77 / 32.5 MiB | 110 / 46.4 MiB |
| 64^3 | 1.0 MiB | 40 / 40.0 MiB | 45 / 45.0 MiB | 72 / 72.0 MiB |
| 96^3 | 3.375 MiB | 20 / 67.5 MiB | 24 / 81.0 MiB | 30 / 101.3 MiB |

This rules out **one HTTP object per logical brick** as the launch format. Small chunks control decoded overfetch but create excessive request fan-out; large chunks reduce fan-out by transferring too much data.

### Cross-workstream requirement for `work/data-schema`

The physical format should support **logical chunks materially smaller than physical request/shard units**, with an index that permits request coalescing and/or byte-range access. The rendering branch does not require a particular container or codec. Zarr-style sharding is one candidate; a small custom indexed shard is another. The contract needed by the renderer is simply:

1. immutable volume metadata exposes shape, 25 um voxel size, dtype, and logical chunk shape;
2. a logical chunk can be addressed deterministically;
3. several chunks needed for one plane can be fetched without 100+ independent HTTP round trips;
4. chunk decoding can run outside the UI thread when a JavaScript/native streaming decoder is insufficient;
5. range/shard layout remains compatible with static object storage/CDN reads.

Do not use whole-object HTTP `Content-Encoding` as the only compression mechanism for a range-addressed shard; the source must be able to decode the independently addressed chunk payloads it requests.

## Logical chunk size starting point

Benchmark 32^3 and 48^3 logical chunks first against **real ephys-atlas volume features** once the schema branch has representative artifacts. They keep each decoded chunk at 128-432 KiB float32 and give 31-47 immediately reusable neighboring slices along a dimension when the relevant bricks remain cached.

The synthetic compression benchmark is intentionally not a format decision. A smooth-but-microstructured float32 field compressed to 0.86-0.91 of raw with gzip at these chunk sizes; real ephys feature volumes may compress very differently. Codec choice must be benchmarked on real launch data.

## Cache and scheduling

The current prototype uses:

- 96 MiB decoded-chunk LRU default;
- 8 concurrent logical chunk loads maximum;
- exact reuse while navigation remains inside the same chunk slab;
- optional adjacent-slice prefetch through the same bounded cache.

The frontend may lower the cache budget on constrained devices. Avoid relying solely on `navigator.deviceMemory` because browser coverage differs.

Requests for a stale feature/slice should be cancelled with `AbortSignal`. The physical source should deduplicate in-flight chunk/range requests; this remains source-adapter work once the format is settled.

## Slice orientation contract

Logical chunk data is normalized by the source to canonical `(coronal, sagittal, horizontal)` order. `VolumeSliceLoader` returns:

- coronal: width sagittal, height horizontal;
- sagittal: width coronal, height horizontal;
- horizontal: width sagittal, height coronal.

Display flips/orientation should be applied by the view adapter, not hidden in physical data indexing. Physical coordinate lookup uses `slice-calibration.ts`, not SVG guide-line calibration.

## Canvas2D evidence

`benchmarks/rendering/volume-render.mjs` maps all three full-resolution planes (555,648 pixels total) through a 256-entry RGBA palette with reusable buffers. Local Node 22 results:

- p50: 4.79 ms
- p95: 5.35 ms
- max: 5.68 ms

This is not a browser paint benchmark, but it shows that scalar recoloring itself is comfortably small compared with network/decode costs. Canvas2D therefore has the lowest launch risk. If browser profiling later misses the frame budget, the same `VolumeSliceRenderer` interface can move recoloring/painting to OffscreenCanvas/worker or a GPU renderer without changing application state or storage.

## Provisional performance budgets

These are launch engineering budgets, not measured product guarantees:

| operation | target |
| --- | --- |
| app shell + metadata to interactive, warm CDN | <= 2 s desktop |
| first regional linked slices, excluding feature table | <= 2 MiB transferred |
| regional feature switch after metadata loaded | <= 100 ms local processing; <= 500 ms including network |
| warm slice navigation | <= 50 ms p95 input-to-paint |
| cold volume chunk-boundary navigation | <= 250 ms p95 on a typical broadband connection |
| scalar recolor of all three volume views | <= 10 ms p95 CPU before paint |
| decoded volume chunk cache | 96 MiB default, configurable downward |
| total steady-state viewer JS heap | aim <= 192 MiB; hard review threshold 256 MiB |
| initial volume feature data needed for three current planes | aim <= 8 MiB transferred |
| background/prefetch bytes | bounded and cancellable; never download whole 294 MiB float32 volume implicitly |

The byte/latency targets must be re-run with real release artifacts and browser/network traces before launch.
