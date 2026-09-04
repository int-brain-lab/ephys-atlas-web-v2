import type { DatasetId, DatasetRef, ParcellationId, RepresentationKind } from '../domain/types.js';
import { ResourceFetcher } from './cache.js';
import { loadRegionalFeatureFromResources, loadRegionsFromResources } from './regional-loader.js';
import type { ResourceReader } from './resource-reader.js';
import { parseVolumeResourceIndex, parseVolumeSummary } from './validation/volume-v1.js';
import { validateDistributionMatchesDisplay } from './validation/distribution.js';
import {
  decodeBinaryArray,
  decodeResourceBytes,
  parseDatasetCatalog,
  parseDatasetManifestDocument,
  parseFeatureDescriptor,
  resolveDatasetManifest,
} from './validate.js';
import { SCHEMA_VERSION } from './contracts.js';
import type {
  ArtifactDescriptor,
  ArtifactPayload,
  BinaryArrayDescriptor,
  DatasetCatalog,
  DatasetCatalogEntry,
  DatasetManifest,
  DatasetReleaseSummary,
  DatasetSource,
  EncodedResourceDescriptor,
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

  async readJson(location: string, signal?: AbortSignal, resource?: EncodedResourceDescriptor): Promise<unknown> {
    const response = await this.fetcher.fetch(
      location,
      { immutable: this.immutable, ...(signal ? { signal } : {}), ...(resource ? { integrity: resource } : {}) },
    );
    return response.json() as Promise<unknown>;
  }

  async readArray(location: string, descriptor: BinaryArrayDescriptor, signal?: AbortSignal): Promise<number[]> {
    const bytes = await this.readBytes(location, signal, descriptor);
    return decodeBinaryArray(await decodeResourceBytes(bytes, descriptor), descriptor);
  }

  async readBytes(location: string, signal?: AbortSignal, resource?: EncodedResourceDescriptor): Promise<ArrayBuffer> {
    const response = await this.fetcher.fetch(
      location,
      { immutable: this.immutable, ...(signal ? { signal } : {}), ...(resource ? { integrity: resource } : {}) },
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
      manifest = reader.readJson(manifestUrl, undefined, release.manifestResource).then(async (raw) => {
        const document = parseDatasetManifestDocument(raw);
        if (document.release.releaseId !== release.id) {
          throw new Error(`Manifest release ${document.release.releaseId} does not match catalog release ${release.id}`);
        }
        const features = await Promise.all(document.featureRefs.map(async (featureRef) => {
          const featureUrl = reader.resolve(manifestUrl, featureRef.path);
          this.featureUrls.set(this.featureKey(entry.id, release.id, featureRef.id), featureUrl);
          const descriptor = parseFeatureDescriptor(
            await reader.readJson(featureUrl, undefined, featureRef.resource),
            featureRef.path,
          );
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
      const [resourceIndexRaw, summaryRaw] = await Promise.all([
        reader.readJson(
          reader.resolve(featureUrl, descriptor.resourceIndexPath),
          signal,
          descriptor.resourceIndexResource,
        ),
        reader.readJson(
          reader.resolve(featureUrl, descriptor.summaryPath),
          signal,
          descriptor.summaryResource,
        ),
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
        baseUrl: featureUrl,
        loadResource: (path, resourceSignal, resource) => reader.readBytes(
          reader.resolve(featureUrl, path),
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

  async loadArtifact(
    ref: DatasetRef,
    artifactId: string,
    featureId?: string,
    signal?: AbortSignal,
  ): Promise<ArtifactPayload> {
    const { entry, release } = await this.resolveRelease(ref);
    const manifest = await this.loadManifest(ref);
    const artifact = this.findArtifact(manifest, artifactId, featureId);
    const baseUrl = featureId === undefined
      ? this.requireManifestUrl(entry.id, release.id)
      : this.requireFeatureUrl(entry.id, release.id, featureId);
    const reader = this.reader(release.immutable);
    return {
      artifact,
      bytes: await reader.readBytes(reader.resolve(baseUrl, artifact.resource.path), signal, artifact.resource),
    };
  }

  private reader(immutable: boolean): ResourceReader {
    return new HttpResourceReader(this.fetcher, immutable);
  }

  private async resolveRelease(ref: DatasetRef): Promise<{ entry: DatasetCatalogEntry; release: DatasetReleaseSummary }> {
    const catalog = await this.loadCatalog();
    const entry = catalog.datasets.find((dataset) => dataset.id === ref.datasetId);
    if (!entry) throw new Error(`Dataset not found: ${ref.datasetId}`);
    if (!ref.releaseId) throw new Error(`An exact release is required for published dataset ${ref.datasetId}`);
    const releaseId = ref.releaseId;
    const release = entry.releases.find((item) => item.id === releaseId);
    if (!release) throw new Error(`Release not found: ${ref.datasetId}@${releaseId}`);
    return { entry, release };
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
