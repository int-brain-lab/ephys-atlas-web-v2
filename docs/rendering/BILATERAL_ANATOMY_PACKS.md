# Bilateral 10 µm anatomy packs

`tools/anatomy_pack/build_v2.py` builds `anatomy-pack-v2` directly from the
real Allen CCFv3 10 µm annotation. It does not upscale or rescale the 25 µm
v1 geometry. The complete source grid is `(AP, ML, DV) = (1320, 1140, 800)`.

## Scientific identity and coordinates

The derived memory-mappable label LUT preserves physical hemispheres. Source
columns whose voxel centres have negative ML coordinates map to negative
Allen, Beryl, and Cosmos IDs; positive-ML columns map to positive IDs.
Background zero is never emitted as a region path.

Every projection uses the complete bilateral grid. Affines consume
`[slice_index, u, v, 1]` and return `[ml, ap, dv, 1]` in micrometres:

| projection | slices | shape | `(u, v)` |
| --- | ---: | ---: | --- |
| coronal | 1320 | 800 × 1140 | `(ML, DV)` |
| sagittal | 1140 | 800 × 1320 | `(AP, DV)` |
| horizontal | 800 | 1320 × 1140 | `(ML, AP)` |

The sagittal AP display axis is posterior-to-anterior. The manifest records
the forward and inverse transforms plus cross-projection sentinels; the
browser must use those transforms rather than display calibration constants.

## Exact topology and compact paths

Raster cells are polygonized on their half-integer edges after globally
noding the complete boundary graph. Polygon interiors and disconnected
components are retained. Paths declare `fill_rule="evenodd"`, and omitting
background zero therefore preserves both external and enclosed background.
The full-corpus validation records the number of enclosed background
components before and after serialization.

The production v2 algorithm does not geometrically approximate boundaries.
It removes a ring vertex only when the exact cross product is zero and the
vertex lies between its neighbours. The resulting segment is the same line
set, so IoU is 1 and the boundary-error upper bound is 0 µm by construction.
The compact SVG serializer uses one absolute `M` per ring followed by relative
`h`, `v`, or `l` deltas and a closing `z`. Ordering and numeric formatting are
deterministic. The provenance algorithm is
`exact collinear vertex removal`; `tolerance_um` and
`boundary_error_bound_um` are both zero.

## Reproducible commands

Prepare the memory-mappable bilateral LUT once:

```bash
just bootstrap-anatomy
uv run --project builder --extra anatomy --extra scientific --extra test --locked \
  python -m tools.anatomy_pack.build_v2 --prepare-only
```

Benchmark representative planes without writing a pack:

```bash
uv run --project builder --extra anatomy --extra scientific --extra test --locked \
  python -m tools.anatomy_pack.build_v2 --probe
```

Generate the immutable depth-16 corpus from a clean tracked worktree:

```bash
uv run --project builder --extra anatomy --extra scientific --extra test --locked \
  python -m tools.anatomy_pack.build_v2 \
  --output artifacts/anatomy-pack-v2 \
  --pack-depth 16 \
  --created-at 2026-08-20T00:00:00Z
```

The generator refuses dirty tracked worktrees and existing output paths. It
writes deterministic gzip bytes (`mtime=0`), validates both JSON schemas, and
checks every compressed byte count, decoded byte count, and SHA-256 before
atomically moving the staged directory into place.

## Accepted complete-corpus artifact

The accepted depth-16 artifact is
`allen-ccfv3-10um-bilateral-exact-599b5e0bbab1`, generated from clean commit
`fcdb82d144d3104dc1ee76f6582ed537bfc211be`. Its manifest is 58,797 bytes with
SHA-256
`273adff9e76ee902126bfb1dc18b9f0a7f6dfccacb3305f56e0463c68b24fc8c`.
The 205 gzip packs contain all 3,260 orthogonal slices and occupy 44,424,303
bytes; the complete directory including the manifest is 44,483,100 bytes.
No single depth-16 pack exceeds 517,748 compressed bytes or 3,825,077 decoded
bytes.

Complete-corpus validation records 537,110 region paths and 1,436,826 rings.
All topology, exact coverage, background topology, signed-ID, affine, and
resource-integrity gates pass. Eligible-region IoU is 1.0, the boundary-error
upper bound is 0 µm, and all source/emitted counts agree. The 4,653 enclosed
background components are preserved exactly. Independent validation reopened
and schema-checked every pack, recomputed every compressed checksum and byte
count, verified deterministic gzip headers and canonical decoded JSON, and
rehashed both pinned source artifacts.

The byte-identical public copy lives at
`web/public/atlas/anatomy/allen-ccfv3-10um-bilateral-exact-599b5e0bbab1/`.
Its inventory hash (SHA-256 over sorted relative path, byte size, and file
SHA-256 records) is
`8c6eca8c7bf74c0847a7a56026398841d1852dd10fe31044dc165fe6709b711b`.
The v1 pack remains present as a rollback asset. Registering this public copy
does not by itself select a runtime anatomy URL or alter browser calibration.
