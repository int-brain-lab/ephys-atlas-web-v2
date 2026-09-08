# Landing imagery

These are unretouched screenshots captured from the actual local viewer on
Linux, using the reviewed `data/development-bundle-v5.json` bundle. They are
illustrations of implemented browsing behavior, not published scientific
releases or a decision about the production default.

The captures show channels `2026_W32-d050-q14-v1`, feature `rms_ap.denoised`,
Allen regional presentation, and the D070 native anatomy pack
`ibl-native-d070-b5f5abc7d0bb3575`. They do not use synthetic golden fixtures.
The page names the development preview. `capture.json` records served capture
hashes and exact viewer state URLs. The original data and geometry retain their
existing source provenance and licenses.

To recapture with the validated real `just dev` server running:

```sh
node web/scripts/capture-landing.mjs http://127.0.0.1:5173/app/
```

`anatomy.jpg` is a screenshot of the 3-D image area, excluding overlaid controls.
`slices.jpg` is the linked orthogonal workspace. `viewer.jpg` retains the full
interface as review evidence; only the first two images are page assets.
No image generator, retouching, interpolated scientific data, or renderer
modification is involved. CSS scales/crops the display responsively.
