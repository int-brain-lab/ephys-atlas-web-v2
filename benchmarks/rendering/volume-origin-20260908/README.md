# W26 depth-4 production-origin benchmark

This directory freezes the executable Chromium harness and compact evidence used by D075 to select `orthogonal_slice_packs` at depth 4 for the W26 volume release. The run exercised the deployed application at `https://ephys-atlas.iblcore.org/app/` against the direct, noncatalogued CloudFront candidate built at commit `62199f51d81a7833480c64559930cdec9993f702`.

The harness intercepts only the page's same-origin `/catalog.json` request with an in-memory catalog entry. It fetches the manifest, feature documents, resource indices, summaries, and packs unchanged from the live CloudFront benchmark namespace. It derives release identity, manifest bytes and SHA-256, feature inventory, and pack resources from `Q5_LOCAL`.

Run the smoke, matrix, and correctness cases separately so a failed test cannot overwrite evidence from another worker:

```bash
unset Q5_RESUME
export Q5_ORIGIN='https://ephys-atlas.iblcore.org'
export Q5_LOCAL='/absolute/path/to/ephys_atlas_volumes/2026_W26-candidate-depth4-20260908-v1'
export Q5_MODE=smoke
export Q5_OUTPUT="$PWD/artifacts/q5-smoke.json"
web/node_modules/.bin/playwright test \
  --config benchmarks/rendering/volume-origin-20260908/playwright.config.ts \
  --grep 'smoke:'

export Q5_MODE=full
export Q5_OUTPUT="$PWD/artifacts/q5-slider-matrix.json"
web/node_modules/.bin/playwright test \
  --config benchmarks/rendering/volume-origin-20260908/playwright.config.ts \
  --grep 'six worst features'

export Q5_OUTPUT="$PWD/artifacts/q5-slider-correctness.json"
web/node_modules/.bin/playwright test \
  --config benchmarks/rendering/volume-origin-20260908/playwright.config.ts \
  --grep 'all features'
```

The accepted matrix contains 180 fresh-context trials: six worst linked-Bregma features, ten trials, and three delivery profiles. Every trial made exactly three initial pack requests, made zero requests for the cached in-pack slider revisit, stayed at or below 225,000 declared transfer bytes, and used 2,222,592 decoded Float32 bytes for the three center packs. The worst warm-slider p95 was 90.6 ms against the predeclared 100 ms gate. The largest matrix observation was 23.1 MB used JS heap; the separate 41-feature sweep ended at 53.5 MB used JS heap and passed its zero-request in-pack and exactly-one-request boundary checks. Process RSS is diagnostic and is not a browser cache budget.

[`results-summary.json`](results-summary.json) retains all per-trial timings and counters, profile aggregates, raw ignored-evidence hashes, and the two diagnostic histories. The original first-edge run observed three required packs plus two speculative adjacent prefetches and failed the strict request-count gate. Commit `db87240` removed automatic retained-viewport volume prefetch. A separate URL-history restoration diagnostic exceeded the slider budget because `popstate` intentionally reloads the dataset session; it is preserved and is not presented as slice-slider latency.
