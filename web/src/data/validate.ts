import type { DatasetId, ParcellationId, StatisticId } from '../domain/types.js';
import {
  SCHEMA_VERSION,
  type BinaryArrayDescriptor,
  type BinaryDType,
  type DatasetCatalog,
  type DatasetManifest,
  type DatasetManifestDocument,
  type FeatureDescriptor,
  type FeaturePayload,
  type RegionalFeaturePayload,
} from './contracts.js';

function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, context: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${context} must be a non-empty string`);
  return value;
}

function boolean(value: unknown, context: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${context} must be a boolean`);
  return value;
}

function array(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array`);
  return value;
}

function numberArray(value: unknown, length: number, context: string): number[] {
  const values = array(value, context);
  if (values.length !== length || values.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error(`${context} must contain ${length} finite numbers`);
  }
  return values as number[];
}

function parcellation(value: unknown, context: string): ParcellationId {
  if (value !== 'allen' && value !== 'beryl' && value !== 'cosmos') throw new Error(`${context} must be allen, beryl, or cosmos`);
  return value;
}

function statistic(value: unknown, context: string): StatisticId {
  if (!['mean', 'median', 'min', 'max', 'count'].includes(String(value))) throw new Error(`${context} is not a supported display statistic`);
  return value as StatisticId;
}

function dtype(value: unknown, context: string): BinaryDType {
  const supported: readonly BinaryDType[] = ['int16', 'int32', 'uint16', 'uint32', 'float16', 'float32', 'float64'];
  if (!supported.includes(value as BinaryDType)) throw new Error(`${context} has unsupported dtype ${String(value)}`);
  return value as BinaryDType;
}

export function parseBinaryArray(value: unknown, context: string): BinaryArrayDescriptor {
  const item = object(value, context);
  const shape = array(item.shape, `${context}.shape`).map((dimension, index) => {
    if (typeof dimension !== 'number' || !Number.isInteger(dimension) || dimension < 0) {
      throw new Error(`${context}.shape[${index}] must be a non-negative integer`);
    }
    return dimension;
  });
  if (item.order !== 'C') throw new Error(`${context}.order must be C`);
  if (item.endianness !== 'little' && item.endianness !== 'not-applicable') {
    throw new Error(`${context}.endianness must be little or not-applicable`);
  }
  const descriptor: BinaryArrayDescriptor = {
    path: string(item.path, `${context}.path`),
    dtype: dtype(item.dtype, `${context}.dtype`),
    shape,
    order: 'C',
    endianness: item.endianness,
  };
  if (typeof item.sha256 === 'string') descriptor.sha256 = item.sha256;
  if (typeof item.bytes === 'number' && Number.isInteger(item.bytes) && item.bytes >= 0) descriptor.bytes = item.bytes;
  return descriptor;
}

export function parseDatasetCatalog(value: unknown): DatasetCatalog {
  const root = object(value, 'catalog');
  if (root.schemaVersion !== SCHEMA_VERSION) throw new Error(`catalog.schemaVersion must be ${SCHEMA_VERSION}`);
  const datasets = array(root.datasets, 'catalog.datasets').map((value, index) => {
    const item = object(value, `catalog.datasets[${index}]`);
    const releases = array(item.releases, `catalog.datasets[${index}].releases`).map((value, releaseIndex) => {
      const release = object(value, `catalog.datasets[${index}].releases[${releaseIndex}]`);
      return {
        id: string(release.id, `catalog.datasets[${index}].releases[${releaseIndex}].id`),
        label: string(release.label, `catalog.datasets[${index}].releases[${releaseIndex}].label`),
        manifest: string(release.manifest, `catalog.datasets[${index}].releases[${releaseIndex}].manifest`),
        immutable: boolean(release.immutable, `catalog.datasets[${index}].releases[${releaseIndex}].immutable`),
      };
    });
    const id = string(item.id, `catalog.datasets[${index}].id`) as DatasetId;
    const defaultRelease = string(item.defaultRelease, `catalog.datasets[${index}].defaultRelease`);
    if (!releases.some((release) => release.id === defaultRelease)) throw new Error(`catalog dataset ${id} defaultRelease is missing from releases`);
    return {
      id,
      title: string(item.title, `catalog.datasets[${index}].title`),
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
      releases,
      defaultRelease,
    };
  });
  return { schemaVersion: SCHEMA_VERSION, datasets };
}

export function parseDatasetManifestDocument(value: unknown): DatasetManifestDocument {
  const root = object(value, 'manifest');
  if (root.schema_version !== SCHEMA_VERSION) throw new Error(`manifest.schema_version must be ${SCHEMA_VERSION}`);
  const release = object(root.release, 'manifest.release');
  const parcellations = array(root.parcellations, 'manifest.parcellations').map((value, index) => {
    const item = object(value, `manifest.parcellations[${index}]`);
    return {
      id: parcellation(item.id, `manifest.parcellations[${index}].id`),
      regionIndex: parseBinaryArray(item.region_index, `manifest.parcellations[${index}].region_index`),
      ...(typeof item.metadata === 'string' ? { metadata: item.metadata } : {}),
    };
  });
  const featureRefs = array(root.features, 'manifest.features').map((value, index) => {
    const item = object(value, `manifest.features[${index}]`);
    return {
      id: string(item.id, `manifest.features[${index}].id`),
      path: string(item.path, `manifest.features[${index}].path`),
    };
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    datasetId: string(root.dataset_id, 'manifest.dataset_id'),
    title: string(root.title, 'manifest.title'),
    description: typeof root.description === 'string' ? root.description : '',
    release: {
      releaseId: string(release.release_id, 'manifest.release.release_id'),
      immutable: boolean(release.immutable, 'manifest.release.immutable'),
      createdAt: string(release.created_at, 'manifest.release.created_at'),
      paperSnapshot: boolean(release.paper_snapshot, 'manifest.release.paper_snapshot'),
    },
    parcellations,
    featureRefs,
  };
}

export function parseFeatureDescriptor(value: unknown, path: string): FeatureDescriptor {
  const root = object(value, `feature ${path}`);
  if (root.schema_version !== SCHEMA_VERSION) throw new Error(`${path}.schema_version must be ${SCHEMA_VERSION}`);
  const representations = object(root.representations, `${path}.representations`);
  const descriptor: FeatureDescriptor = {
    id: string(root.id, `${path}.id`),
    path,
    label: string(root.label, `${path}.label`),
    description: typeof root.description === 'string' ? root.description : '',
    unit: typeof root.unit === 'string' ? root.unit : null,
    statistics: [],
    representations: {},
  };

  if (representations.regional !== undefined) {
    const regional = object(representations.regional, `${path}.representations.regional`);
    if (regional.format !== 'ephys-atlas-regional-v0.1') throw new Error(`${path} has unsupported regional format`);
    const mappings: Partial<Record<ParcellationId, ReturnType<typeof parseRegionalParcellation>>> = {};
    const stats = new Set<StatisticId>();
    for (const [index, raw] of array(regional.parcellations, `${path}.representations.regional.parcellations`).entries()) {
      const parsed = parseRegionalParcellation(raw, `${path}.representations.regional.parcellations[${index}]`);
      mappings[parsed.parcellationId] = parsed;
      try { stats.add(statistic(parsed.summary, `${path}.summary`)); } catch { /* descriptive field may not be a UI statistic */ }
    }
    descriptor.statistics = [...stats];
    descriptor.representations.regional = {
      kind: 'regional',
      format: 'ephys-atlas-regional-v0.1',
      parcellations: mappings,
    };
  }

  if (representations.volume !== undefined) {
    const volume = object(representations.volume, `${path}.representations.volume`);
    if (volume.format !== 'ephys-atlas-chunked-volume-v0.1') throw new Error(`${path} has unsupported volume format`);
    if (volume.layout !== 'chunks3d' && volume.layout !== 'orthogonal_slice_packs') throw new Error(`${path}.volume.layout is unsupported`);
    const grid = object(volume.grid, `${path}.volume.grid`);
    const arrayDescriptor = object(volume.array, `${path}.volume.array`);
    const shape = numberArray(grid.shape, 3, `${path}.volume.grid.shape`) as [number, number, number];
    const axisOrder = array(grid.axis_order, `${path}.volume.grid.axis_order`).map((item, i) => string(item, `${path}.volume.grid.axis_order[${i}]`));
    if (axisOrder.length !== 3) throw new Error(`${path}.volume.grid.axis_order must have three entries`);
    const voxelSizeUm = numberArray(grid.voxel_size_um, 3, `${path}.volume.grid.voxel_size_um`) as [number, number, number];
    const originUm = numberArray(grid.origin_um, 3, `${path}.volume.grid.origin_um`) as [number, number, number];
    const indexToWorldUm = numberArray(grid.index_to_world_um, 16, `${path}.volume.grid.index_to_world_um`);
    if (arrayDescriptor.order !== 'C') throw new Error(`${path}.volume.array.order must be C`);
    if (arrayDescriptor.endianness !== 'little' && arrayDescriptor.endianness !== 'not-applicable') throw new Error(`${path}.volume.array.endianness is unsupported`);
    if (arrayDescriptor.nonfinite !== 'preserve' && arrayDescriptor.nonfinite !== 'forbid') throw new Error(`${path}.volume.array.nonfinite is unsupported`);
    const resource = volume.layout === 'chunks3d'
      ? object(volume.chunks, `${path}.volume.chunks`)
      : object(volume.slice_packs, `${path}.volume.slice_packs`);
    descriptor.representations.volume = {
      kind: 'volume',
      format: 'ephys-atlas-chunked-volume-v0.1',
      layout: volume.layout,
      grid: {
        shape,
        axisOrder: axisOrder as [string, string, string],
        coordinateSystem: string(grid.coordinate_system, `${path}.volume.grid.coordinate_system`),
        voxelSizeUm,
        originUm,
        indexToWorldUm,
      },
      array: {
        dtype: dtype(arrayDescriptor.dtype, `${path}.volume.array.dtype`),
        endianness: arrayDescriptor.endianness,
        order: 'C',
        nonfinite: arrayDescriptor.nonfinite,
      },
      resource,
      ...(typeof volume.statistics === 'string' ? { statistics: volume.statistics } : {}),
      ...(Array.isArray(volume.value_range) && volume.value_range.length === 2 ? { valueRange: volume.value_range as [number | null, number | null] } : {}),
    };
  }

  if (!descriptor.representations.regional && !descriptor.representations.volume) {
    throw new Error(`${path} must provide regional and/or volume representation`);
  }
  return descriptor;
}

function parseRegionalParcellation(value: unknown, context: string) {
  const item = object(value, context);
  return {
    parcellationId: parcellation(item.parcellation_id, `${context}.parcellation_id`),
    summary: string(item.summary, `${context}.summary`),
    values: parseBinaryArray(item.values, `${context}.values`),
    statistics: string(item.statistics, `${context}.statistics`),
  };
}

export function resolveDatasetManifest(
  document: DatasetManifestDocument,
  features: readonly FeatureDescriptor[],
  datasetId: DatasetId = document.datasetId as DatasetId,
): DatasetManifest {
  if (features.length !== document.featureRefs.length) throw new Error('Resolved feature count does not match manifest feature references');
  const parcellationDescriptors: DatasetManifest['parcellationDescriptors'] = {};
  for (const item of document.parcellations) parcellationDescriptors[item.id] = item;
  return {
    schemaVersion: SCHEMA_VERSION,
    dataset: {
      id: datasetId,
      release: document.release.releaseId,
      title: document.title,
      ...(document.description ? { description: document.description } : {}),
      ...(document.datasetId === 'golden_fixture' ? { fixture: true } : {}),
    },
    parcellations: document.parcellations.map((item) => item.id),
    parcellationDescriptors,
    features,
  };
}

export interface StatisticsDocument {
  fields: readonly string[];
  values: BinaryArrayDescriptor;
}

export function parseStatisticsDocument(value: unknown): StatisticsDocument {
  const root = object(value, 'statistics');
  if (root.format !== 'ephys-atlas-statistics-v0.1') throw new Error('statistics.format is unsupported');
  const regional = object(root.regional_summary, 'statistics.regional_summary');
  return {
    fields: array(regional.fields, 'statistics.regional_summary.fields').map((item, index) => string(item, `statistics.regional_summary.fields[${index}]`)),
    values: parseBinaryArray(regional.values, 'statistics.regional_summary.values'),
  };
}

/** Validates already-decoded browser payloads. */
export function parseFeaturePayload(value: unknown): FeaturePayload {
  const root = object(value, 'feature');
  if (root.schemaVersion !== SCHEMA_VERSION) throw new Error(`feature.schemaVersion must be ${SCHEMA_VERSION}`);
  const featureId = string(root.featureId, 'feature.featureId');
  if (root.representation === 'regional') {
    const regionIds = array(root.regionIds, 'feature.regionIds').map((v, i) => string(v, `feature.regionIds[${i}]`));
    const statisticsObject = object(root.statistics, 'feature.statistics');
    const statistics: RegionalFeaturePayload['statistics'] = {};
    for (const [key, raw] of Object.entries(statisticsObject)) {
      const stat = statistic(key, `feature.statistics.${key}`);
      const values = array(raw, `feature.statistics.${key}`).map((v, i) => {
        if (typeof v !== 'number') throw new Error(`feature.statistics.${key}[${i}] must be numeric`);
        return v;
      });
      if (values.length !== regionIds.length) throw new Error(`feature.statistics.${key} length must match regionIds`);
      statistics[stat] = values;
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      featureId,
      representation: 'regional',
      parcellation: parcellation(root.parcellation, 'feature.parcellation'),
      regionIds,
      statistics,
    };
  }
  throw new Error('parseFeaturePayload currently validates decoded regional payloads only');
}

export function decodeBinaryArray(buffer: ArrayBuffer, descriptor: BinaryArrayDescriptor): number[] {
  const count = descriptor.shape.reduce((product, dimension) => product * dimension, 1);
  const bytesPerElement: Record<BinaryDType, number> = {
    int16: 2, int32: 4, uint16: 2, uint32: 4, float16: 2, float32: 4, float64: 8,
  };
  const expected = count * bytesPerElement[descriptor.dtype];
  if (buffer.byteLength !== expected) throw new Error(`${descriptor.path} has ${buffer.byteLength} bytes; expected ${expected}`);
  const view = new DataView(buffer);
  const values = new Array<number>(count);
  const little = true;
  for (let i = 0; i < count; i += 1) {
    const offset = i * bytesPerElement[descriptor.dtype];
    switch (descriptor.dtype) {
      case 'int16': values[i] = view.getInt16(offset, little); break;
      case 'int32': values[i] = view.getInt32(offset, little); break;
      case 'uint16': values[i] = view.getUint16(offset, little); break;
      case 'uint32': values[i] = view.getUint32(offset, little); break;
      case 'float32': values[i] = view.getFloat32(offset, little); break;
      case 'float64': values[i] = view.getFloat64(offset, little); break;
      case 'float16': values[i] = float16ToNumber(view.getUint16(offset, little)); break;
    }
  }
  return values;
}

function float16ToNumber(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) return fraction === 0 ? sign * 0 : sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}
