# Frontend

TypeScript + Vite frontend foundation for IBL Ephys Atlas Web v2. It deliberately uses the browser platform directly rather than a UI framework.

## Development

```bash
npm install
npm run dev
npm test
```

`npm test` runs type checking and fast unit tests. Browser tests are kept separate so the default loop does not download or launch browser binaries:

```bash
npx playwright install chromium   # once per machine if needed
npm run test:browser
```

`npm run build` type-checks and creates the Vite production bundle.

## Structure

- `src/domain/`: framework-independent state, actions, reducer, store, and domain types
- `src/url/`: versioned human-readable URL state
- `src/data/`: provisional data contract, HTTP/local sources, cache, repository, prefetch
- `src/rendering/`: renderer-facing interfaces only; no atlas renderer is implemented here
- `src/ui/`: small explicit DOM shell
- `public/fixtures/`: tiny synthetic provisional fixture used until the shared golden fixture lands
- `test/unit/`: Node unit tests
- `test/browser/`: Playwright browser tests

The provisional fixture is not scientific data and must not be used for validation or interpretation.
