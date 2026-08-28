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

`mesh-pack.schema.json` is the only 3-D geometry asset contract. It uses
signed bilateral Allen identities, nullable reduced mappings, an exact
`reference_space_id`, explicit source-to-world evidence, manifest-selected
default/upgrade LODs, and versioned EAM3 decoder contracts. Tiny committed
packs are marked `test-only`. D042 separately selects the pinned GLB-derived
compiled-full geometry/LOD baseline; immutable deployment must retain its
exact-source provenance, inventory/topology, integrity, and browser evidence.

The shared valid/invalid corpus under `tests/contract-fixtures/v1/` is executed
by both Python and TypeScript validators and covers every top-level schema plus
the common binary/resource semantics.

Every nonempty scalar representation declares Linear/Full and may add reviewed
Log or Signed-log scales and a Focused domain. The representation-specific
feature display owns availability and preferences. Regional statistics and
volume summaries use one extensible `distribution.binnings` shape containing
the exact raw-value edges, global counts, and explicit underflow/overflow
counts for every declared scale/domain combination. Regional binnings add one
typed `uint32` matrix whose columns are exactly
`underflow, bins..., overflow`. Every combination is computed directly from
source observations or valid voxels; consumers never stretch or re-bin an
existing histogram. Focused counts retain whole-population normalization, and
volume distributions remain global valid-voxel-only.
An empty regional observation population or zero-valid-voxel volume omits the
distribution object entirely and therefore owns no distribution-count
resources; its descriptive statistics are null. A nonempty population must
declare a distribution and finite descriptive statistics.
