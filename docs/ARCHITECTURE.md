# Architecture

## Direction

Canonical scientific data should be transformed by deterministic Python tooling into versioned immutable web-dataset releases consumed by the browser from static/object storage where possible.

    canonical scientific data
        -> Python builder/validator
        -> immutable dataset release
        -> object storage / CDN
        -> browser app

A publishing API may manage creation, validation, credentials, and publication, but the normal public read path should remain static where practical.

## Dataset model

A dataset contains features. A feature may expose one or more independent representations:

- `regional`
- `volume`
- `points` (future-facing; not launch-critical)

Do not force all representations into one physical format.

## Frontend

- TypeScript
- Vite
- plain DOM / lightweight native components; no React or other frontend framework by default
- semantic HTML/CSS
- explicit typed application state and actions
- Web Workers for expensive decoding/transforms
- IndexedDB and/or OPFS for persistent local datasets/cache
- Playwright for browser-level tests

## Rendering

Reuse the existing curated SVG slice assets where useful. Their alignment is manually/visually calibrated rather than scientifically exact, so treat them as display assets with explicit transforms rather than a canonical coordinate representation.

3D is renderer-agnostic. Evaluate Datoviz, custom WebGPU, Three.js/WebGPU/WebGL, or another suitable browser renderer. Do not make a 3D replacement a dependency of the first end-to-end vertical slice.

## Publishing

The existing system uses capability-style bearer tokens. V2 should preserve the simplicity of capability-based publishing while improving validation, credential hygiene, and release semantics. Avoid building a full identity platform during the four-week launch window.
