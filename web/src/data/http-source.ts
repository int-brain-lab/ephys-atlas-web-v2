import type { DatasetId, DatasetRef, ParcellationId, RepresentationKind } from '../domain/types.js';
import { ResourceFetcher } from './cache.js';
import { loadRegionalFeatureFromResources, loadRegionsFromResources } from './regional-loader.js';
import type { ResourceReader } from './resource-reader.js';
import {
  decodeBinaryArray,
  parseDatasetCatalog,
  parseDatasetManifestDocument,
  parseFeatureDescriptor,
  resolveDatasetManifest,
} from './validate.js';
import { SCHEMA_VERSION } from './contracts.js';
import type {
  BinaryArrayDescriptor,
  DatasetCatalog,
  DatasetCatalogEntry,
  DatasetManifest,
  DatasetReleaseSummary,
  DatasetSource,
  FeatureDescriptor,
  FeaturePayload,
  RegionMetadata,
} from './contracts.js';

class HttpResourceReader implements ResourceReader {
  constructor(
    private readonly fetcher: ResourceFetcher,
    private readonly immutable: boolean,
  ) {}

  resolve(base: string, relative: string): string {
    return new URL(relative, base).toString();
  }

  async readJson(location: string, signal?: AbortSignal): Promise<unknown> {
    const response = await this.fetcher.fetch(
      location,
      { immutable: this.immutable, ...(signal ? { signal } : {}) },
    );
    return response.json() as Promise<unknown>;
  }

  async readArray(location: string, descriptor: BinaryArrayDescriptor, signal?: AbortSignal): Promise<number[]> {
    const bytes = await this.readBytes(location, signal);
    return decodeBinaryArray(bytes, descriptor);
  }

  async readBytes(location: string, signal?: AbortSignal): Promise<ArrayBuffer> {
    const response = await this.fetcher.fetch(
      location,
      { immutable: this.immutable, ...(signal ? { signal } : {}) },
    );
    return response.arrayBuffer();
  }
}

export class HttpDatasetSource implements DatasetSource {
  readonly kind = 'published' as const;
  private catalogPromise: Promise<DatasetCatalog> | null = null;
  private readonly manifestCache = new Map<string, Promise<DatasetManifest>>();
  private readonly regionCache = new Map<string, Promise<readonly RegionMetadata[]>>();
  private readonly manifestUrls = new Map<string, string>();
  private readonly featureUrls = new Map<string, string>();

  constructor(
    private readonly catalogUrl: string,
    private readonly fetcher = new ResourceFetcher(),
  ) {}

  async loadCatalog(): Promise<DatasetCatalog> {
    this.catalogPromise ??= new HttpResourceReader(this.fetcher, false)
      .readJson(this.catalogUrl)
      .then(parseDatasetCatalog)
      .catch((error: unknown) => {
        this.catalogPromise = null;
        throw error;
      });
    return this.catalogPromise;
  }

  async loadManifest(ref: DatasetRef): Promise<DatasetManifest> {
    const { entry, release } = await this.resolveRelease(ref);
    const key = this.releaseKey(entry.id, release.id);
    let manifest = this.manifestCache.get(key);
    if (!manifest) {
      const reader = this.reader(release.immutable);
      const manifestUrl = reader.resolve(this.catalogUrl, release.manifest);
      this.manifestUrls.set(key, manifestUrl);
      manifest = reader.readJson(manifestUrl).then(async (raw) => {
        const document = parseDatasetManifestDocument(raw);
        if (document.release.releaseId !== release.id) {
          throw new Error(`Manifest release ${document.release.releaseId} does not match catalog release ${release.id}`);
        }
        const features = await Promise.all(document.featureRefs.map(async (featureRef) => {
          const featureUrl = reader.resolve(manifestUrl, featureRef.path);
          this.featureUrls.set(this.featureKey(entry.id, release.id, featureRef.id), featureUrl);
          const descriptor = parseFeatureDescriptor(await reader.readJson(featureUrl), featureRef.path);
          if (descriptor.id !== featureRef.id) throw new Error(`Feature id mismatch for ${featureRef.path}`);
          return descriptor;
        }));
        return resolveDatasetManifest(document, features, entry.id);
      }).catch((error: unknown) => {
        this.manifestCache.delete(key);
        this.manifestUrls.delete(key);
        throw error;
      });
      this.manifestCache.set(key, manifest);
    }
    return manifest;
  }

