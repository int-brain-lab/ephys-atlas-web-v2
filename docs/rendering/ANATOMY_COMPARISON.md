# Anatomy SVG comparison lab

The comparison lab is a generated, fully offline HTML file for choosing a
bounded SVG simplification policy. It places three representations side by
side:

1. the SVG fragments curated for the legacy atlas website;
2. unsimplified contours extracted from a pinned Allen CCF annotation;
3. annotation-derived candidates simplified at several physical tolerances.

Only representations 2 and 3 share an authoritative voxel/world coordinate
system. The old SVG has no physical affine, so its overlay is deliberately
labelled **visual comparison only**. The report never presents old-versus-new
IoU or boundary distances as scientific measurements.

## Generate the report

```bash
just bootstrap-anatomy
just test-anatomy
just anatomy-compare
```

The first run downloads the three hash-pinned legacy bundles into the ignored
`artifacts/anatomy-cache/` directory. `iblatlas` obtains the selected Allen
annotation through its normal ONE cache. The default uses 25 µm voxels and
writes `artifacts/anatomy-compare.html`; open that one file directly in a
browser. It contains no runtime network dependencies.

Use `just anatomy-compare 10` only when the larger 10 µm annotation and the
longer benchmark are justified. Hashes of the source annotation and exact LUT
used for `atlas.label`, the pinned `iblatlas` commit, generator commit, axis
convention, and index-to-world affine are embedded in every report. Local
cache paths are not.

For a byte-reproducible report, call the builder directly with a fixed date:

```bash
uv run --project builder --extra anatomy --extra scientific --extra test --locked \
  python tools/anatomy_compare/build.py \
  --resolution 25 --created-at 2026-08-20T00:00:00Z --offline
```

## What is measured

The candidate sweep currently reports vertices, contour rings, directed
reference-vertex to candidate-boundary error in micrometres, and deterministic
raw, gzip, and Brotli sizes. It also measures the complete three-slice sample
pack for each projection, including JSON envelope overhead. The reference and
candidate are derived from the same annotation plane; browser antialiasing is
never used for scientific metrics.

The pilot uses deterministic Ramer-Douglas-Peucker simplification on each
closed region contour. It pads the label plane before contour extraction so a
region touching an image edge is closed along the true plane boundary.

## Production decision gate

Independent region-ring simplification can create tiny gaps, overlaps, or
mismatched shared borders even when every individual contour respects its
tolerance. Therefore `topology_validated` remains false for all pilot
candidates. Do not copy these paths into the viewer as the final anatomy pack.

The production generator should trace each interface between two labels,
split interfaces at junctions, simplify each shared chain exactly once, and
reuse that chain in reverse for the neighboring region. It must then validate:

- no uncovered or multiply covered pixels in the brain mask;
- identical shared boundaries and preserved adjacency;
- valid closed rings, holes, and disconnected components;
- no missing atlas IDs or components;
- full-corpus error percentiles and worst cases;
- deterministic 16- and 32-slice production-pack sizes, including the initial
  three-view transfer and neighbor prefetch.

`Shapely >=2.1` with GEOS `coverage_simplify`, `coverage_is_valid`, and
`coverage_invalid_edges` is the preferred implementation to evaluate first.
Its tolerance is not itself a maximum-distance guarantee, so the independent
physical error measurements remain mandatory.

Choose the loosest tolerance that passes those topology checks and the agreed
physical error budget. At 25 µm source resolution, 10–20 µm is the sensible
first review range; this is a review starting point, not an acceptance claim.

The emitted path suffix is a lateralized `BrainRegions` row index, matching the
legacy SVG convention; it is not an Allen atlas ID. The browser boundary must
continue to use the explicit crosswalk already implemented by v2.

## Relation to the legacy pipeline

The v1 repository used externally prepared contours, an RDP stage, Inkscape's
`SelectionSimplify` action, SVGO, metadata cleanup, and retained alternating
slices. That produced compact, visually effective assets, but the Inkscape
step is opaque and does not encode a physical error or topology guarantee. The
v2 lab preserves the useful visual comparison while replacing the acceptance
criterion with pinned inputs and measured geometry.
