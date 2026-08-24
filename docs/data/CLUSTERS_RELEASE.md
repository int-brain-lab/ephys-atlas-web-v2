# Ephys Atlas cluster release

## Status

The D044-approved `ephys_atlas_clusters` release was built locally from the
content-addressed `ibl_neuropixel_brainwide_01` snapshot and validated on
2026-08-24. It is an immutable scientific release candidate, not a synthetic
fixture. The generated directory remains ignored and has not been published or
added to a public catalog.

## Immutable identity

- release ID: `sha256-9b5e55215b306f26`
- source rows: 925,251 all-cluster observations
- features: 14
- parcellations: Allen, Beryl, Cosmos
- files: 191
- total served-file bytes: 3,979,061
- manifest SHA-256:
  `2407053b18a78b5f28ea559a901fd3313d510d6f72e867e5a369be72f12fe054`
- deterministic graph SHA-256:
  `6c686c42ab51ab888ffbdbe0e58544df6df793fff1d4724be78dd5c0a6bc687c`
- catalog-selection SHA-256:
  `05c84bc0935be224b7d1bb2506a2c433a58a9dda34dacddd858e14dccdd3b959`

The graph digest is the SHA-256 of the sorted release-relative `sha256sum`
records for every file. A second build in a fresh temporary directory produced
the same digest byte-for-byte.

## Reproduction

```bash
uv run --project builder --extra scientific --locked \
  ephys-atlas-data build-clusters sha256-9b5e55215b306f26 \
  --project ibl_neuropixel_brainwide_01 \
  --population all \
  --catalog-selection docs/data/CLUSTERS_CATALOG_SELECTION.json \
  --created-at 2026-08-24T00:00:00Z \
  --ibleatools-commit fffe0c75810dd1a013a878abcbcf8ef6348a5a21 \
  --iblatlas-commit 52083adf44825d0622a503705e095699a5957587 \
  --builder-commit 3ef71b3 \
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