  async loadRegions(ref: DatasetRef, parcellation: ParcellationId): Promise<readonly RegionMetadata[]> {
    const { entry, release } = await this.resolveRelease(ref);
    const manifest = await this.loadManifest(ref);
    const parcel = manifest.parcellationDescriptors[parcellation];
    if (!parcel) throw new Error(`Dataset has no ${parcellation} parcellation`);
    const manifestUrl = this.requireManifestUrl(entry.id, release.id);
    const key = `${this.releaseKey(entry.id, release.id)}:${parcellation}`;
    let pending = this.regionCache.get(key);
    if (!pending) {
      pending = loadRegionsFromResources(this.reader(release.immutable), manifestUrl, parcellation, parcel)
        .catch((error: unknown) => {
          this.regionCache.delete(key);
          throw error;
        });
      this.regionCache.set(key, pending);
    }
    return pending;
  }

  async loadFeature(
    ref: DatasetRef,
    featureId: string,
    representation: RepresentationKind,
    parcellation?: ParcellationId,
    signal?: AbortSignal,
  ): Promise<FeaturePayload> {
    const { entry, release } = await this.resolveRelease(ref);
    const manifest = await this.loadManifest(ref);
    const feature = this.findFeature(manifest, featureId);
    const featureUrl = this.requireFeatureUrl(entry.id, release.id, featureId);
    const manifestUrl = this.requireManifestUrl(entry.id, release.id);
    const reader = this.reader(release.immutable);

    if (representation === 'volume') {
      const descriptor = feature.representations.volume;
      if (!descriptor) throw new Error(`Feature ${feature.id} has no volume representation`);
      return {
        schemaVersion: SCHEMA_VERSION,
        featureId,
        representation: 'volume',
        descriptor,
        baseUrl: featureUrl,
        loadResource: (path, signal) => reader.readBytes(reader.resolve(featureUrl, path), signal),
      };
    }

    if (!parcellation) throw new Error(`Parcellation required for regional feature ${feature.id}`);
    const parcel = manifest.parcellationDescriptors[parcellation];
    if (!parcel) throw new Error(`Dataset has no ${parcellation} region index`);
    return loadRegionalFeatureFromResources({
      reader,
      manifestLocation: manifestUrl,
      featureLocation: featureUrl,
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

  private reader(immutable: boolean): ResourceReader {
    return new HttpResourceReader(this.fetcher, immutable);
  }

  private async resolveRelease(ref: DatasetRef): Promise<{ entry: DatasetCatalogEntry; release: DatasetReleaseSummary }> {
    const catalog = await this.loadCatalog();
    const entry = catalog.datasets.find((dataset) => dataset.id === ref.datasetId);
    if (!entry) throw new Error(`Dataset not found: ${ref.datasetId}`);
    const releaseId = ref.releaseId ?? entry.defaultRelease;
    const release = entry.releases.find((item) => item.id === releaseId);
    if (!release) throw new Error(`Release not found: ${ref.datasetId}@${releaseId}`);
    return { entry, release };
  }

  private findFeature(manifest: DatasetManifest, featureId: string): FeatureDescriptor {
    const feature = manifest.features.find((item) => item.id === featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);
    return feature;
  }

  private requireManifestUrl(datasetId: DatasetId, releaseId: string): string {
    const url = this.manifestUrls.get(this.releaseKey(datasetId, releaseId));
    if (!url) throw new Error(`Resolved manifest URL missing for ${datasetId}@${releaseId}`);
    return url;
  }

  private requireFeatureUrl(datasetId: DatasetId, releaseId: string, featureId: string): string {
    const url = this.featureUrls.get(this.featureKey(datasetId, releaseId, featureId));
    if (!url) throw new Error(`Resolved feature URL missing for ${featureId}`);
    return url;
  }

  private releaseKey(datasetId: DatasetId, releaseId: string): string {
    return `${datasetId}@${releaseId}`;
  }

  private featureKey(datasetId: DatasetId, releaseId: string, featureId: string): string {
    return `${this.releaseKey(datasetId, releaseId)}:${featureId}`;
  }
}
