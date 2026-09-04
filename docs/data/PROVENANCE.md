# Release provenance requirements

Status: active cross-dataset requirements.

Scientific provenance is part of the release contract. Dataset recipes own
source-specific facts; this document defines the common information every real
release must preserve wherever schema v1 permits it.

## Required identity

Record:

- dataset and immutable release IDs;
- source project/namespace and exact vintage, content snapshot, or legacy
  preserved-product identity;
- every consumed source object's served byte size and SHA-256;
- source/tool/builder commits or package versions;
- builder operating system, machine architecture, Python, and NumPy versions;
- the exact deterministic builder command and creation timestamp;
- whether the artifact is synthetic/test-only, validated-real-local, staging,
  or published-production.

Moving labels such as `latest` are acquisition conveniences, not provenance.
Resolve and record the immutable identity before building.

Production scientific releases are built and preflighted on Linux from clean
`main`. macOS artifacts remain local preview output and cannot be promoted.

## Required scientific recipe

Record all choices that affect meaning:

- source feature/column and transformation mode;
- population, QC, inclusion/exclusion, and missing-value policy;
- atlas/reference-space identity and parcellation mapping;
- lateralization/folding, aggregation, weighting, and observation unit;
- value units and semantic description;
- volume shape, ordered axes, affine, index-center convention, validity/outside
  policy, and canonical-object identity;
- reviewed scale/domain selection artifact and its SHA-256 when applicable.

Do not infer a missing scientific choice from a source path, array shape,
frontend default, previous release, or audit heuristic.

## Derived transport and publication

A browser-optimized transport records provenance back to the canonical source
object and the deterministic conversion parameters. Transport choices do not
change scientific geometry or validity. Publishing validates already-built
bytes and must not add or rewrite scientific provenance.

Published release contents are immutable. Catalogs and aliases remain outside
release directories and identify the immutable target they resolve to.

## Dataset owners

| Dataset | Current source and recipe authority | Release/evidence authority |
| --- | --- | --- |
| Channels | [`CHANNELS_RECIPE.md`](CHANNELS_RECIPE.md) | [`DEVELOPMENT_RELEASE.md`](DEVELOPMENT_RELEASE.md) |
| Clusters | [`CLUSTERS_RECIPE.md`](CLUSTERS_RECIPE.md) and machine selections | [`CLUSTERS_RELEASE.md`](CLUSTERS_RELEASE.md), [`CLUSTERS_SOURCE_AUDIT.md`](CLUSTERS_SOURCE_AUDIT.md) |
| Encoding volumes | [`VOLUME_IMPLEMENTATION_HANDOFF.md`](VOLUME_IMPLEMENTATION_HANDOFF.md) and geometry selection | [`VOLUME_2026_W26_EVIDENCE.md`](VOLUME_2026_W26_EVIDENCE.md) |
| Brain-Wide Map | [`BRAINWIDE_MAP_RECIPE.md`](BRAINWIDE_MAP_RECIPE.md) | exact-input equivalence tests and current integration status |
| Local/custom | [`CUSTOM_DATA_AUTHORING.md`](CUSTOM_DATA_AUTHORING.md) | user-supplied explicit source metadata plus validated archive graph |

The complete documentation map, including machine-readable distribution
selections, is [`README.md`](README.md).
