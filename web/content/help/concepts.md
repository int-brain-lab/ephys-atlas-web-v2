## Dataset and immutable release {#dataset-and-release}

A dataset identifies the scientific product. A release identifies an immutable snapshot of that product. Changing the release may change its features, values, population, or scientific recipe.

## Feature {#feature}

A feature is the measured or derived quantity displayed by the viewer. Its unit, source column, transformation, and population are described under Data details.

## Regional and Volume {#representation}

Regional data summarizes observations within atlas regions. Volume data contains values sampled across a three-dimensional voxel grid.

## Parcellation {#parcellation}

A parcellation defines how atlas regions are grouped. For regional data, changing it changes the regions and their summaries. For volume data, it changes the anatomical overlay and region inspection, not the voxel values.

## Statistic {#statistic}

The statistic determines which regional summary is displayed, such as the mean or median. It does not alter the source observations.

## Scale and display range {#scale-and-range}

Scale and range control how values map to colors. They do not modify the underlying observations or downloaded values.

## Full and Focused distributions {#distribution-domain}

Full shows the complete value domain. Focused enlarges a reviewed part of the distribution while retaining explicit counts for values below and above the visible interval.

## Population and provenance {#population-and-provenance}

Population describes which observations were included in the release. Provenance records the source data, scientific recipe, tools, and builder used to create it. Check Data details before interpreting or citing a feature.

