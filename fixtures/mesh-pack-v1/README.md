# Tiny mesh-pack v1 fixture

This directory is deterministic, synthetic, and test-only. It is not Allen
geometry and must never be published as scientific data or used as a runtime
fallback.

The fixture remains available to browser tests at `/3d-lab/` on their test
server. The owner-facing standalone command loads real Native / D042 anatomy:

```sh
npm --prefix web run dev:3d
```

It opens `http://127.0.0.1:4194/3d-lab/`; the server's root redirects there
as well. It requires `artifacts/mesh-d042-components-v1`,
`artifacts/mesh-native-review-v1` (including its integrity-checked evidence report), and the pinned donor
catalog. Missing real inputs fail at startup, without a synthetic fallback.
See `docs/rendering/3D_SELECTED_ASSET.md` for the repackaging command.

`source/source.glb` contains one synthetic Allen surface with an intact component
that crosses ML=0 and a disconnected right-lateral component. Both components
share the same left/right regional presentations. The crossing component has an
explicit zero explode displacement while the lateral component moves. The source catalog also includes a non-grey active identity so scope
exclusion is exercised, and its reduced Beryl mapping intentionally remains
`null`.

The tests regenerate both the GLB and `pack/` byte-for-byte. To make a separate
pack manually, run:

```sh
just mesh-pack-fixture artifacts/mesh-pack-v1-fixture
just mesh-pack-validate artifacts/mesh-pack-v1-fixture
```

The committed pack contains only `manifest.json`, one gzip EAM3 resource, and
its content-addressed validation report. Complete-graph validation rejects
missing, undeclared, size-mismatched, and hash-mismatched files.
