# IBL Ephys Atlas Web v2

A clean-slate v2 of the International Brain Laboratory Ephys Atlas web
application. The historical application remains a separate source reference;
it is not a runtime compatibility dependency or launch fallback requirement.

## Development model

`main` is the single active development branch and source of truth. The repository is intended to support local agent/Codex-based development without relying on private chat history.

Before making changes, read:

1. [`AGENTS.md`](AGENTS.md) — repository rules and scientific/engineering guardrails;
2. [`docs/LAUNCH_SPEC.md`](docs/LAUNCH_SPEC.md) — executable launch acceptance criteria;
3. [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — ordered milestones and next unblocked work;
4. [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md) — choices an agent must not invent;
5. [`docs/AGENTIC_DEVELOPMENT.md`](docs/AGENTIC_DEVELOPMENT.md) — local autonomous coding workflow;
6. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/DECISIONS.md`](docs/DECISIONS.md), and [`docs/INTEGRATION_STATUS.md`](docs/INTEGRATION_STATUS.md) for accepted architecture and current state.

For fresh-checkout and local Codex setup, see
[`docs/CODEX_HANDOFF.md`](docs/CODEX_HANDOFF.md). It is an operating runbook,
not a second product-priority list.
Apple-silicon setup is recorded in
[`docs/MACOS_DEVELOPMENT.md`](docs/MACOS_DEVELOPMENT.md), and the active
production-volume continuation is
[`docs/data/VOLUME_IMPLEMENTATION_HANDOFF.md`](docs/data/VOLUME_IMPLEMENTATION_HANDOFF.md).

The breaking pre-launch
[`projection and volume architecture cutover`](docs/rendering/PROJECTION_VOLUME_CUTOVER_PLAN.md)
is complete through Commit 8. Future implementation agents should use its
Commit 9 production-volume gates together with the ordered implementation plan;
Q4 and Q5 must be resolved before selecting production geometry or transport.

Historical/focused documents under `docs/data/`, `docs/frontend/`, `docs/rendering/`, `docs/publishing/`, and `docs/ux/` remain supporting evidence but do not override the active launch spec or decision log.

## Quick start

Prerequisites: [`uv`](https://docs.astral.sh/uv/) 0.12+, Node 22, and `just`.
`uv` installs/uses Python 3.12 for the repository; project dependencies are
never installed into system Python.

```bash
just bootstrap
just check
just dev
```

When the ignored validated real releases and D042 mesh artifact are present on
this machine, the complete local-only catalog can be served without contacting
or publishing to a remote service:

```bash
just dev-local-full
just validate-local-full
```

This exposes channels, the approved cluster release, the preserved BWM release,
and the explicitly candidate-labelled W26 volume transport in one local catalog.
Registered slices, Top, Swanson, and the content-addressed D042 3-D pack are
served by the same Vite process. Dataset/release resources and mesh bytes receive
immutable HTTP cache headers; the catalog remains revalidated. No publishing API
or remote destination participates in this workflow.

`just check` is the local completion gate and mirrors CI: builder/schema tests, publishing tests, TypeScript typecheck, frontend unit tests, production build, and Playwright browser tests.

All Python commands in the `Justfile` run through the committed builder and
publishing `uv.lock` files. `just bootstrap` is safe on PEP 668 externally
managed Debian/Ubuntu Python installations and does not require `sudo` or
system `pip`.

Real ephys channel builds use a separate pinned environment:

```bash
just bootstrap-scientific
```

This uses the same uv-managed Python 3.12 and committed builder lock; it does
not require sudo. The first real development build and its exact source/code
pins are recorded in
[`docs/data/DEVELOPMENT_RELEASE.md`](docs/data/DEVELOPMENT_RELEASE.md).

To compare the legacy curated SVGs with annotation-derived candidates in a
fully offline report, run `just bootstrap-anatomy` and `just anatomy-compare`.
The methodology and scientific limits are documented in
[`docs/rendering/ANATOMY_COMPARISON.md`](docs/rendering/ANATOMY_COMPARISON.md).

The default viewer serves one schema-v1 `atlas-projection-pack-v1` with three
registered sparse slice stacks and affine-free Top/Swanson maps. Its registered
geometry is copied byte-for-byte from the validated sparse 80 µm anatomy build,
which derives from the bilateral 10 µm authority; anatomy packs are build inputs,
not browser formats. Scientific cursor, URL, affine, and guide state remain on
the native bilateral 10 µm grid. Run `just test-anatomy` to exercise the source
contracts, generators, integrity, and comparison gates. Clean reproducible
source builds remain available through `just anatomy-pack-v2` and
`just sampled-anatomy-pack`; existing output is never overwritten.

## Launch scope

Launch-critical datasets:

- `ephys_atlas_channels`
- `ephys_atlas_clusters`
- `ephys_atlas_volumes`
- `brainwide_map`
- `local` browser-imported datasets

The launch-critical viewer supports regional and volume representations,
Allen/Beryl/Cosmos parcellations where applicable, linked orthogonal slices,
static Top and Swanson regional views, region search/selection, scalar coloring,
descriptive statistics/comparison, shareable URL state, downloads, and the same
schema contract for published and local data.

AGEA, MERFISH, large point-cloud workflows, advanced inferential statistics, and a full replacement 3-D stack are deferred unless explicitly promoted.

## Repository layout

- `web/` — TypeScript + Vite browser application, intentionally framework-free by default;
- `builder/` — deterministic dataset build, validation, provenance, and packaging tooling;
- `publishing/` — capability-based staging/publication service and Python client;
- `schema/` — versioned dataset schemas and physical-format contracts;
- `fixtures/` — deterministic synthetic golden releases used across implementations/tests;
- `benchmarks/` — rendering/storage measurements used to choose production physical formats;
- `tests/` — cross-cutting builder/schema/rendering tests;
- `docs/` — product spec, architecture, decisions, source policy, implementation plan, and supporting evidence.

## Core invariants

Published releases are immutable; aliases such as `latest` resolve to immutable release IDs outside release contents. Feature catalogs are data-driven rather than hardcoded. Scientific provenance and coordinate transforms must be explicit. Curated SVG display calibration is not canonical scientific geometry. Production volume transport is selected from real-data browser benchmarks rather than inferred from the reference fixture.
