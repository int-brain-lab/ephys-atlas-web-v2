import type { DatasetId, ParcellationId, StatisticId } from '../domain/types.js';
import {
  SCHEMA_VERSION,
  type BinaryArrayDescriptor,
  type BinaryDType,
  type DatasetCatalog,
  type DatasetManifest,
  type DatasetManifestDocument,
  type DatasetProvenance,
  type FeatureDescriptor,
  type FeaturePayload,
  type JsonValue,
  type ProvenanceSourceRole,
  type ReleaseMetadata,
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

function plainString(value: unknown, context: string): string {
  if (typeof value !== 'string') throw new Error(`${context} must be a string`);
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

const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DATASET_ID = /^[a-z0-9][a-z0-9._-]*$/;
const COMMIT = /^[0-9a-f]{7,40}$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function dateTime(value: unknown, context: string): string {
  const timestamp = plainString(value, context);
  const match = DATE_TIME.exec(timestamp);
  if (!match) throw new Error(`${context} must be an RFC 3339 date-time`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) throw new Error(`${context} must be an RFC 3339 date-time`);
  return timestamp;
}

function jsonValue(value: unknown, context: string): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${context} must contain JSON values`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${context}[${index}]`));
  if (value && typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) result[key] = jsonValue(item, `${context}.${key}`);
    return result;
  }
  throw new Error(`${context} must contain JSON values`);
}

function parseRelease(value: unknown): ReleaseMetadata {
  const release = object(value, 'manifest.release');
  const immutable = boolean(release.immutable, 'manifest.release.immutable');
  if (!immutable) throw new Error('manifest.release.immutable must be true');
  let publication: ReleaseMetadata['publication'];
  if (release.publication !== undefined) {
    const raw = object(release.publication, 'manifest.release.publication');
    publication = {
      ...(raw.doi !== undefined ? { doi: plainString(raw.doi, 'manifest.release.publication.doi') } : {}),
      ...(raw.label !== undefined ? { label: plainString(raw.label, 'manifest.release.publication.label') } : {}),
    };
  }
  return {
    releaseId: string(release.release_id, 'manifest.release.release_id'),
    immutable: true,
    createdAt: dateTime(release.created_at, 'manifest.release.created_at'),
    paperSnapshot: release.paper_snapshot === undefined
      ? false
      : boolean(release.paper_snapshot, 'manifest.release.paper_snapshot'),
    ...(publication ? { publication } : {}),
  };
}

function parseProvenance(value: unknown): DatasetProvenance {
  const provenance = object(value, 'manifest.provenance');
  const roles: readonly ProvenanceSourceRole[] = [
    'scientific-code', 'canonical-data', 'selection-freeze', 'publication-input', 'user-input',
  ];
  const sources = array(provenance.sources, 'manifest.provenance.sources').map((value, index) => {
    const context = `manifest.provenance.sources[${index}]`;
    const source = object(value, context);
    if (!roles.includes(source.role as ProvenanceSourceRole)) throw new Error(`${context}.role is unsupported`);
    if (source.commit !== undefined && (typeof source.commit !== 'string' || !COMMIT.test(source.commit))) {
      throw new Error(`${context}.commit must be 7 to 40 lowercase hexadecimal characters`);
    }
    if (source.sha256 !== undefined && (typeof source.sha256 !== 'string' || !SHA256.test(source.sha256))) {
      throw new Error(`${context}.sha256 must be 64 lowercase hexadecimal characters`);
    }
    return {
      role: source.role as ProvenanceSourceRole,
      description: string(source.description, `${context}.description`),
      ...(source.repository !== undefined ? { repository: plainString(source.repository, `${context}.repository`) } : {}),
      ...(source.commit !== undefined ? { commit: source.commit } : {}),
      ...(source.path !== undefined ? { path: plainString(source.path, `${context}.path`) } : {}),
      ...(source.release !== undefined ? { release: plainString(source.release, `${context}.release`) } : {}),
      ...(source.uri !== undefined ? { uri: plainString(source.uri, `${context}.uri`) } : {}),
      ...(source.sha256 !== undefined ? { sha256: source.sha256 } : {}),
    };
  });
  if (sources.length === 0) throw new Error('manifest.provenance.sources must not be empty');
  const rawBuilder = object(provenance.builder, 'manifest.provenance.builder');
  const rawRecipe = object(provenance.recipe, 'manifest.provenance.recipe');
  const recipe: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(rawRecipe)) {
    recipe[key] = jsonValue(item, `manifest.provenance.recipe.${key}`);
  }
  const recipeId = string(recipe.id, 'manifest.provenance.recipe.id');
  return {
    sources,
    builder: {
      name: plainString(rawBuilder.name, 'manifest.provenance.builder.name'),
      version: plainString(rawBuilder.version, 'manifest.provenance.builder.version'),
      command: plainString(rawBuilder.command, 'manifest.provenance.builder.command'),
      ...(rawBuilder.repository !== undefined ? { repository: plainString(rawBuilder.repository, 'manifest.provenance.builder.repository') } : {}),
      ...(rawBuilder.commit !== undefined ? { commit: plainString(rawBuilder.commit, 'manifest.provenance.builder.commit') } : {}),
    },
    recipe: { ...recipe, id: recipeId },
    notes: provenance.notes === undefined
      ? []
      : array(provenance.notes, 'manifest.provenance.notes').map((item, index) => plainString(item, `manifest.provenance.notes[${index}]`)),
  };
}

