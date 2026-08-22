# Anatomy pack v3 contract

Status: accepted immutable build/reproducibility contract; superseded as a
browser runtime format by `atlas-projection-pack-v1`.

`anatomy-pack-v3` is a sparse display transport derived from a validated,
immutable `anatomy-pack-v2`. It does not replace the parent's scientific
geometry or native coordinate domain.

## Scientific and sampling invariants

- Native projection `slice_count`, 10 µm affines, URL indices, cursor state,
  and linked guides remain authoritative.
- Each projection declares a strictly increasing `display_slice_indices`
  inventory of native indices. The browser must not infer this list from pack
  depth or file names.
- Production display spacing is 80 µm. The lattice is the native plane nearest
  fixed-axis world coordinate zero plus integer multiples of 80 µm within the
  native extent.
- A non-display native index resolves to the nearest display index for anatomy
  geometry only. Equidistant ties resolve to the lower native index.
- Every SVG fragment, atlas ID, path, view box, affine, source declaration,
  validation result, and synchronization sentinel originates from the
  validated parent. The converter does not polygonize or simplify geometry.

## Manifest and artifact invariants

The schema is `schema/anatomy-pack-v3/manifest.schema.json`. The manifest
records the parent pack identity and manifest SHA-256, converter commit, exact
sampling rule, explicit inventories, and immutable artifact metadata.

Production packs use depth eight and `ISVG` version 1 wrapped in deterministic
gzip (`mtime=0`, compression level 9). Each artifact has a unique identity and
contains a fixed-width index over concatenated UTF-8 SVG fragments. Manifest
byte size, uncompressed size, SHA-256, projection identity, pack identity,
slice indices, and world coordinates must all agree with the artifact before
it is accepted.

The v3 builder consumes the shallowest complete pack set in its parent,
validates parent bytes and affine/world coordinates, round-trips every emitted
ISVG artifact, validates the new manifest schema, and refuses to overwrite an
existing output. The production CLI also refuses a dirty tracked worktree so
the recorded converter commit identifies the generator exactly.

## Historical browser ownership boundary

Before the D031 cutover, the anatomy source owned manifest parsing, immutable fetches, compressed-byte
SHA verification, in-flight request deduplication, and prefetch policy. A
persistent module worker owns the decompressed ISVG byte LRU. Loading a pack
transfers the verified compressed buffer to that worker; requesting a slice
returns one SVG fragment string and its two scalar coordinates, never the
whole pack or a decoded JSON object graph.

The worker reports every LRU eviction. The source must invalidate matching
residency tokens and reload if a fragment lookup reports a miss. The renderer
may separately retain a small LRU of parsed SVG DOM layers; that cache is a
presentation optimization and does not change source or worker ownership.

## Projection-pack derivation

The v3 artifact is now validated and copied losslessly into the registered
resources of `atlas-projection-pack-v1`. Neither v3 nor its immutable bilateral
10 µm v2 parent is a supported browser fallback. Both remain authoritative
build evidence, and volume data storage and sampling remain independent of
this regional SVG display contract.
