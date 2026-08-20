# Work model

The initial parallel exploration phase is complete. All accepted data/schema, publishing, UX, frontend, rendering, and integration work is consolidated on `main`.

## Single development line

`main` is the sole active product branch and the source of truth for code, schema, documentation, CI, and launch readiness.

Do not create persistent `work/*` branches. Do not resume the historical data/frontend/rendering/UX/publishing branches. A short-lived branch is justified only for a genuinely isolated experiment that cannot safely be developed sequentially on `main`; it must be integrated or discarded immediately after the experiment.

Routine project work, including data builder changes, viewer implementation, rendering integration, publishing fixes, and documentation, proceeds sequentially on `main` with CI as the integration gate. Pull requests are not required for this project workflow.

Accepted cross-cutting decisions continue to be recorded in `docs/DECISIONS.md`.

## Ownership by subsystem

The repository still has clear subsystem boundaries even though they no longer map to branches:

- `schema/`, `builder/`, fixtures, provenance and scientific metadata: data/schema/reproducibility;
- `web/`: browser state, UX, regional and volume rendering, charts and interactions;
- `publishing/`: capability-authenticated mutation service and client; public reads remain static;
- `docs/`: architecture, decisions, source policy, deployment and launch notes;
- CI and release integration: repository-wide.

Shared contracts are changed once on `main`, with their producers and consumers updated in the same integration sequence whenever practical.

## Current integrated state

The first schema-v0.1 regional vertical slice is implemented end-to-end using the deterministic golden fixture:

regional feature -> typed binary artifacts -> browser -> linked curated slices -> feature coloring -> region selection -> URL state -> histogram/comparison.

The browser and publishing service now share the same static catalog contract. The `ephys_atlas_channels` builder has an explicit deterministic regional recipe; production raw/denoised and population choices remain scientific sign-off parameters rather than hidden defaults.

## Next launch-critical work

1. Exercise the channel builder on a real pinned/current `ea_active` source snapshot when the scientific-data environment is available, then point a staging browser catalog at that immutable release.
2. Complete the volume vertical slice. Benchmark realistic physical layouts before freezing the launch transport; the schema permits the current 3-D chunks and a browser-oriented orthogonal slice-pack layout.
3. Complete remaining viewer controls, downloads/share state, local import polish, error/loading states and release selection around the real data path.
4. Keep remote publishing operational but do not let deployment-specific publishing work block viewer launch.
5. Treat 3-D as lower priority than regional and volume launch completeness unless it can be added without delaying them.

## Coordination rules

- `main` must remain buildable and testable; fix a red integration gate before starting the next independent feature.
- Do not silently redefine scientific semantics, coordinate systems, region identifiers, source vintages, or physical formats.
- Prefer code, tests, fixtures and measured browser/data evidence over prose-only proposals.
- Feature catalogs remain data-driven; do not hard-code the mutable upstream feature list.
- Published releases are immutable; mutable aliases resolve to immutable release IDs outside release contents.
- Display calibration for curated SVG anatomy is presentation metadata, never a canonical scientific coordinate transform.
