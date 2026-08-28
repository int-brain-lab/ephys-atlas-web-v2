# Encoding-volume `2026_W26` source and transport evidence

Status: frozen evidence supporting D043 and the provisional Q5 recommendation.

## Scope

This report records local source inspection and transport measurements for the
current implementation input. D043 now defines the scientific axis mapping;
this report still does not simulate the eventual production HTTP/CDN origin.

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
`iblatlas` Allen coordinate transform. The scientific owner supplied that
authority on 2026-08-24; D043 and the machine-readable geometry selection
record the resulting all-forward voxel-center affine.

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
network profiles. Q4 is resolved for this exact W26 source by D043.

## Full candidate releases and worst-case profiles

Two ignored, explicitly non-published schema-v1 candidates were built from all
41 dynamically discovered W26 features using builder commit `d43fda3` and the
committed D043 selection. Both complete graphs passed schema-v1 validation.

| candidate | files | served bytes | manifest SHA-256 | complete-graph SHA-256 |
| --- | ---: | ---: | --- | --- |
| `2026_W26-candidate-depth4` | 6,809 | 494,830,395 | `611510ab6ffb2c5489333d7176db6240ffc1f6d2f323bde6e82e77995144332f` | `506f7a66ea7325b19095a30e06025e0d2c06a71ff182bde0f144760004348de5` |
| `2026_W26-candidate-depth8` | 3,488 | 492,228,218 | `77fdacc4aca33fc34f2c1583b245e1b3b62f3a419702a570633f850e1d4511a9` | `9fedde1b936fa373b2a1570abbd917184486a51609f4db87214ec3c8e1f13d86` |

The complete-graph digest is SHA-256 over sorted records of
`relative-path NUL byte-size NUL file-sha256 LF`. The committed generated report
`benchmarks/rendering/volume-candidate-2026_W26-graph.json` records every
feature's pack bytes and exhaustive valid/outside/missing counts. Every feature
has zero missing voxels under the selected non-finite policy; its mutually
exclusive counts sum to 9,630,720 grid voxels.

The prior three representatives were not reused for the extension. Full
candidate inventories identified these six worst linked-Bregma features:
`psd_residual_alpha`, `psd_residual_delta`, `recovery_slope`,
`psd_residual_beta`, `repolarisation_slope`, and `psd_residual_theta`.
Three Chromium trials per feature/depth produced these ranges:

| profile | depth | cold bytes | cold p50 ms | cached p50 ms | decoded center-pack cache | paint p50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| local route | 4 | 198,849–212,743 | 14.6–25.8 | 2.5–4.6 | 2,222,592 B | 0.3–0.7 |
| local route | 8 | 423,998–456,487 | 18.1–28.7 | 2.4–2.8 | 4,445,184 B | 0.4–0.5 |
| 20 ms / 100 Mbps | 4 | 198,849–212,743 | 37.9–46.7 | 2.3–2.5 | 2,222,592 B | 0.3–0.4 |
| 20 ms / 100 Mbps | 8 | 423,998–456,487 | 50.8–61.8 | 2.4–4.0 | 4,445,184 B | 0.3–0.5 |
| 80 ms / 10 Mbps | 4 | 198,849–212,743 | 187.9–196.2 | 3.5–4.6 | 2,222,592 B | 0.4–0.5 |
| 80 ms / 10 Mbps | 8 | 423,998–456,487 | 320.2–332.8 | 2.9–3.8 | 4,445,184 B | 0.4–0.7 |

All cold cases used exactly three requests and decoded-cache revisits used zero
requests. The raw report records fetch/decode-plane estimates, paint timings,
environment, and limitations in
`benchmarks/rendering/real-volume-browser-2026_W26-candidate-profiles-results.json`.
Latency/bandwidth were simulated at Playwright route fulfillment, so this is
provisional local evidence rather than eventual CloudFront verification.

