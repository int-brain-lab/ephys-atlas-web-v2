# SVG slice reuse and calibration

Status: **legacy fallback only**. D023 replaces these hand-registered assets in
the default v2 runtime with a generated pack whose per-projection affines are
scientific contract data. This note remains the calibration record required to
re-enable the modular legacy provider.

## What is being reused

V1's regional slices are curated SVG path sets produced from Allen meshes and then simplified manually/tool-by-tool. The historical processing notes in `int-brain-lab/ephys-atlas-web/tools/process.py` describe MATLAB slice generation, RDP simplification, Inkscape simplification, SVGO cleanup, and later manual processing of the generated slice JSON. This work should be treated as a display asset, not regenerated casually for v2.

V1 loads one JSON object per view (`slices_coronal.json`, `slices_sagittal.json`, `slices_horizontal.json`, plus top/Swanson), then swaps the selected SVG fragment into a `<g>`. V2 should preserve the fragment geometry and mapping classes while changing the delivery/cache strategy.

## Two coordinate systems that must remain separate

### Scientific Allen coordinates

The regional SVG sequence is indexed at 10 um. V1's coordinate labels imply:

| Slice axis | Count | index 0 | step |
| --- | ---: | ---: | ---: |
| coronal / AP | 1320 | +5400 um | -10 um |
| sagittal / ML | 1140 | -5739 um | +10 um |
| horizontal / DV | 800 | +332 um | -10 um |

The historical `2026_W12` ephys-atlas volume used the same origins at 25 um
with axis counts 528, 456, and 320 respectively. That mapping is historical
evidence only. It must not be applied to the current `2026_W26` 50 um object
without the authoritative affine/axis resolution tracked in Q4.

### Curated SVG display coordinates

V1 positioned cross-view guides with six independently tuned pixel formulas and two arbitrary edge clamps. V2 instead converts every slice index to an Allen coordinate first, then registers that coordinate against one fixed display envelope and orientation per curated projection. The exact v1 view boxes are those envelopes:

- coronal: `58 50 356 250`
- sagittal: `56 66 358 217`
- horizontal: `122 42 230 266`

Within a projection, its two visible Allen axes map linearly across the corresponding view-box dimensions in the orientation of the curated artwork. This makes the guide intersection one deterministic AP/ML/DV point and removes pair-specific drift. It also gives exact, tested behavior at the CCF grid endpoints instead of dividing by a slice count and clamping away the edges.

This is the strongest registration the legacy assets support: their bare path fragments contain no affine or physical bounds. The view box must never be used to infer Allen coordinates or volume voxels. A future anatomy asset should ship an explicit world-to-view transform if sub-pixel anatomical registration is required.

## Renderer boundary

`SvgSliceRenderer` receives an immutable render frame: selected slice fragment, mapping, colors, selection/highlight, view box, and precomputed guide positions. It owns DOM painting and pointer hit extraction only. It does not own application state, feature loading, slice indices, URL state, or region selection semantics.

The historical v1 class convention (`beryl_region_123`, `allen_region_123`,
`cosmos_region_123`) is normalized by the projection-pack builder to direct
`data-allen-id`, `data-beryl-id`, and `data-cosmos-id` attributes. The current
renderer accepts only those stable attributes; it has no legacy class-index
or runtime crosswalk path.

## Asset delivery recommendation

Do not preload every SVG slice at startup as v1 does. Preserve the curated fragments but publish them in an immutable release with an index that supports lazy retrieval and a small neighbor cache. The exact packing (individual compressed slices versus indexed packs) belongs to the data/schema contract; the renderer only requires `SvgSliceAssetSource.loadSlice(axis, index)`.

SVG fragments are trusted static atlas assets. Local/user datasets must not be allowed to inject arbitrary SVG markup through this path without sanitisation.
