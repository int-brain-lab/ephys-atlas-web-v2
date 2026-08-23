# W26 volume geometry review

This is a local, non-production visual review of the scientific geometry
candidates for the checksummed
`ea_active/2026_W26/brainwide_ephys_atlas_50um.npz` volume. It does not select
an affine, change browser configuration, build a release, or publish data.

## Inputs and constraints

The review uses:

- W26 volume SHA-256
  `1f7509fe9e368a90704173bdb5c385827b199a7d5fa4b0aaa8fec5aca5402253`;
- Allen 50 um annotation SHA-256
  `84e7cecea1b03af16e923c3639602b8324929f833425ba03582bf56f962ea0d4`;
- pinned `iblatlas` commit
  `52083adf44825d0622a503705e095699a5957587`.

The W26 `grid_shape` is `(228, 264, 160)`. The Allen scientific XYZ shape is
also `(228, 264, 160)`, where XYZ means ML, AP, DV. This exact, unequal-axis
shape match constrains the review to the eight possible forward/reverse
direction combinations. It excludes axis permutations, arbitrary translation,
and scaling. The page separately displays voxel-center and half-voxel-shifted
edge conventions; their discrete mask-overlap scores are necessarily equal.

## Generate and open the page

The private inputs stay outside Git. With the W26 source in its documented
local path, run:

```sh
just volume-geometry-review \
  /absolute/path/to/annotation_50.nrrd \
  84e7cecea1b03af16e923c3639602b8324929f833425ba03582bf56f962ea0d4
```

Open `artifacts/volume-geometry-review/index.html` locally. The generated page,
JSON report, extracted mask, screenshots, and reviewer exports are ignored by
Git. Generation fails if either source hash or the expected 50 um grid does not
match.

## Review procedure

1. Compare all eight candidates in coronal, sagittal, and horizontal views.
2. Move away from central slices and inspect asymmetric landmarks. Bilateral
   mask symmetry can make ML direction less conclusive than AP or DV.
3. Use overlay, difference, checkerboard, and single-mask displays. Treat the
   overlap ranking as supporting evidence, not scientific authority.
4. Compare the voxel-center and edge-shifted coordinate readouts. Mask shape
   alone cannot decide this convention.
5. Select a candidate only if the reviewer has authoritative knowledge of how
   the W26 array was constructed. Record that basis in the rationale field.
6. Export the selection JSON and return it for repository review. Exporting it
   does not resolve Q4 or modify production code.

The current real-data report ranks
`ml-forward_ap-forward_dv-forward` first by whole-mask overlap (Dice
`0.9940758117`, IoU `0.9882214021`). This is evidence, not a selected transform.
The close ML-reversed score illustrates why mask overlap alone cannot establish
handedness.

## Required follow-up after owner review

Before Q4 can be resolved, preserve the exported selection and its rationale,
verify it against authoritative generator/source documentation or an identified
scientific owner, and record the resulting decision in `docs/DECISIONS.md`.
Only then may the transform and complete outside/missing-value semantics be
encoded in a production volume release.
