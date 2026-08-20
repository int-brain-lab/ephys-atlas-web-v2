# Ephys atlas channel release recipe

`ephys_atlas_channels` now has an approved schema-v0.1 regional build path in
`builder/ephys_atlas_builder/channels.py`.

## Canonical source

The source snapshot is pulled from the current `ea_active` channel-feature
catalog and remains immutable once resolved to a weekly vintage. The builder
consumes the checksummed `source.json` produced by `ephys-atlas-data pull` and
records both the canonical S3 URI and the source-manifest checksum in release
provenance.

## Scientific choices are explicit

The private paper example says that `load_denoised=False` should be used for raw
features, but the example call omits that argument. Current `ibleatools`
`read_features_from_disk()` defaults to `load_denoised=True`. Therefore v2 does
not inherit that default implicitly.

A production build must specify:

- source vintage (or a locally pulled `latest` alias, which is immediately
  resolved to an immutable vintage);
- `--feature-mode raw|denoised`;
- `--population all|inside`;
- an explicit ISO-8601 `--created-at` value;
- whether this is a paper snapshot.

If no `--feature` arguments are supplied, the build resolves the current
`ephysatlas.features.voltage_features_set()` at build time and records the
resolved feature list in the recipe. This keeps the website catalog-driven while
allowing the upstream feature set to change before submission.

## Regional representation

For Allen, Beryl and Cosmos the builder writes a dataset-level dense region-id
index plus region metadata. Each feature then writes, per parcellation:

- regional arithmetic mean (`float32`);
- the full descriptive-statistics matrix (`float64`);
- a global histogram and per-region histogram counts (`uint32`);
- schema-v0.1 metadata linking those files.

Non-finite feature observations are retained as missing observations and are
excluded from finite summaries/histograms. There is no hidden QC filter beyond
the explicitly selected population. `inside` means rows where the upstream
`outside` column is false; `all` preserves the selected table population.

Histogram edges span the finite global minimum to maximum with a deterministic
fixed bin count. Display ranges remain a browser concern and can use the stored
quantiles without clipping the underlying histogram population.

## Example

```bash
ephys-atlas-data pull ephys_atlas_channels 2026_W12

ephys-atlas-data build-channels 2026_W12 \
  --feature-mode denoised \
  --population inside \
  --created-at 2026-08-20T00:00:00Z
```

The resulting release is written under
`data/releases/ephys_atlas_channels/<vintage>/` and validated immediately by the
CLI.

## Remaining scientific sign-off

Before the paper release, IBL still needs to choose the intended production
combination of raw versus denoised input and population/QC policy. The builder is
ready for either choice and records it in provenance; changing that policy does
not require a schema or frontend change.
