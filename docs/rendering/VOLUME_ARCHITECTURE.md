# Volume rendering and loading architecture

## Launch recommendation

Use a dependency-free Canvas2D renderer for the three orthogonal volume slices
behind a storage-neutral `VolumeSliceSource`. Do not download/materialize a full
feature volume in the browser and do not make WebGPU a prerequisite for volume
viewing.

The browser boundary is deliberately layered:

- `VolumeSliceSource` is what the application consumes: `loadSlice(axis, index)`.
- `VolumeChunkSource` is one possible physical adapter. It turns an eventual storage format into decoded logical chunks, potentially using workers, byte ranges, shards, OPFS, or IndexedDB.
- `VolumeSliceLoader` implements `VolumeSliceSource` on top of logical 3-D chunks, limits fetch concurrency, maintains a byte-bounded LRU, and assembles canonical planes.
- `SchemaSlicePackVolumeSource` directly decodes orientation-specific float16/float32 packs, deduplicates in-flight loads, and keeps a byte-bounded decoded LRU without changing the app or renderer.
- `scalarToRgba` applies the active scalar range/palette.
- `CanvasVolumeSliceRenderer` paints prepared RGBA pixels only.

This separation is intentional because schema v1 supports both physical
layouts and Q5 still requires a benchmark-based production selection.

## Historical 2026_W12 benchmark dimensions and dtype

The private paper source documents vintage `2026_W12` as:

- array shape `(456, 528, 320, 41)`;
- 25 um resolution;
- `float16` values;
- 41 feature volumes;
- per-feature means/stds stored separately.

A single 3-D feature therefore contains 77,045,760 voxels: **147.0 MiB raw float16**. Decoding an entire feature to float32 for browser computation would be **293.9 MiB**. The renderer prototype therefore normalizes decoded chunks to `Float32Array` but records the physical `storageDtype` separately.

Eager full-feature loading is rejected: it leaves too little safety margin for typed-array copies, RGBA planes, regional assets, application state, browser internals, and tablet/Safari constraints.

The current implementation input is now the `2026_W26` 50 um object documented
in `docs/DATA_SOURCES.md`. The measurements below remain useful historical
transport evidence, but new production work must repeat them against W26.

## 3-D cubic chunks: measured access-pattern problem

`benchmarks/rendering/volume-layout.mjs` evaluates cubic logical chunks using the real shape and float16 storage size, deliberately assuming one independently fetched object per chunk:

| logical chunk | raw/chunk | coronal cold slice | sagittal cold slice | horizontal cold slice | union of 3 current planes |
| --- | ---: | ---: | ---: | ---: | ---: |
| 32^3 | 0.063 MiB | 150 req / 9.4 MiB | 170 / 10.6 MiB | 255 / 15.9 MiB | 33.4 MiB |
| 48^3 | 0.211 MiB | 70 / 14.8 MiB | 77 / 16.2 MiB | 110 / 23.2 MiB | 48.5 MiB |
| 64^3 | 0.500 MiB | 40 / 20.0 MiB | 45 / 22.5 MiB | 72 / 36.0 MiB | 68.0 MiB |
| 96^3 | 1.688 MiB | 20 / 33.8 MiB | 24 / 40.5 MiB | 30 / 50.6 MiB | 101.3 MiB |

This is the central launch issue. Small cubes reduce voxel overfetch but explode request count; large cubes reduce requests while loading tens of MiB for each cold slice.

Schema v1 retains this `chunks3d` layout as the deterministic reference path,
but also permits `orthogonal_slice_packs`. The renderer benchmark does **not**
support selecting 64³ chunks for production: that candidate touches 157 chunk
objects / 78.5 MiB summed across the three views before overlap, or 136 unique
chunks / 68.0 MiB raw for their union.

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

### Resolved schema boundary and remaining benchmark

Schema v1 makes `layout` explicit, lists every immutable encoded resource, and
implements both candidate adapters.
The remaining work is to benchmark at least these two real-data candidates:

1. existing 32^3/64^3 cube chunks, including real browser request fan-out and three-plane startup transfer;
2. orientation-specific packs, especially depth 4 and 8, including total stored bytes and gzip ratios.

Scientific grid/dtype/affine metadata is common to both layouts. A future
indexed shard remains acceptable if it empirically achieves comparable request
and byte budgets, but would require a coherent schema/producer/consumer change.
The renderer does not require a specific container.

If 3-D chunks remain, the physical format needs a way to coalesce many logical chunks without 100+ independent round trips. Do not rely on whole-object HTTP `Content-Encoding` alone for byte-addressed shards; independently addressed payloads must remain independently decodable.

## Compression benchmark

The committed synthetic smooth float16 field is only a codec sanity check, not a data-format decision. Gzip ratios were ~0.72 for 32^3 and ~0.85 for 64^3; Brotli compressed further but had much slower offline encoding in this Node run. Real ephys-atlas features may have very different distributions and must decide the codec.

For independent slice-pack objects, ordinary HTTP gzip/Brotli content encoding is practical. For random-access shards, use independently decodable internal chunk payloads instead.

### Real `2026_W12` feature benchmark

`benchmarks/rendering/real-volume-layout.py` streams one feature from the
checksummed canonical NPZ without loading the 5.88 GiB main array. Measurements
cover indices 1 (`psd_lfp`), 26 (`rms_ap`), and 40 (`polarity`). The benchmark
assigns only physical `axis0/axis1/axis2` names: Q4 must still provide the
scientific axis mapping. Each candidate is split into independently
gzip-compressed objects at level 6. The committed raw reports are the three
`benchmarks/rendering/real-volume-layout-*-results.json` files.

