# Rendering documentation index

Status: active documentation map.

The implemented application boundary is `ProjectionViewportFactory` for
retained 2-D views and its sibling retained 3-D viewport for the optional
context scene. The projection pack is the only browser anatomy format;
anatomy-pack documents remain derivation and reproducibility authorities.

## Current authorities

| Concern | Authority |
| --- | --- |
| Retained 2-D application boundary and completed cutover | D031/D035 and [`PROJECTION_VOLUME_CUTOVER_PLAN.md`](PROJECTION_VOLUME_CUTOVER_PLAN.md) |
| Registered bilateral scientific geometry | [`BILATERAL_ANATOMY_PACKS.md`](BILATERAL_ANATOMY_PACKS.md) and D045 |
| Sparse registered display derivation | [`ANATOMY_PACK_V3_CONTRACT.md`](ANATOMY_PACK_V3_CONTRACT.md) |
| Five-view browser projection pack | schema v1, D034, and projection-pack tooling/tests |
| Volume layers and transport-neutral slice source | [`VOLUME_ARCHITECTURE.md`](VOLUME_ARCHITECTURE.md), D036, and Q5 |
| Static Top/Swanson sources | D049 and `LICENSES/IBL-EPHYS-ATLAS-V1-STATIC-ASSETS-MIT.txt` |
| Optional 3-D selected geometry | D042 and [`3D_SELECTED_ASSET.md`](3D_SELECTED_ASSET.md) |
| Optional 3-D application integration | D037 and [`3D_INTEGRATION_PLAN.md`](3D_INTEGRATION_PLAN.md) |

## Document roles

| Document | Role | Status |
| --- | --- | --- |
| [`PROJECTION_VOLUME_CUTOVER_PLAN.md`](PROJECTION_VOLUME_CUTOVER_PLAN.md) | completed cutover record plus Q5 production gates | frozen evidence |
| [`BILATERAL_ANATOMY_PACKS.md`](BILATERAL_ANATOMY_PACKS.md) | scientific build/reproducibility contract | accepted |
| [`ANATOMY_PACK_V3_CONTRACT.md`](ANATOMY_PACK_V3_CONTRACT.md) | sparse derivation contract; no longer browser runtime format | accepted |
| [`ANATOMY_PACK_CONTRACT.md`](ANATOMY_PACK_CONTRACT.md) | historical v1 anatomy contract | superseded |
| [`ANATOMY_PACKS.md`](ANATOMY_PACKS.md) | historical v1 build record | superseded |
| [`ANATOMY_NAVIGATION_PERFORMANCE.md`](ANATOMY_NAVIGATION_PERFORMANCE.md) | current benchmark evidence | frozen evidence |
| [`VOLUME_ARCHITECTURE.md`](VOLUME_ARCHITECTURE.md) | volume rendering boundary | accepted |
| [`3D_SELECTED_ASSET.md`](3D_SELECTED_ASSET.md) | selected geometry evidence | frozen evidence |
| [`3D_INTEGRATION_PLAN.md`](3D_INTEGRATION_PLAN.md) | completed application-integration record | frozen evidence |
| [`3D_EVALUATION.md`](3D_EVALUATION.md) | lab and asset-evaluation evidence | frozen evidence |
| [`3D_PROMOTION_REVIEW.md`](3D_PROMOTION_REVIEW.md) | abandoned annotation-regeneration direction | retired |
| [`ANATOMY_SMOOTHING_LAB_PLAN.md`](ANATOMY_SMOOTHING_LAB_PLAN.md) | completed experiment plan | frozen evidence |
| [`ANATOMY_SMOOTHING_REVIEW.md`](ANATOMY_SMOOTHING_REVIEW.md) | owner review selecting exact geometry | frozen evidence |
| [`TOP_RECONSTRUCTION_LAB.md`](TOP_RECONSTRUCTION_LAB.md) | completed Top reconstruction evidence | frozen evidence |
| [`ANATOMY_COMPARISON.md`](ANATOMY_COMPARISON.md) | historical comparison methodology | frozen evidence |
| [`INDEXED_SVG_PACK_EXPERIMENT.md`](INDEXED_SVG_PACK_EXPERIMENT.md) | accepted experiment that led to v3 | superseded |
| [`SVG_CALIBRATION.md`](SVG_CALIBRATION.md) | legacy display calibration evidence | frozen evidence |
| [`HANDOFF.md`](HANDOFF.md) | compatibility stub for older links | superseded |

Generated selection JSON and immutable asset manifests remain at stable paths
and are not replaced by this prose index.
