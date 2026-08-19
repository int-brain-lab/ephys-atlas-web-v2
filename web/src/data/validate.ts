import { LAUNCH_DATASET_IDS, type DatasetId, type ParcellationId, type StatisticId } from '../domain/types.js';
import {
  PROVISIONAL_SCHEMA_VERSION,
  type DatasetCatalog,
  type DatasetManifest,
  type FeatureDescriptor,
  type FeaturePayload,
  type RegionalFeaturePayload,
  type VolumeFeaturePayload,
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

function schemaVersion(value: unknown, context: string): void {
  if (value !== PROVISIONAL_SCHEMA_VERSION) throw new Error(`${context}.schemaVersion must be ${PROVISIONAL_SCHEMA_VERSION}`);
}

function datasetId(value: unknown, context: string): DatasetId {
  const id = string(value, context);
  if (!(LAUNCH_DATASET_IDS as readonly string[]).includes(id)) throw new Error(`${context} is not a launch dataset id: ${id}`);
  return id as DatasetId;
}

function parcellation(value: unknown, context: string): ParcellationId {
  if (value !== 'allen' && value !== 'beryl' && value !== 'cosmos') throw new Error(`${context} must be allen, beryl, or cosmos`);
  return value;
}

function statistic(value: unknown, context: string): StatisticId {
  if (!['mean', 'median', 'min', 'max', 'count'].includes(String(value))) throw new Error(`${context} is not a supported statistic`);
  return value as StatisticId;
}

function parseFeatureDescriptor(value: unknown, context: string): FeatureDescriptor {
  const item = object(value, context);
  const reps = object(item.representations, `${context}.representations`);
  const descriptor: FeatureDescriptor = {
    id: string(item.id, `${context}.id`),
    label: string(item.label, `${context}.label`),
    statistics: array(item.statistics, `${context}.statistics`).map((v, i) => statistic(v, `${context}.statistics[${i}]`)),
    representations: {},
  };
  if (typeof item.description === 'string') descriptor.description = item.description;
  if (typeof item.unit === 'string') descriptor.unit = item.unit;

  if (reps.regional !== undefined) {
    const regional = object(reps.regional, `${context}.representations.regional`);
    if (regional.kind !== 'regional' || regional.format !== 'json') throw new Error(`${context}.representations.regional has unsupported kind/format`);
    const mappings = object(regional.parcellations, `${context}.representations.regional.parcellations`);
    const paths: Partial<Record<ParcellationId, string>> = {};
    for (const key of ['allen', 'beryl', 'cosmos'] as const) {
      if (mappings[key] !== undefined) paths[key] = string(mappings[key], `${context}.representations.regional.parcellations.${key}`);
    }
    descriptor.representations.regional = { kind: 'regional', format: 'json', parcellations: paths };
  }
  if (reps.volume !== undefined) {
    const volume = object(reps.volume, `${context}.representations.volume`);
    if (volume.kind !== 'volume' || volume.format !== 'json') throw new Error(`${context}.representations.volume has unsupported kind/format`);
    descriptor.representations.volume = {
      kind: 'volume',
      format: 'json',
      resource: string(volume.resource, `${context}.representations.volume.resource`),
    };
  }
  if (!descriptor.representations.regional && !descriptor.representations.volume) {
    throw new Error(`${context} must provide regional and/or volume representation`);
  }
  return descriptor;
}

export function parseDatasetCatalog(value: unknown): DatasetCatalog {
  const root = object(value, 'catalog');
  schemaVersion(root.schemaVersion, 'catalog');
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
    const id = datasetId(item.id, `catalog.datasets[${index}].id`);
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
  return { schemaVersion: PROVISIONAL_SCHEMA_VERSION, datasets };
}

export function parseDatasetManifest(value: unknown): DatasetManifest {
  const root = object(value, 'manifest');
  schemaVersion(root.schemaVersion, 'manifest');
  const dataset = object(root.dataset, 'manifest.dataset');
  const parsedDataset = {
    id: datasetId(dataset.id, 'manifest.dataset.id'),
    release: string(dataset.release, 'manifest.dataset.release'),
    title: string(dataset.title, 'manifest.dataset.title'),
    ...(typeof dataset.description === 'string' ? { description: dataset.description } : {}),
    ...(typeof dataset.fixture === 'boolean' ? { fixture: dataset.fixture } : {}),
  };
  const parcellations = array(root.parcellations, 'manifest.parcellations').map((v, i) => parcellation(v, `manifest.parcellations[${i}]`));
  const features = array(root.features, 'manifest.features').map((v, i) => parseFeatureDescriptor(v, `manifest.features[${i}]`));
  return { schemaVersion: PROVISIONAL_SCHEMA_VERSION, dataset: parsedDataset, parcellations, features };
}

export function parseFeaturePayload(value: unknown): FeaturePayload {
  const root = object(value, 'feature');
  schemaVersion(root.schemaVersion, 'feature');
  const featureId = string(root.featureId, 'feature.featureId');
  if (root.representation === 'regional') {
    const regionIds = array(root.regionIds, 'feature.regionIds').map((v, i) => string(v, `feature.regionIds[${i}]`));
    const statisticsObject = object(root.statistics, 'feature.statistics');
    const statistics: RegionalFeaturePayload['statistics'] = {};
    for (const [key, raw] of Object.entries(statisticsObject)) {
      const stat = statistic(key, `feature.statistics.${key}`);
      const values = array(raw, `feature.statistics.${key}`).map((v, i) => {
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`feature.statistics.${key}[${i}] must be finite`);
        return v;
      });
      if (values.length !== regionIds.length) throw new Error(`feature.statistics.${key} length must match regionIds`);
      statistics[stat] = values;
    }
    return {
      schemaVersion: PROVISIONAL_SCHEMA_VERSION,
      featureId,
      representation: 'regional',
      parcellation: parcellation(root.parcellation, 'feature.parcellation'),
      regionIds,
      statistics,
    };
  }
  if (root.representation === 'volume') {
    const rawShape = array(root.shape, 'feature.shape');
    if (rawShape.length !== 3 || rawShape.some((v) => typeof v !== 'number' || !Number.isInteger(v) || v <= 0)) {
      throw new Error('feature.shape must contain three positive integer dimensions');
    }
    return {
      schemaVersion: PROVISIONAL_SCHEMA_VERSION,
      featureId,
      representation: 'volume',
      shape: rawShape as [number, number, number],
      dtype: string(root.dtype, 'feature.dtype'),
      data: string(root.data, 'feature.data'),
    } satisfies VolumeFeaturePayload;
  }
  throw new Error('feature.representation must be regional or volume');
}
