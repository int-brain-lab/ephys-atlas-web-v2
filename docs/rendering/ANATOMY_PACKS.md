# Generated anatomy packs

Status: superseded v1 build record; retained as historical evidence.

`tools/anatomy_pack/build.py` converts the pinned 25 µm Allen CCFv3
annotation into immutable, left-hemisphere SVG slice packs conforming to
`schema/anatomy-pack-v1/`. The output is generated data and is not a manual
redrawing of the atlas.

## Production command

Run from a clean tracked worktree so the manifest can identify an exact
generator commit:

```bash
just bootstrap-anatomy
uv run --project builder --extra anatomy --extra scientific --extra test --locked \
  python -m tools.anatomy_pack.build \
  --tolerance-um 15 \
  --pack-depth 16 \
  --created-at 2026-08-20T00:00:00Z
```

The default output is ignored at `artifacts/anatomy-pack-v1/`. Existing output
is never overwritten. Gzip resources are deterministic (`mtime=0`) and carry
their compressed byte size, uncompressed byte size, and SHA-256 in
`manifest.json`. `--pack-depth 32` may be supplied in addition to generate a
second measured layout from the same slice geometry.

## Scientific geometry

The generator takes the physical left half of the annotation, ML source
indices `0..229` inclusive. Index 229 has centre coordinate -14 µm and is
therefore left of Bregma even though the source lateralization LUT assigns its
voxels to positive rows; every emitted Allen, Beryl, and Cosmos ID is explicitly
folded with `-abs(id)`.

Background row zero is omitted. Raster cells are polygons whose centres have
integer plane coordinates and whose edges have half-integer coordinates. The
complete boundary graph is globally noded before polygonization, including at
T and checkerboard junctions. All projection affines consume
`[slice_index, u, v, 1]` and produce `[ml, ap, dv, 1]` in µm:

- coronal `(u,v) = (ML,DV)`;
- sagittal `(u,v) = (AP,DV)`, with AP displayed posterior-to-anterior;
- horizontal `(u,v) = (ML,AP)`.

The manifest includes inverse transforms and two round-trip synchronization
sentinels. These transforms, rather than display-calibration offsets, are the
scientific source for crosshairs and projection synchronization.

## Acceptance gates

Shapely 2.1 / GEOS `coverage_simplify` operates on the full labelled slice so a
shared interface is simplified once. Every emitted slice must preserve:

- a valid coverage and valid individual geometries;
- all components, holes, and edge adjacencies;
- all non-background atlas rows;
- IoU of at least 0.98 for every source region with area at least 0.01 mm²;
- a symmetric boundary-error upper bound no larger than the configured gate.

Both exact and candidate boundaries are sampled at intervals no larger than
0.25 voxel. Because distance to a closed boundary is 1-Lipschitz, the reported
maximum upper bound adds half that interval (3.125 µm at 25 µm resolution) to
the observed maximum. The manifest also records worst-slice median and p95
sample errors; their names deliberately avoid presenting them as pooled-corpus
percentiles.

The accepted complete-corpus build uses 15 µm tolerance. Its immutable ID is
`allen-ccfv3-25um-left-t15-4a565958b938`; its manifest SHA-256 is
`7ef9179d3d219aa96fe0a0cdebcda9a4329d6195be118e1701c05480d18a82c5`.
All 1,078 slices passed with minimum eligible-region IoU 1.0, zero source-voxel
coverage or topology failures, and a 3.125 µm conservative boundary bound.
The 68 depth-16 gzip packs occupy 18,768,176 bytes. A 20 µm candidate failed
the IoU gate and is not a release option.

The committed browser copy lives under the pack-ID-qualified path
`web/public/atlas/anatomy/allen-ccfv3-25um-left-t15-4a565958b938/`.
Gzip files are opaque application resources: hosts must not attach HTTP
`Content-Encoding`, because the client verifies the compressed bytes before
explicit decompression.
