import type { DatasetRef, ParcellationId, RepresentationKind, StatisticId } from '../domain/types.js';
import {
  materializeRegionalHistogram,
  parseRegionMetadata,
  parseRegionalStatisticsResource,
} from './regional-data.js';
import {
  decodeBinaryArray,
  localDatasetReleaseId,
  resolveDatasetManifest,
  validateLocalDatasetFiles,
} from './validate.js';
import { SCHEMA_VERSION } from './contracts.js';
import type {
  BinaryArrayDescriptor,
  DatasetCatalog,
  DatasetManifest,
  DatasetSource,
  FeatureDescriptor,
  FeaturePayload,
  RegionMetadata,
  RegionalFeaturePayload,
} from './contracts.js';

const DB_NAME = 'ibl-ephys-atlas-v2-local-v02';
const DB_VERSION = 1;
const MANIFESTS = 'manifests';
const RESOURCES = 'resources';
const DISPLAY_STATISTICS = new Set<StatisticId>(['mean', 'median', 'min', 'max', 'count']);

interface StoredManifest {
  key: string;
  selector: string;
  sourceDatasetId: string;
  sourceReleaseId: string;
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

function resourceKey(namespace: string, path: string): string {
  return `${namespace}\u0000${path}`;
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
    const byPath = new Map<string, File>();
    for (const file of allFiles) {
      const path = relativePath(file);
      if (byPath.has(path)) throw new Error(`Local dataset contains duplicate path: ${path}`);
      byPath.set(path, file);
    }
    if (!byPath.has('manifest.json')) throw new Error('Local dataset must contain manifest.json');

    const { document, features } = await validateLocalDatasetFiles(byPath);
    const selector = localDatasetReleaseId(document.datasetId, document.release.releaseId);
    const namespace = selector;
    const manifest = resolveDatasetManifest(document, features, 'local');
    const storedManifest = {
      ...manifest,
      dataset: { ...manifest.dataset, release: selector },
    } satisfies DatasetManifest;

    const db = await openDatabase();
    const transaction = db.transaction([MANIFESTS, RESOURCES], 'readwrite');
    try {
      transaction.objectStore(MANIFESTS).add({
        key: namespace,
        selector,
        sourceDatasetId: document.datasetId,
        sourceReleaseId: document.release.releaseId,
        manifest: storedManifest,
      } satisfies StoredManifest);
      for (const [path, file] of byPath) {
        if (path === 'manifest.json') continue;
        transaction.objectStore(RESOURCES).put({
          key: resourceKey(namespace, path),
          blob: file,
        } satisfies StoredResource);
      }
      await transactionDone(transaction);
    } catch (error) {
      try { transaction.abort(); } catch { /* transaction already completed or aborted */ }
      if (error instanceof DOMException && error.name === 'ConstraintError') {
        throw new Error(`Local dataset ${document.datasetId}/${document.release.releaseId} is already imported`);
      }
      throw error;
    } finally {
      db.close();
    }
    return storedManifest;
  }

