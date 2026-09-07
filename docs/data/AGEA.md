# AGEA source audit and browser transport

Status: active evidence and continuation reference for D067.

Artifact maturity: registration-provisional local preview under D069.
The [main-website integration](AGEA_LOCAL_PREVIEW.md) now includes the full
catalog, shared schema-v1 metadata bundle, bounded searchable feature picker,
original expression with linked anatomy, and bounded persistent caching.
The local [coverage lab](AGEA_COVERAGE_LAB.md) remains available for source
investigation. No approved public AGEA scientific release has been published.
The measurements below are not production-origin acceptance.

The [stripe review report](AGEA_STRIPE_REPORT.md) now provides full-catalog
exploratory screening, six direct Allen archive checks and Ptpru section-gap
projection evidence. It informs scientist review without resolving Q19.

## Scope and source identity

D067 selects full-catalog discovery with one selected experiment displayed in
the existing three linked slices. The region panel stays anatomical. Distinct
experiments sharing a gene symbol remain individually addressable; regional
aggregation and seed-correlation exploration are deferred.

The public IBL source prefix is
`https://ibl-brain-wide-map-public.s3.amazonaws.com/atlas/agea/`.
The read-only listing on 2026-09-06 contains the `2025-03-18.version` marker;
the original binary/table were last modified 2024-01-21, and the processed
binary 2025-03-18. This is a mutable source prefix, so the marker alone is not
immutable identity. Exact original binary, gene table, label and image hashes
are pinned in the [audit tool](../../tools/agea_benchmark.py) and recorded in
[source evidence](AGEA_SOURCE_AUDIT.json).

The source has 4,345 unique experiment IDs and 4,082 distinct gene symbols.
Its array is `(experiment, ML, DV, AP) = (4345, 58, 41, 67)`, little-endian
float16, with 200 µm spacing. One volume is 318,652 raw bytes. The whole source
binary is 1,384,542,940 bytes. The gene table has only `id` and `gene`: full gene
names, aliases, experiment descriptions and probe annotations are not in the
measured catalog.

