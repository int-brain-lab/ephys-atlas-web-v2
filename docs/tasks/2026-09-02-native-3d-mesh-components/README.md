# Native 3-D anatomy

Status: accepted under D070 (2026-09-07); Q18 resolved.
D042 is immutable rollback evidence, no longer the selected default.

## Resume here

The owner reviewed the real anatomy, all 12 flagged movement cases, and OIT,
then approved the whole result. Do not ask for that review again. The exact
source-bound selection is [NATIVE_3D_SELECTION.json](../../data/NATIVE_3D_SELECTION.json).
Additional Firefox/Safari review for this selection is explicitly waived;
general launch-browser QA is not waived.

The approved pack is built as `artifacts/mesh-native-d070-v1`, identity
`ibl-native-d070-b5f5abc7d0bb3575`, on clean Linux commit `3d52114`.
Two builds matched every byte. The v5 development bundle selects it for
`just dev`, alongside all five local datasets. Preserve the review and D042
packs; do not edit their manifests in place or publish scientific data.

Next: use the normal website. Further anatomy approval is not required.
Remote distribution remains subject to Q8 and separate publication preflight.

## Accepted geometry and presentation

- 966,645 source triangles in 1,140 shared-edge components from 566 objects.
- All 539 left, 516 right, and 85 fixed assignments accepted unchanged,
  including the 12 asymmetric exceptions.
- No cuts, caps, welding, smoothing, decimation, or discarded in-scope triangles.
- Original decoded ML < 0 is left; zero and positive are right for colours,
  picking, selection, and visibility, independently of explode movement.
- Classification tolerance 0.001 µm is audit-only, with no near-plane adjustment.
- Raw float32 encoding: maximum position rounding 0.000244140625 µm, zero
  original-ML side flips. Geometry bytes remain unchanged in the approved pack.
- [Weighted blended OIT](../../rendering/3D_TRANSPARENCY.md) applies to
  translucent context; selected regions stay opaque. No volume scalars in 3-D.

## Preserved review evidence

The review pack is `artifacts/mesh-native-review-v1`, purpose `review-only`.
Its historical labels remain unchanged; D070 records approval separately.

- Manifest SHA-256:
  `17b23f3a20806637242b9480c05ca07b90e95aae0b459b050195ef33b39f6379`.
- Geometry SHA-256:
  `b5f5abc7d0bb357520a65dacf33a24251e2bd6f75873d7d5ac650ef2cd271799`.
- Geometry served bytes: 14,055,506; decoded bytes: 24,433,484.
- [Source/component audit](AUDIT.md) and [movement proposal](MOVEMENT_REVIEW.md)
  retain the investigation and exact input hashes. Their unreviewed wording is
  historical evidence; D070 accepts the bound assignments, not a general
  classification heuristic.

The original review can still be compared with D042 using:

```sh
npm --prefix web run dev:3d
```

Open `http://127.0.0.1:4194/?variant=native`.
Review controls belong to this lab, not the normal website.

## Reproducing the historical review compiler

Use a new output directory; the original review manifest remains bound to the
compiler version recorded in it.

```sh
uv run --project builder --extra test --locked python -m tools.mesh_pack.build_native_review \
  --glb ../ephys-atlas-web-v2-3d-lab/data/source/atlas-mesh-pack/meshes.glb \
  --baseline artifacts/mesh-d042-components-v1 \
  --proposal artifacts/native-components-audit/movement-proposal.json \
  --output artifacts/mesh-native-review-new \
  --builder-commit "$(git rev-parse HEAD)"
```

The source path is read-only donor evidence, not authorization to resume the
frozen donor branch. Recover the same pinned public GLB if absent.
The reviewed compiler verified source triangle correspondence/winding, scope,
transform, serialization and zero side flips; two original builds matched
byte-for-byte.

## Validation and rollback

`just check` covers schema, retained renderer, original-side/explode picking,
OIT order independence and lifecycle. The opt-in real-pack check is:

```sh
cd web
npx playwright test --config playwright.native-review.config.ts
```

D042's current-contract rollback pack is `artifacts/mesh-d042-components-v1`.
The original `artifacts/mesh-d042-schema-v1` is frozen old-contract evidence,
not a current-reader default. Do not reintroduce a legacy reader to load it.
All these large ignored artifacts are outside Git: Git push does not archive
them. Durable external preservation still requires an authorized destination
before any destructive cleanup; this does not block additive integration.

Geometry authority and source recovery are in
[3D_SELECTED_ASSET.md](../../rendering/3D_SELECTED_ASSET.md).
