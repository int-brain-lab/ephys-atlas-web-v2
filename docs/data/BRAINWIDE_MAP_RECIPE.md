# Preserved Brain-Wide Map release recipe

Status: accepted scientific recipe and source authority.

D038 defines `brainwide_map` as a faithful schema-v1 preservation of the v1
website's five Beryl-only analysis families. It is a legacy website snapshot,
not a regeneration from a newer Brain-Wide Map paper pipeline.

## Pinned inputs

Generator: `int-brain-lab/ephys-atlas-web/generate.py` at commit
`1d908bea095be2616a750d939d143f3b4db2a641`.

| Family | Bytes | SHA-256 |
| --- | ---: | --- |
| `choice_bwm.pqt` | 19,742 | `179bd6714bbb3e22f98fc4311c07a9a367d6ad8bf7487469108862751a2c3421` |
| `feedback_bwm.pqt` | 20,053 | `262f48322b36f3655e76648aaa41db7a075387541a9403e52819523a56acf7f1` |
| `stimulus_bwm.pqt` | 18,892 | `6ecd376ec9a81bf179a04bd250793fc8f254cd3e77ba93c4c63ba861e07d8efa` |
| `wheel_speed_bwm.pqt` | 12,371 | `58b63dd36f7ce3e7615624d1e11e47906fae00eff717f08653f7e299f057a7ca` |
| `wheel_velocity_bwm.pqt` | 12,126 | `5da2ee7ae0added6996a433fd8c04796d8953bac15612cd89f46d8fb56688438` |

The generator's `beryl_regions.pqt` metadata input is 21,865 bytes with
SHA-256 `124dc20f137ebc4d47795e6ca53d0d8c7d71b03c0b2301851aa058ba854cfa50`.
It supplies region identity/labels and is not a sixth analysis family.

## Transformation contract

The builder:

1. accepts an explicit local source directory and verifies every declared byte
   size and SHA-256 before Parquet decode;
2. pins the local builder commit and rejects a nonexistent provenance commit;
3. reproduces legacy lateralization, arithmetic aggregation, six-significant-
   digit serialization, and boolean significance presentation;
4. emits the 30-feature Beryl-only schema-v1 release with explicit preserved-
   snapshot provenance;
5. applies only the reviewed distribution selection supplied as an explicit
   machine-readable build input.

Do not substitute paper selections, newer aggregate tables, or regenerated
analysis under the same release identity. A scientifically refreshed product
requires a new decision and immutable release.

## Build and evidence

Use the `data-build-brainwide-map` Just recipe with explicit source release,
output release, distribution selection, creation timestamp, builder commit, and
source directory. The deterministic exact-input comparison covers all 30
features and 210 Beryl regions. Production-style local HTTP acceptance covers
catalog discovery, Beryl reconciliation, significance values, provenance,
feature switching, and contextual CSV download.

The current validated-real-local release identity and next publication step are
recorded in [`../INTEGRATION_STATUS.md`](../INTEGRATION_STATUS.md).

On 2026-08-29 the six exact inputs were recovered locally, verified against the
table above, and used for the D054-reviewed release
`legacy-v1-1d908bea-d050-q14-linear-full-v1`. A second clean output was
byte-identical. The immutable manifest is 20,839 bytes with SHA-256
`2a6cf2c6146fa2d5670aa7b696450b930c20e9f86535e99a8f945aa022261e30`;
the complete release contains 154 files and 2,135,040 stored bytes. The prior
D050 release remains immutable.