The repository's pinned iblatlas commit is
`52083adf44825d0622a503705e095699a5957587`. Its
[acquisition script](https://github.com/int-brain-lab/iblatlas/blob/52083adf44825d0622a503705e095699a5957587/iblatlas/genomics/gene_expression_scrapping/02-scrape-experiments.py)
downloads Allen grid archives and converts their volumes to float16. Allen's
[grid documentation](https://brain-map.org/support/tutorials/downloading-3-d-expression-grid-data)
identifies the default as expression energy and `-1` as no measurement.
The current Allen download for experiment `74658173` was inspected: its
`energy.raw` float32 values, converted to float16, match the first IBL volume
exactly. This is one independent spot check, not an audit of 4,345 Allen ZIPs.
Its archive hash and complete MetaImage header are retained in source evidence.

The [processing script](https://github.com/int-brain-lab/iblatlas/blob/52083adf44825d0622a503705e095699a5957587/iblatlas/genomics/gene_expression_scrapping/06-denoise-impute.py)
documents PPCA, bilateral averaging and curtaining correction; its upload
comment identifies `ppca_dual_curtain.bin` as the processed product. The processed
binary has not been acquired or audited here. Q19 must select and hash it if
that variant is wanted. Do not recreate denoising during web packaging.

## Geometry and validity evidence

Calling the pinned loader on the downloaded atlas files produces this matrix
from raw `[ML-index, DV-index, AP-index, 1]` to `[ML, AP, DV, 1]` in µm:

```text
[200,    0,    0, -5739]
[  0,    0, -200,  5400]
[  0, -200,    0,   332]
[  0,    0,    0,     1]
```

This is derived source evidence, not an invented affine or approved release
registration. The [atlas construction script](https://github.com/int-brain-lab/iblatlas/blob/52083adf44825d0622a503705e095699a5957587/iblatlas/genomics/gene_expression_scrapping/05-generate-atlas-templates.py)
documents sampling an Allen atlas into this coarse grid. Acceptance against the
native 10 µm anatomy and the exact release `reference_space_id` remains Q19.
The browser transport benchmark uses voxel indices without an anatomical
overlay or world cursor; it cannot establish registration.

The supplied label volume has 62,959 nonzero voxels out of 159,326. Counts below
are observations summed over every experiment, not unique spatial positions:

| Source category | Nonzero label | Zero label |
| --- | ---: | ---: |
| Missing sentinel `-1` | 22,997,008 | 255,444,791 |
| Measured zero | 336,595 | 35,444,130 |
| Positive | 250,223,252 | 127,825,694 |
| Other negative / nonfinite | 0 | 0 |

Thus neither zero expression nor `-1` is an anatomical outside mask. Many
measurements exist at zero-labelled positions. The choice of mask, precedence
and statistics population must be explicit under Q19. The sizing candidate
includes all finite nonnegative source values without an anatomical mask; it
does not make that policy the product default.

## Physical layout evidence

The reproducible candidate has one gzip-6 JSON bundle with shared provenance
and geometry placeholders, all experiment identities, volume paths and exact
compressed-byte sizes/SHA-256, nine summary statistics, and one 64-bin
Linear/Full histogram per nonempty experiment. It is deliberately labelled a
transport benchmark, not a parallel scientific release schema.

| Artifact | Bytes |
| --- | ---: |
| Metadata JSON before compression | 7,379,204 |
| Metadata gzip-6 | 2,177,235 |
| All 4,345 independently gzip-6 compressed volumes | 757,983,590 |
| Median compressed experiment | 176,096 |
| P95 compressed experiment | 189,756 |
| Largest compressed experiment | 239,314 |
| Decoded float32 active experiment | 637,304 |

The earlier ad hoc sizing bundle was 2,177,122 bytes compressed; this candidate
adds source audit fields. Neither is an exact final schema-v1 bundle size.
Extra gene annotations, scales, histograms, masks or download artifacts can
change it. Preserve the native grid; no upsampling is necessary for transport.

## Browser experiment

[Browser evidence](AGEA_BROWSER_BENCHMARK.json) contains individual timings,
browser/host versions, byte counts and the tested metadata hash. The runner uses
the existing `ResourceFetcher`, gzip decoder, `SchemaChunks3dVolumeSource`,
`VolumeSliceLoader` and Canvas renderer. It does not use a new production reader.

Each Chromium/Firefox profile performs five cold metadata loads and local
searches with at most 30 visible candidate rows. It tests the first, median,
P95 and largest compressed experiments, five trials each. Every trial checks
three plane hashes against independent Python extraction, one cold volume
request, zero additional requests for boundary navigation and zero network
requests when reopening the experiment from persistent cache. Metadata cache
reuse and deliberate cached-byte corruption/recovery are also asserted.

The local profile uses Playwright route delivery. The constrained profile adds
80 ms plus encoded bytes / 10 Mbit/s to each response. This is a transfer-delay
model, not a real CDN, bandwidth-sharing model or low-end CPU simulation.
No compressed HTTP `Content-Encoding` is applied: integrity covers encoded
resource bytes before explicit browser decompression.

Measured on Linux x86-64 with Chromium 151 and Firefox 153 (exact user agents
in the JSON); milliseconds, with five metadata trials and twenty volume trials
per row. Volume percentiles pool the four selected size samples. P95 below uses
linear interpolation over the sorted observed samples.

| Browser / delivery | Metadata ready p50 | JSON parse p50 | Cold volume p50 / p95 | Cached reopen p50 | In-memory navigation p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chromium / local | 67.3 | 10.9 | 19.6 / 28.1 | 13.6 | 0.3 |
| Firefox / local | 99.0 | 22.0 | 40.0 / 57.0 | 18.0 | 1.0 |
| Chromium / 10 Mbit/s + 80 ms | 1,895.8 | 10.8 | 259.6 / 315.6 | 11.9 | 0.2 |
| Firefox / 10 Mbit/s + 80 ms | 1,938.0 | 23.0 | 285.0 / 334.2 | 20.0 | 1.1 |

Metadata ready includes fetching, integrity, persistent admission, decompression,
text decoding, JSON parsing and construction of the local search index. Cold
volume timings include fetching through extraction of all three planes; Canvas
paint is recorded separately. Cached reopen includes re-verification and decode.

The 637,304-byte figure is the retained active volume array, not total browser
memory. Metadata objects, temporary decode allocations, browser caches and
Canvas buffers are additional. `navigator.storage.estimate()` is retained as
diagnostic context only; neither browser RSS nor peak heap is established.
The test search strategy is not a production accessible virtualized picker.
No timing thresholds are asserted from this single workstation.

## Reproduction

Run from the repository root with the committed environments installed. The
source download is read-only and requires roughly 1.4 GB; candidate volumes
add roughly 0.76 GB. All generated data stays under ignored `artifacts/`.

```bash
mkdir -p artifacts/agea-metadata-sizing
for name in gene-expression.bin gene-expression.pqt label.npy image.npy; do
  curl --fail --location "https://ibl-brain-wide-map-public.s3.amazonaws.com/atlas/agea/$name" \
    --output "artifacts/agea-metadata-sizing/$name"
done
curl --fail --location https://api.brain-map.org/grid_data/download/74658173 \
  --output artifacts/agea-metadata-sizing/allen-74658173.zip
uv run --project builder --extra test --locked python -m tools.agea_benchmark \
  --source artifacts/agea-metadata-sizing --output artifacts/agea-browser-benchmark
AGEA_BENCHMARK_DIR=artifacts/agea-browser-benchmark npx --prefix web playwright test \
  --config web/playwright.agea-benchmark.config.ts
```

The audit fails before decode if any pinned IBL input differs. Optional Allen
ZIP evidence is a current-download spot check with its own recorded hash. The
source tool creates all experiment binaries; the browser serves only declared
benchmark samples on a test-only route. Ordinary tests require no AGEA download.

## Next implementation slice

The D069 local integration implements the metadata acceleration, bounded picker,
source-preserving preview builder and cache-capacity machinery above. Exact
current scope, commands and measurements are in [the preview runbook](AGEA_LOCAL_PREVIEW.md).

Next: owner review of the integrated original-expression view; resolve remaining
Q19 public-release registration/identity/display choices; measure peak memory
and constrained/final-origin delivery. The full-catalog ZIP currently exceeds
the existing 20,000-entry local-import limit; do not advertise that archive as
supported or weaken the limit without a separate measured packaging task.

The measured bundle and experiment sizes support the chosen one-bundle,
one-volume-per-experiment direction. They do not yet establish production
application latency or justify adding metadata shards.
