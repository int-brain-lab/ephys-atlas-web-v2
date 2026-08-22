import type { BinaryArrayDescriptor } from '../contracts.js';
import { parseBinaryArray } from './binary.js';
import { array, object, string, unique } from './primitives.js';

export interface StatisticsDocument {
  fields: readonly string[];
  values: BinaryArrayDescriptor;
  histogram?: {
    edges: readonly number[];
    regionalCounts: BinaryArrayDescriptor;
  };
}

export function parseStatisticsDocument(value: unknown): StatisticsDocument {
  const root = object(value, 'statistics');
  if (root.schema_version !== '1.0') throw new Error('statistics.schema_version is unsupported');
  if (root.format !== 'ephys-atlas-regional-statistics-v1') throw new Error('statistics.format is unsupported');
  string(root.population, 'statistics.population');
  const global = object(root.global, 'statistics.global');
  for (const field of ['count', 'missing_count'] as const) {
    if (typeof global[field] !== 'number' || !Number.isInteger(global[field]) || global[field] < 0) {
      throw new Error(`statistics.global.${field} must be a non-negative integer`);
    }
  }
  for (const field of ['min', 'max', 'mean', 'std', 'median'] as const) {
    if (global[field] !== null && (typeof global[field] !== 'number' || !Number.isFinite(global[field]))) {
      throw new Error(`statistics.global.${field} must be finite or null`);
    }
  }
  const regional = object(root.regional_summary, 'statistics.regional_summary');
  const fields = array(regional.fields, 'statistics.regional_summary.fields')
    .map((item, index) => string(item, `statistics.regional_summary.fields[${index}]`));
  const supportedFields = new Set(['count', 'missing_count', 'min', 'max', 'mean', 'std', 'median', 'q05', 'q25', 'q75', 'q95']);
  if (fields.length === 0 || fields.some((field) => !supportedFields.has(field))) {
    throw new Error('statistics.regional_summary.fields contains unsupported values');
  }
  unique(fields, 'statistics.regional_summary.fields');
  const result: StatisticsDocument = {
    fields,
    values: parseBinaryArray(regional.values, 'statistics.regional_summary.values'),
  };
  if (root.histogram !== undefined) {
    const histogram = object(root.histogram, 'statistics.histogram');
    const edges = array(histogram.edges, 'statistics.histogram.edges').map((item, index) => {
      if (typeof item !== 'number' || !Number.isFinite(item)) throw new Error(`statistics.histogram.edges[${index}] must be finite`);
      return item;
    });
    if (edges.length < 2 || edges.some((edge, index) => index > 0 && edge <= edges[index - 1]!)) {
      throw new Error('statistics.histogram.edges must be strictly increasing');
    }
    const globalCounts = array(histogram.global_counts, 'statistics.histogram.global_counts');
    if (globalCounts.length !== edges.length - 1
      || globalCounts.some((item) => typeof item !== 'number' || !Number.isInteger(item) || item < 0)) {
      throw new Error('statistics.histogram.global_counts must contain one non-negative integer per bin');
    }
    if (histogram.bin_rule !== 'left-closed-right-open-last-closed') {
      throw new Error('statistics.histogram.bin_rule is unsupported');
    }
    result.histogram = {
      edges,
      regionalCounts: parseBinaryArray(histogram.regional_counts, 'statistics.histogram.regional_counts'),
    };
  }
  return result;
}
