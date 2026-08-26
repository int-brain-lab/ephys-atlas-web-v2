# Ephys Atlas cluster release

## Status

The D044/D047-approved `ephys_atlas_clusters` candidate was built on Fractal
from the content-addressed `ibl_neuropixel_brainwide_01` snapshot and validated
locally and on Fractal on 2026-08-26. It is real scientific data, not a
synthetic fixture. The generated directory remains ignored and has not been
published or added to a public catalog. Automated acceptance is complete;
the owner selected Linear as the preferred Firing-rate presentation, and a
final synchronized-UI confirmation remains pending.

## Immutable identity

- release ID: `sha256-9b5e55215b306f26-value-scale-v1`
- source snapshot ID: `sha256-9b5e55215b306f26`
- source rows: 925,251 all-cluster observations
- features: 14
- parcellations: Allen, Beryl, Cosmos
- files: 209
- total served-file bytes: 5,105,824
- manifest SHA-256:
  `6c03d5f02e1baba81faf288133f7cff41dfca2cc8f0bfb69341a3bb30bc9b05f`
- deterministic graph SHA-256:
  `b5ebcae1b59798f3902df481f560fe98a6d351221a7522d3c2b5038cda0da1cd`
- catalog-selection SHA-256:
  `edcede48ec860d5ab8509b6f43c1d09d8ea7ce37b6a1f8daddf359125f2a5d68`

The graph digest is the SHA-256 of the sorted release-relative `sha256sum`
records for every file. A second build in a fresh temporary directory produced
the same digest byte-for-byte.

The earlier 191-file candidate `sha256-9b5e55215b306f26` and 209-file candidate
`sha256-9b5e55215b306f26-hist-axis-v1` remain immutable evidence. Their manifest
SHA-256 values are respectively
`2407053b18a78b5f28ea559a901fd3313d510d6f72e867e5a369be72f12fe054`
and `9db5cbd5763053f06915e8b97a516327490f4fdc5c417687b441fb852bba6b20`.
No prior bytes were altered or deleted.

## Reproduction

```bash
uv run --project builder --extra scientific --locked \
  ephys-atlas-data build-clusters sha256-9b5e55215b306f26 \
  --release-id sha256-9b5e55215b306f26-value-scale-v1 \
  --project ibl_neuropixel_brainwide_01 \
  --population all \
  --catalog-selection docs/data/CLUSTERS_CATALOG_SELECTION_VALUE_SCALE.json \
  --created-at 2026-08-26T00:00:00Z \
  --ibleatools-commit fffe0c75810dd1a013a878abcbcf8ef6348a5a21 \
  --iblatlas-commit 52083adf44825d0622a503705e095699a5957587 \
  --builder-commit 2e9fbaa4b903f50b360b596706efb23b7171e8f2 \
  --source-root data/source \
  --release-root data/releases
```

The builder verifies the approved table's 218,957,376-byte size and SHA-256
`07aa69542d59e7dc0d1f4e32dbf7941fcd7ddb5c47c216286ebb5005ee038df4`
before Parquet decoding. It rejects changes to the project, source snapshot,
table identity, complete feature catalog, or display policy.

## Browser acceptance

The opt-in production HTTP reader suite is:

```bash
just test-cluster-release
```

Chromium acceptance passed for:

- dynamic discovery and switching of all 14 features;
- Allen, Beryl, and Cosmos switching;
- finite regional values and 50-bin observation distributions;
- exact linear and logarithmic 50-bin variants for the six audited strictly
  positive features, each summing to the same finite population;
- one synchronized value scale for color normalization, global and compact
  distributions, range markers, handles, pointer inversion, and window drag;
- preferred Linear display for Firing rate with its exact Log alternative still
  available, one URL `scale` field, and disabled Log for incompatible data;
- the approved units and implementation-grounded descriptions;
- Log defaults for the other five approved strictly-positive heavy-tailed
  features and Linear defaults for Firing rate and signed/zero-bearing features;
- the all-cluster recipe and pinned legacy repository provenance in the Info
  dialog.

## Publication boundary

No online publication was attempted. Publication requires the common Q8/Q9
origin, catalog/default-alias, and authorization decisions. Once authorized,
publish these already-built bytes without scientific transformation, validate
their size/SHA graph before exposure, and repeat this acceptance suite against
the selected origin.
