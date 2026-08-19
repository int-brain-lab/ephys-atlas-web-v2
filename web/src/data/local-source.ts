import type { DatasetRef, ParcellationId, RepresentationKind, StatisticId } from '../domain/types.js';
import {
  decodeBinaryArray,
  parseDatasetManifestDocument,
  parseFeatureDescriptor,
  parseStatisticsDocument,
  resolveDatasetManifest,
} from './validate.js';
import { SCHEMA_VERSION } from './contracts.js';
import type {
  BinaryArrayDescriptor,
  DatasetCatalog,
  DatasetManifest,
  DatasetSource,
  FeatureDescriptor,
  FeaturePayload,
  RegionalFeaturePayload,
} from './contracts.js';

const DB_NAME = 'ibl-ephys-atlas-v2-local-v01';
const DB_VERSION = 1;
const MANIFESTS = 'manifests';
const RESOURCES = 'resources';
const DISPLAY_STATISTICS = new Set<StatisticId>(['mean', 'median', 'min', 'max', 'count']);

interface StoredManifest {
  key: string;
  manifest: DatasetManifest;
}

interface StoredResource {
  key: string;
  blob: Blob;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MANIFESTS)) db.createObjectStore(MANIFESTS, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(RESOURCES)) db.createObjectStore(RESOURCES, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open local dataset store'));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function releaseKey(releaseId: string): string {
  return `local@${releaseId}`;
}

function resourceKey(releaseId: string, path: string): string {
  return `${releaseKey(releaseId)}:${path}`;
}

function relativePath(file: File): string {
  const path = file.webkitRelativePath || file.name;
  const parts = path.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : path;
}

