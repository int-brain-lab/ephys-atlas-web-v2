import type { ParcellationId, StatisticId } from '../domain/types.js';
import { SCHEMA_VERSION } from './contracts.js';
import type {
  FeatureDescriptor,
  ParcellationDescriptor,
  RegionMetadata,
  RegionalFeaturePayload,
} from './contracts.js';
import { materializeRegionalHistogram, parseRegionMetadata, parseRegionalStatisticsResource } from './regional-data.js';
import type { ResourceReader } from './resource-reader.js';

const DISPLAY_STATISTICS = new Set<StatisticId>(['mean', 'median', 'min', 'max', 'count']);

export async function loadRegionsFromResources(
  reader: ResourceReader,
  manifestLocation: string,
  parcellation: ParcellationId,
  descriptor: ParcellationDescriptor,
): Promise<readonly RegionMetadata[]> {
  if (!descriptor.metadata) throw new Error(`${parcellation} parcellation has no region metadata resource`);
  const [raw, regionIds] = await Promise.all([
    reader.readJson(reader.resolve(manifestLocation, descriptor.metadata)),
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
}): Promise<RegionalFeaturePayload> {
  const { reader, manifestLocation, featureLocation, feature, parcellation, parcellationDescriptor } = options;
  const regional = feature.representations.regional?.parcellations[parcellation];
  if (!regional) throw new Error(`Feature ${feature.id} has no ${parcellation} regional representation`);

  const [regionIds, values, statisticsRaw] = await Promise.all([
    reader.readArray(
      reader.resolve(manifestLocation, parcellationDescriptor.regionIndex.path),
      parcellationDescriptor.regionIndex,
    ),
    reader.readArray(reader.resolve(featureLocation, regional.values.path), regional.values),
    reader.readJson(reader.resolve(featureLocation, regional.statistics)),
  ]);
  if (regionIds.length !== values.length) {
    throw new Error(`${feature.id}/${parcellation} values do not match region index length`);
  }

  const statistics: RegionalFeaturePayload['statistics'] = {};
  if (DISPLAY_STATISTICS.has(regional.summary as StatisticId)) {
    statistics[regional.summary as StatisticId] = values;
  }

  const statsDocument = parseRegionalStatisticsResource(statisticsRaw);
  const statsLocation = reader.resolve(featureLocation, regional.statistics);
  const [matrix, histogramFlat] = await Promise.all([
    reader.readArray(reader.resolve(statsLocation, statsDocument.values.path), statsDocument.values),
    statsDocument.histogram?.regionalCounts
      ? reader.readArray(
          reader.resolve(statsLocation, statsDocument.histogram.regionalCounts.path),
          statsDocument.histogram.regionalCounts,
        )
      : Promise.resolve(null),
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
    if (!field || !DISPLAY_STATISTICS.has(field as StatisticId)) continue;
    statistics[field as StatisticId] = regionIds.map((_, row) => matrix[row * fieldCount + fieldIndex] ?? NaN);
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
    ...(statsDocument.histogram
      ? { histogram: materializeRegionalHistogram(statsDocument.histogram, histogramFlat, regionIds.length) }
      : {}),
  };
}
