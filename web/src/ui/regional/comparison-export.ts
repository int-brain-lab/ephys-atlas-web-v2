import type {
  FeatureDescriptor,
  DistributionBinning,
  RegionalFeaturePayload,
  RegionMetadata,
} from '../../data/contracts.js';
import type { StatisticId } from '../../domain/types.js';
import { histogramDistribution } from './model.js';

export interface ComparisonExportOptions {
  datasetId: string;
  releaseId: string;
  feature: RegionalFeaturePayload;
  descriptor?: FeatureDescriptor;
  regions: readonly RegionMetadata[];
  selectedRegionIds: readonly string[];
  statistic: StatisticId;
  binning?: DistributionBinning;
}

export interface ComparisonExport {
  filename: string;
  csv: string;
}

const FIELDS = [
  'dataset_id',
  'release_id',
  'feature_id',
  'representation',
  'parcellation',
  'selected_statistic',
  'unit',
  'population',
  'value_scale',
  'distribution_domain',
  'symlog_linear_threshold',
  'focus_lower_bound',
  'focus_upper_bound',
  'region_id',
  'acronym',
  'region_name',
  'observation_count',
  'missing_count',
  'min',
  'max',
  'mean',
  'std',
  'median',
  'q05',
  'q25',
  'q75',
  'q95',
  'bin_start',
  'bin_end',
  'bin_count',
  'bin_probability',
  'population_denominator',
  'underflow_count',
  'underflow_probability',
  'overflow_count',
  'overflow_probability',
] as const;

export function buildSelectedComparisonExport(options: ComparisonExportOptions): ComparisonExport {
  const { datasetId, releaseId, feature, descriptor, regions, selectedRegionIds, statistic, binning } = options;
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const indexById = new Map(feature.regionIds.map((id, index) => [id, index]));
  const rows: string[][] = [];
  for (const regionId of selectedRegionIds) {
    const rowIndex = indexById.get(regionId);
    if (rowIndex === undefined) continue;
    const region = regionById.get(regionId);
    const value = (field: keyof RegionalFeaturePayload['statistics']): string => {
      const number = feature.statistics[field]?.[rowIndex];
      return number !== undefined && Number.isFinite(number) ? String(number) : '';
    };
    const counts = binning?.regional?.[rowIndex];
    const distribution = counts ? histogramDistribution(counts) : null;
    const binCount = distribution?.counts.length ?? 0;
    const iterations = Math.max(1, binCount);
    for (let bin = 0; bin < iterations; bin += 1) {
      rows.push([
        datasetId,
        releaseId,
        feature.featureId,
        feature.representation,
        feature.parcellation,
        statistic,
        descriptor?.unit ?? '',
        feature.population ?? '',
        binning?.scale.kind ?? '',
        binning?.domain.kind ?? '',
        binning?.scale.kind === 'symlog' ? String(binning.scale.linearThreshold) : '',
        binning?.domain.kind === 'focused' ? String(binning.domain.bounds[0]) : '',
        binning?.domain.kind === 'focused' ? String(binning.domain.bounds[1]) : '',
        regionId,
        region?.acronym ?? '',
        region?.name ?? '',
        value('count'),
        value('missing_count'),
        value('min'),
        value('max'),
        value('mean'),
        value('std'),
        value('median'),
        value('q05'),
        value('q25'),
        value('q75'),
        value('q95'),
        binCount > 0 ? String(binning?.edges[bin] ?? '') : '',
        binCount > 0 ? String(binning?.edges[bin + 1] ?? '') : '',
        binCount > 0 ? String(distribution?.counts[bin] ?? '') : '',
        binCount > 0 ? String(distribution?.probabilities[bin] ?? '') : '',
        distribution ? String(distribution.total) : '',
        distribution ? String(distribution.underflowCount) : '',
        distribution ? String(distribution.underflowProbability) : '',
        distribution ? String(distribution.overflowCount) : '',
        distribution ? String(distribution.overflowProbability) : '',
      ]);
    }
  }
  return {
    filename: `${datasetId}-${releaseId}-${feature.featureId}-${feature.parcellation}-selected-comparison.csv`,
    csv: [FIELDS, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n',
  };
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