Depth 4 is therefore the stronger provisional Q5 recommendation: depth 8 saves
only 2,602,177 bytes across the complete 41-feature release while roughly
doubling linked-plane transfer and decoded center-pack memory. Q5 deliberately
remains open until the selected origin reproduces the header/cache behavior and
real network measurements.

## Production-style local browser acceptance

The ignored depth-4 candidate is served through the opt-in real-release path
with short-lived catalog caching, immutable release caching, wildcard read
CORS, correct JSON/binary MIME types, declared content lengths, and opaque gzip
bytes without `Content-Encoding`. Chromium acceptance covers all 41 feature
switches, D043-derived Bregma-linked indices `(i0,i1,i2)=(115,108,7)`, exact
inspected `rms_ap` values compared with the packed float16 bytes, explicit
outside voxels, request-free same-pack navigation, rapid-switch cancellation,
and encoded SHA-256 failure. Successful compositing with the active 10 um
projection pack confirms exact shared `reference_space_id=allen-ccf-2017` while
retaining distinct 50 um and 10 um grids.

Integrated visual review on 2026-08-26 exposed two frontend-only composition
defects without changing the candidate bytes, D043 geometry, or scientific
navigation. The scalar layer now occupies the same full viewport as the
regional SVG. Volume navigation retains the previous complete composite while
loading, commits anatomy and scalar layers atomically, and reuses unchanged
linked projections. A 20-step coronal native-grid sweep at 16 ms intervals
produced four meaningful coronal scalar paints, zero sagittal or horizontal
paints, zero composite-to-regional mode transitions, and one cold-pack request.
A gated cold-pack test also confirmed that several native cursor inputs mapping
to one 50 um plane retain the previous composite, issue one non-aborted request,
and commit only the latest requested plane.

## Value-validity audit

A bounded streaming pass over all 394,859,520 float16 values found 230,814,914
zeros, zero NaNs, and zero positive or negative infinities. The official W26
documentation defines `0.0` as outside brain. The schema-v1 `nonfinite` missing
policy therefore remains explicit but classifies no source values in this
object. The audit result is preserved with the geometry confirmation in
`docs/data/VOLUME_2026_W26_GEOMETRY_SELECTION.json`.

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

Build and re-run the complete candidates/acceptance with:

```bash
just data-build-volumes-candidate 2026_W26 2026_W26-candidate-depth4 \
  2026-08-24T12:00:00Z 4 \
  9bfa0623a16bc7a989a6b27a589887641beee0a8 \
  52083adf44825d0622a503705e095699a5957587 d43fda3
just data-build-volumes-candidate 2026_W26 2026_W26-candidate-depth8 \
  2026-08-24T12:00:00Z 8 \
  9bfa0623a16bc7a989a6b27a589887641beee0a8 \
  52083adf44825d0622a503705e095699a5957587 d43fda3
uv run --project builder --extra test --locked python \
  benchmarks/rendering/summarize-volume-candidate.py \
  data/releases/ephys_atlas_volumes/2026_W26-candidate-depth4 \
  data/releases/ephys_atlas_volumes/2026_W26-candidate-depth8 \
  --output benchmarks/rendering/volume-candidate-2026_W26-graph.json
cd web
EPHYS_ATLAS_REAL_RELEASE=../data/releases/ephys_atlas_volumes/2026_W26-candidate-depth4 \
EPHYS_ATLAS_REAL_FEATURE=rms_lf npm run test:volume-candidate
EPHYS_ATLAS_VOLUME_CANDIDATES=../data/releases/ephys_atlas_volumes/2026_W26-candidate-depth4,../data/releases/ephys_atlas_volumes/2026_W26-candidate-depth8 \
EPHYS_ATLAS_VOLUME_CANDIDATE_BENCHMARK_OUTPUT=../benchmarks/rendering/real-volume-browser-2026_W26-candidate-profiles-results.json \
npx playwright test --config playwright.volume-benchmark.config.ts \
  candidate-profiles.spec.ts
```
