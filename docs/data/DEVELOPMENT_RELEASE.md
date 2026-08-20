# Ephys channel development release

This records the first end-to-end build against a real immutable channel source.
It is reproducibility evidence and a browser-integration candidate, not the
paper snapshot or a production publication.

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
- builder: `d954d0e142057afefcba0289f28df19e65669679`
- Python: 3.12

The pulled `source.json` contains byte sizes and SHA-256 hashes for all five
source parquet files and is copied into the release. The release manifest also
records the three code commits and the complete resolved feature catalog.

## Reproduction

```bash
uv sync --project builder --python 3.12 --extra scientific --locked

uv run --project builder --extra scientific --locked ephys-atlas-data pull \
  ephys_atlas_channels latest --dest data/source

uv run --project builder --extra scientific --locked ephys-atlas-data \
  build-channels 2026_W32 \
  --feature-mode both \
  --population inside \
  --created-at 2026-08-20T11:24:51Z \
  --ibleatools-commit 9bfa0623a16bc7a989a6b27a589887641beee0a8 \
  --iblatlas-commit 52083adf44825d0622a503705e095699a5957587 \
  --builder-commit d954d0e142057afefcba0289f28df19e65669679
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
- schema-v0.1 validation passed
- a second build in an independent output root was byte-identical (`diff -qr`)

The raw alpha ranges demonstrate why dtype promotion and robust browser display
ranges are necessary. They are intentionally not median-replaced, clipped, or
silently serialized as infinity. The full `float64` statistics and histograms
retain the declared source population.

## Remaining step

The release is local and ignored by Git. It still needs an authorized immutable
object-store or publishing target plus a non-production catalog entry before
the browser can run its real-value acceptance suite. Q2 remains the only blocker
to labeling a channel release as the paper snapshot.
