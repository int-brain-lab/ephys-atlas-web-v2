# Local development bundle

Status: active local-data runbook. Every v7 dataset resolves to an immutable
public HTTPS release; the projection pack and native mesh still require
reviewed local bytes.

The local viewer consumes the same immutable schema-v1 releases and validated
packs intended for HTTP delivery. It does not copy them into a developer-only
format or fall back to synthetic data. Its generated preview catalog retains
the product's Ephys Atlas and Brain-Wide Map project grouping, defaults to a
coordinated **Current local previews** edition, and keeps exact preview IDs as
secondary metadata. Local labels do not imply staging or publication maturity.

## Normal workflow

Use the pinned reviewed bundle when repeatability matters:

```bash
just bootstrap
just data
just dev
```

`just data` reuses and fully validates present artifacts. It downloads a
missing artifact only when the descriptor contains an exact HTTPS source;
v7 resolves all seven published datasets. The projection pack and native mesh
retain reviewed local artifacts and unresolved sources, so full clean-checkout
acquisition still needs those two origins pinned and verified.
`just dev` is read-only and stops on a missing or corrupt launch-critical artifact.

Use the refresh lane on the macOS development machine when you want to know
whether newer upstream data exists:

```bash
just data-refresh-local
just dev-latest
```

This pulls the mutable channel and cluster `latest` aliases, resolves them to
immutable source IDs, and compares those IDs with the reviewed releases. It
launches only when they match. If a new source appears, it stops with an audit
and selection-review requirement; it never applies old scientific choices to
new bytes. Brain-Wide Map stays on its exact D038 preserved source and the
volume stays on the D043 W26 source because neither has an approved mutable
development policy.

## Active v7 identity

[`data/development-bundle-v7.json`](../../data/development-bundle-v7.json)
pins the October 2026 W39 deployment: channels, clusters, volumes, edges,
processed AGEA, MERFISH classes and lipids, each by its served root-manifest
size and SHA-256 and exact HTTPS directory, plus the projection pack and
native mesh. The default view is `rms_ap` on the W39 channels release. Brain-Wide
Map is no longer part of the bundle (see the
[deployment record](../publishing/W39_DEPLOYMENT_20261007.md)). `just data`,
`just dev`, `just dev-latest` and the full local-browser gate use it.

## Historical v6 identity

[`data/development-bundle-v6.json`](../../data/development-bundle-v6.json) was
used by `just data`, `just dev`, `just dev-latest` and the full local-browser gate.
It preserves v5's channels, clusters, Brain-Wide Map, projections, native mesh
and initial view, and replaces only these dataset entries:

| Role | Immutable identity | Maturity |
| --- | --- | --- |
| Volume | `2026_W26-ibl-review-20260917-v2` | published production |
| AGEA | `agea-processed-20260917-v3` | published production |

Both root manifests were checked against the live catalog's served-byte size
and SHA-256. Their exact immutable HTTPS directories are recorded as resolved
sources, so `just data` can acquire them when absent. The complete local v6
graph validates: 7 artifacts, 43,330 files and 1,488,052,370 stored bytes.

These releases include D078 regional histograms. Select a region to load its
companion matrix; changing hemisphere reuses it. The chart keeps each selected
region in its legend during loading, failures and empty results, and explains
when a release has no regional capability. A missing mapping row is distinct
from a stored row containing no valid voxels. No ontology subtree is inferred.
Processed AGEA retains its upstream bilateral-averaging disclosure.

## Historical v5 identity

[`data/development-bundle-v5.json`](../../data/development-bundle-v5.json) pins:

| Role | Immutable identity | Maturity |
| --- | --- | --- |
| Channels | `2026_W32-d050-q14-v1` | reviewed local technical release; not the Q2 paper release |
| Clusters | `sha256-9b5e55215b306f26-d050-d048-q14-v1` | reviewed local technical release |
| Brain-Wide Map | `legacy-v1-1d908bea-d050-q14-linear-full-v1` | reviewed local technical release |
| Volume | `2026_W26-candidate-depth4-d050-q14-linear-full-v1` | reviewed local candidate; Q5 resolved by D075 for a separately built production release |
| Projection pack | `ibl-atlas-projections-2363b6958fbf` | production-intent local asset |
| 3-D mesh pack | `ibl-native-d070-b5f5abc7d0bb3575` | D070 owner-approved, validated-real-local anatomy |
| AGEA | `agea-original-local-preview-86b49971-2cdd9bee-c93e9c5b` | D069 original-value local preview; D078/D079 govern the separately published processed successor |

