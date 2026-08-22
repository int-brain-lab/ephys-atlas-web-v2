# Work model

The initial parallel exploration phase is complete. All accepted data/schema, publishing, UX, frontend, rendering, and integration work is consolidated on `main`.

This file keeps the historical `WORKSTREAMS` name only so old links remain valid. It is no longer a branch/conversation assignment document. The active execution order lives in `docs/IMPLEMENTATION_PLAN.md`.

## Single development line

`main` is the sole active product branch and the source of truth for code, schema, documentation, CI, and launch readiness.

Do not create persistent `work/*` or `agent/*` branches. Do not resume historical data/frontend/rendering/UX/publishing branches. A temporary branch is justified only if the repository owner explicitly requests an isolated experiment; it must be integrated or discarded promptly.

Routine project work proceeds sequentially on `main` with `just check`/CI as the integration gate. Pull requests are not required for the current project workflow.

See D017 in `docs/DECISIONS.md` and the root `AGENTS.md`.

## Subsystem boundaries

The repository still has clear ownership boundaries even though they no longer map to branches:

- `schema/`, `builder/`, fixtures, provenance, source adapters, scientific metadata: data/schema/reproducibility;
- `web/`: browser state, UX, regional/volume rendering, charts, interactions, local transport;
- `publishing/`: capability-authenticated mutation service/client; public reads stay static;
- `benchmarks/`: measured evidence for physical/rendering choices;
- `docs/`: product spec, architecture, decisions, open questions, source policy, deployment and launch state;
- CI/release integration: repository-wide.

Shared contracts are changed once on `main`, with affected producers and consumers updated in the same coherent task whenever practical.

## Current vertical slices

### Regional

The schema-v0.1 regional golden path is implemented end-to-end:

regional feature -> typed binary artifacts -> published/local browser source ->
region metadata/statistics/histograms -> linked sparse indexed-SVG anatomy ->
feature coloring -> hierarchy/value-ranked list and SVG selection -> URL state ->
selected/global comparison and CSV export.

The fixture is synthetic; production channel science remains blocked on the explicit questions listed in `docs/OPEN_QUESTIONS.md`.

### Volume

The schema-v0.1 golden volume path is implemented through the shared renderer boundary:

volume descriptor -> transport resource callback -> `chunks3d` or
`orthogonal_slice_packs` adapter -> axis/coordinate mapping from declared
scientific metadata -> bounded decoded cache -> orthogonal slice extraction ->
Canvas rendering.

This proves the browser contract/reference implementation. It does not freeze production volume transport or establish the unresolved authoritative scientific affine.

### Publishing

Publishing stages/resumes/validates immutable releases and emits a browser-compatible static public catalog while keeping administrative state separate. It does not perform scientific transforms.

## Coordination rules

- Fix a red `main` gate before starting the next independent product feature.
- Select new work from `docs/IMPLEMENTATION_PLAN.md`, not from old workstream handoffs.
- Do not silently redefine scientific semantics, coordinate systems, region identifiers, source vintages, or physical formats.
- If a required scientific choice is unresolved, record/use `docs/OPEN_QUESTIONS.md` and work on an independent task rather than guessing.
- Prefer code, tests, fixtures, and measured browser/data evidence over prose-only proposals.
- Feature catalogs remain data-driven.
- Published releases remain immutable; aliases resolve outside release contents.
- Curated SVG display calibration is presentation metadata, never a canonical scientific coordinate transform.
- The isolated P3D lab may proceed concurrently under D032; production 3-D
  promotion remains lower priority than the launch-critical
  regional/volume/data/deployment path.
