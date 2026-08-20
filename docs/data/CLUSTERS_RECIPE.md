# Ephys atlas cluster release recipe

`ephys_atlas_clusters` is a separate regional dataset built from the scalar
columns of `cells_aggregates/clusters.table.pqt`. It does not use BWM data or
`clusters_good.table.pqt`.

## Population and aggregation

The approved population is all cluster rows in the explicitly selected project
snapshot. There is no good-unit filter, insertion balancing, or other implicit
QC. For each feature and parcellation:

1. validate and fold atlas ids to the left with `-abs(id)`;
2. assign every cluster to its Allen, Beryl, or Cosmos region;
3. exclude non-finite values independently for that feature;
4. give every remaining cluster equal weight;
5. write the regional arithmetic mean plus count, missing count, minimum,
   maximum, standard deviation, median, and quantiles.

Thus a region's displayed value is the mean of all finite cluster values in
that region. Insertions with more clusters contribute more observations, by
design.

## Reproducibility

The current upstream project prefix is not vintage-labelled. Pulling it creates
a checksummed snapshot whose immutable release id is derived from its contents.
The build additionally requires the exact project name and Git commits for
`ibleatools`, `iblatlas`, and this builder. The source release and detailed
project/QC choice remain explicit inputs; the recipe does not guess a paper
vintage or substitute a different cluster population.

There is deliberately no default launch feature catalog. Every snapshot build
must repeat `--feature` to define a nonempty catalog, and the resolved list is
recorded in provenance. Units are copied only when the pinned upstream schema
provides them; otherwise they remain null rather than being guessed. Large
waveform, ACG, STPC, and STLFP arrays are not silently reduced into regional
features.

## Example

```bash
ephys-atlas-data pull ephys_atlas_clusters latest --project <exact-project>

ephys-atlas-data build-clusters latest \
  --project <exact-project> \
  --population all \
  --feature firing_rate \
  --feature amp_median \
  --created-at 2026-08-20T00:00:00Z \
  --ibleatools-commit <commit> \
  --iblatlas-commit <commit> \
  --builder-commit <commit>
```

The CLI resolves `latest` to the pulled content-derived snapshot id and writes
the validated release under
`data/releases/ephys_atlas_clusters/<content-release-id>/`.
