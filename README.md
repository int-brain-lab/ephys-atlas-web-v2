# IBL Ephys Atlas Web v2

A clean-slate v2 of the International Brain Laboratory Ephys Atlas web application.

The legacy application remains separate and deployable during development of v2.

## Initial scope

Launch-critical datasets:

- `ephys_atlas_channels`
- `ephys_atlas_clusters`
- `ephys_atlas_volumes`
- `brainwide_map`
- `local` browser-imported datasets

Planned follow-ups include AGEA, MERFISH, large point datasets, and richer statistical analysis.

## Repository layout

- `web/` — TypeScript + Vite browser application, with no frontend framework by default
- `builder/` — Python deterministic dataset build, validation, and packaging tooling
- `publishing/` — capability-based staging/publication service and Python client
- `schema/` — versioned dataset schemas and format contracts
- `fixtures/` — small golden datasets used across implementations and tests
- `benchmarks/` — rendering/storage measurements used to choose launch physical formats
- `tests/` — cross-cutting data and rendering tests
- `docs/` — architecture, decisions, UX, rendering, publishing, and workstream documentation

Start with `docs/INTEGRATION_STATUS.md` for the current integrated state, then `docs/PROJECT_BRIEF.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, and `docs/WORKSTREAMS.md` before making cross-cutting changes.
