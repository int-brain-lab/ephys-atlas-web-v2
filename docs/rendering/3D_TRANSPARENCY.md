# 3-D transparency

Status: implemented in the shared retained viewport, 2026-09-07. Applies to
both D042 and the D070-approved native anatomy (including the review lab); no pack bytes, source triangles,
movement assignments, signed presentation, or picking semantics change.

Selected regions remain opaque. Visible unselected context retains its existing
28/255 opacity, now rendered with weighted blended order-independent transparency
instead of sorted alpha blending with depth writes. With no translucent context,
the renderer uses one opaque pass and does not allocate OIT targets until needed.

## Pipeline and lifecycle

1. Render opaque fragments to a linear RGBA16F target plus depth texture.
2. Accumulate weighted, premultiplied translucent colour and alpha into RGBA16F
   with additive blending. Reject fragments behind opaque depth; do not write
   translucent depth.
3. Multiply transparency coverage into an RGBA8 revealage target, again rejecting
   fragments behind opaque depth. Two separate transparent passes avoid requiring
   per-attachment blending extensions.
4. Composite the weighted average and revealage over opaque colour, converting
   linear colour to display sRGB exactly once.

The bounded weight uses linear view depth relative to the camera far plane.
The method follows [McGuire and Bavoil's weighted blended OIT](https://jcgt.org/published/0002/02/09/).
It removes draw-order dependence, but overlapping colour/depth mixing is an
approximation, not depth peeling. It does not repair source normal discontinuities,
coplanar opaque surfaces, or anatomical geometry. Offscreen targets are single-sample;
transparent-view edge antialiasing is not equivalent to the opaque canvas MSAA path.

Targets resize with the capped-DPR drawing buffer, are reused across interaction
and LOD changes, recover through Three.js context restoration, and are disposed
with the viewport. Target storage is approximately 24 bytes per drawing-buffer
pixel (excluding driver overhead). Geometry buffers remain retained across passes.
The WebGL2 path requires `EXT_color_buffer_float`; missing support raises an
explicit 3-D error, with clearing selection restoring opaque rendering. There is
no silent fallback to order-dependent blending. The existing 2-D failure boundary
remains unchanged.

## Surface lighting

The shared custom shader uses a view-space directional key plus a soft fill
and ambient floor. On owner request, the 2026-09-07 lighting refinement replaces
the nearly flat absolute-normal shading with stronger directional contrast.
Back-face normals are flipped for double-sided rendering. RGB is multiplied
by the light intensity without white specular highlights; region hue, lookup
values, opacity, source normals/triangles and CPU picking remain unchanged.
Unused Three.js scene lights were removed because this shader never read them.
This is surface shading, not shadow mapping or ambient occlusion.

## Evidence

`web/test/browser/weighted-transparency.spec.ts` checks reversed triangle and
chunk order (pixel differences at most two byte levels), opaque occlusion,
contribution of transparent foreground/background, signed picking, opaque/OIT
switching without geometry uploads, resize, context recovery, destruction, and
unsupported-capability recovery. It also requires a visible brightness
difference between lit and shaded normals while retaining the OIT path.
Existing native original-side/explode and
integrated scene lifecycle tests exercise the same renderer.

`npx playwright test --config playwright.native-review.config.ts` from `web/`
checks the real native/D042 packs, all 12 review cases, and rotation/explode with
transparent context. A local 1152 × 866 drawing-buffer run on Chromium's **SwiftShader
software Vulkan backend** measured median 270 ms / p95 313 ms interaction-to-GPU
completion (20 samples after four warmups). These are software-rendering diagnostics,
not desktop GPU frame-rate acceptance. Hardware Chromium, Firefox, and Safari
performance/visual evidence is not claimed. D070 records owner acceptance and
waives additional Firefox/Safari review for this 3-D selection. Local screenshot inspection confirmed
composited anatomy without changing the source geometry.
