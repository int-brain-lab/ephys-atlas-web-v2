# Distribution audit evidence

Status: frozen evidence from the 2026-08-29 read-only Q14 source audits.

The four complete pinned source populations were audited without editing a
distribution selection, building a replacement release, or publishing remote
state. Full JSON reports, source-array handoffs, provenance sidecars, and
review tables remain in the ignored local `artifacts/distribution-audit/`
workspace. This record preserves their identities and high-level results in a
clean checkout; the reports remain candidate evidence rather than scientific
presentation authority.

## Evidence inventory

| Dataset | Population | Features | Source-array/report identity | Review table identity |
| --- | --- | ---: | --- | --- |
| Channels | 381,149 inside channels per feature from pinned W32 raw and denoised tables | 70 | NPZ `b8aec51109e45340909ee25446b84be8a199055ccfa17e3bf1e32742f77e5fff`; report `3d411601c1fed8f06d53649c2e7a438acb94a053dc966f0bb43520616af35f3a` | `f19cedfddb5644f0ac22967cc9c10e9b1ff48ef4dc1648a3b6d4ff065e9a8f34` |
| Clusters | all 925,251 rows from the pinned 14-column catalog; finite values independently per feature | 14 | NPZ `161dd9142619b0cf5d0e13fcd6da8396609aa31fdd2c9e6f77ec85ffd27c68ac`; report `fb475e95cf0991b3ffb599b405de0df362d275011d54393df9d18de458ae5bca` | `813ee8436afcac38423726a014a62eb2551197c9784ee0a7f7a2f1bca9e7f692` |
| Brain-Wide Map | all 6,084 rows across the five pinned Beryl-only tables after the exact legacy boolean and six-significant-digit presentation transform | 30 | NPZ `515ae3d07d1ef41cefc17f7b59b4e8a90fee237511f1c7db2b3edff70a289f8e`; report `14079fc5c8bfc2d158bc86f0c17edad246263cbb61d6e29c4a8c301b385b36a5` | `50d3d7a612dda2b021078991cc3daf5dc82950761325c6b6b1289963949fb80b` |
| Encoding volumes | 4,001,179 valid finite voxels per feature from the verified W26 last-axis NPZ; 5,629,541 outside and zero missing | 41 | source NPZ `1f7509fe9e368a90704173bdb5c385827b199a7d5fa4b0aaa8fec5aca5402253`; report `12e306a726b7037e781f60d8e4d18effd23a194ff2e3b4d3adfb20bfe09dfa8d` | `ca7ce890aa545bb79c2f68441cce06d280dd9acd3ea0b371c90426ed07565b54` |

The channels adapter used
`ephys_atlas_builder.channel_source.load_channel_scientific_inputs` with
`feature_mode="both"` and `population="inside"`. The cluster adapter copied
the 14 selected scalar columns directly with no row filter, transform,
clipping, aggregation, or replacement. The Brain-Wide Map adapter followed
[`BRAINWIDE_MAP_RECIPE.md`](BRAINWIDE_MAP_RECIPE.md). The volume adapter
verified the recorded 238,954,924-byte NPZ identity before loading feature
metadata and used the D043 `0.0` outside sentinel.

## Validation and descriptive findings

Every report reproduced byte-for-byte, covered the complete expected feature
catalog, and passed finite-plus-missing, sign-count, histogram-conservation,
and Focused-tail identities. The channel audit also reproduced D052's exact
`peak_val.raw` counts, range, 1–99% bounds, tails, and Full-bin diagnostic.

- Channels: 18 features are source-eligible for Log, 28 have mixed signs, and
  16 put at least 99% of observations in one Full linear bin.
- Clusters: 9 features are source-eligible for Log. The highest Full linear
  concentration occurs for `contamination`, `amp_max`, `amp_median`,
  `amp_min`, `noise_cutoff`, and `contamination_alt`.
- Brain-Wide Map: 11 significance features are source-eligible for Log; 8
  features have mixed signs; one candidate 1–99% interval is degenerate.
- Volumes: 13 features are source-eligible for Log, 10 have mixed signs, 18
  are wholly negative, and no feature puts even 50% of valid voxels in one
  Full linear bin.

Eligibility and concentration are descriptive. They do not select Log,
Signed log, Focused, a threshold, bounds, palette, or default.

## Stop condition

The four D050 release IDs named in [`DISTRIBUTION_AUDIT.md`](DISTRIBUTION_AUDIT.md)
were not present in this checkout's ignored local release workspace. The older
checked-in regional candidates predate the D050 `distribution` object and are
not substitutes; the W26 pre-D050 volume inventory was recorded only as local
historical availability evidence.

P4D now stops at owner review under Q14. Exact per-feature choices must be
approved before changing any machine-readable selection or immutable release.
