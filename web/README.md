# Frontend

The browser application is TypeScript + Vite with plain DOM components. It
loads schema-v1 published or IndexedDB-backed local releases and keeps
regional SVG and volume Canvas layers inside a retained
`ProjectionViewport` boundary.

## Development

From the repository root, prefer the commands shared with CI:

```bash
just dev
just test-web
just test-browser
just check
```

From this directory, `npm test` runs typechecking plus unit and rendering tests;
`npm run test:browser` runs Playwright; and `npm run build` creates the
production bundle. Install dependencies and Chromium once with `just bootstrap`
in a fresh checkout.

## Structure

- `src/core/` contains renderer-, DOM-, and transport-independent spatial
  primitives.
- `src/domain/` contains typed application state, actions, and reducers.
- `src/application/` owns asynchronous dataset/release/feature workflows.
- `src/data/` contains schema-v1 validation, materialization, HTTP/local
  resource adapters, and caches.
- `src/rendering/` contains the schema-v1 projection-pack source, retained 2-D
  viewport, regional SVG and scalar Canvas layers, and future-facing 3-D
  contracts.
- `src/ui/` contains the responsive plain-DOM shell and regional controllers.
- `public/atlas/` contains the reproducible projection-pack development fixture,
  immutable anatomy build inputs, and pinned ontology metadata.
- `public/fixtures/` mirrors the canonical synthetic fixtures required by Vite.
- `test/unit/` and `test/browser/` contain deterministic unit and Playwright
  coverage; dedicated real-release and benchmark configs remain separate from
  the default gate.

The default registered display uses `atlas-projection-pack-v1`; its sparse
geometry is copied byte-for-byte from anatomy-pack-v3 and ultimately from the
validated bilateral 10 µm v2 parent. Scientific cursor, URL, affine, and guide
state stays on the parent grid. The pack's currently hidden Top/Swanson paths,
`fixtures/golden-v1`, and its browser copy are synthetic and must never be
presented as scientific data.

Current implementation status and next work are recorded in
`docs/INTEGRATION_STATUS.md` and `docs/IMPLEMENTATION_PLAN.md`.
