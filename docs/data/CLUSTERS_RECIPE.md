# Ephys atlas cluster release recipe

`ephys_atlas_clusters` is a separate regional dataset built from the scalar
columns of `cells_aggregates/clusters.table.pqt`. It does not use BWM data or
`clusters_good.table.pqt`.

The approved launch source project is the current `ibleatools` frozen BWM
project `ibl_neuropixel_brainwide_01`. This is an Alyx project/cohort and S3
namespace, not an immutable release identifier. The builder must therefore
snapshot and checksum its exact aggregate objects before building.

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

Every production snapshot build must load
`docs/data/CLUSTERS_CATALOG_SELECTION.json`. D044 freezes the exact 14-feature
catalog declared by the pinned original Ephys Atlas repository and its explicit
cluster-unit mapping. The builder rejects any mismatch in project, source
snapshot, table bytes/hash, catalog, or display defaults before Parquet decode.
Large waveform, ACG, STPC, and STLFP arrays are not silently reduced into
regional features.

The D038 source audit is complete for content-addressed snapshot
`sha256-9b5e55215b306f26`. All 14 candidates are present, but the pinned upstream
schema declares no units, but the pinned original website repository supplies
the cluster unit mapping. The scientific owner approved its complete feature
set and the audited source semantics on 2026-08-24. See
`docs/data/CLUSTERS_SOURCE_AUDIT.md` and the raw JSON report it references.

## Example

```bash
ephys-atlas-data pull ephys_atlas_clusters latest --project ibl_neuropixel_brainwide_01

ephys-atlas-data build-clusters latest \
  --project ibl_neuropixel_brainwide_01 \
  --population all \
  --catalog-selection docs/data/CLUSTERS_CATALOG_SELECTION.json \
  --created-at 2026-08-20T00:00:00Z \
  --ibleatools-commit <commit> \
  --iblatlas-commit <commit> \
  --builder-commit <commit>
```

The CLI resolves `latest` to the pulled content-derived snapshot id and writes
the validated release under
`data/releases/ephys_atlas_clusters/<content-release-id>/`.
