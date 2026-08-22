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

Use `docs/DATA_SOURCES.md`, `schema/v1/README.md`, and the focused documents under `docs/data/`, `docs/frontend/`, `docs/rendering/`, and `docs/publishing/` when working in those areas.

## Branch and commit model

- Work on `main`. Do not create persistent `work/*`, `agent/*`, or other parallel product branches unless the repository owner explicitly asks for an isolated experiment.
- The repository owner has explicitly authorized one short-lived isolated
  worktree for the brain-mesh 3-D experiment described in
  `docs/rendering/3D_EVALUATION.md`. Treat its branch as a disposable
  development aid: rebase it frequently, land small reviewed green commits on
  `main`, and do not let it become a second product branch or source of truth.
- Fetch the current remote `main` before starting a new unit of work. Fast-forward
  or rebase only from a clean worktree, and never overwrite unrelated local work.
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

- Schema v1 in `schema/v1/` is the sole implemented release contract across
  the builder, browser, local import, publishing service, and fixtures. Schema
  v0.1 readers, adapters, schemas, and fixtures were removed in the approved
  pre-launch cutover; do not reintroduce them.
- Change the contract once and update every producer/consumer in the same
  coherent task rather than adding adapter-specific shadow schemas.
- Large numeric data belongs in typed binary artifacts, not large JSON payloads.
- `fixtures/golden-v1/` is deterministic and synthetic. It must never be presented as scientific data.
- Synthetic ephys fixtures are test-only inputs. Do not copy them under
  `web/public/`, use them as the runtime default, or fall back to them when a
  configured real release is absent.
- Browser tests must mount the canonical golden fixture directly through the
  test-only local-release server; do not maintain a divergent browser copy.

## Rendering invariants

- `ProjectionViewportFactory` is the implemented application boundary. It owns
  retained layered orthogonal viewports shared by regional SVG and volume
  Canvas plus affine-free static regional viewports. Do not reintroduce
  `SliceRenderer`, a hybrid switch, anatomy-pack browser readers, or another
  renderer facade.
- The immutable bilateral 10 µm `anatomy-pack-v2` is the canonical regional
  geometry and affine authority. The active sparse `anatomy-pack-v3` copies
  display planes from that parent without changing scientific navigation. The
  cutover may repackage those validated fragments into the new projection-pack
  contract without weakening their scientific evidence.
- Navigation uses the native bilateral 10 µm Allen grid and one ML/AP/DV
  cursor. The approved pre-launch reset does not require old URL migrations in
  the completed runtime.
- Do not hand-edit generated anatomy manifests or packs. Parent regeneration
  requires the pinned source annotation/LUT, a clean generator commit, and the
  topology/coverage/error gates in
  `docs/rendering/ANATOMY_PACK_CONTRACT.md` and
  `docs/rendering/BILATERAL_ANATOMY_PACKS.md`; sparse display derivation must
  satisfy `docs/rendering/ANATOMY_PACK_V3_CONTRACT.md`.
- Legacy runtime compatibility and host access are not requirements. Exact
  pinned Top/Swanson source bytes may be deterministic build inputs for static
  projection assets, with distinct provenance and no invented affine.
- Volume storage layout (`chunks3d` versus `orthogonal_slice_packs`) is independent of scientific grid geometry. Choose the production layout from measured real-data browser benchmarks, not convenience.
- Coordinate compatibility is established only by an exact
  `reference_space_id`. Grid identity (shape, axis semantics, affine,
  index-center convention, and voxel-edge extent) and asset/pack identity are
  separate; different 10 µm and 50 µm grids may share a reference space, while
  matching pack IDs or shapes never prove compatibility.
- Verify immutable fetched bytes against declared served-byte size and SHA-256
  before persistent cache admission or decoding. A bad cached entry is evicted
  and may be retried cleanly; decoded-cache identity includes the resource hash
  and decoding contract, not a feature-relative path alone.
- Top and Swanson are affine-free static SVG fragments with the pinned legacy
  view box `60 20 340 300`. They must not reuse a slice resource descriptor
  that requires an index or `world_coordinate_um`.
- The optional 3-D lab may progress independently of the 2-D cutover, but it
  must consume the shared coordinate, regional-presentation, and workspace-view
  contracts rather than fork application state or add another 2-D renderer
  facade. Build web mesh packs from pinned inputs with deterministic provenance,
  integrity, coverage, LOD, and visual-quality gates; do not serve the raw
  monolithic source GLB as the production contract.
- For Q12, the repository owner has approved local canonical-annotation
  regeneration of the complete bilateral source identities for Allen 927,
  526322264, and 599626923. This does not authorize any other regenerated ID,
  smoothing/manual repair, publication, final LOD selection, removal of the
  experimental label, or donor retirement. Follow the exact implementation,
  evidence, stop conditions, and owner review checklist in
  `docs/rendering/3D_PROMOTION_REVIEW.md`; keep generated evidence under
  ignored `artifacts/`.

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

Install `uv`, Node 22, and `just`, then run `just bootstrap` once in a fresh
checkout. All repository Python environments and commands are owned by the
committed `uv.lock` files; do not install project dependencies into system
Python or invoke system `pip`. Then use:

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
