import type { DatasetRef, ParcellationId, RepresentationKind } from '../domain/types.js';
import { loadRegionalFeatureFromResources, loadRegionsFromResources } from './regional-loader.js';
import type { ResourceReader } from './resource-reader.js';
import { parseVolumeResourceIndex, parseVolumeSummary } from './validation/volume-v1.js';
import {
  decodeBinaryArray,
  decodeResourceBytes,
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
  EncodedResourceDescriptor,
  FeatureDescriptor,
  FeaturePayload,
  RegionMetadata,
} from './contracts.js';

const DB_NAME = 'ibl-ephys-atlas-schema-v1-local';
const DB_VERSION = 1;
const MANIFESTS = 'manifests';
const RESOURCES = 'resources';

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

class LocalResourceReader implements ResourceReader {
  constructor(
    private readonly source: LocalDatasetSource,
    private readonly manifest: DatasetManifest,
  ) {}

  resolve(base: string, relative: string): string {
    return resolvePath(base, relative);
  }

  async readJson(location: string, signal?: AbortSignal, _resource?: EncodedResourceDescriptor): Promise<unknown> {
    signal?.throwIfAborted();
    const text = await (await this.source.readResource(this.manifest, location)).text();
    signal?.throwIfAborted();
    return JSON.parse(text) as unknown;
  }

  async readArray(location: string, descriptor: BinaryArrayDescriptor, signal?: AbortSignal): Promise<number[]> {
    const bytes = await this.readBytes(location, signal);
    return decodeBinaryArray(await decodeResourceBytes(bytes, descriptor), { ...descriptor, path: location });
  }

  async readBytes(location: string, signal?: AbortSignal, _resource?: EncodedResourceDescriptor): Promise<ArrayBuffer> {
    signal?.throwIfAborted();
    const bytes = await (await this.source.readResource(this.manifest, location)).arrayBuffer();
    signal?.throwIfAborted();
    return bytes;
  }
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
    const manifest = resolveDatasetManifest(document, features, 'local');
    const storedManifest = {
      ...manifest,
      dataset: { ...manifest.dataset, release: selector },
    } satisfies DatasetManifest;

    const db = await openDatabase();
    const transaction = db.transaction([MANIFESTS, RESOURCES], 'readwrite');
    try {
      transaction.objectStore(MANIFESTS).add({
        key: selector,
        selector,
        sourceDatasetId: document.datasetId,
        sourceReleaseId: document.release.releaseId,
        manifest: storedManifest,
      } satisfies StoredManifest);
      for (const [path, file] of byPath) {
        if (path === 'manifest.json') continue;
        transaction.objectStore(RESOURCES).put({ key: resourceKey(selector, path), blob: file } satisfies StoredResource);
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
        description: 'Browser-imported schema-v1 datasets stored only on this device.',
        releases,
        defaultRelease: releases.at(-1)?.id ?? '',
      }] : [],
    };
  }

  async loadManifest(ref: DatasetRef): Promise<DatasetManifest> {
    if (ref.datasetId !== 'local' || !ref.releaseId) throw new Error('A local release id is required');
    const db = await openDatabase();
    const transaction = db.transaction(MANIFESTS, 'readonly');
    const stored = await requestValue(
      transaction.objectStore(MANIFESTS).get(ref.releaseId) as IDBRequest<StoredManifest | undefined>,
    );
    db.close();
    if (!stored) throw new Error(`Local release not found: ${ref.releaseId}`);
    return stored.manifest;
  }

  async loadRegions(ref: DatasetRef, parcellation: ParcellationId): Promise<readonly RegionMetadata[]> {
    const manifest = await this.requireManifest(ref);
    const parcel = manifest.parcellationDescriptors[parcellation];
    if (!parcel) throw new Error(`Dataset has no ${parcellation} parcellation`);
    return loadRegionsFromResources(this.reader(manifest), 'manifest.json', parcellation, parcel);
  }

  async loadFeature(
    ref: DatasetRef,
    featureId: string,
    representation: RepresentationKind,
    parcellation?: ParcellationId,
    signal?: AbortSignal,
  ): Promise<FeaturePayload> {
    const manifest = await this.requireManifest(ref);
    const feature = this.findFeature(manifest, featureId);
    const reader = this.reader(manifest);

    if (representation === 'volume') {
      const descriptor = feature.representations.volume;
      if (!descriptor) throw new Error(`Feature ${featureId} has no volume representation`);
      const [resourceIndexRaw, summaryRaw] = await Promise.all([
        reader.readJson(reader.resolve(feature.path, descriptor.resourceIndexPath), signal),
        reader.readJson(reader.resolve(feature.path, descriptor.summaryPath), signal),
      ]);
      const resolvedDescriptor = {
        ...descriptor,
        resource: parseVolumeResourceIndex(resourceIndexRaw, descriptor),
        valueRange: parseVolumeSummary(summaryRaw, descriptor),
      };
      return {
        schemaVersion: SCHEMA_VERSION,
        featureId,
        representation: 'volume',
        descriptor: resolvedDescriptor,
        loadResource: (path, resourceSignal, resource) => reader.readBytes(
          reader.resolve(feature.path, path),
          resourceSignal,
          resource,
        ),
      };
    }

    if (!parcellation) throw new Error(`Parcellation required for regional feature ${feature.id}`);
    const parcel = manifest.parcellationDescriptors[parcellation];
    if (!parcel) throw new Error(`Dataset has no ${parcellation} region index`);
    return loadRegionalFeatureFromResources({
      reader,
      manifestLocation: 'manifest.json',
      featureLocation: feature.path,
      feature,
      parcellation,
      parcellationDescriptor: parcel,
      ...(signal ? { signal } : {}),
    });
  }

  async prefetchFeature(
    ref: DatasetRef,
    featureId: string,
    representation: RepresentationKind,
    parcellation?: ParcellationId,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.loadFeature(ref, featureId, representation, parcellation, signal);
  }

  private async requireManifest(ref: DatasetRef): Promise<DatasetManifest> {
    if (!ref.releaseId) throw new Error('A local release id is required');
    return this.loadManifest(ref);
  }

  private reader(manifest: DatasetManifest): ResourceReader {
    return new LocalResourceReader(this, manifest);
  }

  private findFeature(manifest: DatasetManifest, featureId: string): FeatureDescriptor {
    const feature = manifest.features.find((item) => item.id === featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    return feature;
  }

  async readResource(manifest: DatasetManifest, path: string): Promise<Blob> {
    const db = await openDatabase();
    const transaction = db.transaction(RESOURCES, 'readonly');
    const namespace = manifest.dataset.release;
    const stored = await requestValue(
      transaction.objectStore(RESOURCES).get(resourceKey(namespace, path)) as IDBRequest<StoredResource | undefined>,
    );
    db.close();
    if (!stored) throw new Error(`Local resource not found: ${path}`);
    return stored.blob;
  }

  private async listManifests(): Promise<StoredManifest[]> {
    const db = await openDatabase();
    const transaction = db.transaction(MANIFESTS, 'readonly');
    const stored = await requestValue(transaction.objectStore(MANIFESTS).getAll() as IDBRequest<StoredManifest[]>);
    db.close();
    return stored;
  }
}
