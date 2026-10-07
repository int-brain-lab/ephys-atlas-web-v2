# IBL Ephys Atlas Web v2

Explore mouse-brain electrophysiology in the [live viewer](https://ephys-atlas.iblcore.org/app/).
The application provides linked coronal, sagittal, and horizontal slices,
Top and Swanson regional maps, an optional 3-D anatomy view, searchable
features and regions, descriptive statistics and distributions, downloads,
shareable views, and validated browser-local ZIP import.

Start with [Use the viewer](docs/guides/using-the-viewer.md) and
[Understand parcellations](docs/guides/parcellations.md). To create your own
regional or volume dataset, follow the
[custom-data tutorial](docs/data/CUSTOM_DATA_TUTORIAL.md).

Scientific builders produce immutable, provenance-rich schema-v1 releases.
Public exploration reads static data without authentication; transformation
happens before publication. The frontend uses strict TypeScript, Vite and plain
DOM code; the builders, authoring API and publishing tools use Python.

## Current status

The initial IBL review website is deployed with Ephys Atlas channels, clusters
and volumes, Brain-Wide Map, AGEA, and the approved native 3-D anatomy. Processed
AGEA and the W26 regional-distribution successor were published under D079;
see the [deployment record](docs/publishing/REGIONAL_DISTRIBUTION_DEPLOYMENT_20260917.md).

The final paper snapshot/defaults and broader launch QA remain separate work.
Q5's volume storage choice and Q8's origin/access choice are resolved. Use the
[implementation plan](docs/IMPLEMENTATION_PLAN.md),
[open questions](docs/OPEN_QUESTIONS.md) and
[resolved-question index](docs/RESOLVED_QUESTIONS.md) for their current scope.
Local preview and candidate releases keep their original maturity labels even
when a separately built successor has been published.

## Development setup

Run commands from the repository root. Install `uv` 0.12 or newer, Node 22 and
`just`. Bootstrap installs Python 3.12 and dependencies through the committed
uv locks, Node dependencies through `npm ci`, and Playwright Chromium.

```bash
just bootstrap
just check
```

The full gate uses deterministic synthetic fixtures and does not require the
ignored real-data bundle. It checks documentation, Python, strict TypeScript,
unit/rendering tests, the production build, browser behavior and documentation
screenshots. Synthetic fixtures are test inputs and never runtime substitutes
for scientific data.

### Preview the reviewed local data

`just dev` uses the pinned
[development bundle v5](data/development-bundle-v5.json). Its real artifacts
live in ignored local directories and must be available at the exact declared
paths. The descriptor's source URLs remain unresolved, so a fresh checkout
cannot currently download this bundle. A new descriptor pointing to published
immutable HTTPS releases is planned; the historical descriptor will retain
its identities and preview labels.

Once those reviewed artifacts are available locally:

```bash
just data
just dev
```

`just data` reuses valid local bytes and validates every available artifact's
complete graph. It can atomically download missing artifacts when a descriptor
provides resolved HTTPS sources; unresolved required artifacts produce an
explicit error. `just dev` validates without downloading, derives the local
catalog and starts Vite. Open <http://localhost:5173/> for the landing page or
<http://localhost:5173/app/> for the viewer, using the port printed by Vite.

Missing or corrupt required artifacts stop startup. An absent optional artifact
does not block 2-D exploration; a corrupt artifact that is present fails
validation. The [local-development runbook](docs/data/LOCAL_DEVELOPMENT_BUNDLE.md)
records exact identities, integrity checks and the explicit D042 3-D rollback.

## Main commands

| Command | Purpose |
| --- | --- |
| `just bootstrap` | Install locked Python, Node and Chromium dependencies. |
| `just data` | Reuse or obtain descriptor-pinned artifacts and validate their graphs. |
| `just dev` | Validate the local bundle, derive its catalog and start Vite. |
| `just data-refresh-local` | Refresh channel/cluster source aliases; stop if they differ from reviewed inputs. |
| `just dev-latest` | Perform that reviewed-source check, then start the viewer. |
| `just test-python` | Run builder and publishing tests. |
| `just test-web` | Run TypeScript, unit/rendering tests and the production build. |
| `just test-browser` | Run the Chromium browser suite. |
| `just check` | Run the full local completion gate. |
| `just docs-serve` | Preview the local documentation site. |

Use `just --list` for dataset builders, validation, benchmarks and focused
acceptance commands. Linux generates and checks canonical screenshot pixels;
macOS runs semantic browser tests and skips those pixel comparisons.

## Publication and deployment

Linux is the canonical scientific build, preflight and publication host.
macOS supports development and local previews. Before publishing scientific
releases, build on clean `main` and run
`just production-release-preflight <release...>`.
The [local-publisher runbook](docs/publishing/LOCAL_PUBLISHER.md) describes
validation, immutable uploads and catalog-last promotion.

The [CI workflow](.github/workflows/ci.yml) runs Python and web checks. A
successful push to `main` or manual workflow dispatch also publishes the website
when the production AWS role is configured. Site deployment is separate from
scientific release publication. The MkDocs site is built locally and in CI;
its build command does not deploy it.

## Repository map

| Path | Responsibility |
| --- | --- |
| `builder/` | Scientific builders, schema validation and the Python authoring API. |
| `web/` | TypeScript viewer, data layer, rendering, UI and browser tests. |
| `publishing/` | Local S3 publication tools and the optional capability-based service. |
| `tools/` | Bundle, validation, documentation and deployment orchestration. |
| `schema/v1/` | The sole implemented producer/consumer release contract. |
| `fixtures/` | Deterministic synthetic contract and browser fixtures. |
| `data/` | Committed descriptors/configuration and ignored local source/release storage. |
| `docs/` | Product contracts, decisions, scientific recipes, evidence and runbooks. |

## Contributor reference

Begin with [AGENTS.md](AGENTS.md) and its required reading sequence. Work on
`main`, preserve unrelated changes, implement a coherent slice, run targeted
tests followed by `just check`, and update durable documentation before committing.

- [System overview](docs/SYSTEM_OVERVIEW.md) — data flow and documentation authority.
- [Launch specification](docs/LAUNCH_SPEC.md) — acceptance criteria.
- [Integration status](docs/INTEGRATION_STATUS.md) — implemented behavior and maturity.
- [Decisions](docs/DECISIONS.md) — accepted product and architecture choices.
- [Scientific data index](docs/data/README.md) — sources, recipes, selections and evidence.
- [Schema v1](schema/v1/README.md) — release format and invariants.
