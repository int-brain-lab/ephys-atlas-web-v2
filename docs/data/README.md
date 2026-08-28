# Data documentation index

Status: active documentation map.

Schema v1 is the sole release contract. This index assigns one default reading
path to each dataset and separates current recipes/runbooks from frozen
evidence. Machine-readable selection JSON remains at its existing stable path.

## Dataset authorities

| Dataset | Current source/recipe authority | Selection authority | Release/evidence record | Active runbook |
| --- | --- | --- | --- | --- |
| Channels | [`CHANNELS_RECIPE.md`](CHANNELS_RECIPE.md) | [`CHANNELS_DISTRIBUTION_SELECTION.json`](CHANNELS_DISTRIBUTION_SELECTION.json) | [`DEVELOPMENT_RELEASE.md`](DEVELOPMENT_RELEASE.md) | [`DISTRIBUTION_AUDIT.md`](DISTRIBUTION_AUDIT.md) |
| Clusters | [`CLUSTERS_RECIPE.md`](CLUSTERS_RECIPE.md) | [`CLUSTERS_CATALOG_SELECTION.json`](CLUSTERS_CATALOG_SELECTION.json) and [`CLUSTERS_DISTRIBUTION_SELECTION.json`](CLUSTERS_DISTRIBUTION_SELECTION.json) | [`CLUSTERS_RELEASE.md`](CLUSTERS_RELEASE.md), [`CLUSTERS_SOURCE_AUDIT.md`](CLUSTERS_SOURCE_AUDIT.md) | [`DISTRIBUTION_AUDIT.md`](DISTRIBUTION_AUDIT.md) |
| Encoding volumes | [`VOLUME_IMPLEMENTATION_HANDOFF.md`](VOLUME_IMPLEMENTATION_HANDOFF.md) for the pinned W26 source/continuation contract | [`VOLUME_2026_W26_GEOMETRY_SELECTION.json`](VOLUME_2026_W26_GEOMETRY_SELECTION.json) and [`VOLUME_2026_W26_DISTRIBUTION_SELECTION.json`](VOLUME_2026_W26_DISTRIBUTION_SELECTION.json) | [`VOLUME_2026_W26_EVIDENCE.md`](VOLUME_2026_W26_EVIDENCE.md) | [`DISTRIBUTION_AUDIT.md`](DISTRIBUTION_AUDIT.md); Q5 final-origin validation remains blocked |
| Brain-Wide Map | [`BRAINWIDE_MAP_RECIPE.md`](BRAINWIDE_MAP_RECIPE.md) | [`BRAINWIDE_MAP_DISTRIBUTION_SELECTION.json`](BRAINWIDE_MAP_DISTRIBUTION_SELECTION.json) | exact-input equivalence tests and current integration status | [`DISTRIBUTION_AUDIT.md`](DISTRIBUTION_AUDIT.md) |
| Local/custom | D051 and [`CUSTOM_DATA_AUTHORING.md`](CUSTOM_DATA_AUTHORING.md) | user-supplied explicit authoring inputs constrained by schema v1 | none yet | [`CUSTOM_DATA_AUTHORING.md`](CUSTOM_DATA_AUTHORING.md) |

`docs/DATA_SOURCES.md` remains the stable cross-dataset compatibility entry
point. Dataset recipes and machine-readable selections own current scientific
choices; evidence reports retain hashes, measurements, and reproduction facts.

## Document roles

| Document | Role | Status |
| --- | --- | --- |
| [`CHANNELS_RECIPE.md`](CHANNELS_RECIPE.md) | scientific recipe | accepted |
| [`CLUSTERS_RECIPE.md`](CLUSTERS_RECIPE.md) | scientific recipe | accepted |
| [`BRAINWIDE_MAP_RECIPE.md`](BRAINWIDE_MAP_RECIPE.md) | scientific recipe | accepted |
| [`CUSTOM_DATA_AUTHORING.md`](CUSTOM_DATA_AUTHORING.md) | focused implementation plan | active |
| [`DISTRIBUTION_AUDIT.md`](DISTRIBUTION_AUDIT.md) | audit and rollout runbook | runbook |
| [`DEVELOPMENT_RELEASE.md`](DEVELOPMENT_RELEASE.md) | channel release record | frozen evidence |
| [`CLUSTERS_RELEASE.md`](CLUSTERS_RELEASE.md) | cluster release record | frozen evidence |
| [`CLUSTERS_SOURCE_AUDIT.md`](CLUSTERS_SOURCE_AUDIT.md) | source audit | frozen evidence |
| [`VOLUME_2026_W26_EVIDENCE.md`](VOLUME_2026_W26_EVIDENCE.md) | source and transport evidence | frozen evidence |
| [`VOLUME_GEOMETRY_REVIEW.md`](VOLUME_GEOMETRY_REVIEW.md) | resolved geometry review | frozen evidence |
| [`VOLUME_HTTP_VALIDATION.md`](VOLUME_HTTP_VALIDATION.md) | historical W12 transport evidence | frozen evidence |
| [`VOLUME_IMPLEMENTATION_HANDOFF.md`](VOLUME_IMPLEMENTATION_HANDOFF.md) | W26 acquisition and Q5 continuation runbook | runbook |
| [`STORAGE_FORMATS.md`](STORAGE_FORMATS.md) | physical-format rationale | accepted |
| [`PROVENANCE.md`](PROVENANCE.md) | cross-dataset provenance inventory | active |
| [`HANDOFF.md`](HANDOFF.md) | compatibility summary pending rationalization | superseded |

Selection JSON and audit JSON are machine-readable authorities/evidence rather
than prose documents; their validity and consumer paths are enforced by tests.
