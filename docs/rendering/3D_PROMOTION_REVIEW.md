# Retired 3-D regeneration handoff

Status: **retired by D042 on 2026-08-24; do not execute**.

This path attempted to replace selected pinned-GLB surfaces with geometry
generated from canonical annotation voxels. The repository owner clarified the
product contract and selected the already reviewed frozen-donor compiled-full
resource instead:

- geometry authority: pinned public `atlas/meshes.glb`;
- selected donor commit: `ba1e2d129753bdc459bca7b23fa896f41ee13536`;
- selected resource: `source.eamh.gz`;
- served bytes: `4,958,039`;
- SHA-256:
  `658d68d81619ef83f7dbd6b032533ecd751fb52d3e7dd734dc90b1086b95baaa`;
- retained triangles: `989,811`;
- signed surfaces: `1,130` from `566` in-scope GLB source objects;
- geometry policy: no smoothing, no triangle decimation, no voxel-derived
  replacements, and no upgrade LOD.

The ignored candidate bundle under `artifacts/mesh-production-candidate/` is
historical local evidence only. It is not a product input, promotion candidate,
or task queue. Do not publish it or use its regenerated surfaces.

Any schema-v1 repackaging must preserve the selected GLB-derived inventory and
triangle topology. Volume features are unrelated: they are displayed only as
linked coronal, sagittal, and horizontal 2-D slices.
