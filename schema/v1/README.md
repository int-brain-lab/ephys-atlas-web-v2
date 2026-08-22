# Schema v1

Schema v1 is the active release contract for builders, publishing, HTTP/local
browser loading, fixtures, and downloads. It replaced schema v0.1 atomically;
there is no compatibility reader or adapter for the retired contract.

All encoded resources carry their encoded byte length and SHA-256 plus an
explicit codec and decoded byte length. Consumers must verify encoded bytes
before persistent caching or decoding. A decoded-cache identity consists of
the resource SHA-256 and the complete decode contract, not its relative path.

`reference_space_id` establishes scientific compositing compatibility.
`grid_id`, shape, and affine identify a particular sampling grid and may differ
between compatible assets. Pack and asset IDs are provenance identities only.

Volume and registered-plane matrices are row-major mappings from
`[i0, i1, i2, 1]` to `[ml, ap, dv, 1]`. Integer indices identify voxel centers;
half-integers identify voxel edges. Schema v1 currently accepts only finite,
signed-permutation spatial transforms with homogeneous row `[0, 0, 0, 1]`.
Semantic validators derive and check any declared inverse and voxel-edge
extent.

Top and Swanson are affine-free static regional maps. Their descriptors contain
only SVG display geometry and checksummed fragment resources; they must never
claim a grid, slice index, world coordinate, or affine.

Each registered projection points to a gzip-compressed
`atlas-registered-svg-resource-index-v1`. That index enumerates immutable
indexed-SVG packs and their exact native slice inventories. A complete
projection-pack validator must verify the manifest, the three indexes, every
transitive registered/static resource, and the absence of undeclared files.

The shared valid/invalid corpus under `tests/contract-fixtures/v1/` is executed
by both Python and TypeScript validators and covers every top-level schema plus
the common binary/resource semantics.
