# IBL Core brand identity

The viewer uses the IBL Core identity defined by the **IBL Core Logo Manual,
version 1.0 (2026)** supplied by the project owner.

## Logo asset

The browser asset is the official colored-negative lockup:

- source: `https://iblcore.org/images/ibl-core-logo.svg`;
- repository path: `web/public/brand/ibl-core-logo.svg`;
- retrieved: 2026-08-21;
- SHA-256: `827b7329fbcec4e60e34670125b05dbfd0bb7614f165e1dd0020b8aaea60baec`;
- intrinsic dimensions: 240 × 209.

Keep the committed bytes unchanged. The manual prohibits distortion, effects,
recoloring, deletion, repositioning, or changing the proportions of logo
elements. Layout must preserve clear space around the complete lockup; do not
extract the circular device as an unapproved icon.

The colored-negative lockup is used on the viewer's dark header without a
separate background block. The product name remains adjacent HTML text so it
is legible and accessible at the viewer header's compact sizes. The complete
lockup links to the official `https://iblcore.org/` homepage in a new tab so
the viewer's scientific state remains in place.

## Institutional palette

The manual defines:

| Role | Value |
| --- | --- |
| Blue | `#004D89` |
| Cyan | `#009FD7` |
| Magenta | `#CE2C97` |

The frontend exposes these as brand tokens. Cyan is the primary interface
accent, blue is available for selective brand use, and magenta is reserved for
selective brand emphasis. Neutral surfaces, accessible text, focus treatment,
and scientific color encodings remain separate concerns.

In particular, do not replace Allen ontology colors, feature colormaps, or
categorical region-selection colors with the institutional palette. Those
colors communicate scientific or interaction identity under D022.

## Typography

The institutional typeface is Ubuntu Sans Condensed. The product title uses a
font stack that prefers it when available and falls back to a condensed/system
sans-serif. The logo's outlined lettering remains authoritative. A web font
must only be added later from an approved, locally served and licensed asset;
the viewer must not acquire a runtime font-CDN dependency solely for branding.