  async loadCatalog(): Promise<DatasetCatalog> {
    const storedManifests = await this.listManifests();
    const releases = storedManifests.map((stored) => ({
      id: stored.selector,
      label: `${stored.sourceDatasetId} / ${stored.sourceReleaseId}`,
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
    const stored = await requestValue(transaction.objectStore(MANIFESTS).get(ref.releaseId) as IDBRequest<StoredManifest | undefined>);
    db.close();
    if (!stored) throw new Error(`Local release not found: ${ref.releaseId}`);
    return stored.manifest;
  }

  async loadRegions(ref: DatasetRef, parcellation: ParcellationId): Promise<readonly RegionMetadata[]> {
    if (!ref.releaseId) throw new Error('A local release id is required');
    const manifest = await this.loadManifest(ref);
    const parcel = manifest.parcellationDescriptors[parcellation];
    if (!parcel) throw new Error(`Dataset has no ${parcellation} parcellation`);
    if (!parcel.metadata) throw new Error(`${parcellation} parcellation has no region metadata resource`);
    const [metadataBlob, regionIds] = await Promise.all([
      this.readResource(manifest, parcel.metadata),
      this.readArray(manifest, parcel.regionIndex.path, parcel.regionIndex),
    ]);
    const regions = parseRegionMetadata(JSON.parse(await metadataBlob.text()) as unknown);
    if (regions.length !== regionIds.length) throw new Error(`${parcellation} metadata does not match region index length`);
    for (const region of regions) {
      if (region.index < 0 || region.index >= regionIds.length || regionIds[region.index] !== region.atlasId) {
        throw new Error(`${parcellation} metadata/index mismatch at region ${region.id}`);
      }
    }
    return regions;
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
      return {
        schemaVersion: SCHEMA_VERSION,
        featureId,
        representation: 'volume',
        descriptor,
        loadResource: async (path) => {
          const blob = await this.readResource(manifest, resolvePath(feature.path, path));
          return blob.arrayBuffer();
        },
      };
    }

    if (!parcellation) throw new Error(`Parcellation required for regional feature ${feature.id}`);
    const regional = feature.representations.regional?.parcellations[parcellation];
    const parcel = manifest.parcellationDescriptors[parcellation];
    if (!regional || !parcel) throw new Error(`Feature ${feature.id} has no ${parcellation} regional representation`);

    const regionIds = await this.readArray(manifest, parcel.regionIndex.path, parcel.regionIndex);
    const values = await this.readArray(manifest, resolvePath(feature.path, regional.values.path), regional.values);
    if (regionIds.length !== values.length) throw new Error(`${feature.id}/${parcellation} values do not match region index length`);
    const statsPath = resolvePath(feature.path, regional.statistics);
    const statsBlob = await this.readResource(manifest, statsPath);
    const statsDocument = parseRegionalStatisticsResource(JSON.parse(await statsBlob.text()) as unknown);
    const [matrix, histogramFlat] = await Promise.all([
      this.readArray(manifest, resolvePath(statsPath, statsDocument.values.path), statsDocument.values),
      statsDocument.histogram?.regionalCounts
        ? this.readArray(
            manifest,
            resolvePath(statsPath, statsDocument.histogram.regionalCounts.path),
            statsDocument.histogram.regionalCounts,
          )
        : Promise.resolve(null),
    ]);
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
      ...(statsDocument.population ? { population: statsDocument.population } : {}),
      ...(statsDocument.global ? { global: statsDocument.global } : {}),
      ...(statsDocument.histogram
        ? { histogram: materializeRegionalHistogram(statsDocument.histogram, histogramFlat, regionIds.length) }
        : {}),
    };
  }

  private findFeature(manifest: DatasetManifest, featureId: string): FeatureDescriptor {
    const feature = manifest.features.find((item) => item.id === featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    return feature;
  }

  private async readResource(manifest: DatasetManifest, path: string): Promise<Blob> {
    const db = await openDatabase();
    const transaction = db.transaction(RESOURCES, 'readonly');
    const namespace = manifest.dataset.release;
    const stored = await requestValue(transaction.objectStore(RESOURCES).get(resourceKey(namespace, path)) as IDBRequest<StoredResource | undefined>);
    db.close();
    if (!stored) throw new Error(`Local resource not found: ${path}`);
    return stored.blob;
  }

  private async readArray(manifest: DatasetManifest, path: string, descriptor: BinaryArrayDescriptor): Promise<number[]> {
    const blob = await this.readResource(manifest, path);
    return decodeBinaryArray(await blob.arrayBuffer(), { ...descriptor, path });
  }

  private async listManifests(): Promise<StoredManifest[]> {
    const db = await openDatabase();
    const transaction = db.transaction(MANIFESTS, 'readonly');
    const stored = await requestValue(transaction.objectStore(MANIFESTS).getAll() as IDBRequest<StoredManifest[]>);
    db.close();
    return stored;
  }
}