export function localDatasetReleaseId(datasetId: string, releaseId: string): string {
  if (!DATASET_ID.test(datasetId)) throw new Error('Local dataset id has an invalid format');
  if (!releaseId) throw new Error('Local release id must be non-empty');
  return `${datasetId}@${encodeURIComponent(releaseId)}`;
}

function relativePath(value: unknown, context: string): string {
  const path = string(value, context);
  if (!RELATIVE_PATH.test(path)) throw new Error(`${context} must be a safe relative path`);
  return path;
}

function unique(values: readonly string[], context: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${context} must not contain duplicates`);
}

export function parseBinaryArray(value: unknown, context: string): BinaryArrayDescriptor {
  const item = object(value, context);
  const shape = array(item.shape, `${context}.shape`).map((dimension, index) => {
    if (typeof dimension !== 'number' || !Number.isInteger(dimension) || dimension < 0) {
      throw new Error(`${context}.shape[${index}] must be a non-negative integer`);
    }
    return dimension;
  });
  if (shape.length === 0) throw new Error(`${context}.shape must not be empty`);
  if (item.order !== 'C') throw new Error(`${context}.order must be C`);
  if (item.endianness !== 'little' && item.endianness !== 'not-applicable') {
    throw new Error(`${context}.endianness must be little or not-applicable`);
  }
  const descriptor: BinaryArrayDescriptor = {
    path: relativePath(item.path, `${context}.path`),
    dtype: dtype(item.dtype, `${context}.dtype`),
    shape,
    order: 'C',
    endianness: item.endianness,
  };
  if (item.sha256 !== undefined) {
    if (typeof item.sha256 !== 'string' || !SHA256.test(item.sha256)) throw new Error(`${context}.sha256 must be 64 lowercase hexadecimal characters`);
    descriptor.sha256 = item.sha256;
  }
  if (item.bytes !== undefined) {
    if (typeof item.bytes !== 'number' || !Number.isInteger(item.bytes) || item.bytes < 0) throw new Error(`${context}.bytes must be a non-negative integer`);
    descriptor.bytes = item.bytes;
  }
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
  const release = parseRelease(root.release);
  const provenance = parseProvenance(root.provenance);
  array(root.artifacts, 'manifest.artifacts');
  const parcellations = array(root.parcellations, 'manifest.parcellations').map((value, index) => {
    const item = object(value, `manifest.parcellations[${index}]`);
    return {
      id: parcellation(item.id, `manifest.parcellations[${index}].id`),
      regionIndex: parseBinaryArray(item.region_index, `manifest.parcellations[${index}].region_index`),
      ...(item.metadata !== undefined ? { metadata: relativePath(item.metadata, `manifest.parcellations[${index}].metadata`) } : {}),
    };
  });
  const featureRefs = array(root.features, 'manifest.features').map((value, index) => {
    const item = object(value, `manifest.features[${index}]`);
    return {
      id: string(item.id, `manifest.features[${index}].id`),
      path: relativePath(item.path, `manifest.features[${index}].path`),
    };
  });
  unique(parcellations.map((item) => item.id), 'manifest.parcellations ids');
  unique(featureRefs.map((item) => item.id), 'manifest.features ids');
  unique(featureRefs.map((item) => item.path), 'manifest.features paths');
  if (featureRefs.length === 0) throw new Error('manifest.features must not be empty');
  const datasetId = string(root.dataset_id, 'manifest.dataset_id');
  if (!DATASET_ID.test(datasetId)) throw new Error('manifest.dataset_id has an invalid format');
  return {
    schemaVersion: SCHEMA_VERSION,
    datasetId,
    title: string(root.title, 'manifest.title'),
    description: plainString(root.description, 'manifest.description'),
    release,
    provenance,
    parcellations,
    featureRefs,
  };
}

export function parseFeatureDescriptor(value: unknown, path: string): FeatureDescriptor {
  const root = object(value, `feature ${path}`);
  if (root.schema_version !== SCHEMA_VERSION) throw new Error(`${path}.schema_version must be ${SCHEMA_VERSION}`);
  const representations = object(root.representations, `${path}.representations`);
  const valueSemantics = object(root.value_semantics, `${path}.value_semantics`);
  array(root.artifacts, `${path}.artifacts`);
  const featureId = string(root.id, `${path}.id`);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(featureId)) throw new Error(`${path}.id has an invalid format`);
  const descriptor: FeatureDescriptor = {
    id: featureId,
    path,
    label: string(root.label, `${path}.label`),
    description: plainString(root.description, `${path}.description`),
    unit: root.unit === null ? null : plainString(root.unit, `${path}.unit`),
    valueSemantics: {
      quantity: string(valueSemantics.quantity, `${path}.value_semantics.quantity`),
      transform: string(valueSemantics.transform, `${path}.value_semantics.transform`),
      sourcePopulation: string(valueSemantics.source_population, `${path}.value_semantics.source_population`),
      missingValues: string(valueSemantics.missing_values, `${path}.value_semantics.missing_values`),
      ...(valueSemantics.source_column !== undefined
        ? { sourceColumn: plainString(valueSemantics.source_column, `${path}.value_semantics.source_column`) }
        : {}),
      ...(valueSemantics.qc_filter !== undefined
        ? { qcFilter: plainString(valueSemantics.qc_filter, `${path}.value_semantics.qc_filter`) }
        : {}),
    },
    statistics: [],
    representations: {},
  };

  if (representations.regional !== undefined) {
    const regional = object(representations.regional, `${path}.representations.regional`);
    if (regional.format !== 'ephys-atlas-regional-v0.1') throw new Error(`${path} has unsupported regional format`);
    const mappings: Partial<Record<ParcellationId, ReturnType<typeof parseRegionalParcellation>>> = {};
    const stats = new Set<StatisticId>();
    const parcellations = array(regional.parcellations, `${path}.representations.regional.parcellations`);
    if (parcellations.length === 0) throw new Error(`${path}.representations.regional.parcellations must not be empty`);
    for (const [index, raw] of parcellations.entries()) {
      const parsed = parseRegionalParcellation(raw, `${path}.representations.regional.parcellations[${index}]`);
      if (mappings[parsed.parcellationId]) throw new Error(`${path} has duplicate ${parsed.parcellationId} regional representations`);
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
    if (shape.some((item) => !Number.isInteger(item) || item <= 0)) throw new Error(`${path}.volume.grid.shape must contain positive integers`);
    const axisOrder = array(grid.axis_order, `${path}.volume.grid.axis_order`).map((item, i) => string(item, `${path}.volume.grid.axis_order[${i}]`));
    if (axisOrder.length !== 3) throw new Error(`${path}.volume.grid.axis_order must have three entries`);
    const normalizedAxes = axisOrder.map((item) => item.toLowerCase());
    unique(normalizedAxes, `${path}.volume.grid.axis_order`);
    if (!['ap', 'ml', 'dv'].every((axis) => normalizedAxes.includes(axis))) {
      throw new Error(`${path}.volume.grid.axis_order must contain ap, ml, and dv`);
    }
    const voxelSizeUm = numberArray(grid.voxel_size_um, 3, `${path}.volume.grid.voxel_size_um`) as [number, number, number];
    if (voxelSizeUm.some((item) => item <= 0)) throw new Error(`${path}.volume.grid.voxel_size_um must be positive`);
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
      ...(volume.value_range === undefined ? {} : { valueRange: nullableRange(volume.value_range, `${path}.volume.value_range`) }),
    };
  }

  if (!descriptor.representations.regional && !descriptor.representations.volume) {
    throw new Error(`${path} must provide regional and/or volume representation`);
  }
  return descriptor;
}

function nullableRange(value: unknown, context: string): [number | null, number | null] {
  const values = array(value, context);
  if (values.length !== 2 || values.some((item) => item !== null && (typeof item !== 'number' || !Number.isFinite(item)))) {
    throw new Error(`${context} must contain two finite numbers or null values`);
  }
  return values as [number | null, number | null];
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
      description: document.description,
      ...(document.datasetId === 'golden_fixture' ? { fixture: true } : {}),
    },
    release: document.release,
    provenance: document.provenance,
    parcellations: document.parcellations.map((item) => item.id),
    parcellationDescriptors,
    features,
  };
}

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
  if (root.format !== 'ephys-atlas-statistics-v0.1') throw new Error('statistics.format is unsupported');
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
  const fields = array(regional.fields, 'statistics.regional_summary.fields').map((item, index) => string(item, `statistics.regional_summary.fields[${index}]`));
  const supportedFields = new Set(['count', 'missing_count', 'min', 'max', 'mean', 'std', 'median', 'q05', 'q25', 'q75', 'q95']);
  if (fields.length === 0 || fields.some((field) => !supportedFields.has(field))) throw new Error('statistics.regional_summary.fields contains unsupported values');
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
    if (globalCounts.length !== edges.length - 1 || globalCounts.some((item) => typeof item !== 'number' || !Number.isInteger(item) || item < 0)) {
      throw new Error('statistics.histogram.global_counts must contain one non-negative integer per bin');
    }
    if (histogram.bin_rule !== 'left-closed-right-open-last-closed') throw new Error('statistics.histogram.bin_rule is unsupported');
    result.histogram = {
      edges,
      regionalCounts: parseBinaryArray(histogram.regional_counts, 'statistics.histogram.regional_counts'),
    };
  }
  return result;
}

interface ArtifactExpectation {
  path: string;
  bytes: number;
  sha256: string;
  context: string;
}

interface ResourceExpectation {
  path: string;
  context: string;
  bytes?: number;
  sha256?: string;
  decodedBytes?: number;
  codec?: 'none' | 'gzip';
}

export interface ValidatedLocalDataset {
  document: DatasetManifestDocument;
  features: readonly FeatureDescriptor[];
}

function bytesPerElement(value: BinaryDType): number {
  return { int16: 2, int32: 4, uint16: 2, uint32: 4, float16: 2, float32: 4, float64: 8 }[value];
}

function binaryBytes(descriptor: BinaryArrayDescriptor): number {
  return descriptor.shape.reduce((product, dimension) => product * dimension, 1) * bytesPerElement(descriptor.dtype);
}

function resolveRelativePath(baseFile: string, child: string, context: string): string {
  relativePath(baseFile, `${context} base path`);
  relativePath(child, context);
  const directory = baseFile.includes('/') ? baseFile.slice(0, baseFile.lastIndexOf('/') + 1) : '';
  return `${directory}${child}`;
}

function parseArtifacts(value: unknown, baseFile: string, context: string): ArtifactExpectation[] {
  return array(value, context).map((raw, index) => {
    const item = object(raw, `${context}[${index}]`);
    const id = string(item.id, `${context}[${index}].id`);
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw new Error(`${context}[${index}].id has an invalid format`);
    if (!['current-feature', 'selected-data', 'source-snapshot', 'auxiliary'].includes(String(item.role))) {
      throw new Error(`${context}[${index}].role is unsupported`);
    }
    string(item.media_type, `${context}[${index}].media_type`);
    const bytesValue = item.bytes;
    if (typeof bytesValue !== 'number' || !Number.isInteger(bytesValue) || bytesValue < 0) {
      throw new Error(`${context}[${index}].bytes must be a non-negative integer`);
    }
    if (typeof item.sha256 !== 'string' || !SHA256.test(item.sha256)) {
      throw new Error(`${context}[${index}].sha256 must be 64 lowercase hexadecimal characters`);
    }
    const path = resolveRelativePath(baseFile, relativePath(item.path, `${context}[${index}].path`), `${context}[${index}].path`);
    return { path, bytes: bytesValue, sha256: item.sha256, context: `${context}[${index}]` };
  });
}

async function readJsonResource(files: ReadonlyMap<string, Blob>, path: string, context: string): Promise<unknown> {
  const file = files.get(path);
  if (!file) throw new Error(`Local dataset is missing ${path} (${context})`);
  try {
    return JSON.parse(await file.text()) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${path} is not valid JSON: ${error.message}`);
    throw error;
  }
}

