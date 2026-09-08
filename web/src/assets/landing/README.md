# Landing imagery

These are unretouched screenshots and a vector export from the actual local viewer on
Linux, using the reviewed `data/development-bundle-v5.json` bundle. They are
illustrations of implemented browsing behavior, not published scientific
releases or a decision about the production default.

The captures show channels `2026_W32-d050-q14-v1`, feature `rms_ap.denoised`,
Allen regional presentation, and the D070 native anatomy pack
`ibl-native-d070-b5f5abc7d0bb3575`. They do not use synthetic golden fixtures.
The visible caption identifies the feature and vintage; removing the development
label from the landing does not change the recorded local artifact maturity.
`capture.json` records served capture
hashes and exact viewer state URLs. The original data and geometry retain their
existing source provenance and licenses.

To recapture with the validated real `just dev` server running:

```sh
node web/scripts/capture-landing.mjs http://127.0.0.1:5173/app/
```

`anatomy.jpg` is a screenshot of the 3-D image area, excluding overlaid controls.
`slices.svg` exports the actual rendered regional layers and slice guides with
their unchanged path geometry, view boxes, colors and computed presentation.
It contains no scripts, embedded bitmaps or scientific data requests. Its
metadata records the three source planes, indices and world coordinates.
`slices.jpg` and `viewer.jpg` retain the workspace and full interface as review
evidence; only `anatomy.jpg` and `slices.svg` are page assets.
To update only the vector asset while preserving raster evidence, append
`--vector-only` to the capture command.
No image generator, retouching, interpolated scientific data, or renderer
modification is involved. CSS scales/crops the display responsively.

## Acknowledgement sources

The landing credits the International Brain Laboratory as requested by the
repository owner. Its anatomical reference acknowledgement links to the Allen
CCFv3 dataset and Wang et al. (2020), DOI `10.1016/j.cell.2020.04.007`.
The IBL supporter names follow the support section at <https://iblcore.org/>,
checked on 2026-09-08: Simons Foundation International, Simons Foundation,
Wellcome, and the National Institutes of Health. This acknowledges support for
IBL and does not assert a particular grant funded this website.