| layout | stored gzip / feature | current center planes | requests | warm depth |
| --- | ---: | ---: | ---: | ---: |
| 32³ chunks | 17.37–37.68 MiB | 5.21–11.39 MiB | 534 | 32 within each chunk slab |
| 64³ chunks | 17.75–38.71 MiB | 9.84–21.77 MiB | 136 | 64 within each chunk slab |
| 4-slice packs, three orientations | 58.21–117.73 MiB | 0.83–1.66 MiB | 3 | 4 |
| 8-slice packs, three orientations | 58.22–117.72 MiB | 1.65–3.32 MiB | 3 | 8 |

The three real features compress to roughly 11.8–26.7% of raw storage, showing
why a single synthetic or real feature is insufficient for capacity planning.
Three-orientation packs cost roughly three times the gzip storage of cubes, but
reduce the first three linked planes from 136–534 object requests to three and
remain below the 8–10 MiB startup-transfer target for every sampled feature.
Pack depth 4 trades half the initial bytes for half the immediately warm
navigation range relative to depth 8.

The implemented slice-pack adapter was then measured in headless Chromium over
Vite/Playwright route fulfillment using real `rms_ap` center and boundary
packs. Ten trials include browser fetch, `DecompressionStream`, float16 decode,
orientation normalization, cache reuse, RGBA preparation, and Canvas2D paint.
The committed raw report is
`benchmarks/rendering/real-volume-browser-rms_ap-results.json`.

| depth | current planes | cold p50 / p95 | cached adjacent p50 / p95 | boundary p50 / p95 | six-plane prepare+paint p50 / p95 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 4 | 3 req / 0.83 MiB | 37.8 / 54.1 ms | 0 req / 0.8 / 1.5 ms | 3 req / 0.84 MiB / 36.8 / 71.9 ms | 3.7 / 8.7 ms |
| 8 | 3 req / 1.65 MiB | 70.9 / 75.0 ms | 0 req / 0.8 / 1.0 ms | 3 req / 1.70 MiB / 71.0 / 73.7 ms | 3.8 / 5.2 ms |

This exposed and prompted removal of a per-voxel object allocation in the
orientation transpose; cached three-plane navigation fell from about 57 ms in
the first diagnostic run to 1.5 ms p95. Depth 4 is the current launch
recommendation because it halves cold bytes/decode relative to depth 8 while
remaining comfortably within the warm-navigation budget. Q5 stays open until
the measurement covers additional feature distributions and a real HTTP/CDN
origin; route fulfillment does not model production latency, caching headers,
or contention.

### Current `2026_W26` evidence

The pinned 50 um W26 object has now been pulled and measured for the same three
representative features. Depth-4 center packs transfer 0.20–0.36 MiB in three
requests, compared with 0.41–0.75 MiB for depth 8. The 32³/64³ center unions
require 36–136 requests and 1.35–4.56 MiB. Ten-trial local Chromium depth-4 cold
p50 is 14.6–15.5 ms, compared with 24.3–26.2 ms for depth 8; both retain
request-free cached navigation. Exact source identity, tables, limitations,
reproduction commands, and raw-report paths are in
`docs/data/VOLUME_2026_W26_EVIDENCE.md`.

This confirms depth 4 as the local recommendation across representative W26
distributions. It does not resolve Q5 because Playwright route fulfillment does
not model the production cache and network profile.

Reproduce it after `just bootstrap-scientific`:

```bash
uv run --project builder --extra scientific --locked python \
  benchmarks/rendering/real-volume-layout.py \
  data/source/ephys_atlas_volumes/2026_W12/brainwide_ephys_atlas_25um.npz \
  --feature-index 26 --feature-id rms_ap \
  --work-dir /tmp/ibl-ephys-real-volume-layout \
  --output benchmarks/rendering/real-volume-layout-rms_ap-results.json
```

Generate the bounded real artifacts and run the browser measurement:

```bash
uv run --project builder --extra scientific --locked python \
  benchmarks/rendering/prepare-volume-browser-benchmark.py \
  data/source/ephys_atlas_volumes/2026_W12/brainwide_ephys_atlas_25um.npz \
  --feature-index 26 --feature-id rms_ap \
  --work-dir /tmp/ibl-ephys-volume-browser-benchmark

cd web
EPHYS_ATLAS_VOLUME_BENCHMARK_DIR=/tmp/ibl-ephys-volume-browser-benchmark \
EPHYS_ATLAS_VOLUME_BENCHMARK_OUTPUT=../benchmarks/rendering/real-volume-browser-rms_ap-results.json \
  npm run benchmark:real-volume
```

## Cache and scheduling

The current 3-D chunk prototype uses:

- 96 MiB decoded-chunk LRU default;
- 8 concurrent logical chunk loads maximum;
- exact reuse while navigation remains inside the same chunk slab;
- optional adjacent-slice prefetch through the same bounded cache;
- `AbortSignal` for stale feature/slice requests.

The slice-pack source uses a 48 MiB decoded LRU by default, reuses all slices in
the current pack, prefetches only adjacent packs, and deduplicates in-flight
requests. Both schema layouts now terminate at the same canonical
`VolumeSliceSource`; the real HTTP/browser benchmark still determines which
layout is published for launch.

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
