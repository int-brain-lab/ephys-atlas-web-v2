import type { ParcellationId, StatisticId } from '../domain/types.js';
import { SCHEMA_VERSION } from './contracts.js';
import type {
  FeatureDescriptor,
  ParcellationDescriptor,
  RegionMetadata,
  RegionalFeaturePayload,
  RegionalStatisticId,
} from './contracts.js';
import { materializeDistributionBinning, parseRegionMetadata, parseRegionalStatisticsResource } from './regional-data.js';
import type { ResourceReader } from './resource-reader.js';
import { validateDistributionMatchesDisplay } from './validation/distribution.js';

const DISPLAY_STATISTICS = new Set<StatisticId>(['mean', 'median', 'std', 'min', 'max', 'count']);
const REGIONAL_STATISTICS = new Set<RegionalStatisticId>([
  ...DISPLAY_STATISTICS,
  'missing_count',
  'std',
  'q05',
  'q25',
  'q75',
  'q95',
]);

export async function loadRegionsFromResources(
  reader: ResourceReader,
  manifestLocation: string,
  parcellation: ParcellationId,
  descriptor: ParcellationDescriptor,
): Promise<readonly RegionMetadata[]> {
  if (!descriptor.metadata) throw new Error(`${parcellation} parcellation has no region metadata resource`);
  const [raw, regionIds] = await Promise.all([
    reader.readJson(
      reader.resolve(manifestLocation, descriptor.metadata),
      undefined,
      descriptor.metadataResource,
    ),
    reader.readArray(reader.resolve(manifestLocation, descriptor.regionIndex.path), descriptor.regionIndex),
  ]);
  const regions = parseRegionMetadata(raw);
  if (regions.length !== regionIds.length) throw new Error(`${parcellation} metadata does not match region index length`);
  for (const region of regions) {
    if (region.index < 0 || region.index >= regionIds.length || regionIds[region.index] !== region.atlasId) {
      throw new Error(`${parcellation} metadata/index mismatch at region ${region.id}`);
    }
  }
  return regions;
}

export async function loadRegionalFeatureFromResources(options: {
  reader: ResourceReader;
  manifestLocation: string;
  featureLocation: string;
  feature: FeatureDescriptor;
  parcellation: ParcellationId;
  parcellationDescriptor: ParcellationDescriptor;
  signal?: AbortSignal;
}): Promise<RegionalFeaturePayload> {
  const { reader, manifestLocation, featureLocation, feature, parcellation, parcellationDescriptor, signal } = options;
  const regional = feature.representations.regional?.parcellations[parcellation];
  if (!regional) throw new Error(`Feature ${feature.id} has no ${parcellation} regional representation`);

  const [regionIds, values, statisticsRaw] = await Promise.all([
    reader.readArray(
      reader.resolve(manifestLocation, parcellationDescriptor.regionIndex.path),
      parcellationDescriptor.regionIndex,
      signal,
    ),
    reader.readArray(reader.resolve(featureLocation, regional.values.path), regional.values, signal),
    reader.readJson(
      reader.resolve(featureLocation, regional.statistics),
      signal,
      regional.statisticsResource,
    ),
  ]);
  if (regionIds.length !== values.length) {
    throw new Error(`${feature.id}/${parcellation} values do not match region index length`);
  }

  const statistics: RegionalFeaturePayload['statistics'] = {};
  if (DISPLAY_STATISTICS.has(regional.summary as StatisticId)) {
    statistics[regional.summary as StatisticId] = values;
  }

  const statsDocument = parseRegionalStatisticsResource(statisticsRaw);
  const display = feature.display?.regional;
  if (!display) throw new Error(`Feature ${feature.id} has no regional display contract`);
  const distributionResources = statsDocument.distribution?.binnings ?? [];
  if (statsDocument.distribution) {
    validateDistributionMatchesDisplay(distributionResources, display, `${feature.id}/${parcellation}`);
  }
  const statsLocation = reader.resolve(featureLocation, regional.statistics);
  const [matrix, ...distributionRows] = await Promise.all([
    reader.readArray(reader.resolve(statsLocation, statsDocument.values.path), statsDocument.values, signal),
    ...distributionResources.map((binning) => {
      if (!binning.regionalCounts) throw new Error(`${feature.id}/${parcellation}/${binning.id} has no regional counts`);
      return reader.readArray(
        reader.resolve(statsLocation, binning.regionalCounts.path),
        binning.regionalCounts,
        signal,
      );
    }),
  ]);

  const fieldCount = statsDocument.fields.length;
  if (
    statsDocument.values.shape.length !== 2
    || statsDocument.values.shape[0] !== regionIds.length
    || statsDocument.values.shape[1] !== fieldCount
  ) {
    throw new Error(`${feature.id}/${parcellation} regional statistics shape is inconsistent`);
  }
  for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex += 1) {
    const field = statsDocument.fields[fieldIndex];
    if (!field || !REGIONAL_STATISTICS.has(field as RegionalStatisticId)) continue;
    statistics[field as RegionalStatisticId] = regionIds.map((_, row) => matrix[row * fieldCount + fieldIndex] ?? NaN);
  }
  const regionalPopulationCounts = statistics.count;
  if (!regionalPopulationCounts) throw new Error(`${feature.id}/${parcellation} regional statistics require count`);
  const binnings = distributionResources.map((binning, index) => (
    materializeDistributionBinning(binning, distributionRows[index]!, regionIds.length)
  ));
  for (const binning of binnings) {
    binning.regional?.forEach((counts, row) => {
      const total = counts.underflowCount
        + counts.binCounts.reduce((sum, count) => sum + count, 0)
        + counts.overflowCount;
      if (total !== regionalPopulationCounts[row]) {
        throw new Error(`${feature.id}/${parcellation}/${binning.id} region ${row} does not conserve its population`);
      }
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    featureId: feature.id,
    representation: 'regional',
    parcellation,
    regionIds: regionIds.map(String),
    statistics,
    ...(statsDocument.population ? { population: statsDocument.population } : {}),
    ...(statsDocument.global ? { global: statsDocument.global } : {}),
    ...(binnings.length > 0 ? { distribution: { binnings } } : {}),
  };
}
