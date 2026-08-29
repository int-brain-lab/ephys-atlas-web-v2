# IBL Ephys Atlas Web v2

IBL Ephys Atlas Web v2 builds provenance-rich scientific datasets into
immutable schema-v1 releases and explores them through a static-read browser
application. The viewer provides linked coronal, sagittal, and horizontal
slices, Top and Swanson regional maps, dynamic feature discovery, regional
statistics and comparisons, encoding-volume slices, downloads, shareable URL
state, and validated local ZIP import. The frontend is strict TypeScript with
Vite and plain DOM code; scientific builders and publishing tools are Python.

The product is pre-launch. Current real artifacts are validated locally, not
published production releases. The channel snapshot is not the unresolved Q2
paper selection, the W26 volume is still a Q5 transport candidate, and no
production origin or paper default has been selected.

## Quick start

Prerequisites are `uv` 0.12 or newer, Node 22, and `just`. Repository Python
3.12 environments and dependencies come only from committed uv lockfiles.

```bash
just bootstrap
just data
just dev
```

When the ignored local artifacts are staged, open <http://localhost:5173/>
after Vite starts. `just data` verifies every descriptor artifact against the pinned
[`development-bundle-v3.json`](data/development-bundle-v3.json), including its
root hash, immutable identity, and complete file graph. The complete local
corpus validated in the current integration workspace is 534,262,861 bytes
across channels, clusters, Brain-Wide Map, the W26 volume candidate, the
five-view projection pack, and the optional D042 mesh pack.

Remote download is intentionally unavailable until Q8 supplies an authorized
immutable origin. In a fresh checkout, `just data` therefore reports all
missing artifacts and `just dev` stops before startup; neither command uses a
synthetic, older-release, or mutable-alias fallback. The exact BWM and D042
inputs have been recovered locally; remote download still requires Q8 to bind
their immutable browser-ready outputs to an authorized origin.

## Main commands

| Command | Purpose |
| --- | --- |
| `just bootstrap` | Install locked Python, Node, and Chromium dependencies. |
| `just data` | Verify the pinned local development artifact graph without network access. |
| `just dev` | Verify the graph, derive the local catalog from its descriptor, and start Vite. |
| `just check` | Run the complete local CI-equivalent gate. |
| `just docs-serve` | Preview the strict local documentation site. |

Dataset-specific builders, benchmarks, and focused acceptance recipes remain
available through `just --list`; they are diagnostic and production workflows,
not alternate interactive viewer entry points.

## Repository map

- `builder/` — deterministic scientific builders, schema validation, and public
  Python authoring API;
- `web/` — framework-free TypeScript viewer, data layer, rendering, UI, and
  browser tests;
- `publishing/` — capability-authorized staging and publication service;
- `schema/v1/` — the sole implemented producer/consumer release contract;
- `fixtures/` — deterministic synthetic contract and browser fixtures;
- `data/` — committed bundle descriptors plus ignored local source/release
  storage;
- `docs/` — product authority, decisions, scientific recipes, evidence, and
  operational runbooks.

## Authoritative documentation

- [`SYSTEM_OVERVIEW.md`](docs/SYSTEM_OVERVIEW.md) — system flow, boundaries, and
  documentation authority map;
- [`LAUNCH_SPEC.md`](docs/LAUNCH_SPEC.md) — launch acceptance criteria;
- [`IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — ordered incomplete
  work;
- [`OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md) — decisions an implementation
  agent must not guess;
- [`INTEGRATION_STATUS.md`](docs/INTEGRATION_STATUS.md) — implemented capability
  and artifact maturity;
- [`data/README.md`](docs/data/README.md) — scientific source, recipe, selection,
  and evidence index;
- [`LOCAL_DEVELOPMENT_BUNDLE.md`](docs/data/LOCAL_DEVELOPMENT_BUNDLE.md) — local
  artifact identity, verification, download, and recovery plan.

Contributors and coding agents must begin with [`AGENTS.md`](AGENTS.md), work on
`main`, preserve unrelated changes, implement one coherent vertical slice, run
targeted tests followed by `just check`, and update durable documentation when
repository reality changes. Synthetic fixtures never stand in for scientific
data, and unpublished or candidate artifacts must retain their maturity labels.