The available graph is 7 artifacts, 30,157 files and 1,376,287,351 stored bytes.
The core releases and projections are unchanged from v4. AGEA's local copy under
`data/releases/agea/` also contains the two exact hash-bound provenance inputs
declared but absent from the original preview package: `AGEA_ALIGNMENT_REVIEW.json`
and `tools/agea_preview.py`. Their bytes match the committed source files and
manifest hashes; scientific resources and the manifest are unchanged. The original
preview directory was preserved.

Historical v2/v3/v4 descriptors are evidence, not active aliases. In particular,
v4 names an old-contract D042 pack and is not the current rollback command.
A future remote bundle receives a new immutable ID and exact source URLs;
existing descriptors are never retargeted.

## Native anatomy and rollback

Open the normal website with `just dev`, then choose the **3-D** context tab.
The approved Native pack loads lazily, shares feature/anatomy colours and selection,
retains URL camera/explode state, and uses OIT for translucent context. Lab review
controls and the experimental label are not in the normal viewer. Build and
approval evidence: [selected anatomy](../rendering/3D_SELECTED_ASSET.md).

To explicitly run the preserved current-contract D042 rollback with the same
five datasets, without modifying the default descriptor:

```sh
uv run --project builder --extra test --locked python -m tools.development_bundle \
  run --cwd web data/development-bundle-v5-d042-rollback.json -- npm run dev:real
```

`just validate-local-full <url>` validates every available dataset and verifies
the served mesh identity against the active bundle. The opt-in automated
main-website gate is `cd web && npx playwright test --config playwright.native-main.config.ts`.

## Integrity and installation

The descriptor records artifact identity, maturity, bounded destination, root
manifest size/SHA-256, source state, and launch criticality. The synchronizer:

1. validates bounded paths and identities;
2. reuses a destination only after complete graph validation;
3. stages a resolved download on the destination filesystem;
4. verifies every declared encoded size and SHA-256 before decoding;
5. runs the existing release/projection/mesh validator;
6. installs atomically under an advisory lock.

It never overwrites corrupt or immutable output, resolves a mutable alias,
silently substitutes an older release, or uploads private Parquet/NPZ/LUT/donor
inputs. An absent optional mesh is reported; a present but invalid mesh fails.

## macOS versus Linux

macOS is for fast source refresh, validation, UI work, and scientific preview.
Platform-dependent numeric serialization or font rasterization differences are
acceptable there because macOS-built releases are not publishable. Linux is the
sole canonical release build, preflight, and publication environment under
D062. Production releases record OS/machine/Python/NumPy provenance and must
pass, on clean `main`:

```bash
just production-release-preflight data/releases/<dataset>/<release-id>
```

This is a mandatory precursor to the implemented S3 publication transaction;
passing it does not authorize publication. Candidate/local IDs, mutable source
IDs, non-Linux provenance, dirty/non-main worktrees, and mismatched builder
commits fail closed.

## Remaining distribution work

Q8 is resolved and the initial production deployment is complete. D075 resolves
Q5 with depth-four orthogonal slice packs; D079 publishes the processed AGEA
and regional W26 successors. See the
[deployment record](../publishing/REGIONAL_DISTRIBUTION_DEPLOYMENT_20260917.md).

Pin resolved immutable HTTPS sources for the remaining v6 roles, verify
remote served bytes, and prove complete acquisition and viewer startup from a
clean checkout. Preserve v5 and the rollback descriptors as local-preview evidence.
Q2/Q9 concern the later paper snapshot and defaults, not this acquisition work.
The [implementation plan](../IMPLEMENTATION_PLAN.md) tracks the remaining task.
