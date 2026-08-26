# Ephys Atlas cluster release

## Status

The D044/D048-approved `ephys_atlas_clusters` candidate was built on Fractal
from the content-addressed `ibl_neuropixel_brainwide_01` snapshot and validated
locally and on Fractal on 2026-08-26. It is real scientific data, not a
synthetic fixture. The generated directory remains ignored and has not been
published or added to a public catalog. The owner selected Log with an automatic
3.73–17.8 Hz range as the preferred Firing-rate presentation. Automated
acceptance and final visual confirmation in the complete atlas workspace are
complete.

## Immutable identity

- release ID: `sha256-9b5e55215b306f26-firing-defaults-v1`
- source snapshot ID: `sha256-9b5e55215b306f26`
- source rows: 925,251 all-cluster observations
- features: 14
- parcellations: Allen, Beryl, Cosmos
- files: 209
- total served-file bytes: 5,106,203
- manifest SHA-256:
  `98d24e66016f36872733b495f8c0e0a21aa0142e982c9f3c73098f3a3a2e75dc`
- deterministic graph SHA-256:
  `db321e6461480dcf44ced7a05b2932a387226f2f0d02c2c037e46a4b62f028c1`
- catalog-selection SHA-256:
  `238d52ba09ec391ce1a0ca010a734dddd0c71c93c5d96acba41863812895ae0c`

The graph digest is the SHA-256 of the sorted release-relative `sha256sum`
records for every file. A second build in a fresh temporary directory produced
the same digest byte-for-byte.

The prior candidates `sha256-9b5e55215b306f26`,
`sha256-9b5e55215b306f26-hist-axis-v1`, and
`sha256-9b5e55215b306f26-value-scale-v1` remain immutable evidence. Their manifest
SHA-256 values are `2407053b18a78b5f28ea559a901fd3313d510d6f72e867e5a369be72f12fe054`,
`9db5cbd5763053f06915e8b97a516327490f4fdc5c417687b441fb852bba6b20`,
and `6c03d5f02e1baba81faf288133f7cff41dfca2cc8f0bfb69341a3bb30bc9b05f`.
No prior bytes were altered or deleted.

## Reproduction

```bash
uv run --project builder --extra scientific --locked \
  ephys-atlas-data build-clusters sha256-9b5e55215b306f26 \
  --release-id sha256-9b5e55215b306f26-firing-defaults-v1 \
  --project ibl_neuropixel_brainwide_01 \
  --population all \
  --catalog-selection docs/data/CLUSTERS_CATALOG_SELECTION_FIRING_RATE_DEFAULTS.json \
  --created-at 2026-08-26T00:00:00Z \
  --ibleatools-commit fffe0c75810dd1a013a878abcbcf8ef6348a5a21 \
  --iblatlas-commit 52083adf44825d0622a503705e095699a5957587 \
  --builder-commit 58d035cf548fa762031bb641b8fabb2e6797681d \
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
- preferred Log display and automatic 3.73–17.8 Hz range for Firing rate with
  its exact Linear alternative still available, one URL `scale` field, and
  disabled Log for incompatible data;
- the approved units and implementation-grounded descriptions;
- Log defaults for all six approved strictly-positive heavy-tailed features and
  Linear defaults for signed/zero-bearing features;
- the all-cluster recipe and pinned legacy repository provenance in the Info
  dialog.

On 2026-08-26, the repository owner completed the final guided visual review in
the complete atlas workspace and confirmed the D048 defaults without further
scientific or presentation changes.

## Publication boundary

No online publication was attempted. Publication requires the common Q8/Q9
origin, catalog/default-alias, and authorization decisions. Once authorized,
publish these already-built bytes without scientific transformation, validate
their size/SHA graph before exposure, and repeat this acceptance suite against
the selected origin.
