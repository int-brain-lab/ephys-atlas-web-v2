# Interior region navigation

D086 refines D085 Auto-slice. The target icon beside fold/unfold toggles automatic
movement; its tooltip explains the current state. The adjacent stacked icon
toggles Select multiple. Both have accessible pressed states. Disabled Auto-slice
persists as `autoslice=0` in URL-v4 state. Restored coordinates are never recentered
on load; enabling only affects subsequent selections.

## Source and algorithm

`tools/projection_pack/build_region_navigation.py` generates the schema-v1
`atlas-region-navigation-v1` companion in `web/src/assets/navigation/`. These
small imported assets are bundled even when production excludes Vite publicDir.
No projection-pack or release bytes are changed.

The source is the bilateral 10 µm native LUT pinned by the canonical parent:
`annotation_10_lut_bilateral_v02.npy`, SHA-256
`f8c26e2eb972cbff5caa2101fda8b7c5c2a2bdb985e3faad6bf0e57defcc27cb`.
The signed region catalog and exact projection manifest are also hash-bound in
provenance. Signed physical mappings follow the parent geometry’s mapping rule.

For each Allen/Beryl/Cosmos signed region, compute the mean of all occupied
native voxels. Select the closest occupied voxel whose crosshair remains in the
same mapped region on each snapped display plane. Require that region’s identity
in all three hash-verified SVG fragments. Native-to-display snapping uses the
lower index on ties; equal centroid distances resolve AP, ML, then DV. Holes,
concavities and disconnected regions therefore cannot place the native cursor
in another region. The point is a navigation aid, not a scientific measurement.

A lazy binary table per mapping stores little-endian int32 rows
`[signed atlas ID, AP index, ML index, DV index]`. Unavailable points use three
`-1` entries. IDs are sorted and unique. Browser reads verify byte size and SHA,
then validate row order, bounds and hemisphere. Lookup checks exact pack manifest
hash, reference-space ID, grid and affine before using any anchor. Shared reads
survive cancellation; failed reads can be retried by reselecting the region.

## Build and verification

Run on the canonical Linux host with the pinned LUT already available:

```bash
uv run --project builder --extra anatomy --extra scientific --extra test --locked \
  python -m tools.projection_pack.build_region_navigation --output /tmp/region-navigation
```

The generator refuses to overwrite an output directory. Review the complete
result before replacing the bundled generated files. Source hashes, generator
source hash, recipe and Linux environment are recorded in the manifest.

The current tables total 45,280 binary bytes. All 614 signed Beryl and 22 signed
Cosmos entries have anchors. Allen has 1,338 anchors, 851 rows without their own
native voxels and five occupied rows without a display-eligible interior point.
Unavailable rows keep slices fixed and explain why; feature values and optional
3-D geometry never choose a position.

HATA (`-589508447`) centers at native AP/ML/DV `[879,305,588]`, or world
ML/AP/DV `[-2689,-3390,-5548]` µm. It gives the same result from the user’s
`[-2879,-3600,-5358]` example or a distant starting position. Browser coverage
checks that each displayed crosshair is inside the signed HATA fragment.
Other centering/cancellation tests cover regions `-68` and `-362`; synthetic
builder tests cover hollow shapes, hemisphere separation, tie rules and sparse
coverage. Schema fixtures enforce Python/TypeScript/JSON-Schema parity.

Existing cancellation rules cover newer selections, manual slice navigation,
disabling Auto-slice, context changes, history restoration and teardown. No
movement occurs for deselection, branch expansion or URL hydration.
