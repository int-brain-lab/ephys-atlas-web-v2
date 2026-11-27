# Brain-Wide Map restoration deployment

Status: complete on 2026-11-26.

The D101 restoration is live at <https://ephys-atlas.iblcore.org>. One catalog
promotion adds back the `brainwide-map` project, its `ibl-review-20260908-v1`
edition and the `brainwide_map` dataset on top of the W42/W46 catalog. No
release bytes were published or changed; Ephys Atlas remains the default.

## Published identities

| Artifact | Identity | SHA-256 |
| --- | --- | --- |
| BWM release (existing, unchanged) | `legacy-v1-1d908bea-ibl-review-20260908-v1` | manifest `ae03114ff1544c91a27b7d3ad9cc2fc06d690cb4bfcc93a5d9a495fe919fdb6a` (20,988 bytes) |
| Catalog | `bd8b3a633cf048db99e84a0c5b8b9fab` | `846025d8a526a8683a3eba58a94c2e9c89a2ca3c3602134a0b511dae03b5f6a3` (9,735 bytes) |
| Site | CI run 45859831227 | commit `9b22758` (development bundle v9) |
| Previous catalog | `2378fa1410294898824e06a163211d5f` | `058aab718896e16573251071178647eb937cdf59317fadad96bff85265e08419` |

## Promotion

The curator configuration at `901bd4c` (PR #20) was compiled and promoted with
`tools.s3_catalog --apply --transport sdk` from clean `main` on macOS arm64,
against local copies of all 15 referenced releases. The eight releases absent
locally were copied read-only from the production root (excluding each
`_publication.json`) and passed `check_catalog_release` and full graph
validation before use. The offline compilation was identical to the live
catalog apart from the BWM project, edition, dataset and release; the D096
transition guard reported only those additions and no removals.

## Production checks

The served `catalog.json` matches the promoted S3 object byte for byte.
`node web/scripts/verify-production-site.mjs https://ephys-atlas.iblcore.org`
passed against the live site (landing, geometry, navigation, quantiles, URL,
static projections, catalog inventory, data chooser, all eight datasets
including `brainwide_map`, and the 3-D mesh). `just site-compatibility` passes
with the synchronized descriptor. This is automated Chromium evidence only. The first site push (`1469447`) failed CI because the
development-bundle parity test still pinned v8 and the dev-server catalog named
the project `brain-wide-map`; v9 and the `brainwide-map` id fixed it before any
site deployment, and the verification passed again against that build.
