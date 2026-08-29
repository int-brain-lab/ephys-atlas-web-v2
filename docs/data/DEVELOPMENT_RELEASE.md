# Ephys channel development release

This records the first end-to-end build against a real immutable channel source.
It is reproducibility evidence and a browser-integration candidate, not the
paper snapshot or a production publication.

Status: frozen evidence; pulled and rebuilt as schema v1 on 2026-08-22. The ignored local release
at `data/releases/ephys_atlas_channels/2026_W32` validates and is the mandatory
ordinary development dataset. It remains a development release rather than a
paper snapshot or public publication.

## Resolved inputs

- dataset: `ephys_atlas_channels`
- project: `ea_active`
- requested alias: `latest`
- immutable source vintage: `2026_W32`
- canonical prefix:
  `s3://ibl-brain-wide-map-private/aggregates/atlas/features/ea_active/2026_W32/agg_full/`
- feature mode: `both` (raw and denoised variants)
- population: `inside`
- hemisphere: bilateral observations pooled onto left atlas ids
- additional QC/outlier replacement: none
- `ibleatools`: `9bfa0623a16bc7a989a6b27a589887641beee0a8`
- `iblatlas`: `52083adf44825d0622a503705e095699a5957587`
- builder: `3535f69cd7bca8032022ca8af5a4402ab23e0546`
- Python: 3.12

The pulled `source.json` contains byte sizes and SHA-256 hashes for all five
source parquet files and is copied into the release. The release manifest also
records the three code commits and the complete resolved feature catalog.

## Reproduction

```bash
uv sync --project builder --python 3.12 --extra scientific --locked

uv run --project builder --extra scientific --locked ephys-atlas-data pull \
  ephys_atlas_channels 2026_W32 --dest data/source

uv run --project builder --extra scientific --locked ephys-atlas-data \
  build-channels 2026_W32 \
  --feature-mode both \
  --population inside \
  --created-at 2026-08-22T15:00:00Z \
  --ibleatools-commit 9bfa0623a16bc7a989a6b27a589887641beee0a8 \
  --iblatlas-commit 52083adf44825d0622a503705e095699a5957587 \
  --builder-commit 3535f69cd7bca8032022ca8af5a4402ab23e0546
```

The second command writes and validates
`data/releases/ephys_atlas_channels/2026_W32`.

## Observed output

- 70 published feature variants (35 source features, each raw and denoised)
- Allen, Beryl, and Cosmos outputs with 591, 289, and 13 left-folded regions
- 210 regional display arrays
- 204 `float32` display arrays
- 6 `float64` display arrays: raw `alpha_mean` and `alpha_std` for the three
  parcellations, promoted because their preserved finite means exceed the
  `float32` range
- no non-finite values in any regional display array
- 918 files, approximately 19.2 MB
- schema-v1 validation passed
- the real-release Playwright suite passed against the HTTP loader: 591
  Allen, 289 Beryl, and 13 Cosmos rows; raw alpha `float64` decoding; 50-bin
  distribution; and real-region selection

The raw alpha ranges demonstrate why dtype promotion and robust browser display
ranges are necessary. They are intentionally not median-replaced, clipped, or
silently serialized as infinity. The full `float64` statistics and histograms
retain the declared source population.

## Browser acceptance

The real release remains ignored local data. Run its separate acceptance suite:

```bash
cd web
EPHYS_ATLAS_REAL_RELEASE=../data/releases/ephys_atlas_channels/2026_W32 \
  npm run test:real-release
```

The test intercepts the development catalog/release requests and serves bytes
from that directory through the production `HttpDatasetSource` path. It does
not bypass contract parsing or binary decoding, copy the release into Git, or
claim to test production-origin CORS/cache headers.

For interactive review of this channel release alone, run:

```bash
just dev-real release=2026_W32 feature=rms_ap.denoised
```

The ordinary `just dev` entry point serves the integrated local catalog,
including channels, clusters, Brain-Wide Map, volume, projections, and 3-D.

Vite validates the immutable manifest and requested feature before startup,
then exposes a development-only catalog and release bytes under one local
origin. The root URL opens that release with `rms_ap.denoised` selected, while
explicit share-URL parameters still take precedence. This exercises the normal
`HttpDatasetSource`; it does not copy the ignored real release into
`web/public`, transform it, or label it as the paper snapshot. There is no
synthetic runtime fallback: startup fails with the missing manifest path when
the real release has not been pulled and built.

## Why the checkout did not initially contain the data

The canonical source is roughly 466 MB in a private S3 prefix and the built
schema-v1 release is roughly 21 MB. Both `data/source/` and `data/releases/` are
intentionally ignored: source parquet and generated releases are reproducible
local artifacts, not Git payloads. The earlier build record described a local
schema-v0.1 output that had neither been committed nor published through a
catalog, while the browser still defaulted to its public golden fixture. Access
was not the problem; the immutable `2026_W32` source pull succeeded once it was
requested explicitly.

## Remaining step

The release is local and ignored by Git. It still needs an authorized immutable
object-store or publishing target plus a non-production catalog entry. Repeat
the same acceptance checks against that origin to cover its CORS and cache
policy. Q2 remains the only blocker to labeling a channel release as the paper
snapshot.
