# Cluster source audit for catalog review

## Snapshot

The D038-approved `ibl_neuropixel_brainwide_01` project was pulled on
2026-08-23 into content-addressed snapshot `sha256-9b5e55215b306f26`.

- population audited: all 925,251 rows of `clusters.table.pqt`
- table bytes: 218,957,376
- table SHA-256: `07aa69542d59e7dc0d1f4e32dbf7941fcd7ddb5c47c216286ebb5005ee038df4`
- snapshot-manifest SHA-256: `0127c71c6d796859719c7bab1e1c2e5a1be60266206d32833a2260946040e000`
- raw audit: `docs/data/audits/ephys_atlas_clusters-sha256-9b5e55215b306f26.json`

The content-derived snapshot covers all eight downloaded project objects, not
only the table. Large ACG, waveform, STPC, and STLFP arrays are checksummed
source objects but are not candidate launch regional features.

## Candidate catalog evidence

All 14 D038 candidates are present as Parquet `double` columns. The pinned
`ModelClusters` schema exposes no unit or description metadata for any of them,
so units remain null. No candidate contains positive or negative infinity.

| feature | finite | missing | min | median | max | q05–q95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `amp_max` | 925,251 | 0 | 2.486e-6 | 1.532e-4 | 0.7449 | 4.463e-5–4.896e-4 |
| `amp_min` | 925,251 | 0 | 1.863e-6 | 4.739e-5 | 0.1446 | 1.470e-5–1.369e-4 |
| `amp_median` | 925,251 | 0 | 2.486e-6 | 6.505e-5 | 0.2059 | 1.784e-5–2.224e-4 |
| `amp_std_dB` | 924,821 | 430 | 0.002973 | 1.425 | 10.73 | 0.8446–2.246 |
| `contamination` | 925,251 | 0 | 0 | 0.2145 | 428,068 | 0–7.986 |
| `contamination_alt` | 925,251 | 0 | 0 | 0.1717 | 396.2 | 0–2.228 |
| `drift` | 900,951 | 24,300 | 0 | 297,030 | 53,464,532 | 2,657–2,183,444 |
| `missed_spikes_est` | 834,847 | 90,404 | 2.420e-7 | 0.5 | 0.5 | 0.0006094–0.5 |
| `noise_cutoff` | 919,667 | 5,584 | -3.536 | 40.77 | 267,990 | -0.7052–592.3 |
| `presence_ratio` | 925,251 | 0 | 0.001166 | 0.9939 | 1 | 0.2132–1 |
| `presence_ratio_std` | 925,251 | 0 | 0.03412 | 21.76 | 2,795.5 | 0.9841–125.5 |
| `slidingRP_viol` | 925,251 | 0 | 0 | 0 | 1 | 0–1 |
| `spike_count` | 925,251 | 0 | 1 | 21,714 | 1,680,677 | 249–106,440.5 |
| `firing_rate` | 925,251 | 0 | 0.0001167 | 4.547 | 351.0 | 0.05406–22.55 |

The raw audit also records means, population standard deviations, q01/q25/q75/
q99, zero/negative counts, and deterministic 20-bin full-range histograms.

## Human review resolution

The repository/scientific owner approved all four review points on 2026-08-24:

1. retain all 14 columns declared by the original Ephys Atlas repository;
2. use that repository's explicit cluster-unit mapping and descriptions grounded
   in the pinned upstream implementations;
3. preserve every source value and replace legacy fixed plot limits with robust
   automatic bounds plus conservative presentation-only log defaults;
4. accept the observed negative, heavy-tailed, capped, and binary encodings as
   the source product to publish, while describing them transparently.

D044 records the catalog decision. The historical
`CLUSTERS_CATALOG_SELECTION.json` reproduces the first two candidates; D047's
`CLUSTERS_CATALOG_SELECTION_VALUE_SCALE.json` preserves the same exact legacy
sources, table, catalog, units, and descriptions while separately recording Log
histogram capability and the reviewed Linear Firing-rate preference. Q6 is
resolved.

## Reproduction

```bash
just data-pull-clusters latest

uv run --project builder --extra scientific --locked \
  ephys-atlas-data audit-clusters sha256-9b5e55215b306f26 \
  --project ibl_neuropixel_brainwide_01 \
  --feature amp_max --feature amp_min --feature amp_median \
  --feature amp_std_dB --feature contamination \
  --feature contamination_alt --feature drift \
  --feature missed_spikes_est --feature noise_cutoff \
  --feature presence_ratio --feature presence_ratio_std \
  --feature slidingRP_viol --feature spike_count --feature firing_rate \
  --histogram-bins 20 \
  --output docs/data/audits/ephys_atlas_clusters-sha256-9b5e55215b306f26.json
```
