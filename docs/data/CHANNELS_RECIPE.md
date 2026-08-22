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

The release policy is to publish raw and denoised channel values as explicit
feature variants. `--feature-mode both` writes ids such as `rms_ap.raw` and
`rms_ap.denoised`; single-mode builds remain available for development and
backward compatibility. The source parquet, rather than an upstream loader
default, determines each variant.

A production build must specify:

- source vintage (or a locally pulled `latest` alias, which is immediately
  resolved to an immutable vintage);
- `--feature-mode raw|denoised|both` (use `both` for publication);
- `--population all|inside`;
- an explicit ISO-8601 `--created-at` value;
- whether this is a paper snapshot.
- exact `ibleatools`, `iblatlas`, and builder Git commits.

If no `--feature` arguments are supplied, the build resolves the current
`ephysatlas.features.voltage_features_set()` at build time and records the
resolved feature list in the recipe. This keeps the website catalog-driven while
allowing the upstream feature set to change before submission.

## Feature descriptions and units

Feature descriptions are scientific release metadata, not frontend copy. For
each source column the builder reads the Pandera column returned by
`ephysatlas.features.ModelRawFeatures.to_schema()`, copies its `description`,
and selects `transformed_unit`, `raw_unit`, then `unit` in that order. The raw
or denoised source variant is appended to the feature label and recorded in
provenance; it is not repeated in the scientific description. The resulting
values are stored in each immutable `features/<feature-id>/feature.json`;
browser search and presentation consume that release metadata without a fixed
feature dictionary.

The pinned `2026_W32` development release audit found complete upstream
descriptions for 25 of its 35 source features. These ten waveform columns fall
back to the explicit but non-scientific `Channel feature <column>` placeholder
because the pinned upstream schema provides neither a description nor a unit:

- `depolarisation_slope`
- `peak_time_secs`
- `peak_val`
- `recovery_slope`
- `recovery_time_secs`
- `repolarisation_slope`
- `tip_time_secs`
- `tip_val`
- `trough_time_secs`
- `trough_val`

Do not infer definitions or units from their names. Prefer adding reviewed
metadata to the authoritative `ibleatools` schema and rebuilding the immutable
release. If that is not possible, any local metadata overlay must be a pinned,
reviewed scientific input recorded in release provenance rather than a browser
mapping. `alpha_mean`, `alpha_std`, and `channel_labels` also have null units,
but they do have upstream descriptions and are not using the placeholder.

## Regional representation

The website deliberately presents a single left hemisphere, matching the
existing atlas. Before grouping, every finite atlas id is validated as an
integer in the int32 domain and folded with `-abs(id)`. This pools observations
from both recorded hemispheres into the corresponding left-side region; it does
not mean that only left-side observations were selected.

For Allen, Beryl and Cosmos the builder writes this left-folded dataset-level
dense region-id index plus region metadata. Each feature then writes, per
parcellation:

- regional arithmetic mean (`float32` when representable, promoted to `float64`
  rather than clipped or overflowed when the source range requires it);
- the full descriptive-statistics matrix (`float64`);
- a global histogram and per-region histogram counts (`uint32`);
- schema-v0.1 metadata linking those files.

Non-finite feature observations are retained as missing observations and are
excluded from finite summaries/histograms. There is no hidden QC filter beyond
the explicitly selected population. In particular, the builder bypasses
`read_features_from_disk()` because that function unconditionally replaces
large `alpha_mean`/`alpha_std` values with a median. V2 loads, merges, and maps
the parquet tables, verifies the requested upstream feature catalog, and
converts each published scalar independently without replacing or clipping
source values. Whole-table non-null validation is deliberately not used because
the canonical snapshot has legitimate feature-specific missing values. `inside`
means rows where the upstream `outside` column is false; `all` preserves the
selected table population.

Histogram edges span the finite global minimum to maximum with a deterministic
fixed bin count. Display ranges remain a browser concern and can use the stored
quantiles without clipping the underlying histogram population.

## Example

```bash
uv sync --project builder --python 3.12 --extra scientific --locked

uv run --project builder --extra scientific --locked ephys-atlas-data pull \
  ephys_atlas_channels 2026_W12

uv run --project builder --extra scientific --locked ephys-atlas-data \
  build-channels 2026_W12 \
  --feature-mode both \
  --population inside \
  --created-at 2026-08-20T00:00:00Z \
  --ibleatools-commit <commit> \
  --iblatlas-commit <commit> \
  --builder-commit <commit>
```

The resulting release is written under
`data/releases/ephys_atlas_channels/<vintage>/` and validated immediately by the
CLI.

The committed `builder/uv.lock` resolves the pinned `scientific` extra. Editable
sibling checkouts may be used for development only after verifying they are at
the same commits recorded in the release.

For publication, use both raw and denoised variants, the explicitly selected
population, preserved source values, and pinned code commits. These choices are
written into the manifest and each feature's value semantics.
