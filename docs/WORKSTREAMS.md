# Workstreams

Parallel ChatGPT conversations work on isolated branches. Cross-cutting decisions return to the integration conversation and are recorded in `docs/DECISIONS.md`.

## 00 Integration / architecture

Branch: `main` for accepted integration changes.

Owns project brief, architecture, decisions, roadmap, cross-workstream contract review, and integration.

## 01 Data / schema / reproducibility

Branch: `work/data-schema`

Primary ownership: `schema/`, `builder/` data-model/build portions, `fixtures/`, data-model documentation.

Deliverables: schema v0.1, provenance/source mapping, golden fixture, deterministic builder skeleton, regional + volume representations, download/package semantics.

## 02 Frontend foundation

Branch: `work/frontend`

Primary ownership: `web/` except renderer-specific experiments.

Deliverables: TypeScript/Vite scaffold, state/actions, dataset loading contracts, URL state, local storage/import foundations, tests, initial UI shell.

## 03 Publishing / backend

Branch: `work/publishing`

Primary ownership: publishing service/client portions of `builder/` or a clearly isolated service directory, plus publishing docs/tests.

Deliverables: v1 auth analysis, v2 publishing API/auth design, immutable release workflow, validation, Python publishing client, deployment proposal.

## 04 Rendering / volumes / 3D

Branch: `work/rendering`

Primary ownership: renderer abstractions/experiments, rendering docs, performance benchmarks.

Deliverables: SVG reuse/calibration plan, slice renderer contract, volume loading/rendering strategy, performance budgets, technology-neutral 3D investigation.

## 05 UX / UI

Branch: `work/ux` if/when files are committed.

This is intentionally interactive rather than autonomous. It owns prototype iteration and `docs/ux/` specifications. It should guide one high-leverage UX decision at a time and hand accepted decisions to the frontend workstream.

## Coordination rules

- Do not silently redefine shared data contracts in a workstream.
- Record proposed cross-cutting changes in a handoff note and bring them to 00 Integration.
- Prefer actual code/tests/docs over prose-only reports.
- Commit incrementally to the assigned branch.
- First integrated milestone: one real regional feature -> v2 artifact -> browser -> linked slices -> region selection -> histogram/comparison.
- Volumes are the next launch-critical vertical slice.