function resolvePath(baseFile: string, relative: string): string {
  const base = new URL(baseFile, 'https://local.invalid/');
  return new URL(relative, base).pathname.replace(/^\//, '');
}

export class LocalDatasetSource implements DatasetSource {
  readonly kind = 'local' as const;

  async importFiles(files: Iterable<File>): Promise<DatasetManifest> {
    const allFiles = [...files];
    const byPath = new Map(allFiles.map((file) => [relativePath(file), file]));
    const manifestFile = byPath.get('manifest.json') ?? allFiles.find((file) => file.name === 'manifest.json');
    if (!manifestFile) throw new Error('Local dataset must contain manifest.json');

    const document = parseDatasetManifestDocument(JSON.parse(await manifestFile.text()) as unknown);
    const features = await Promise.all(document.featureRefs.map(async (featureRef) => {
      const file = byPath.get(featureRef.path);
      if (!file) throw new Error(`Local dataset is missing ${featureRef.path}`);
      const feature = parseFeatureDescriptor(JSON.parse(await file.text()) as unknown, featureRef.path);
      if (feature.id !== featureRef.id) throw new Error(`Feature id mismatch for ${featureRef.path}`);
      return feature;
    }));
    const manifest = resolveDatasetManifest(document, features, 'local');

    const db = await openDatabase();
    const transaction = db.transaction([MANIFESTS, RESOURCES], 'readwrite');
    transaction.objectStore(MANIFESTS).put({ key: releaseKey(manifest.dataset.release), manifest } satisfies StoredManifest);
    for (const file of allFiles) {
      const path = relativePath(file);
      if (path === 'manifest.json') continue;
      transaction.objectStore(RESOURCES).put({
        key: resourceKey(manifest.dataset.release, path),
        blob: file,
      } satisfies StoredResource);
    }
    await transactionDone(transaction);
    db.close();
    return manifest;
  }

  async loadCatalog(): Promise<DatasetCatalog> {
    const manifests = await this.listManifests();
    const releases = manifests.map((manifest) => ({
      id: manifest.dataset.release,
      label: manifest.dataset.release,
      manifest: 'indexeddb://manifest.json',
      immutable: true,
    }));

    return {
      schemaVersion: SCHEMA_VERSION,
      datasets: releases.length ? [{
        id: 'local',
        title: 'Local datasets',
        description: 'Browser-imported schema-v0.1 datasets stored only on this device.',
        releases,
        defaultRelease: releases.at(-1)?.id ?? '',
      }] : [],
    };
  }

  async loadManifest(ref: DatasetRef): Promise<DatasetManifest> {
    if (ref.datasetId !== 'local' || !ref.releaseId) throw new Error('A local release id is required');
    const db = await openDatabase();
    const transaction = db.transaction(MANIFESTS, 'readonly');
    const stored = await requestValue(transaction.objectStore(MANIFESTS).get(releaseKey(ref.releaseId)) as IDBRequest<StoredManifest | undefined>);
    db.close();
    if (!stored) throw new Error(`Local release not found: ${ref.releaseId}`);
    return stored.manifest;
  }

  async loadFeature(
    ref: DatasetRef,
    featureId: string,
    representation: RepresentationKind,
    parcellation?: ParcellationId,
  ): Promise<FeaturePayload> {
    if (!ref.releaseId) throw new Error('A local release id is required');
    const manifest = await this.loadManifest(ref);
    const feature = this.findFeature(manifest, featureId);
    if (representation === 'volume') {
      const descriptor = feature.representations.volume;
      if (!descriptor) throw new Error(`Feature ${featureId} has no volume representation`);
      return { schemaVersion: SCHEMA_VERSION, featureId, representation: 'volume', descriptor };
    }

    if (!parcellation) throw new Error(`Parcellation required for regional feature ${feature.id}`);
    const regional = feature.representations.regional?.parcellations[parcellation];
    const parcel = manifest.parcellationDescriptors[parcellation];
    if (!regional || !parcel) throw new Error(`Feature ${feature.id} has no ${parcellation} regional representation`);

    const regionIds = await this.readArray(ref.releaseId, parcel.regionIndex.path, parcel.regionIndex);
    const values = await this.readArray(ref.releaseId, resolvePath(feature.path, regional.values.path), regional.values);
    if (regionIds.length !== values.length) throw new Error(`${feature.id}/${parcellation} values do not match region index length`);
    const statsPath = resolvePath(feature.path, regional.statistics);
    const statsBlob = await this.readResource(ref.releaseId, statsPath);
    const statsDocument = parseStatisticsDocument(JSON.parse(await statsBlob.text()) as unknown);
    const matrix = await this.readArray(ref.releaseId, resolvePath(statsPath, statsDocument.values.path), statsDocument.values);
    const fieldCount = statsDocument.fields.length;
    if (statsDocument.values.shape.length !== 2 || statsDocument.values.shape[0] !== regionIds.length || statsDocument.values.shape[1] !== fieldCount) {
      throw new Error(`${feature.id}/${parcellation} regional statistics shape is inconsistent`);
    }

    const statistics: RegionalFeaturePayload['statistics'] = {};
    if (DISPLAY_STATISTICS.has(regional.summary as StatisticId)) statistics[regional.summary as StatisticId] = values;
    for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex += 1) {
      const field = statsDocument.fields[fieldIndex];
      if (!field || !DISPLAY_STATISTICS.has(field as StatisticId)) continue;
      statistics[field as StatisticId] = regionIds.map((_, row) => matrix[row * fieldCount + fieldIndex] ?? NaN);
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      featureId,
      representation: 'regional',
      parcellation,
      regionIds: regionIds.map(String),
      statistics,
    };
  }

  private findFeature(manifest: DatasetManifest, featureId: string): FeatureDescriptor {
    const feature = manifest.features.find((item) => item.id === featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    return feature;
  }

  private async readResource(releaseId: string, path: string): Promise<Blob> {
    const db = await openDatabase();
    const transaction = db.transaction(RESOURCES, 'readonly');
    const stored = await requestValue(transaction.objectStore(RESOURCES).get(resourceKey(releaseId, path)) as IDBRequest<StoredResource | undefined>);
    db.close();
    if (!stored) throw new Error(`Local resource not found: ${path}`);
    return stored.blob;
  }

  private async readArray(releaseId: string, path: string, descriptor: BinaryArrayDescriptor): Promise<number[]> {
    const blob = await this.readResource(releaseId, path);
    return decodeBinaryArray(await blob.arrayBuffer(), { ...descriptor, path });
  }

  private async listManifests(): Promise<DatasetManifest[]> {
    const db = await openDatabase();
    const transaction = db.transaction(MANIFESTS, 'readonly');
    const stored = await requestValue(transaction.objectStore(MANIFESTS).getAll() as IDBRequest<StoredManifest[]>);
    db.close();
    return stored.map((item) => item.manifest);
  }
}
