import type { DatasetRef, ParcellationId, RepresentationKind } from '../domain/types.js';
import { prepareLocalArchive, type PreparedLocalArchive } from './local-archive.js';
import { loadRegionalFeatureFromResources, loadRegionsFromResources } from './regional-loader.js';
import type { ResourceReader } from './resource-reader.js';
import { parseVolumeResourceIndex, parseVolumeSummary } from './validation/volume-v1.js';
import { validateDistributionMatchesDisplay } from './validation/distribution.js';
import {
  decodeBinaryArray,
  decodeResourceBytes,
  localDatasetReleaseId,
  resolveDatasetManifest,
  validateLocalDatasetFiles,
} from './validate.js';
import { SCHEMA_VERSION } from './contracts.js';
import type {
  ArtifactDescriptor,
  ArtifactPayload,
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
  rootManifest?: Blob;
  importedAt?: string;
  integrity?: StoredIntegrity;
}

interface StoredResource {
  key: string;
  blob: Blob;
}

type LocalIntegrityState = 'verified' | 'damaged' | 'unverified';

interface StoredIntegrity {
  state: Exclude<LocalIntegrityState, 'unverified'>;
  checkedAt: string;
  message?: string;
}

export interface LocalReleaseInspection {
  readonly selector: string;
  readonly sourceDatasetId: string;
  readonly sourceReleaseId: string;
  readonly title: string;
  readonly importedAt: string | null;
  readonly storedBytes: number;
  readonly resourceCount: number;
  readonly integrityState: LocalIntegrityState;
  readonly integrityCheckedAt: string | null;
  readonly integrityMessage?: string;
}

export interface LocalStorageInspection {
  readonly releases: readonly LocalReleaseInspection[];
  readonly usageBytes?: number;
  readonly quotaBytes?: number;
  readonly persisted?: boolean;
}

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error('Local dataset storage is unavailable in this browser or browsing mode'));
  }
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    let rejected = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MANIFESTS)) db.createObjectStore(MANIFESTS, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(RESOURCES)) db.createObjectStore(RESOURCES, { keyPath: 'key' });
    };
    request.onsuccess = () => {
      if (rejected) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('Unable to open local dataset store'));
    request.onblocked = () => {
      rejected = true;
      reject(new Error('Local dataset storage is blocked by another open tab; close other tabs for this site and try again'));
    };
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

function scanCursor<T>(request: IDBRequest<IDBCursorWithValue | null>, visit: (value: T) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      visit(cursor.value as T);
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor failed'));
  });
}

function resourceKey(namespace: string, path: string): string {
  return `${namespace}\u0000${path}`;
}

