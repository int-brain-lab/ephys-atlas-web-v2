# Frontend

The browser application is TypeScript + Vite with plain DOM components. It
loads schema-v0.1 published or IndexedDB-backed local releases and keeps
regional SVG and volume Canvas implementations below the shared
`SliceRenderer` boundary.

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
- `src/data/` contains schema-v0.1 validation, materialization, HTTP/local
  resource adapters, and caches.
- `src/rendering/` contains the generated anatomy, regional SVG, volume, and
  future-facing 3-D implementations below `SliceRenderer`.
- `src/ui/` contains the responsive plain-DOM shell and regional controllers.
- `public/atlas/` contains immutable generated anatomy packs and pinned ontology
  metadata.
- `public/fixtures/` mirrors the canonical synthetic fixtures required by Vite.
- `test/unit/` and `test/browser/` contain deterministic unit and Playwright
  coverage; dedicated real-release and benchmark configs remain separate from
  the default gate.

The default anatomy display is sparse `anatomy-pack-v3`, derived byte-for-byte
from the validated bilateral 10 µm v2 parent. Scientific cursor, URL, affine,
and guide state stays on the parent grid. `fixtures/golden-v0.3` and its
browser-served copy are synthetic and must never be presented as scientific
data.

Current implementation status and next work are recorded in
`docs/INTEGRATION_STATUS.md` and `docs/IMPLEMENTATION_PLAN.md`.
