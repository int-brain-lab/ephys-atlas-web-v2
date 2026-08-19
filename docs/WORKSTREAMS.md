# Workstreams

The initial five-way exploration phase is complete. The project now uses three active workstreams so shared contracts converge earlier and conversation overhead stays low. Accepted cross-cutting decisions are recorded in `docs/DECISIONS.md`.

## 00 Integration / release

Branch: `main` for accepted changes. Short-lived `agent/*` branches may be used only to assemble and validate changes before directly fast-forwarding/merging them into `main`; routine integration does not require pull requests.

Owns project brief, architecture, decisions, roadmap, integration, release readiness, CI, shared-contract review, and deployment sequencing.

The initial data/schema, publishing, UX, frontend, and rendering workstreams are integrated. `main` is the shared product baseline.

## 01 Data / schema / reproducibility

Branch: `work/data-schema`, kept aligned with integrated `main` before new data work starts.

Primary ownership: `schema/`, `builder/`, canonical-source adapters, fixtures, provenance, scientific metadata, and physical data packaging.

Immediate work:

- build real launch datasets from pinned/current source vintages;
- resolve remaining scientific metadata/QC questions from authoritative sources rather than implementation guesses;
- benchmark real encoding volumes for `chunks3d` versus browser-oriented slice packs before freezing launch transport;
- keep immutable source provenance and publication snapshots explicit.

## 02 Viewer

Branch: `work/frontend`, reset/aligned to integrated `main` after each completed integration pass.

This combines the former frontend, rendering, and UX conversations. It owns `web/`, browser interaction, responsive UX, regional/volume rendering, charts, and renderer integration.

The frontend `SliceRenderer` facade is the application boundary. Lower-level SVG/volume/3-D renderers stay below it. UX decisions are made against the real browser implementation rather than maintained as a separate autonomous workstream.

Immediate work:

- replace representative region UI with schema-v0.1 regional data;
- connect region hover/selection and feature coloring to the lower-level SVG renderer;
- implement distribution/histogram/comparison from real descriptive-statistic payloads;
- complete the first real regional vertical slice before expanding 3-D work;
- integrate real volume artifacts through `VolumeSliceSource` once the physical layout is benchmarked.

## Parked: publishing / backend

The `work/publishing` implementation has been integrated as a launch-capable skeleton. Further autonomous publishing work is paused until deployment/domain/storage choices or collaboration requirements make it necessary.

The viewer launch must not depend on additional publishing features. Public reads remain static; publishing validates and commits immutable releases.

## Historical branches

`work/ux`, `work/rendering`, and `work/publishing` are historical/reference branches. Do not start new parallel product work on them unless Integration explicitly reopens a narrowly scoped investigation.

## Coordination rules

- Shared contracts land through Integration before downstream work depends on them.
- Data owns scientific semantics and physical artifact generation; Viewer owns browser consumption and interaction.
- Do not duplicate schema, renderer, or state abstractions across workstreams.
- Prefer code/tests/fixtures and measured browser/data evidence over prose-only proposals.
- Do not leave completed work only in a conversation-local worktree: commit and push it before handoff.
- First integrated milestone: one real regional feature -> v2 artifact -> browser -> linked slices -> region selection -> histogram/comparison.
- Volumes are the next launch-critical vertical slice; 3-D follows unless it can be added without delaying them.
