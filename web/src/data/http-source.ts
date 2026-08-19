import type { DatasetId, DatasetRef, ParcellationId, RepresentationKind } from '../domain/types.js';
import { ResourceFetcher } from './cache.js';
import { parseDatasetCatalog, parseDatasetManifest, parseFeaturePayload } from './validate.js';
import type {
  DatasetCatalog,
  DatasetCatalogEntry,
  DatasetManifest,
  DatasetReleaseSummary,
  DatasetSource,
  FeatureDescriptor,
  FeaturePayload,
} from './contracts.js';

export class HttpDatasetSource implements DatasetSource {
  readonly kind = 'published' as const;
  private catalogPromise: Promise<DatasetCatalog> | null = null;
  private readonly manifestCache = new Map<string, Promise<DatasetManifest>>();

  constructor(
    private readonly catalogUrl: string,
    private readonly fetcher = new ResourceFetcher(),
  ) {}

  async loadCatalog(): Promise<DatasetCatalog> {
    this.catalogPromise ??= this.fetchJson(this.catalogUrl, false).then(parseDatasetCatalog);
    return this.catalogPromise;
  }

  async loadManifest(ref: DatasetRef): Promise<DatasetManifest> {
    const { entry, release } = await this.resolveRelease(ref);
    const key = `${entry.id}@${release.id}`;
    let manifest = this.manifestCache.get(key);
    if (!manifest) {
      manifest = this.fetchJson(
        new URL(release.manifest, this.catalogUrl).toString(),
        release.immutable,
      ).then(parseDatasetManifest);
      this.manifestCache.set(key, manifest);
    }
    return manifest;
  }

  async loadFeature(
    ref: DatasetRef,
    featureId: string,
    representation: RepresentationKind,
    parcellation?: ParcellationId,
  ): Promise<FeaturePayload> {
    const { release } = await this.resolveRelease(ref);
    const manifestUrl = new URL(release.manifest, this.catalogUrl).toString();
    const manifest = await this.loadManifest(ref);
    const feature = this.findFeature(manifest, featureId);
    const resource = this.resourceFor(feature, representation, parcellation);
    return parseFeaturePayload(await this.fetchJson(new URL(resource, manifestUrl).toString(), release.immutable));
  }

  async prefetchFeature(
    ref: DatasetRef,
    featureId: string,
    representation: RepresentationKind,
    parcellation?: ParcellationId,
  ): Promise<void> {
    await this.loadFeature(ref, featureId, representation, parcellation);
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

  private resourceFor(feature: FeatureDescriptor, representation: RepresentationKind, parcellation?: ParcellationId): string {
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

  private async fetchJson(url: string, immutable: boolean): Promise<unknown> {
    const response = await this.fetcher.fetch(url, { immutable });
    return response.json() as Promise<unknown>;
  }
}
