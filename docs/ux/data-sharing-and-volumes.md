# UX: volumes, sharing, provenance, and local data

Status: accepted

## UX-018 — Representation selection

Features may have one or more representations. Dataset/feature selection defines the scientific quantity; representation selection is contextual.

- Do not duplicate a feature merely because it has regional and volume forms.
- Show a compact representation selector only when more than one representation is available, e.g. `Regional | Volume`.
- With a single representation, omit the control.

## UX-019 — Volume display in orthogonal slices

- Volume data use the same linked coronal, sagittal, and horizontal workspace.
- Default rendering shows the volume prominently with thin atlas boundaries overlaid.
- Atlas outline visibility and, where useful, volume opacity are adjustable.
- Hover reports at least coordinates, voxel value, unit, and atlas region under the pointer.
- The three slices share a common 3D cursor/crosshair state.

## UX-020 — Volume-specific controls

Use the shared color/range controls plus a small contextual `Volume` section.

- Keep only controls justified by the active dataset and renderer.
- Likely controls include atlas outlines, opacity, and interpolation mode where scientifically meaningful.
- Threshold/mask controls are shown only when defined or useful for the dataset.
- Avoid exposing generic advanced volume-rendering parameters merely because the renderer supports them.

## UX-021 — Downloads

Use one `Download` entry point with explicit scopes.

- `Current feature`
- `Selected regions / current selection`
- `Complete dataset release`

For large downloads, show format and estimated size where available. Downloads refer to scientific data rather than the current display colors unless an action is explicitly named as a visual/image export.

## UX-022 — Shareable state

Use the URL as the canonical share mechanism rather than server-side saved sessions for launch.

Shareable state should include scientifically relevant exploration state when practical:

- resolved immutable release
- dataset and feature
- representation
- mapping/statistic
- color range, colormap, and transform
- coordinates/slice positions
- active secondary view
- selected regions
- comparison/focus state when reasonable

Do not encode purely ephemeral state such as hover. Links should resolve deterministic immutable releases even if the user entered through an alias such as `latest`.

## UX-023 — Provenance and metadata

Provenance is always reachable but does not occupy permanent workspace.

- Provide a contextual `Info` drawer/panel from dataset and feature context.
- Compact normal-state context should expose unit, short description, and release/version where possible.
- Expanded metadata includes immutable release, description, units, source/authors, generation method, citations/DOI, schema/version information, timestamps, and relevant external links when available.

## UX-024 — Local dataset import

Expose `Import local dataset…` from the dataset picker.

- Validate the same frontend data contract used by published datasets.
- Before opening, summarize features, available representations, mappings, size, errors, and warnings.
- Once loaded, a local dataset behaves like a normal dataset in the workspace.
- Display a persistent `Local` badge so users cannot confuse it with a published release.
- Local data may be persisted in browser storage but must never be uploaded implicitly.
- Shared URLs that depend on local data must clearly explain that the data themselves are not embedded or transferred.
