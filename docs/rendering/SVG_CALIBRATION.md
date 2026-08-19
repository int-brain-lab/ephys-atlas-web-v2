# SVG slice reuse and calibration

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

The launch ephys-atlas volume uses the same origins at 25 um with axis counts 528, 456, and 320 respectively. Therefore SVG slice index -> physical coordinate -> volume voxel index is explicit and deterministic. This transform is suitable for data lookup.

### Curated SVG display coordinates

The cross-view guide lines are visually tuned affine fits in SVG coordinates. V1 encoded them as numeric constants in `js/core/slice-helpers.js`; v2 records them in `slice-calibration.ts` as display-only calibration:

| source -> target | SVG dimension | center | span | edge clamp |
| --- | --- | ---: | ---: | ---: |
| sagittal -> coronal | x | 237 | 354 | 10 slices |
| sagittal -> horizontal | x | 237 | 230 | 10 slices |
| coronal -> sagittal | x | 236 | 354 | 10 slices |
| coronal -> horizontal | y | 174 | 264 | 10 slices |
| horizontal -> coronal | y | 174 | 242 | none |
| horizontal -> sagittal | y | 174 | 210 | none |

The exact v1 view boxes are also explicit:

- coronal: `58 50 356 250`
- sagittal: `56 66 358 217`
- horizontal: `122 42 230 266`

These fits are acceptable for guide placement and visual linkage. They must never be used to infer Allen coordinates or volume voxels.

## Renderer boundary

`SvgSliceRenderer` receives an immutable render frame: selected slice fragment, mapping, colors, selection/highlight, view box, and precomputed guide positions. It owns DOM painting and pointer hit extraction only. It does not own application state, feature loading, slice indices, URL state, or region selection semantics.

The current v1 class convention (`beryl_region_123`, `allen_region_123`, `cosmos_region_123`) is retained by the renderer adapter so the curated assets can be reused without rewriting their paths.

## Asset delivery recommendation

Do not preload every SVG slice at startup as v1 does. Preserve the curated fragments but publish them in an immutable release with an index that supports lazy retrieval and a small neighbor cache. The exact packing (individual compressed slices versus indexed packs) belongs to the data/schema contract; the renderer only requires `SvgSliceAssetSource.loadSlice(axis, index)`.

SVG fragments are trusted static atlas assets. Local/user datasets must not be allowed to inject arbitrary SVG markup through this path without sanitisation.