async function parseJsonResource(files: ReadonlyMap<string, Blob>, path: string, context: string): Promise<Record<string, unknown>> {
  return object(await readJsonResource(files, path, context), context);
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function decodedByteLength(blob: Blob, codec: 'none' | 'gzip', path: string): Promise<number> {
  if (codec === 'none') return blob.size;
  if (!('DecompressionStream' in globalThis)) throw new Error(`Cannot validate gzip resource ${path}: DecompressionStream is unavailable`);
  try {
    const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    return (await new Response(stream).arrayBuffer()).byteLength;
  } catch {
    throw new Error(`Local resource ${path} is not valid gzip data`);
  }
}

function addResource(resources: Map<string, ResourceExpectation>, expectation: ResourceExpectation): void {
  const existing = resources.get(expectation.path);
  if (!existing) {
    resources.set(expectation.path, expectation);
    return;
  }
  for (const key of ['bytes', 'sha256', 'decodedBytes', 'codec'] as const) {
    const previous = existing[key];
    const next = expectation[key];
    if (previous !== undefined && next !== undefined && previous !== next) {
      throw new Error(`Inconsistent declarations for ${expectation.path}: ${existing.context} and ${expectation.context}`);
    }
  }
  resources.set(expectation.path, { ...existing, ...expectation, context: `${existing.context}; ${expectation.context}` });
}

function addBinaryResource(
  resources: Map<string, ResourceExpectation>,
  baseFile: string,
  descriptor: BinaryArrayDescriptor,
  context: string,
): string {
  const path = resolveRelativePath(baseFile, descriptor.path, context);
  const expectedBytes = binaryBytes(descriptor);
  if (descriptor.bytes !== undefined && descriptor.bytes !== expectedBytes) {
    throw new Error(`${context}.bytes is ${descriptor.bytes}; dtype and shape require ${expectedBytes}`);
  }
  addResource(resources, {
    path,
    context,
    bytes: expectedBytes,
    ...(descriptor.sha256 ? { sha256: descriptor.sha256 } : {}),
  });
  return path;
}

function addArtifact(resources: Map<string, ResourceExpectation>, artifact: ArtifactExpectation): void {
  addResource(resources, artifact);
}

function integerArray(value: unknown, length: number, context: string): number[] {
  const values = array(value, context);
  if (values.length !== length || values.some((item) => typeof item !== 'number' || !Number.isInteger(item) || item <= 0)) {
    throw new Error(`${context} must contain ${length} positive integers`);
  }
  return values as number[];
}

function templatePath(template: string, replacements: Readonly<Record<string, number>>, context: string): string {
  let path = template;
  for (const [name, value] of Object.entries(replacements)) path = path.replaceAll(`{${name}}`, String(value));
  if (/\{[^}]+\}/.test(path)) throw new Error(`${context} contains an unsupported template field`);
  return relativePath(path, context);
}

