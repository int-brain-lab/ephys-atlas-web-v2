# Resolved questions

Status: accepted resolution index.

This compact index preserves stable Q identifiers after they leave
[`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md). Decisions, selection artifacts, and
linked evidence remain the authority; this file does not rewrite their history.

| ID | Resolution | Authority and primary evidence |
| --- | --- | --- |
| Q1 | Publish raw and denoised channel variants as separately identified features; raw remains the audit/reference layer. | D020; [`data/CHANNELS_RECIPE.md`](data/CHANNELS_RECIPE.md) |
| Q3 | Use the explicit `inside` channel population, per-feature finite observations, no extra physiological QC/clipping/replacement, and left-folded aggregation. | D020; [`data/CHANNELS_RECIPE.md`](data/CHANNELS_RECIPE.md) |
| Q4 | For the exact checksummed W26 50 µm object, use all-forward ML/AP/DV axes, integer indices at voxel centers, the D043 affine, `0.0` outside sentinel, and nonfinite missing policy. | D043; [`data/VOLUME_2026_W26_GEOMETRY_SELECTION.json`](data/VOLUME_2026_W26_GEOMETRY_SELECTION.json) |
| Q6 | Use all rows from the content-addressed `ibl_neuropixel_brainwide_01/clusters.table.pqt` snapshot and all 14 approved original scalar features/units. | D038, D044; [`data/CLUSTERS_CATALOG_SELECTION.json`](data/CLUSTERS_CATALOG_SELECTION.json) |
| Q7 | Preserve the five checksummed Beryl-only legacy website Parquet families as a legacy snapshot, not a regenerated paper release. | D038; [`data/PROVENANCE.md`](data/PROVENANCE.md) |
| Q10 | Use the committed immutable generated registered geometry/projection pack; do not contact the legacy host at runtime. | D023, refined through D031/D034/D035 |
| Q11 | Keep automated Chromium and require a documented manual Firefox/Safari release matrix; automated Firefox/WebKit CI is not required. | D040 |
| Q12 | Use the pinned GLB-derived compiled-full 3-D geometry: 4,958,039 served bytes, 989,811 triangles, no smoothing/decimation/voxel replacement, and no upgrade LOD. | D042; [`rendering/3D_SELECTED_ASSET.md`](rendering/3D_SELECTED_ASSET.md) |
| Q13 | Retain exact legacy Top and authorize the pinned Top/Swanson byte sequences under the committed MIT notice. | D049; `LICENSES/IBL-EPHYS-ATLAS-V1-STATIC-ASSETS-MIT.txt` |

Q8 and Q14 remain in the open registry because only part of each question is
resolved. Q2, Q5, and Q9 remain wholly open.
