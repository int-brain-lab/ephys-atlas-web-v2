# Ephys Atlas cluster release

## Status

The D044/D046-approved `ephys_atlas_clusters` candidate was built on Fractal
from the content-addressed `ibl_neuropixel_brainwide_01` snapshot and validated
locally and on Fractal on 2026-08-26. It is real scientific data, not a
synthetic fixture. The generated directory remains ignored and has not been
published or added to a public catalog. Automated acceptance is complete;
final human visual comparison of the histogram presentation remains pending.

## Immutable identity

- release ID: `sha256-9b5e55215b306f26-hist-axis-v1`
- source snapshot ID: `sha256-9b5e55215b306f26`
- source rows: 925,251 all-cluster observations
- features: 14
- parcellations: Allen, Beryl, Cosmos
- files: 209
- total served-file bytes: 5,105,307
- manifest SHA-256:
  `9db5cbd5763053f06915e8b97a516327490f4fdc5c417687b441fb852bba6b20`
- deterministic graph SHA-256:
  `c53c205f640d73ed0165e46f3057934ed61a93fece58cbb7f40ec4e4fb8ea911`
- catalog-selection SHA-256:
  `666a2a4acacf9253d7af2579a827b36825cf82a23db1b0fd9e8ed1a60f86e8e0`

The graph digest is the SHA-256 of the sorted release-relative `sha256sum`
records for every file. A second build in a fresh temporary directory produced
the same digest byte-for-byte.

The earlier 191-file candidate `sha256-9b5e55215b306f26` remains immutable
evidence with manifest SHA-256 `2407053b18a78b5f28ea559a901fd3313d510d6f72e867e5a369be72f12fe054`.
It is superseded for review only; no bytes were altered or deleted.

## Reproduction

```bash
uv run --project builder --extra scientific --locked \
  ephys-atlas-data build-clusters sha256-9b5e55215b306f26 \
  --release-id sha256-9b5e55215b306f26-hist-axis-v1 \
  --project ibl_neuropixel_brainwide_01 \
  --population all \
  --catalog-selection docs/data/CLUSTERS_CATALOG_SELECTION.json \
  --created-at 2026-08-26T00:00:00Z \
  --ibleatools-commit fffe0c75810dd1a013a878abcbcf8ef6348a5a21 \
  --iblatlas-commit 52083adf44825d0622a503705e095699a5957587 \
  --builder-commit 4f84df2cee70ff814fb45df83be6ee2eda2c79f0 \
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
- release-preferred Log display, immediate Linear/Log switching, independent
  URL persistence, and disabled Log for incompatible signed/zero-bearing data;
- the approved units and implementation-grounded descriptions;
- log defaults for strictly-positive heavy-tailed features and linear defaults
  for signed/zero-bearing features;
- the all-cluster recipe and pinned legacy repository provenance in the Info
  dialog.

## Publication boundary

No online publication was attempted. Publication requires the common Q8/Q9
origin, catalog/default-alias, and authorization decisions. Once authorized,
publish these already-built bytes without scientific transformation, validate
their size/SHA graph before exposure, and repeat this acceptance suite against
the selected origin.