function errorName(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name?: unknown }).name)
    : undefined;
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

  prepareArchive(archive: Blob, signal?: AbortSignal): Promise<PreparedLocalArchive> {
    return prepareLocalArchive(archive, signal);
  }

  async admitPrepared(prepared: PreparedLocalArchive): Promise<DatasetManifest> {
    const { document, features } = prepared.validated;
    const selector = localDatasetReleaseId(document.datasetId, document.release.releaseId);
    const manifest = resolveDatasetManifest(document, features, 'local');
    const storedManifest = {
      ...manifest,
      dataset: { ...manifest.dataset, release: selector },
    } satisfies DatasetManifest;

    const rootManifest = prepared.files.get('manifest.json');
    if (!rootManifest) throw new Error('Validated local dataset has no root manifest');
    const importedAt = new Date().toISOString();
    const db = await openDatabase();
    const transaction = db.transaction([MANIFESTS, RESOURCES], 'readwrite');
    let duplicateRelease = false;
    try {
      const manifestRequest = transaction.objectStore(MANIFESTS).add({
        key: selector,
        selector,
        sourceDatasetId: document.datasetId,
        sourceReleaseId: document.release.releaseId,
        manifest: storedManifest,
        rootManifest,
        importedAt,
        integrity: { state: 'verified', checkedAt: importedAt },
      } satisfies StoredManifest);
      manifestRequest.onerror = () => {
        duplicateRelease = manifestRequest.error?.name === 'ConstraintError';
      };
      for (const [path, file] of prepared.files) {
        if (path === 'manifest.json') continue;
        transaction.objectStore(RESOURCES).put({ key: resourceKey(selector, path), blob: file } satisfies StoredResource);
      }
      await transactionDone(transaction);
    } catch (error) {
      try { transaction.abort(); } catch { /* transaction already completed or aborted */ }
      if (duplicateRelease || (error instanceof DOMException && error.name === 'ConstraintError')) {
        throw new Error(`Local dataset ${document.datasetId}/${document.release.releaseId} is already imported`);
      }
      if (errorName(error) === 'QuotaExceededError') {
        throw new Error(
          'This browser does not have enough storage for the local dataset. '
          + 'No partial import was kept; delete an existing local dataset or clear site data, then try again.',
        );
      }
      throw error;
    } finally {
      db.close();
    }
    return storedManifest;
  }

  async importArchive(archive: Blob, signal?: AbortSignal): Promise<DatasetManifest> {
    return this.admitPrepared(await this.prepareArchive(archive, signal));
  }

  async deleteRelease(selector: string): Promise<void> {
    if (!selector) throw new Error('A local release id is required');
    const db = await openDatabase();
    const transaction = db.transaction([MANIFESTS, RESOURCES], 'readwrite');
    const manifests = transaction.objectStore(MANIFESTS);
    const resources = transaction.objectStore(RESOURCES);
    let found = true;
    const completion = transactionDone(transaction);
    const request = manifests.get(selector) as IDBRequest<StoredManifest | undefined>;
    request.onsuccess = () => {
      if (!request.result) {
        found = false;
        transaction.abort();
        return;
      }
      const prefix = `${selector}\u0000`;
      resources.delete(IDBKeyRange.bound(prefix, `${selector}\u0001`, false, true));
      manifests.delete(selector);
    };
    try {
      await completion;
    } catch (error) {
      if (!found) throw new Error(`Local release not found: ${selector}`);
      throw error;
    } finally {
      db.close();
    }
  }

  async inspectStorage(): Promise<LocalStorageInspection> {
    const db = await openDatabase();
    const manifests: StoredManifest[] = [];
    const resourcesBySelector = new Map<string, { bytes: number; count: number }>();
    try {
      const transaction = db.transaction([MANIFESTS, RESOURCES], 'readonly');
      await Promise.all([
        scanCursor<StoredManifest>(transaction.objectStore(MANIFESTS).openCursor(), (stored) => manifests.push(stored)),
        scanCursor<StoredResource>(transaction.objectStore(RESOURCES).openCursor(), (resource) => {
          const separator = resource.key.indexOf('\u0000');
          if (separator < 1) return;
          const selector = resource.key.slice(0, separator);
          const current = resourcesBySelector.get(selector) ?? { bytes: 0, count: 0 };
          current.bytes += resource.blob.size;
          current.count += 1;
          resourcesBySelector.set(selector, current);
        }),
      ]);
    } finally {
      db.close();
    }
    const releases = manifests.map((stored) => {
      const resourcesForRelease = resourcesBySelector.get(stored.selector) ?? { bytes: 0, count: 0 };
      return this.releaseInspection(stored, resourcesForRelease.bytes, resourcesForRelease.count);
    }).sort((left, right) => (
      (right.importedAt ?? '').localeCompare(left.importedAt ?? '') || left.selector.localeCompare(right.selector)
    ));

    let estimate: StorageEstimate | undefined;
    let persisted: boolean | undefined;
    try {
      estimate = await navigator.storage?.estimate();
    } catch { /* Storage estimates are optional browser capabilities. */ }
    try {
      persisted = await navigator.storage?.persisted();
    } catch { /* Persistence reporting is optional. */ }
    return {
      releases,
      ...(estimate?.usage === undefined ? {} : { usageBytes: estimate.usage }),
      ...(estimate?.quota === undefined ? {} : { quotaBytes: estimate.quota }),
      ...(persisted === undefined ? {} : { persisted }),
    };
  }

  async verifyRelease(selector: string): Promise<LocalReleaseInspection> {
    if (!selector) throw new Error('A local release id is required');
    const db = await openDatabase();
    const prefix = `${selector}\u0000`;
    let stored: StoredManifest | undefined;
    const resources: StoredResource[] = [];
    try {
      const transaction = db.transaction([MANIFESTS, RESOURCES], 'readonly');
      const manifestPromise = requestValue(
        transaction.objectStore(MANIFESTS).get(selector) as IDBRequest<StoredManifest | undefined>,
      );
      const resourcePromise = scanCursor<StoredResource>(transaction.objectStore(RESOURCES).openCursor(
        IDBKeyRange.bound(prefix, `${selector}\u0001`, false, true),
      ), (resource) => resources.push(resource));
      [stored] = await Promise.all([manifestPromise, resourcePromise]);
    } finally {
      db.close();
    }
    if (!stored) throw new Error(`Local release not found: ${selector}`);

    const resourceBytes = resources.reduce((total, resource) => total + resource.blob.size, 0);
    if (!stored.rootManifest) {
      return this.releaseInspection(stored, resourceBytes, resources.length);
    }

    const checkedAt = new Date().toISOString();
    let integrity: StoredIntegrity;
    try {
      const files = new Map<string, Blob>([['manifest.json', stored.rootManifest]]);
      for (const resource of resources) files.set(resource.key.slice(prefix.length), resource.blob);
      const validated = await validateLocalDatasetFiles(files);
      const verifiedSelector = localDatasetReleaseId(validated.document.datasetId, validated.document.release.releaseId);
      if (verifiedSelector !== selector) {
        throw new Error(`Manifest identity changed: expected ${selector}, got ${verifiedSelector}`);
      }
      integrity = { state: 'verified', checkedAt };
    } catch (error) {
      integrity = {
        state: 'damaged',
        checkedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    await this.updateIntegrity(selector, integrity);
    return this.releaseInspection({ ...stored, integrity }, resourceBytes, resources.length);
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
      const summary = parseVolumeSummary(summaryRaw, descriptor);
      const display = feature.display?.volume;
      if (!display) throw new Error(`Feature ${feature.id} has no volume display contract`);
      if (summary.distribution) {
        validateDistributionMatchesDisplay(summary.distribution.binnings, display, `${feature.id}/volume`);
      }
      const resolvedDescriptor = {
        ...descriptor,
        resource: parseVolumeResourceIndex(resourceIndexRaw, descriptor),
      };
      return {
        schemaVersion: SCHEMA_VERSION,
        featureId,
        representation: 'volume',
        descriptor: resolvedDescriptor,
        summary,
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

  async loadArtifact(
    ref: DatasetRef,
    artifactId: string,
    featureId?: string,
    signal?: AbortSignal,
  ): Promise<ArtifactPayload> {
    const manifest = await this.requireManifest(ref);
    const artifact = this.findArtifact(manifest, artifactId, featureId);
    const basePath = featureId === undefined ? 'manifest.json' : this.findFeature(manifest, featureId).path;
    return {
      artifact,
      bytes: await this.reader(manifest).readBytes(
        resolvePath(basePath, artifact.resource.path),
        signal,
        artifact.resource,
      ),
    };
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

  private findArtifact(manifest: DatasetManifest, artifactId: string, featureId?: string): ArtifactDescriptor {
    const artifacts = featureId === undefined
      ? manifest.artifacts
      : this.findFeature(manifest, featureId).artifacts;
    const artifact = artifacts.find((item) => item.id === artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${featureId ? `${featureId}/` : ''}${artifactId}`);
    }
    return artifact;
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

  private releaseInspection(stored: StoredManifest, resourceBytes: number, resourceCount: number): LocalReleaseInspection {
    const integrityState = stored.rootManifest ? stored.integrity?.state ?? 'unverified' : 'unverified';
    return {
      selector: stored.selector,
      sourceDatasetId: stored.sourceDatasetId,
      sourceReleaseId: stored.sourceReleaseId,
      title: stored.manifest.dataset.title,
      importedAt: stored.importedAt ?? null,
      storedBytes: resourceBytes + (stored.rootManifest?.size ?? 0),
      resourceCount,
      integrityState,
      integrityCheckedAt: stored.integrity?.checkedAt ?? null,
      ...(stored.integrity?.message ? { integrityMessage: stored.integrity.message } : {}),
    };
  }

  private async updateIntegrity(selector: string, integrity: StoredIntegrity): Promise<void> {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(MANIFESTS, 'readwrite');
      const store = transaction.objectStore(MANIFESTS);
      let found = true;
      const completion = transactionDone(transaction);
      const request = store.get(selector) as IDBRequest<StoredManifest | undefined>;
      request.onsuccess = () => {
        if (!request.result) {
          found = false;
          transaction.abort();
          return;
        }
        store.put({ ...request.result, integrity });
      };
      try {
        await completion;
      } catch (error) {
        if (!found) throw new Error(`Local release not found: ${selector}`);
        throw error;
      }
    } finally {
      db.close();
    }
  }
}
