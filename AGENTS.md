# Agent instructions

This repository is developed as a single integrated product. `main` is the only development branch and the source of truth.

## Start here

Before changing code, read these files in order:

1. `AGENTS.md`
2. `docs/LAUNCH_SPEC.md`
3. `docs/IMPLEMENTATION_PLAN.md`
4. `docs/OPEN_QUESTIONS.md`
5. `docs/ARCHITECTURE.md`
6. `docs/DECISIONS.md`
7. `docs/INTEGRATION_STATUS.md`

Use `docs/DATA_SOURCES.md`, `schema/v0.1/README.md`, and the focused documents under `docs/data/`, `docs/frontend/`, `docs/rendering/`, and `docs/publishing/` when working in those areas.

## Branch and commit model

- Work on `main`. Do not create persistent `work/*`, `agent/*`, or other parallel product branches unless the repository owner explicitly asks for an isolated experiment.
- Pull/rebase from the current remote `main` before starting a new unit of work.
- Keep commits small enough to review and revert, but complete enough to leave the repository coherent.
- Never intentionally leave a red commit as the handoff point. Run the relevant targeted tests while developing and `just check` before declaring a task complete.
- Do not create pull requests for routine work unless explicitly requested. The current project workflow integrates directly on `main`.
- Do not rewrite or force-push shared history.

## Scientific correctness guardrails

Scientific provenance is part of the product contract, not optional metadata.

- Never invent or infer a scientific choice just to unblock implementation.
- Do not silently choose raw versus denoised ephys features, a QC/population filter, a paper vintage, a cluster population, a `brainwide_map` definition, or a volume affine. These are tracked in `docs/OPEN_QUESTIONS.md`.
- If an unresolved scientific question blocks a production artifact, implement and test the machinery with synthetic fixtures, make the blocked choice explicit, and stop short of publishing a purported scientific release.
- Published releases are immutable. Mutable aliases such as `latest` live outside immutable release directories.
- The feature catalog is dynamic. Do not hardcode the complete set of features from one vintage.
- Record source project, vintage/release, transformation mode, population/QC recipe, builder version, and source hashes in provenance wherever the schema permits it.

## Data and schema invariants

- Schema v0.1 in `schema/v0.1/` is the contract shared by the builder, browser, local import, and publishing service.
- Prefer changing the contract once and updating every producer/consumer in the same coherent task rather than adding adapter-specific shadow schemas.
- Large numeric data belongs in typed binary artifacts, not large JSON payloads.
- `fixtures/golden-v0.3/` is deterministic and synthetic. It must never be presented as scientific data.
- The browser-served golden fixture must remain semantically identical to the builder fixture. If copies are needed for Vite, update them from the canonical fixture rather than hand-editing divergent content.

## Rendering invariants

- `SliceRenderer` is the application rendering boundary. Keep SVG, Canvas, volume, and future 3-D implementation details below it.
- Scientific coordinates and curated SVG display calibration are separate systems. Never derive a scientific volume transform from the hand-tuned legacy SVG alignment.
- The five curated v1 SVG bundles are authoritative display assets. Do not regenerate, simplify, reorder, or resample them. Their pinned identity is documented in `docs/frontend/LEGACY_CURATED_ASSETS.md`.
- Orthogonal SVG assets are display-downsampled. Scientific navigation and URL state stay on the full-resolution coordinate domains.
- Volume storage layout (`chunks3d` versus `orthogonal_slice_packs`) is independent of scientific grid geometry. Choose the production layout from measured real-data browser benchmarks, not convenience.

## Frontend constraints

- The viewer is TypeScript + Vite with plain DOM code. Do not introduce a frontend framework or large dependency without a concrete need and repository-owner approval.
- Preserve URL-persisted view state and responsive behavior when changing interaction code.
- New browser-visible behavior should have Playwright coverage when practical. Data/transform logic should have deterministic unit tests.
- Do not weaken strict TypeScript settings to make a change compile.

## Publishing constraints

- Public reads are static and unauthenticated.
- Publishing is capability-based and publishes already-built releases; it does not transform scientific data.
- A release must pass byte-size/SHA validation and the schema validator before becoming public.
- Keep the public browser catalog contract separate from administrative publishing state.

## Required commands

Run `just bootstrap` once in a fresh checkout, then use:

- `just dev` — run the Vite viewer locally.
- `just test-python` — builder and publishing Python tests.
- `just test-web` — TypeScript typecheck, unit tests, and production build.
- `just test-browser` — Playwright browser suite.
- `just check` — the full local gate; this is the default completion criterion.

CI is defined in `.github/workflows/ci.yml`. Local `just check` should stay aligned with it.

## Agent work loop

Follow `docs/AGENTIC_DEVELOPMENT.md`. In particular:

1. select the next unblocked milestone from `docs/IMPLEMENTATION_PLAN.md`;
2. inspect current code and tests before editing;
3. implement the smallest coherent vertical slice;
4. run targeted tests, then `just check`;
5. update status/spec/decision docs when reality changed;
6. commit only the intended files with a descriptive message;
7. leave `main` green and the next action explicit.

If authoritative information contradicts these documents, update the durable repository documentation in the same task rather than relying on chat history.
