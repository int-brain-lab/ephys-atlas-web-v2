# W39 channels, volumes, edges, MERFISH and lipids deployment

Status: complete on 2026-10-07.

The D088/D089/D090 deployment is live at <https://ephys-atlas.iblcore.org>. It
publishes the `ea_active` `2026_W39` channels, encoding volumes and edges, the
denoised MERFISH cell classes and the Lipid Brain Atlas as new immutable
releases, promotes one catalog change, and redeploys the site with the W39
default view. Every earlier release and `ephys-atlas` edition remains in the
catalog.

## Published identities

| Artifact | Identity | Manifest SHA-256 / transaction |
| --- | --- | --- |
| Channels | `2026_W39-ibl-review-20261007-v1` | `6adc9fa963196d6db829125c5ac869c49bec7622ec7397e8503965f79476a2b8`; transaction `21874d2ae9c6dca50d5dcdeda9d75985b415c8cc242ada01d6ef5c4d568b99cd` |
| Volumes | `2026_W39-ibl-review-20261007-v1` | `99bcd4075943b86f62e5f0a5be5fbbc1ec439a4a797f9ed705e7b0a37a7e4c71`; transaction `a48e38b53179dc399f538686689dde290febb6e06b558dbf32ef3238b5d292db` |
| Edges | `2026_W39-edges-ibl-review-20261007-v1` | `b42e72d6180345b231a71ef4bcd5efafd0ece42ff84decdbe479e0dd33533d9f`; transaction `a344b02d1e5ad2bfa707a76d5afceb8b339190c0c93c50531c149c7997dfb38a` |
| MERFISH classes | `class-processed-all-3b4a73f-ibl-review-20261007-v1` | `5564ad8dcfc6731f1638e28eefbcd80d310f6c1da12ba9c9364edec6b564816c`; transaction `9db2dab99d679808893b710766225f4a222bfd2a02ec6af46eda084b0610d116` |
| Lipids | `lba-2025-3b4a73f-ibl-review-20261007-v1` | `3d2b836b6046f80ee3fe159dbbc657d67c77dd0dc35f417b7825e45d54d7c331`; transaction `b0d679c6b22d731511d9563c48a8ee5bafc7da0e3d963f122445c70071c51ed3` |
| Catalog | `142f16ccf087412aa1ff0532a4b93997` | `435e77daae52affa9949f7592745ed3fa039317f30b3e5b4363b182cfe2b5f93` (7,350 bytes) |
| Site | `d919c86f10689aede2585112bc7633a8` | CI run 37676943670, commit `f623d27` |

## Sources and builds

| Release | Source | Vintage |
| --- | --- | --- |
| Channels | `aggregates/atlas/features/ea_active/2026_W39/agg_full/` (five files hash-checked against `source.json`) | W39, denoised-only, 51 features |
| Volumes | `aggregates/atlas/encoding_volumes/ea_active/2026_W39/brainwide_ephys_atlas_50um.npz` (`51c2c831…`) | W39, 43 features |
| Edges | `aggregates/atlas/encoding_volumes/ea_active/2026_W39/brainwide_ephys_edges_50um.npz` (`5fb4aac3…`), uploaded create-only on 2026-10-07 from the owner-derived local file | W39, 1 feature |
| MERFISH | `s3://ibl-brain-wide-map-public/atlas/merfish/`, loader `label='processed'`, all 34 classes | iblatlas `main` `3b4a73f` |
| Lipids | `s3://ibl-brain-wide-map-public/atlas/lipids/`, 173 lipids, no reliability filter | iblatlas `main` `3b4a73f` |

Channels, volumes and edges were built at commit
`7935facba1445000d036a95196d173b61bcacc37` on macOS arm64 (D088 withdraws
D062's Linux-only rule); MERFISH and lipids at `2e2c00d` with
`tools/genomics_volumes.py`. All five passed
`just production-release-preflight` and were published with
`tools.s3_publish --apply --transport sdk`. Staged MERFISH and lipid volumes were
reproduced bit-for-bit from a clean export of iblatlas `main`. The selections
are [D089](../DECISIONS.md#d089--w39-channel-volume-and-edges-release-selections)
and [D090](../DECISIONS.md#d090--merfish-class-and-lipid-volume-releases).

## Catalog

The promoted catalog has three projects: **Ephys Atlas** (default edition
`ibl-review-20261007-v4`: channels, frozen clusters, volumes and edges, all
W39 apart from the clusters), **Genomics** (processed AGEA and MERFISH) and
**Lipidome**. By owner decision the redundant Brain-Wide Map project and the
old Anatomy project were removed from the catalog; their release bytes remain on
S3 and the production history accepted the change. The first promotion attempt
stopped before any write because the smoke test pinned the old default feature
(`rms_ap.denoised`) against the W39 channels release; the script now falls back
to the release's first feature.

## Consequences

- W39 channels are denoised-only, so feature IDs have no `.denoised` suffix
  (`rms_ap`). Deep links that use `rms_ap.denoised` on the W39 release no longer
  resolve; the W32 release keeps its IDs.
- Six W32 waveform features absent from W39 (`peak_time_secs`, `peak_val`,
  `recovery_time_secs`, `tip_time_secs`, `trough_time_secs`, `trough_val`) are
  not published.
- Edges are an owner-derived volume, not an upstream canonical product.
- W26 interpretable volumes and eigenmodes were excluded from this release.

## Production checks

`node web/scripts/verify-production-site.mjs https://ephys-atlas.iblcore.org`
passed against the live site for channels, clusters, volumes, edges, AGEA,
MERFISH and lipids, plus landing, geometry, navigation, quantile, URL and 3-D
checks. `just site-compatibility` passes offline and against the origin. This is
automated Chromium evidence only; Firefox and native Safari were not rerun. On
this Mac four browser specs (Control-click multi-selection and one analytics
event name) fail identically on pristine `origin/main`; Linux CI passed.
