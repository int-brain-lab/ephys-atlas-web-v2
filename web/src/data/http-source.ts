import type { DatasetId, DatasetRef, ParcellationId, RepresentationKind, StatisticId } from '../domain/types.js';
import { ResourceFetcher } from './cache.js';
import {
  materializeRegionalHistogram,
  parseRegionMetadata,
  parseRegionalStatisticsResource,
} from './regional-data.js';
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
  RegionalFeaturePayload,
} from './contracts.js';

const DISPLAY_STATISTICS = new Set<StatisticId>(['mean', 'median', 'min', 'max', 'count']);

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
    this.catalogPromise ??= this.fetchJson(this.catalogUrl, false).then(parseDatasetCatalog);
    return this.catalogPromise;
  }

  async loadManifest(ref: DatasetRef): Promise<DatasetManifest> {
    const { entry, release } = await this.resolveRelease(ref);
    const key = this.releaseKey(entry.id, release.id);
    let manifest = this.manifestCache.get(key);
    if (!manifest) {
      const manifestUrl = new URL(release.manifest, this.catalogUrl).toString();
      this.manifestUrls.set(key, manifestUrl);
      manifest = this.fetchJson(manifestUrl, release.immutable).then(async (raw) => {
        const document = parseDatasetManifestDocument(raw);
        if (document.release.releaseId !== release.id) {
          throw new Error(`Manifest release ${document.release.releaseId} does not match catalog release ${release.id}`);
        }
        const features = await Promise.all(document.featureRefs.map(async (featureRef) => {
          const featureUrl = new URL(featureRef.path, manifestUrl).toString();
          this.featureUrls.set(this.featureKey(entry.id, release.id, featureRef.id), featureUrl);
          const descriptor = parseFeatureDescriptor(await this.fetchJson(featureUrl, release.immutable), featureRef.path);
          if (descriptor.id !== featureRef.id) throw new Error(`Feature id mismatch for ${featureRef.path}`);
          return descriptor;
        }));
        return resolveDatasetManifest(document, features, entry.id);
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
    if (!parcel.metadata) throw new Error(`${parcellation} parcellation has no region metadata resource`);
    const manifestUrl = this.manifestUrls.get(this.releaseKey(entry.id, release.id));
    if (!manifestUrl) throw new Error(`Resolved manifest URL missing for ${entry.id}@${release.id}`);
    const key = `${this.releaseKey(entry.id, release.id)}:${parcellation}`;
    let pending = this.regionCache.get(key);
    if (!pending) {
      pending = Promise.all([
        this.fetchJson(new URL(parcel.metadata, manifestUrl).toString(), release.immutable),
        this.fetchArray(new URL(parcel.regionIndex.path, manifestUrl).toString(), parcel.regionIndex, release.immutable),
      ]).then(([raw, regionIds]) => {
        const regions = parseRegionMetadata(raw);
        if (regions.length !== regionIds.length) throw new Error(`${parcellation} metadata does not match region index length`);
        for (const region of regions) {
          if (region.index < 0 || region.index >= regionIds.length || regionIds[region.index] !== region.atlasId) {
            throw new Error(`${parcellation} metadata/index mismatch at region ${region.id}`);
          }
        }
        return regions;
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
  ): Promise<FeaturePayload> {
    const { entry, release } = await this.resolveRelease(ref);
    const manifest = await this.loadManifest(ref);
    const feature = this.findFeature(manifest, featureId);
    const featureUrl = this.featureUrls.get(this.featureKey(entry.id, release.id, featureId));
    const manifestUrl = this.manifestUrls.get(this.releaseKey(entry.id, release.id));
    if (!featureUrl || !manifestUrl) throw new Error(`Resolved resource URLs missing for ${featureId}`);

    if (representation === 'volume') {
      const descriptor = feature.representations.volume;
      if (!descriptor) throw new Error(`Feature ${feature.id} has no volume representation`);
      return {
        schemaVersion: SCHEMA_VERSION,
        featureId,
        representation: 'volume',
        descriptor,
        baseUrl: featureUrl,
        loadResource: async (path, signal) => {
          const response = await this.fetcher.fetch(
            new URL(path, featureUrl).toString(),
            { immutable: release.immutable, ...(signal ? { signal } : {}) },
          );
          return response.arrayBuffer();
        },
      };
    }

    if (!parcellation) throw new Error(`Parcellation required for regional feature ${feature.id}`);
    const regional = feature.representations.regional?.parcellations[parcellation];
    if (!regional) throw new Error(`Feature ${feature.id} has no ${parcellation} regional representation`);
    const parcel = manifest.parcellationDescriptors[parcellation];
    if (!parcel) throw new Error(`Dataset has no ${parcellation} region index`);

    const [regionIds, values, statisticsRaw] = await Promise.all([
      this.fetchArray(new URL(parcel.regionIndex.path, manifestUrl).toString(), parcel.regionIndex, release.immutable),
      this.fetchArray(new URL(regional.values.path, featureUrl).toString(), regional.values, release.immutable),
      this.fetchJson(new URL(regional.statistics, featureUrl).toString(), release.immutable),
    ]);
    if (regionIds.length !== values.length) throw new Error(`${feature.id}/${parcellation} values do not match region index length`);

    const statistics: RegionalFeaturePayload['statistics'] = {};
    if (DISPLAY_STATISTICS.has(regional.summary as StatisticId)) statistics[regional.summary as StatisticId] = values;
    const statsDocument = parseRegionalStatisticsResource(statisticsRaw);
    const statsUrl = new URL(regional.statistics, featureUrl).toString();
    const [matrix, histogramFlat] = await Promise.all([
      this.fetchArray(new URL(statsDocument.values.path, statsUrl).toString(), statsDocument.values, release.immutable),
      statsDocument.histogram?.regionalCounts
        ? this.fetchArray(
            new URL(statsDocument.histogram.regionalCounts.path, statsUrl).toString(),
            statsDocument.histogram.regionalCounts,
            release.immutable,
          )
        : Promise.resolve(null),
    ]);
    const fieldCount = statsDocument.fields.length;
    if (statsDocument.values.shape.length !== 2 || statsDocument.values.shape[0] !== regionIds.length || statsDocument.values.shape[1] !== fieldCount) {
      throw new Error(`${feature.id}/${parcellation} regional statistics shape is inconsistent`);
    }
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

  private async fetchJson(url: string, immutable: boolean): Promise<unknown> {
    const response = await this.fetcher.fetch(url, { immutable });
    return response.json() as Promise<unknown>;
  }

  private async fetchArray(url: string, descriptor: BinaryArrayDescriptor, immutable: boolean): Promise<number[]> {
    const response = await this.fetcher.fetch(url, { immutable });
    return decodeBinaryArray(await response.arrayBuffer(), descriptor);
  }

  private releaseKey(datasetId: DatasetId, releaseId: string): string {
    return `${datasetId}@${releaseId}`;
  }

  private featureKey(datasetId: DatasetId, releaseId: string, featureId: string): string {
    return `${this.releaseKey(datasetId, releaseId)}:${featureId}`;
  }
}
