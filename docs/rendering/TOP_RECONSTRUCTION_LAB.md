# Top reconstruction lab

Status: **implemented as local review evidence; no production asset selected**.

## Purpose and boundary

The lab reconstructs an affine-free dorsal Top projection from the pinned Allen
CCFv3 25 µm annotation and compares it with the surviving pinned legacy Top.
It exists to determine whether topology-preserving regenerated geometry is a
better visual source than the legacy simplified paths. It does not modify the
active projection pack, resolve Q13, invent a Top affine, or publish an asset.

The legacy Top remains the fallback throughout the investigation.

## Reconstruction recipe

The input annotation has canonical `(AP, ML, DV)` array axes. DV world
coordinates decrease as the array index increases, so the dorsal visible label
for each AP×ML column is the first non-background value encountered while
scanning DV indices from zero upward. The builder maps those source Allen IDs
to physical bilateral `BrainRegions` rows and emits direct signed Allen, Beryl,
and Cosmos identities.

All region geometry is polygonized from the complete two-dimensional label
plane at once. Candidate simplification uses GEOS coverage simplification with
the outer boundary fixed; regions are never simplified independently. The
existing deterministic coverage, geometry-validity, component/hole,
adjacency, source-voxel, IoU, and boundary-error measurements remain attached
to every candidate, including rejected candidates.

The report fits each geometry's bounds independently with the same 3% padding
for visual comparison. This is display-only silhouette registration and makes
no scientific affine or coordinate claim. Original source view boxes remain in
the embedded evidence.

## Guided review

The default workflow asks one question at a time. During screening, legacy is
always option A on the left and one reconstruction is option B on the right.
The reviewer answers `A is better`, `No meaningful difference`, or `B is
better`. Answers can be corrected.

Every reconstruction that beats legacy enters an adaptive pairwise finalist
round. A no-difference finalist answer conservatively retains the lower
tolerance. The final result is either retain legacy, shortlist an eligible
candidate, or investigate a visually preferred rejected candidate without
promotion. The downloadable decision record has no production effect.

Advanced evidence provides synchronized mouse-wheel zoom, drag pan,
side-by-side, color-overlay, boundary-difference, individual variant views,
region hover, metrics, failures, source hashes, and inventory differences.

## Current real-input evidence

The first local build used:

- annotation: 4,035,363 bytes, SHA-256
  `c620cbcc562183e4dcd40250d440130501781f74b41de35b1c1bdabace290c42`;
- legacy Top: 40,173 bytes, SHA-256
  `4dc788df3da667c8dde5a9f1b0abc258715a916cb8609542bdd849f793815c30`;
- pinned `iblatlas` commit
  `52083adf44825d0622a503705e095699a5957587`.

The reconstructed surface contains 116 signed Allen paths. It contains every
legacy signed Allen identity plus bilateral `VISC1` (`-897`, `897`); no legacy
identity is missing. Exact geometry passes by definition. The 12.5 µm
whole-coverage candidate is eligible and changes no sampled source voxel
centre. The 25 and 37.5 µm candidates are retained as rejected diagnostics
because they change source voxel labels and fail provisional IoU/error gates.

These measurements establish a credible reconstruction and expose the one
inventory difference. Human visual review must decide whether to shortlist
anything.

## Reproduction

Inputs remain ignored/private local files. Build with:

```sh
just top-reconstruction-lab \
  data/releases/top-source-investigation/annotation_25.nrrd \
  data/releases/top-review-input/slices_top.json
```

The output is a self-contained ignored file at
`artifacts/top-reconstruction-lab/index.html`. Serve that directory with any
local static server. Never copy it into `web/public/`.
