import type { DatasetRef, ParcellationId, RepresentationKind } from '../domain/types.js';
import { PROVISIONAL_SCHEMA_VERSION } from './contracts.js';
import { parseDatasetManifest, parseFeaturePayload } from './validate.js';
import type {
  DatasetCatalog,
  DatasetManifest,
  DatasetSource,
  FeatureDescriptor,
  FeaturePayload,
} from './contracts.js';

const DB_NAME = 'ibl-ephys-atlas-v2-local';
const DB_VERSION = 1;
const MANIFESTS = 'manifests';
const RESOURCES = 'resources';

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

function findResource(feature: FeatureDescriptor, representation: RepresentationKind, parcellation?: ParcellationId): string {
  if (representation === 'regional') {
    if (!parcellation) throw new Error(`Parcellation required for regional feature ${feature.id}`);
    const path = feature.representations.regional?.parcellations[parcellation];
    if (!path) throw new Error(`Feature ${feature.id} has no ${parcellation} regional representation`);
    return path;
  }
  const path = feature.representations.volume?.resource;
  if (!path) throw new Error(`Feature ${feature.id} has no volume representation`);
  return path;
}

export class LocalDatasetSource implements DatasetSource {
  readonly kind = 'local' as const;

  async importFiles(files: Iterable<File>): Promise<DatasetManifest> {
    const allFiles = [...files];
    const manifestFile = allFiles.find((file) => relativePath(file) === 'manifest.json' || file.name === 'manifest.json');
    if (!manifestFile) throw new Error('Local dataset must contain manifest.json');

    const manifest = parseDatasetManifest(JSON.parse(await manifestFile.text()) as unknown);
    if (manifest.schemaVersion !== PROVISIONAL_SCHEMA_VERSION) {
      throw new Error(`Unsupported local schema: ${manifest.schemaVersion}`);
    }
    if (manifest.dataset.id !== 'local') {
      throw new Error('Local manifest dataset.id must be "local"');
    }

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
      schemaVersion: PROVISIONAL_SCHEMA_VERSION,
      datasets: releases.length ? [{
        id: 'local',
        title: 'Local datasets',
        description: 'Browser-imported datasets stored only on this device.',
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
    const feature = manifest.features.find((item) => item.id === featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    const path = findResource(feature, representation, parcellation);

    const db = await openDatabase();
    const transaction = db.transaction(RESOURCES, 'readonly');
    const stored = await requestValue(transaction.objectStore(RESOURCES).get(resourceKey(ref.releaseId, path)) as IDBRequest<StoredResource | undefined>);
    db.close();
    if (!stored) throw new Error(`Local resource not found: ${path}`);
    return parseFeaturePayload(JSON.parse(await stored.blob.text()) as unknown);
  }

  private async listManifests(): Promise<DatasetManifest[]> {
    const db = await openDatabase();
    const transaction = db.transaction(MANIFESTS, 'readonly');
    const stored = await requestValue(transaction.objectStore(MANIFESTS).getAll() as IDBRequest<StoredManifest[]>);
    db.close();
    return stored.map((item) => item.manifest);
  }
}
