import type { DistributionBinning, RegionMetadata } from '../../data/contracts.js';
import type { ParcellationId, VolumeRegionHemisphere } from '../../domain/types.js';
import { selectVolumeRegionDistribution } from '../../data/volume-regional-loader.js';

export interface VolumeDistributionExportOptions {
  readonly datasetId: string;
  readonly releaseId: string;
  readonly featureId: string;
  readonly parcellation: ParcellationId;
  readonly hemisphere: VolumeRegionHemisphere;
  readonly selectedRegionIds: readonly string[];
  readonly regions: readonly RegionMetadata[];
  readonly physicalRegions: readonly RegionMetadata[];
  readonly binning: DistributionBinning;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildVolumeDistributionExport(options: VolumeDistributionExportOptions): {
  readonly csv: string;
  readonly filename: string;
} {
  const regionById = new Map(options.regions.map((region) => [region.id, region]));
  const header = [
    'dataset_id', 'release_id', 'feature_id', 'parcellation', 'region_id', 'acronym',
    'region_name', 'hemisphere', 'binning_id', 'bin_kind', 'bin_index', 'lower_edge',
    'upper_edge', 'count', 'population',
  ];
  const rows: Array<Array<string | number>> = [header];
  for (const regionId of options.selectedRegionIds) {
    const counts = selectVolumeRegionDistribution(
      options.binning,
      options.physicalRegions,
      regionId,
      options.hemisphere,
    );
    if (!counts) continue;
    const region = regionById.get(regionId);
    const population = counts.underflowCount
      + counts.binCounts.reduce((sum, count) => sum + count, 0)
      + counts.overflowCount;
    const prefix: Array<string | number> = [
      options.datasetId, options.releaseId, options.featureId, options.parcellation,
      regionId, region?.acronym ?? '', region?.name ?? '', options.hemisphere,
      options.binning.id,
    ];
    rows.push([...prefix, 'underflow', '', '', options.binning.edges[0] ?? '', counts.underflowCount, population]);
    counts.binCounts.forEach((count, index) => {
      rows.push([
        ...prefix, 'bin', index, options.binning.edges[index] ?? '',
        options.binning.edges[index + 1] ?? '', count, population,
      ]);
    });
    rows.push([
      ...prefix, 'overflow', '', options.binning.edges.at(-1) ?? '', '',
      counts.overflowCount, population,
    ]);
  }
  return {
    csv: `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`,
    filename: `${options.datasetId}-${options.releaseId}-${options.featureId}-${options.parcellation}-${options.hemisphere}-regional-distributions.csv`,
  };
}
