# Encoding-volume `2026_W26` source and transport evidence

## Scope

This report records local source inspection and transport measurements for the
current implementation input. It does not define the unresolved scientific
axis mapping or simulate the eventual production HTTP/CDN origin.

## Canonical input

- URI: `s3://ibl-brain-wide-map-private/aggregates/atlas/encoding_volumes/ea_active/2026_W26/brainwide_ephys_atlas_50um.npz`
- bytes: `238954924`
- SHA-256: `1f7509fe9e368a90704173bdb5c385827b199a7d5fa4b0aaa8fec5aca5402253`
- pulled through authenticated ONE/IBL AWS helpers on 2026-08-23
- independently reacquired through the repository's official ONE/IBL puller on
  Apple silicon on 2026-08-24; the file again measured 238,954,924 bytes and
  matched the declared SHA-256 exactly
- main member: DEFLATE-compressed, C-order little-endian float16,
  shape `(228, 264, 160, 41)`, 789,719,168 uncompressed bytes
- metadata members: `grid_shape`, `mean_per_feature`, `std_per_feature`,
  `res_um`, and 41-element `feature_names`
- declared metadata: `grid_shape=[228,264,160]`, `res_um=[50]`

The official `ibleatools` guide at
`fffe0c75810dd1a013a878abcbcf8ef6348a5a21` now describes the storage order as
`x × y × z × features`. It does not declare the W26 origin or index-center
convention or identify producer code tying those axes to the complete
`iblatlas` Allen coordinate transform, so Q4 remains blocked.

The pinned repository `ibleatools` predates the documented `res_um` downloader
argument. The puller therefore uses that API when available and otherwise uses
the same authenticated `one.remote.aws.s3_download_file` helper with the exact
documented key. Volume resolution is a required explicit CLI input, and a pull
fails unless the expected resolution-specific artifact exists.

## Offline layout measurements

The three historical representative features remain present at the same
indices: `psd_lfp` (1), `rms_ap` (26), and `polarity` (40). Each report compares
independently gzip-compressed 32³/64³ chunks and depth-4/depth-8 orthogonal slice
packs. Axis names remain physical only; no scientific affine is inferred.

| feature | layout | full gzip MiB | center requests | center gzip MiB |
| --- | --- | ---: | ---: | ---: |
| `psd_lfp` | 32³ chunks | 3.09 | 136 | 1.65 |
|  | 64³ chunks | 3.23 | 36 | 2.78 |
|  | depth-4 packs | 8.94 | 3 | 0.23 |
|  | depth-8 packs | 8.93 | 3 | 0.48 |
| `rms_ap` | 32³ chunks | 2.54 | 136 | 1.35 |
|  | 64³ chunks | 2.65 | 36 | 2.25 |
|  | depth-4 packs | 7.40 | 3 | 0.20 |
|  | depth-8 packs | 7.39 | 3 | 0.41 |
| `polarity` | 32³ chunks | 5.05 | 136 | 2.74 |
|  | 64³ chunks | 5.32 | 36 | 4.56 |
|  | depth-4 packs | 13.64 | 3 | 0.36 |
|  | depth-8 packs | 13.64 | 3 | 0.75 |

## Chromium measurements

Ten headless Chromium trials per feature and depth exercise fetch,
`DecompressionStream`, float16 decoding, orientation normalization, decoded
cache reuse, RGBA preparation, and Canvas2D paint. Playwright fulfills the
objects locally with `Cache-Control: no-store`; these timings exclude real
network latency, CDN caching, and contention.

| feature | depth | cold gzip MiB | cold p50/p95 ms | cached p50/p95 ms | boundary p50/p95 ms | six-plane paint p50/p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `psd_lfp` | 4 | 0.23 | 15.1 / 30.4 | 2.5 / 8.5 | 16.0 / 24.4 | 2.3 / 4.3 |
|  | 8 | 0.48 | 25.7 / 30.5 | 2.5 / 4.4 | 26.1 / 27.3 | 2.1 / 6.3 |
| `rms_ap` | 4 | 0.20 | 14.6 / 29.5 | 2.4 / 4.2 | 14.8 / 38.6 | 2.1 / 4.3 |
|  | 8 | 0.41 | 24.3 / 27.1 | 2.4 / 6.7 | 25.5 / 28.1 | 2.0 / 5.9 |
| `polarity` | 4 | 0.36 | 15.5 / 40.0 | 2.6 / 10.7 | 16.6 / 35.1 | 1.7 / 4.2 |
|  | 8 | 0.75 | 26.2 / 29.7 | 2.5 / 2.8 | 27.4 / 28.2 | 1.6 / 3.3 |

Depth 4 remains the local recommendation: it preserves the three-request path,
roughly halves cold transfer and decode work relative to depth 8, and stays
well inside the provisional local interaction budgets. Slice packs exchange
roughly threefold full-feature storage for that request behavior. Q5 remains
open until equivalent measurements run under production cache headers and
network profiles. Q4 remains independently blocked on authoritative geometry.

## Reproduction

Pull and inspect the ignored source:

```bash
just data-pull-volume 2026_W26 50
just data-inspect-volume \
  data/source/ephys_atlas_volumes/2026_W26/brainwide_ephys_atlas_50um.npz
```

The raw committed reports are
`benchmarks/rendering/real-volume-layout-2026_W26-*-results.json` and
`benchmarks/rendering/real-volume-browser-2026_W26-*-results.json`. Use
`benchmarks/rendering/real-volume-layout.py` and
`benchmarks/rendering/prepare-volume-browser-benchmark.py`, followed by
`npm run benchmark:real-volume`, to regenerate them.
