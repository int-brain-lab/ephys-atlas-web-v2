import type {
  BinaryArrayDescriptor,
  DistributionBinning,
  GlobalStatistics,
  RegionMetadata,
  RegionalFeaturePayload,
} from './contracts.js';
import { parseBinaryArray } from './validation/binary.js';
import {
  parseDistributionBinning,
  validateDistributionBinningSet,
  type DistributionBinningResource,
} from './validation/distribution.js';
import { array } from './validation/primitives.js';

function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${context} must be a finite number`);
  }
  return value;
}

function integer(value: unknown, context: string): number {
  const parsed = finiteNumber(value, context);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${context} must be a safe integer`);
  return parsed;
}

function nonEmptyString(value: unknown, context: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${context} must be a non-empty string`);
  return value;
}

export function parseRegionMetadata(value: unknown): readonly RegionMetadata[] {
  if (!Array.isArray(value)) throw new Error('region metadata must be an array');
  const seenIds = new Set<string>();
  const seenIndices = new Set<number>();
  const regions = value.map((raw, position) => {
    const item = object(raw, `regions[${position}]`);
    const atlasId = integer(item.atlas_id, `regions[${position}].atlas_id`);
    const index = integer(item.index, `regions[${position}].index`);
    const id = String(atlasId);
    if (seenIds.has(id)) throw new Error(`duplicate region atlas_id ${id}`);
    if (seenIndices.has(index)) throw new Error(`duplicate region index ${index}`);
    seenIds.add(id);
    seenIndices.add(index);
    const region: RegionMetadata = {
      id,
      atlasId,
      index,
      acronym: nonEmptyString(item.acronym, `regions[${position}].acronym`),
      name: nonEmptyString(item.name, `regions[${position}].name`),
    };
    if (item.parent_id === null) region.parentId = null;
    else if (typeof item.parent_id === 'number' && Number.isInteger(item.parent_id)) {
      region.parentId = String(item.parent_id);
    } else if (typeof item.parent_id === 'string' && item.parent_id) {
      region.parentId = item.parent_id;
    }
    if (typeof item.depth === 'number' && Number.isInteger(item.depth) && item.depth >= 0) {
      region.depth = item.depth;
    }
    return region;
  });
  return regions.sort((left, right) => left.index - right.index);
}

export interface RegionalStatisticsResource {
  fields: readonly string[];
  values: BinaryArrayDescriptor;
  population?: string;
  global?: GlobalStatistics;
  distribution?: {
    binnings: readonly DistributionBinningResource[];
  };
}

function optionalStatistic(
  source: Record<string, unknown>,
  sourceKey: string,
  targetKey: keyof GlobalStatistics,
  target: GlobalStatistics,
): void {
  const value = source[sourceKey];
  if (typeof value === 'number' && Number.isFinite(value)) target[targetKey] = value;
}

export function parseRegionalStatisticsResource(value: unknown): RegionalStatisticsResource {
  const root = object(value, 'statistics');
  if (root.schema_version !== '1.0' || root.format !== 'ephys-atlas-regional-statistics-v1') {
    throw new Error('statistics.format is unsupported');
  }
  const population = nonEmptyString(root.population, 'statistics.population');
  const regional = object(root.regional_summary, 'statistics.regional_summary');
  if (!Array.isArray(regional.fields)) {
    throw new Error('statistics.regional_summary.fields must be an array');
  }
  const fields = regional.fields.map((field, index) => (
    nonEmptyString(field, `statistics.regional_summary.fields[${index}]`)
  ));
  const supportedFields = new Set(['count', 'missing_count', 'min', 'max', 'mean', 'std', 'median', 'q05', 'q25', 'q75', 'q95']);
  if (fields.length === 0 || fields.some((field) => !supportedFields.has(field)) || new Set(fields).size !== fields.length) {
    throw new Error('statistics.regional_summary.fields contains duplicate or unsupported values');
  }
  const parsed: Omit<RegionalStatisticsResource, 'distribution'> = {
    fields,
    values: parseBinaryArray(regional.values, 'statistics.regional_summary.values'),
    population,
  };
  const source = object(root.global, 'statistics.global');
  const count = integer(source.count, 'statistics.global.count');
  const missingCount = integer(source.missing_count, 'statistics.global.missing_count');
  if (count < 0 || missingCount < 0) throw new Error('statistics.global counts must be non-negative');
  const global: GlobalStatistics = { count, missingCount };
  const fieldMappings = [
      ['min', 'min'],
      ['max', 'max'],
      ['mean', 'mean'],
      ['std', 'std'],
      ['median', 'median'],
      ['q05', 'q05'],
      ['q25', 'q25'],
      ['q75', 'q75'],
      ['q95', 'q95'],
  ] as const;
  const descriptiveFields = new Set(['min', 'max', 'mean', 'std', 'median']);
  for (const [sourceKey, targetKey] of fieldMappings) {
    const value = source[sourceKey];
    if (descriptiveFields.has(sourceKey) && value === undefined) {
      throw new Error(`statistics.global.${sourceKey} is required`);
    }
    if (value !== undefined && value !== null) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`statistics.global.${sourceKey} must be finite or null`);
      }
      optionalStatistic(source, sourceKey, targetKey, global);
    }
  }
  const descriptiveValues = ['min', 'max', 'mean', 'std', 'median']
    .map((field) => source[field]);
  if (count === 0 && descriptiveValues.some((value) => value !== null)) {
    throw new Error('empty statistics require null descriptive values');
  }
  if (count > 0 && descriptiveValues.some((value) => value === null)) {
    throw new Error('nonempty statistics require finite descriptive values');
  }
  parsed.global = global;
  const populationCount = parsed.global?.count;
  if (populationCount === undefined || !Number.isSafeInteger(populationCount) || populationCount < 0) {
    throw new Error('statistics.global.count is required for distribution validation');
  }
  if (root.distribution === undefined) {
    if (populationCount > 0) throw new Error('nonempty statistics require a distribution');
    return parsed;
  }
  if (populationCount === 0) throw new Error('empty statistics must omit its distribution');
  const distribution = object(root.distribution, 'statistics.distribution');
  const binnings = array(distribution.binnings, 'statistics.distribution.binnings')
    .map((item, index) => parseDistributionBinning(
      item,
      `statistics.distribution.binnings[${index}]`,
      true,
    ));
  validateDistributionBinningSet(
    binnings,
    populationCount,
    'statistics.distribution',
    parsed.global?.min,
    parsed.global?.max,
  );
  return { ...parsed, distribution: { binnings } };
}

export function materializeDistributionBinning(
  resource: DistributionBinningResource,
  flatCounts: readonly number[],
  regionCount: number,
): DistributionBinning {
  if (!resource.regionalCounts) throw new Error('regional distribution binning requires regional counts');
  const binCount = resource.global.binCounts.length;
  const rowWidth = binCount + 2;
  const shape = resource.regionalCounts.shape;
  if (shape.length !== 2 || shape[0] !== regionCount || shape[1] !== rowWidth) {
    throw new Error(`regional distribution shape must be [${regionCount}, ${rowWidth}]`);
  }
  if (flatCounts.length !== regionCount * rowWidth) {
    throw new Error('regional distribution payload length is inconsistent');
  }
  return {
    id: resource.id,
    scale: resource.scale,
    domain: resource.domain,
    edges: resource.edges,
    global: resource.global,
    regional: Array.from({ length: regionCount }, (_, row) => {
      const offset = row * rowWidth;
      return {
        underflowCount: flatCounts[offset]!,
        binCounts: flatCounts.slice(offset + 1, offset + 1 + binCount),
        overflowCount: flatCounts[offset + rowWidth - 1]!,
      };
    }),
    binRule: resource.binRule,
  };
}
