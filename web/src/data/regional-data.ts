import type {
  BinaryArrayDescriptor,
  GlobalStatistics,
  RegionMetadata,
  RegionalHistogram,
} from './contracts.js';
import { parseBinaryArray } from './validate.js';

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
  if (!Number.isInteger(parsed)) throw new Error(`${context} must be an integer`);
  return parsed;
}

function nonEmptyString(value: unknown, context: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${context} must be a non-empty string`);
  return value;
}

function finiteNumberArray(value: unknown, context: string): number[] {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array`);
  return value.map((item, index) => finiteNumber(item, `${context}[${index}]`));
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
  histogram?: {
    edges: readonly number[];
    globalCounts: readonly number[];
    regionalCounts?: BinaryArrayDescriptor;
    binRule?: string;
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
  if (root.format !== 'ephys-atlas-statistics-v0.1') {
    throw new Error('statistics.format is unsupported');
  }
  const regional = object(root.regional_summary, 'statistics.regional_summary');
  if (!Array.isArray(regional.fields)) {
    throw new Error('statistics.regional_summary.fields must be an array');
  }
  const fields = regional.fields.map((field, index) => (
    nonEmptyString(field, `statistics.regional_summary.fields[${index}]`)
  ));
  const parsed: RegionalStatisticsResource = {
    fields,
    values: parseBinaryArray(regional.values, 'statistics.regional_summary.values'),
  };
  if (typeof root.population === 'string' && root.population) parsed.population = root.population;
  if (root.global !== undefined) {
    const source = object(root.global, 'statistics.global');
    const global: GlobalStatistics = {};
    const fieldMappings = [
      ['count', 'count'],
      ['missing_count', 'missingCount'],
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
    for (const [sourceKey, targetKey] of fieldMappings) {
      optionalStatistic(source, sourceKey, targetKey, global);
    }
    parsed.global = global;
  }
  if (root.histogram !== undefined) {
    const histogram = object(root.histogram, 'statistics.histogram');
    const edges = finiteNumberArray(histogram.edges, 'statistics.histogram.edges');
    const globalCounts = finiteNumberArray(histogram.global_counts, 'statistics.histogram.global_counts');
    if (edges.length !== globalCounts.length + 1) {
      throw new Error('histogram edges must be one longer than global counts');
    }
    parsed.histogram = {
      edges,
      globalCounts,
      ...(histogram.regional_counts !== undefined
        ? { regionalCounts: parseBinaryArray(histogram.regional_counts, 'statistics.histogram.regional_counts') }
        : {}),
      ...(typeof histogram.bin_rule === 'string' ? { binRule: histogram.bin_rule } : {}),
    };
  }
  return parsed;
}

export function materializeRegionalHistogram(
  resource: NonNullable<RegionalStatisticsResource['histogram']>,
  flatCounts: readonly number[] | null,
  regionCount: number,
): RegionalHistogram {
  const histogram: RegionalHistogram = {
    edges: resource.edges,
    globalCounts: resource.globalCounts,
    ...(resource.binRule ? { binRule: resource.binRule } : {}),
  };
  if (!resource.regionalCounts) return histogram;
  const shape = resource.regionalCounts.shape;
  const binCount = resource.globalCounts.length;
  if (shape.length !== 2 || shape[0] !== regionCount || shape[1] !== binCount) {
    throw new Error(`regional histogram shape must be [${regionCount}, ${binCount}]`);
  }
  if (!flatCounts || flatCounts.length !== regionCount * binCount) {
    throw new Error('regional histogram payload length is inconsistent');
  }
  histogram.regionalCounts = Array.from(
    { length: regionCount },
    (_, row) => flatCounts.slice(row * binCount, (row + 1) * binCount),
  );
  return histogram;
}
