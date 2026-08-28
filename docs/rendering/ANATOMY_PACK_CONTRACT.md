# Anatomy pack contract v1

Status: superseded runtime/build contract; retained as historical evidence.

The production anatomy pack replaces mutable, legacy-host SVG bundles with an
immutable, scientifically registered anatomy asset. Its JSON schemas are:

- `schema/anatomy-pack-v1/manifest.schema.json`;
- `schema/anatomy-pack-v1/slice-pack.schema.json`.

The checked-in fixture is synthetic and tests the contract only. Its hashes,
coordinates, geometry metrics, and code pins do not describe a scientific
atlas release.

## Identity and source authority

The manifest format is `anatomy-pack-v1`, schema version `1.0`. `pack_id` names
one immutable release; aliases live outside it. A valid production pack is
derived from the Allen CCFv3 25 µm left-hemisphere annotation and records the
exact annotation and annotation-LUT byte sizes and SHA-256 hashes.

Region paths use stable, signed atlas IDs directly. Every path carries
`atlas_ids.allen`, `atlas_ids.beryl`, and `atlas_ids.cosmos`; all are negative
for the canonical left hemisphere. No `BrainRegions` row index crosses the pack
or browser boundary. Multiple Allen boundaries may intentionally share the same
Beryl or Cosmos ID.

## Coordinates and SVG path space

World vectors are always `[ml, ap, dv]` in micrometres. Matrices are flattened
row-major 4x4 affine transforms.

For each projection, an index vector is `[slice_index, u, v, 1]`.
`plane_axes` declares what the in-plane `(u, v)` coordinates mean, while
`fixed_world_axis` declares the slice axis:

| projection | plane axes `(u, v)` | fixed axis |
| --- | --- | --- |
| coronal | `(ml, dv)` | `ap` |
| sagittal | `(ap, dv)` | `ml` |
| horizontal | `(ml, ap)` | `dv` |

`plane_index_to_world_um` maps that vector to `[ml, ap, dv, 1]`.
`world_to_plane_index` is its declared inverse. Both must be finite and inverse
within `validation.coordinate_tolerance_um`.

Integer `u`/`v` coordinates are source-voxel centres. Half-integers are voxel
edges. SVG path data uses `x=u` and `y=v` in this same space, so a plane of
`slice_shape=[rows, columns]` has
`view_box=[-0.5, -0.5, columns, rows]`. Display scaling may transform this view
box, but must not alter scientific indices or world coordinates.

## Slice packs and delivery

Each projection exposes one or both candidate depths under `pack_sets`: key
`16` has `pack_depth=16`, and key `32` has `pack_depth=32`. Benchmark manifests
may include both; a production manifest may include only the chosen depth to
avoid duplicating all geometry bytes.

For every present pack set:

- pack indices are contiguous from zero;
- `first_slice_index == pack_index * pack_depth`;
- all non-final packs contain `pack_depth` slices;
- the final pack contains the exact remainder;
- formatting `path_template` with `{pack}` equals the declared artifact path;
- paths are unique across all projections and depths;
- artifact `bytes` and SHA-256 describe the fetched compressed bytes;
- `uncompressed_bytes` describes the decoded JSON bytes.

Pack files are deterministic gzip-compressed JSON (`mtime=0`, stable JSON
serialization). They are stored and fetched as gzip bytes with
`compression="gzip"`; clients explicitly decompress those bytes. Delivery must
not depend on HTTP `Content-Encoding`, which can vary across origins and caches.

Each decoded payload is `anatomy-slice-pack-v1`. Its identity, projection,
depth, pack index, first slice, and slice count must agree with the manifest.
Slice indices are contiguous and each `world_coordinate_um` must equal the
fixed-axis value produced by the projection affine.

## Reproducibility and geometry acceptance

An immutable production manifest pins:

- `iblatlas` repository and commit;
- generator repository and clean commit;
- Shapely and GEOS versions;
- `GEOS coverage_simplify` tolerance;
- boundary sampling interval and the conservative unsampled-error bound.

Streaming validation records the maximum per-slice median and maximum
per-slice p95 as `worst_slice_median` and `worst_slice_p95`; these fields do not
claim to be pooled full-corpus quantiles. `max_upper_bound` is the conservative
global upper bound: sampled maximum plus
`provenance.simplification.boundary_error_bound_um`. It, rather than the raw
sampled maximum, is compared with
`accepted_max_boundary_error_um`.

For regions whose source-plane area is at least
`region_area_threshold_mm2=0.01`, the minimum measured region IoU must be at
least `accepted_minimum_region_iou=0.98`. `minimum_eligible_region_iou` records
the observed worst eligible region. Topology, coverage, component, and missing
ID gates still protect smaller islands; the area threshold does not permit
their removal.

The full-corpus gate requires valid topology and coverage, zero uncovered or
multiply covered source voxels, zero adjacency mismatches and invalid
geometries, no missing signed atlas IDs, equal source/emitted logical slice
counts, and recorded path/ring/vertex and boundary-error metrics. Geometry
simplification is not accepted from tolerance alone.

## Cross-projection synchronization sentinels

Every manifest contains at least two interior world-coordinate sentinels. A
sentinel records one `[ml, ap, dv]` point and its expected
`[slice_index, u, v]` in all three projections. Validation must:

1. transform the world point with each `world_to_plane_index` matrix;
2. compare it with the declared projection indices;
3. reconstruct world coordinates with each inverse affine;
4. confirm all three reconstructed points agree within
   `coordinate_tolerance_um`;
5. record the worst error as `sentinel_max_error_um`.

These sentinels catch projection flips, axis swaps, origin drift, and slice
off-by-one errors before a pack is published.

## Fixture and tests

`fixtures/anatomy/anatomy-pack-v1/manifest.json` deliberately has 17 slices per
projection, exercising full and remainder packs at both depths. The example
slice payload demonstrates direct signed Allen/Beryl/Cosmos IDs and two Allen
regions mapping to one coarser region. `tests/test_anatomy_pack_schema.py`
validates schemas, inverse affines, deterministic inventories, gzip behavior,
scientific source constraints, geometry gates, and cross-plane sentinels.
