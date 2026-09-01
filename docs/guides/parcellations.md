# Understand parcellations

Status: reader guide; release metadata, source recipes, and schema v1 remain
authoritative for the exact identities and values in a release.

A parcellation defines how anatomical regions are identified or grouped. The
viewer supports Allen, Beryl, and Cosmos when the selected release provides
the corresponding representation. A parcellation choice is not merely a color
or label change: for regional features, it selects a different set of
release-provided region identities and summaries.

## Allen, Beryl, and Cosmos

- **Allen** retains the detailed Allen ontology identities represented by the
  release.
- **Beryl** is an IBL reduced mapping that groups Allen identities into a
  smaller analysis-oriented region set.
- **Cosmos** is an IBL coarse mapping that groups Allen identities into broad
  anatomical divisions.

The feature catalog is dynamic, so the viewer enables only parcellations
declared by the active feature. Check **Info** and the immutable release
metadata for the exact source population, aggregation, and available outputs.

## Regional data

Regional values are prepared before publication. The browser does not invent a
reduction by averaging already-loaded Allen summaries. It loads the region
index and statistics produced for the selected parcellation by the release's
documented recipe.

This distinction matters when several source observations map to one reduced
region: an average of original observations need not equal an unweighted
average of pre-aggregated Allen means. Provenance should identify the source
mapping, requested output mappings, population, QC recipe, and aggregation.

For custom authoring, repeated Allen observations may be mapped
observation-by-observation to Beryl or Cosmos before explicit mean aggregation.
Already-aggregated values remain Allen-only because their original observation
weights cannot be recovered safely. See the
[custom-data tutorial](../data/CUSTOM_DATA_TUTORIAL.md#choose-the-correct-regional-method).

Changing parcellation clears region selection that belongs to the previous
identity set. It does not alter the source observations stored in the release.

## Volume data

A scalar volume owns an explicit grid, axis order, affine, dtype, and validity
rules. Changing parcellation changes the anatomical overlay and region
inspection only. It does not resample, aggregate, or transform the voxel
values.

Anatomy and volume layers may use different grids or resolutions, but they can
be composited only when they declare the same exact `reference_space_id`.
Matching shapes or asset identifiers alone do not establish coordinate
compatibility.

## Top and Swanson

Top and Swanson are affine-free static regional projections. They reuse the
active regional presentation and selection where their geometry contains the
corresponding identities, but they do not define slice indices, world
coordinates, or voxel mappings. They should not be used to infer spatial
registration for a volume.

## Reading and reporting results

When interpreting, exporting, or citing regional results, record at least:

- dataset and immutable release ID;
- feature and statistic;
- selected parcellation;
- source population and QC recipe;
- aggregation and transformation mode;
- source vintage and provenance.

A share URL preserves the active parcellation, but the immutable release
metadata remains the authority for how its values were produced.
