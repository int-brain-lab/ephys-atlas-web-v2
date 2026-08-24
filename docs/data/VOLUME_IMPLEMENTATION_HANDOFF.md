# Production volume implementation handoff

Status: **active M2 continuation contract (2026-08-24)**.

This is the focused entry point for a fresh Codex session, including a clean
macOS checkout. The product renders a scalar ephys feature volume only as three
linked 2-D Canvas slices: coronal, sagittal, and horizontal. It does not render
the scalar volume as a 3-D mesh, point cloud, ray-cast volume, or isosurface.
The optional Allen GLB surface view is independent and fixed by D042.

## Already implemented

Do not rebuild these boundaries:

- one shared ML/AP/DV world cursor and three retained registered viewports;
- schema-v1 `chunks3d` and `orthogonal_slice_packs` transports;
- float16/float32 and optional explicit gzip decoding;
- affine-based world/voxel mapping with out-of-grid failure rather than clamp;
- Canvas2D nearest-neighbor scalar paint below registered anatomy outlines;
- valid/outside/missing inspection and transparency;
- URL-persisted opacity and outline visibility;
- verified immutable resources, consumer-safe cancellation, and bounded decoded
  caches;
- deterministic golden unit and Chromium browser coverage.

`ProjectionViewportFactory` remains the 2-D renderer boundary. Do not add a
volume-specific renderer facade or a 3-D volume renderer.

## Canonical W26 source

- dataset: `ephys_atlas_volumes`
- project: `ea_active`
- release/vintage: `2026_W26`
- resolution: `50 um`
- S3 object:
  `s3://ibl-brain-wide-map-private/aggregates/atlas/encoding_volumes/ea_active/2026_W26/brainwide_ephys_atlas_50um.npz`
- served/file bytes: `238,954,924`
- SHA-256:
  `1f7509fe9e368a90704173bdb5c385827b199a7d5fa4b0aaa8fec5aca5402253`
- array: `ephys_atlas_vol`, shape `(228, 264, 160, 41)`, dtype `float16`
- values: raw and unnormalized; optional means/stds are metadata only
- documented outside-brain value: `0.0`

Acquire it only through configured official ONE/IBL access:

```bash
just bootstrap-scientific
just data-pull-volume 2026_W26 50
sha256sum data/source/ephys_atlas_volumes/2026_W26/brainwide_ephys_atlas_50um.npz
just data-inspect-volume data/source/ephys_atlas_volumes/2026_W26/brainwide_ephys_atlas_50um.npz
```

On macOS, use `shasum -a 256` if `sha256sum` is unavailable. A different byte
count or hash is a hard stop. Credentials remain outside Git. Do not substitute
`latest`, W12, another resolution, or a copied synthetic fixture.

## Scientific blocker: Q4

Shape, resolution, C-order storage, and mask overlap do not establish the
scientific transform. Production still requires authoritative evidence for:

- which stored axis is ML, AP, and DV;
- direction/sign of each axis;
- index-center convention and origin;
- the complete `index_to_world_um` affine;
- any missing-value semantics distinct from documented outside-brain zero.

The ignored eight-candidate review in
`docs/data/VOLUME_GEOMETRY_REVIEW.md` ranks all-forward mask overlap first, but
that is evidence, not authority. A new agent should inspect the pinned producer
code/metadata and existing IBL atlas conventions for an explicit declaration.
If none exists, keep Q4 blocked and request one precise scientific-owner choice.
Never promote the best-overlap candidate implicitly.

Independent implementation and tests may use an explicit candidate transform
only in fixtures or candidate-labeled ignored artifacts.

## Transport follow-up: Q5

Current W26 evidence favors depth-four orthogonal slice packs:

- three requests for the linked center planes;
- `0.20–0.36 MiB` gzip across representative features;
- local Chromium cold p50 `14.6–15.5 ms`, p95 `29.5–40.0 ms`;
- cached navigation p50 `2.4–2.6 ms` with no requests.

Depth 8 roughly doubles center bytes and cold latency. Cubes require 36–136
objects and 1.35–4.56 MiB for the same center-plane union. Retain both schema
readers, but treat depth 4 as the production recommendation pending confirmation
with the intended immutable HTTP/cache headers and a realistic network profile.

## Ordered continuation

1. Bootstrap the clean checkout and run `just check` before product changes.
2. Acquire and checksum the exact W26 source above.
3. Audit authoritative producer/atlas code for Q4. Record citations, exact
   versions, and the conclusion in durable docs; do not infer.
4. While Q4 is blocked, verify that the real-release builder accepts an explicit
   affine and fails when it is absent. Add synthetic deterministic tests for any
   missing builder slice.
5. Re-run or extend representative depth-4/depth-8 real-volume evidence only
   where the existing reports leave a concrete gap.
6. After Q4 and Q5 are resolved, encode the approved transform and depth-four
   transport in a new immutable schema-v1 release ID for all 41 discovered
   features, preserving source identity and transformation provenance.
7. Validate the complete graph, then exercise feature switching, linked slice
   navigation, values, validity, caching, and failures through the production
   HTTP loader.
8. Run `just check`, production-origin header/hash checks, and the documented
   Chrome/Firefox/Safari release matrix.

Every coherent implementation slice updates
`docs/IMPLEMENTATION_PLAN.md`, `docs/OPEN_QUESTIONS.md`, and
`docs/INTEGRATION_STATUS.md` when reality changes and commits only a green
handoff.

## Fresh-session stop conditions

Stop rather than guess if:

- official W26 access is unavailable;
- downloaded bytes do not match the identity above;
- the producer does not authoritatively define Q4;
- a requested production origin or credential is unspecified;
- a change would reintroduce 3-D volume rendering or annotation-derived Allen
  meshes.

The clean test suite must remain usable without private data even when one of
these real-release steps is blocked.
