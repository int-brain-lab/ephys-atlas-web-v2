# Local development bundle

Status: active local-data runbook. Remote clean-checkout acquisition remains
blocked on Q8.

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
current v4 sources remain unresolved pending Q8. `just dev` is read-only and
stops on a missing or corrupt launch-critical artifact.

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

## Active v4 identity

[`data/development-bundle-v4.json`](../../data/development-bundle-v4.json) pins:

| Role | Immutable identity | Maturity |
| --- | --- | --- |
| Channels | `2026_W32-d050-q14-v1` | reviewed local technical release; not the Q2 paper release |
| Clusters | `sha256-9b5e55215b306f26-d050-d048-q14-v1` | reviewed local technical release |
| Brain-Wide Map | `legacy-v1-1d908bea-d050-q14-linear-full-v1` | reviewed local technical release |
| Volume | `2026_W26-candidate-depth4-d050-q14-linear-full-v1` | reviewed candidate; Q5 remains open |
| Projection pack | `ibl-atlas-projections-2363b6958fbf` | production-intent local asset |
| 3-D mesh pack | `ibl-bwm-d042-c7bb3a88157c42cc` | optional production-intent local asset |

The currently available graph is 6 artifacts and 551,523,979 stored bytes.
Historical v2/v3 descriptors are evidence, not active aliases. A future remote
bundle receives a new immutable ID and exact source URLs; v4 is never retargeted.

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

This is a mandatory precursor, not the still-unimplemented Q8 S3 publication
transaction. Candidate/local IDs, mutable source IDs, non-Linux provenance,
dirty/non-main worktrees, and mismatched builder commits fail closed.

## Remaining distribution work

Q8 must provide the exact staging CloudFront/OAC/header policy, publisher IAM,
first authorized artifact set, and local S3 publisher. Then create a new bundle
descriptor with resolved immutable HTTPS sources, verify remote served bytes,
and prove `just data`, `just dev`, and `just validate-local-full` from a clean
checkout. Q2, Q5, and Q9 still govern paper channels, volume transport, and
public edition/defaults respectively.
