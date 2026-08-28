# Production volume implementation handoff

Status: runbook for exact W26 acquisition and Q5 continuation.

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
- a schema-v1 release builder that verifies the source snapshot before decode,
  discovers NPZ features dynamically, preserves float16 values, supports both
  physical layouts, and refuses to infer reference space, grid, affine,
  outside/missing semantics, or layout parameters.
- the snapshot recipe consumes the committed D043 JSON, rejects any mismatch in
  W26 source identity, grid, affine, sentinel, validity policy, or audit extent,
  and no longer accepts manually transcribed affine values from the CLI;
- selected features are extracted together in one bounded-memory NPZ
  decompression pass, with deterministic multi-feature and corruption coverage;
- complete ignored 41-feature depth-4/depth-8 candidates, production-style
  local Chromium acceptance, and simulated worst-feature network evidence.

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

## Scientific geometry: Q4 resolved for W26

D043 records the repository/scientific owner's 2026-08-24 authoritative
selection of `ml-forward_ap-forward_dv-forward` with integer indices at voxel
centers. Use `reference_space_id=allen-ccf-2017`,
`grid_id=allen-ccf-2017-50um`, and this row-major affine for the exact pinned
W26 object:

```text
[ 50,   0,   0, -5739 ]
[  0, -50,   0,  5400 ]
[  0,   0, -50,   332 ]
[  0,   0,   0,     1 ]
```

Use the officially documented outside value `0.0` and explicit missing policy
`nonfinite`. A complete streaming audit found no NaNs or infinities among all
394,859,520 source values. The machine-readable confirmation and pinned review
evidence are in `docs/data/VOLUME_2026_W26_GEOMETRY_SELECTION.json`. Do not
generalize this decision to another vintage, resolution, or source hash.

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
3. Retain D043 and its machine-readable selection as the exact W26 geometry
   authority; do not reuse it for a different source object.
4. Retain the completed fail-closed real-release builder and its deterministic
   synthetic tests.
5. Retain the committed full-candidate graph and simulated-profile evidence;
   repeat it only when the source, builder, browser, or transport changes.
6. After Q5 is resolved at the eventual origin, invoke `build-volumes` with the approved transform and
   transport parameters to build a new immutable schema-v1
   release for all 41 discovered
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
- the downloaded source or requested geometry does not match the exact D043
  authority;
- a requested production origin or credential is unspecified;
- a change would reintroduce 3-D volume rendering or annotation-derived Allen
  meshes.

The clean test suite must remain usable without private data even when one of
these real-release steps is blocked.