async function validateResourceFiles(files: ReadonlyMap<string, Blob>, resources: ReadonlyMap<string, ResourceExpectation>): Promise<void> {
  for (const resource of resources.values()) {
    const file = files.get(resource.path);
    if (!file) throw new Error(`Local dataset is missing ${resource.path} (${resource.context})`);
    if (resource.bytes !== undefined && file.size !== resource.bytes) {
      throw new Error(`${resource.path} has ${file.size} bytes; expected ${resource.bytes}`);
    }
    if (resource.decodedBytes !== undefined) {
      const actual = await decodedByteLength(file, resource.codec ?? 'none', resource.path);
      if (actual !== resource.decodedBytes) throw new Error(`${resource.path} decodes to ${actual} bytes; expected ${resource.decodedBytes}`);
    }
    if (resource.sha256 && await sha256Hex(file) !== resource.sha256) {
      throw new Error(`SHA-256 mismatch for ${resource.path}`);
    }
  }
}

/** Validate the complete browser-supported schema-v0.1 graph before IndexedDB is mutated. */
export async function validateLocalDatasetFiles(files: ReadonlyMap<string, Blob>): Promise<ValidatedLocalDataset> {
  const manifestRaw = await parseJsonResource(files, 'manifest.json', 'manifest');
  const document = parseDatasetManifestDocument(manifestRaw);
  const resources = new Map<string, ResourceExpectation>();
  for (const artifact of parseArtifacts(manifestRaw.artifacts, 'manifest.json', 'manifest.artifacts')) addArtifact(resources, artifact);

  const regionCounts = new Map<ParcellationId, number>();
  for (const parcel of document.parcellations) {
    if (!['int16', 'int32', 'uint16', 'uint32'].includes(parcel.regionIndex.dtype)) {
      throw new Error(`${parcel.id} region index must use an integer dtype`);
    }
    const indexPath = addBinaryResource(resources, 'manifest.json', parcel.regionIndex, `manifest.parcellations.${parcel.id}.region_index`);
    const count = parcel.regionIndex.shape.length === 1 ? parcel.regionIndex.shape[0] : undefined;
    if (count === undefined) throw new Error(`${parcel.id} region index must be one-dimensional`);
    regionCounts.set(parcel.id, count);
    if (!parcel.metadata) throw new Error(`${parcel.id} parcellation requires metadata for browser import`);
    addResource(resources, { path: parcel.metadata, context: `manifest.parcellations.${parcel.id}.metadata` });

    const metadata = array(await readJsonResource(files, parcel.metadata, `${parcel.id} region metadata`), `${parcel.id} region metadata`);
    if (metadata.length !== count) throw new Error(`${parcel.id} metadata has ${metadata.length} rows; expected ${count}`);
    const regionIdsFile = files.get(indexPath);
    if (!regionIdsFile) throw new Error(`Local dataset is missing ${indexPath}`);
    const regionIds = decodeBinaryArray(await regionIdsFile.arrayBuffer(), { ...parcel.regionIndex, path: indexPath });
    const seenAtlasIds = new Set<number>();
    for (const [row, raw] of metadata.entries()) {
      const item = object(raw, `${parcel.id} metadata[${row}]`);
      if (!Number.isInteger(item.index) || !Number.isInteger(item.atlas_id)) throw new Error(`${parcel.id} metadata[${row}] requires integer index and atlas_id`);
      const index = item.index as number;
      const atlasId = item.atlas_id as number;
      if (index !== row || regionIds[row] !== atlasId) throw new Error(`${parcel.id} metadata/index mismatch at row ${row}`);
      if (seenAtlasIds.has(atlasId)) throw new Error(`${parcel.id} metadata contains duplicate atlas_id ${atlasId}`);
      seenAtlasIds.add(atlasId);
    }
  }

  const features: FeatureDescriptor[] = [];
  for (const featureRef of document.featureRefs) {
    const featureRaw = await parseJsonResource(files, featureRef.path, `feature ${featureRef.path}`);
    const feature = parseFeatureDescriptor(featureRaw, featureRef.path);
    if (feature.id !== featureRef.id) throw new Error(`Feature id mismatch for ${featureRef.path}: expected ${featureRef.id}, got ${feature.id}`);
    features.push(feature);
    for (const artifact of parseArtifacts(featureRaw.artifacts, featureRef.path, `${featureRef.path}.artifacts`)) addArtifact(resources, artifact);

    const regional = feature.representations.regional;
    if (regional) {
      for (const [parcellationId, descriptor] of Object.entries(regional.parcellations) as [ParcellationId, NonNullable<typeof regional.parcellations[ParcellationId]>][]) {
        const count = regionCounts.get(parcellationId);
        if (count === undefined) throw new Error(`${feature.id} references undeclared ${parcellationId} parcellation`);
        if (descriptor.values.shape.length !== 1 || descriptor.values.shape[0] !== count) {
          throw new Error(`${feature.id}/${parcellationId} values shape must be [${count}]`);
        }
        addBinaryResource(resources, feature.path, descriptor.values, `${feature.id}/${parcellationId} values`);
        const statisticsPath = resolveRelativePath(feature.path, descriptor.statistics, `${feature.id}/${parcellationId} statistics`);
        addResource(resources, { path: statisticsPath, context: `${feature.id}/${parcellationId} statistics` });
        const statisticsRaw = await parseJsonResource(files, statisticsPath, `${feature.id}/${parcellationId} statistics`);
        const statistics = parseStatisticsDocument(statisticsRaw);
        if (statistics.values.shape.length !== 2 || statistics.values.shape[0] !== count || statistics.values.shape[1] !== statistics.fields.length) {
          throw new Error(`${feature.id}/${parcellationId} statistics shape must be [${count}, ${statistics.fields.length}]`);
        }
        addBinaryResource(resources, statisticsPath, statistics.values, `${feature.id}/${parcellationId} regional summary`);
        if (statistics.histogram) {
          const bins = statistics.histogram.edges.length - 1;
          if (statistics.histogram.regionalCounts.shape.length !== 2 || statistics.histogram.regionalCounts.shape[0] !== count || statistics.histogram.regionalCounts.shape[1] !== bins) {
            throw new Error(`${feature.id}/${parcellationId} histogram shape must be [${count}, ${bins}]`);
          }
          addBinaryResource(resources, statisticsPath, statistics.histogram.regionalCounts, `${feature.id}/${parcellationId} regional histogram`);
        }
      }
    }

    const volume = feature.representations.volume;
    if (volume) {
      const volumePaths = new Set<string>();
      if (volume.statistics) {
        const statisticsPath = resolveRelativePath(feature.path, volume.statistics, `${feature.id} volume statistics`);
        addResource(resources, { path: statisticsPath, context: `${feature.id} volume statistics` });
        await parseJsonResource(files, statisticsPath, `${feature.id} volume statistics`);
      }
      const elementBytes = bytesPerElement(volume.array.dtype);
      if (volume.layout === 'chunks3d') {
        const chunkShape = integerArray(volume.resource.shape, 3, `${feature.id}.volume.chunks.shape`);
        const codecRaw = object(volume.resource.codec, `${feature.id}.volume.chunks.codec`);
        if (codecRaw.name !== 'none' && codecRaw.name !== 'gzip') throw new Error(`${feature.id}.volume.chunks.codec.name is unsupported`);
        const codec = codecRaw.name;
        const template = relativePath(volume.resource.path_template, `${feature.id}.volume.chunks.path_template`);
        if (!['{i0}', '{i1}', '{i2}'].every((field) => template.includes(field))) {
          throw new Error(`${feature.id}.volume.chunks.path_template must contain {i0}, {i1}, and {i2}`);
        }
        const chunkCounts = volume.grid.shape.map((size, dimension) => Math.ceil(size / chunkShape[dimension]!));
        for (let i0 = 0; i0 < chunkCounts[0]!; i0 += 1) {
          for (let i1 = 0; i1 < chunkCounts[1]!; i1 += 1) {
            for (let i2 = 0; i2 < chunkCounts[2]!; i2 += 1) {
              const indices = [i0, i1, i2];
              const actualShape = volume.grid.shape.map((size, dimension) => Math.min(chunkShape[dimension]!, size - indices[dimension]! * chunkShape[dimension]!));
              const decodedBytes = actualShape.reduce((product, size) => product * size, elementBytes);
              const path = resolveRelativePath(feature.path, templatePath(template, { i0, i1, i2 }, `${feature.id}.volume.chunks.path_template`), `${feature.id} volume chunk`);
              if (volumePaths.has(path)) throw new Error(`${feature.id} volume resource template does not produce unique paths`);
              volumePaths.add(path);
              addResource(resources, { path, context: `${feature.id} volume chunk`, decodedBytes, codec });
            }
          }
        }
      } else {
        const packDepth = volume.resource.pack_depth;
        if (typeof packDepth !== 'number' || !Number.isInteger(packDepth) || packDepth <= 0) throw new Error(`${feature.id}.volume.slice_packs.pack_depth must be a positive integer`);
        const axes = object(volume.resource.axes, `${feature.id}.volume.slice_packs.axes`);
        for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
          const axisResource = object(axes[axis], `${feature.id}.volume.slice_packs.axes.${axis}`);
          const sliceShape = integerArray(axisResource.slice_shape, 2, `${feature.id}.volume.slice_packs.axes.${axis}.slice_shape`);
          const codecRaw = object(axisResource.codec, `${feature.id}.volume.slice_packs.axes.${axis}.codec`);
          if (codecRaw.name !== 'none' && codecRaw.name !== 'gzip') throw new Error(`${feature.id}.volume.slice_packs.axes.${axis}.codec.name is unsupported`);
          const template = relativePath(axisResource.path_template, `${feature.id}.volume.slice_packs.axes.${axis}.path_template`);
          if (!template.includes('{pack}')) throw new Error(`${feature.id}.volume.slice_packs.axes.${axis}.path_template must contain {pack}`);
          const dimensionName = axis === 'coronal' ? 'ap' : axis === 'sagittal' ? 'ml' : 'dv';
          const dimension = volume.grid.axisOrder.findIndex((name) => name.toLowerCase() === dimensionName);
          if (dimension < 0) throw new Error(`${feature.id}.volume.grid.axis_order does not contain ${dimensionName}`);
          const sliceCount = volume.grid.shape[dimension]!;
          const expectedSliceShape = volume.grid.shape.filter((_, index) => index !== dimension);
          if (sliceShape[0] !== expectedSliceShape[0] || sliceShape[1] !== expectedSliceShape[1]) {
            throw new Error(`${feature.id}.volume.slice_packs.axes.${axis}.slice_shape is inconsistent with the grid`);
          }
          for (let pack = 0; pack < Math.ceil(sliceCount / packDepth); pack += 1) {
            const depth = Math.min(packDepth, sliceCount - pack * packDepth);
            const decodedBytes = sliceShape[0]! * sliceShape[1]! * depth * elementBytes;
            const path = resolveRelativePath(feature.path, templatePath(template, { pack }, `${feature.id}.volume.slice_packs.axes.${axis}.path_template`), `${feature.id} ${axis} slice pack`);
            if (volumePaths.has(path)) throw new Error(`${feature.id} volume resource template does not produce unique paths`);
            volumePaths.add(path);
            addResource(resources, { path, context: `${feature.id} ${axis} slice pack`, decodedBytes, codec: codecRaw.name });
          }
        }
      }
    }
  }

  await validateResourceFiles(files, resources);
  return { document, features };
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
