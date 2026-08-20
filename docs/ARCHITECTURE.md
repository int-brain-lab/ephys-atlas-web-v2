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

`SliceRenderer` is the application rendering boundary. The active regional
renderer uses immutable generated SVG anatomy from the exact bilateral Allen
CCFv3 10 µm pack. Its declared affines synchronize all projections through one
ML/AP/DV cursor; curated v1 SVGs are pinned historical fallback assets only.

SVG remains the regional interaction representation because stable path IDs
support delegated picking, selection, coloring, and linked guides. Runtime
work is bounded with lazy source packs, byte-bounded decoded caching, an
eight-layer retained parsed-DOM cache per view, and a latest-only scheduler with
one geometry request in flight. Verified pack bytes are transferred to a module
worker for decompression, JSON parsing, and structural validation. Interaction
may stride over several slices while exact native indices remain addressable in
state and URLs.

The indexed binary SVG pack is an experiment below this boundary, not a second
scientific geometry model. See
`docs/rendering/INDEXED_SVG_PACK_EXPERIMENT.md`.

3D is renderer-agnostic. Evaluate Datoviz, custom WebGPU, Three.js/WebGPU/WebGL, or another suitable browser renderer. Do not make a 3D replacement a dependency of the first end-to-end vertical slice.

## Publishing

The existing system uses capability-style bearer tokens. V2 should preserve the simplicity of capability-based publishing while improving validation, credential hygiene, and release semantics. Avoid building a full identity platform during the four-week launch window.
