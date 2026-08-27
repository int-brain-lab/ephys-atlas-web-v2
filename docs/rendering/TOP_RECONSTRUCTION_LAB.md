# Top reconstruction lab

Status: **implemented as local review evidence; no production asset selected**.

## Purpose and boundary

The lab reconstructs an affine-free dorsal Top projection from a hash-pinned
Allen CCFv3 source and compares it with the surviving pinned legacy Top. The
first lane uses the 25 µm annotation directly. A second, separate review lane
uses the canonical bilateral 10 µm `BrainRegions`-row LUT already validated by
the immutable anatomy-pack-v2 parent.
It exists to determine whether topology-preserving regenerated geometry is a
better visual source than the legacy simplified paths. It does not modify the
active projection pack, resolve Q13, invent a Top affine, or publish an asset.

The legacy Top remains the fallback throughout the investigation.

## Reconstruction recipe

The source labels have canonical `(AP, ML, DV)` array axes. DV world
coordinates decrease as the array index increases, so the dorsal visible label
for each AP×ML column is the first non-background value encountered while
scanning DV indices from zero upward. For the raw 25 µm annotation, the builder
maps those source Allen IDs to physical bilateral `BrainRegions` rows. The 10 µm
LUT already contains those bilateral rows and is read with memory mapping in
bounded AP blocks. Both routes emit direct signed Allen, Beryl, and Cosmos
identities.

The LUT route requires its SHA-256 and the committed immutable
anatomy-pack-v2 parent manifest. The builder verifies the actual LUT filename,
size, and hash against that manifest, verifies the parent resolution and pinned
annotation evidence, and requires the parent's topology, coverage, adjacency,
geometry, and sampled-voxel gates to be green. This prevents a convenient but
unproven array from becoming reconstruction evidence.

All region geometry is polygonized from the complete two-dimensional label
plane at once. Candidate simplification uses GEOS coverage simplification with
the outer boundary fixed; regions are never simplified independently. The
existing deterministic coverage, geometry-validity, component/hole,
adjacency, source-voxel, IoU, and boundary-error measurements remain attached
to every candidate, including rejected candidates.

The refinement lane uses a distinct shared-boundary Laplacian method. It merges
the complete boundary network, segments long runs at one-source-voxel spacing,
and moves every degree-two graph node toward its two neighbours. Multi-region
junctions and endpoints remain fixed. The moved network is polygonized once
and faces are assigned by maximum overlap with the reference coverage,
including an explicit background comparison. Shared interfaces therefore
cannot diverge independently. The same complete validation suite decides
eligibility; smoothing is not assumed safe merely because it is visually
continuous.

The report fits each geometry's bounds independently with the same 3% padding
for visual comparison. This is display-only silhouette registration and makes
no scientific affine or coordinate claim. Original source view boxes remain in
the embedded evidence.

## Guided review

The default workflow presents one comparison at a time. During screening,
legacy is always option A on the left and one reconstruction is option B on
the right. Each assessment records separate A/same/B judgements for boundary
continuity/holes, smoothing quality, and anatomical shape, plus an optional
free-text observation. The reviewer then chooses `Prefer A`, `No meaningful
difference`, `Needs another variant`, or `Prefer B`. Assessments and their
notes can be corrected.

Every reconstruction explicitly preferred over legacy enters an adaptive
pairwise finalist round. A no-difference finalist answer conservatively retains
the lower tolerance. If no candidate advances and any comparison identifies a
tradeoff requiring refinement, the lab recommends another variant instead of
forcing a false A/B winner. The final result is therefore retain legacy,
shortlist an eligible candidate, design another variant, or investigate a
visually preferred rejected candidate without promotion. The downloadable
decision record preserves every criterion and note and has no production
effect.

Advanced evidence provides synchronized mouse-wheel zoom, drag pan,
side-by-side, color-overlay, boundary-difference, individual variant views,
region hover, metrics, failures, source hashes, and inventory differences.

## Completed 25 µm review

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

The guided human review completed on 2026-08-27. For every exact or simplified
25 µm reconstruction, the reviewer found B better for boundary continuity and
A better for smoothing quality and anatomical shape. Every comparison was
therefore marked `needs-refinement`; no production candidate was selected and
the legacy Top remains the fallback.

The canonical 10 µm experiment was built on Fractal from clean generator
commit `de057da58a1b9e8aafe31ebdbba4cea3be9737b5`. The self-contained report has
SHA-256 `4d9035dd52838f31b2e42c17db114f4b588ea2fea0462bdb770925254bd87435`
and review ID
`9d8b2f63eebbda7e29efa0ae3298d5a71fc0e3e10abd7d2b8998c214726ed265`.
It contains exact plus coverage-safe 2.5, 5, and 7.5 µm candidates. Exact is
the reference; 2.5 and 5 µm produce identical eligible geometry with 38,839
vertices and exact sampled-voxel metrics; 7.5 µm is rejected with minimum IoU
`0.8938257357184078` and maximum boundary-error upper bound `11.25 µm`.
All candidates contain 116 signed Allen regions and differ from legacy only by
bilateral `VISC1`. The completed review repeated the 25 µm result for every
candidate: reconstruction was better for continuity, while legacy was better
for smoothing and anatomical shape. Every comparison requested refinement;
no candidate advanced and production remains unchanged.

The shared-boundary report applies 1, 2, 4, and 8 smoothing passes at a
conservative `0.125` per-pass strength to the 10 µm reconstruction. It was
built on Fractal from clean generator commit
`23050a2d36271fbe95ec8a9a385b495d1ce42342`, has SHA-256
`4a40cc0751de17286bba4655999340fbce41cf8cfd1fcb9b378b2fa6ad1eac06`,
and review ID
`0d2512c0870ac483696996a90efe4c45891b1a0348139f5712f21dcda7433482`.

Every candidate retains all 116 labels, 656 components, 206 holes, valid
coverage, adjacency, background topology, and zero uncovered,
multiply-covered, or wrong-label source voxel centres. Their maximum
boundary-error upper bounds are respectively 2.134, 2.908, 4.214, and 6.227 µm.
All four are nevertheless rejected by the provisional per-region IoU gate;
their minimum eligible-region IoUs are respectively 0.9595, 0.9264, 0.8762,
and 0.8135. They remain explicit visual diagnostics and cannot be promoted.
Human review must determine whether the visual direction merits a safer
follow-up method.

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

For the canonical 10 µm LUT lane:

```sh
just top-reconstruction-lab-lut \
  /path/to/annotation_10_lut_bilateral_v02.npy \
  f8c26e2eb972cbff5caa2101fda8b7c5c2a2bdb985e3faad6bf0e57defcc27cb \
  web/public/atlas/anatomy/allen-ccfv3-10um-bilateral-exact-599b5e0bbab1/manifest.json \
  data/releases/top-review-input/slices_top.json
```

This writes `artifacts/top-reconstruction-lab/10um/index.html`. Its expected
source LUT is 2,407,680,128 bytes; the parent manifest binds it to annotation
SHA-256 `a9e9654ef491f0af107dc0a61bd720dabe7f36e8f3e9239532bf3dbdc94ef24c`.

Build the smoothing-only refinement report with the same four input arguments:

```sh
just top-reconstruction-lab-smoothing \
  /path/to/annotation_10_lut_bilateral_v02.npy \
  f8c26e2eb972cbff5caa2101fda8b7c5c2a2bdb985e3faad6bf0e57defcc27cb \
  web/public/atlas/anatomy/allen-ccfv3-10um-bilateral-exact-599b5e0bbab1/manifest.json \
  data/releases/top-review-input/slices_top.json
```
