import type { DatasetRef, ParcellationId, RepresentationKind } from '../domain/types.js';
import type { DatasetCatalog, DatasetManifest, DatasetSource, FeaturePayload, RegionMetadata } from './contracts.js';

export class DatasetRepository {
  constructor(
    private readonly published: DatasetSource,
    private readonly local: DatasetSource,
  ) {}

  async loadCatalog(): Promise<DatasetCatalog> {
    const [published, local] = await Promise.all([this.published.loadCatalog(), this.local.loadCatalog()]);
    if (published.schemaVersion !== local.schemaVersion) {
      throw new Error(`Catalog schema mismatch: ${published.schemaVersion} vs ${local.schemaVersion}`);
    }
    return { schemaVersion: published.schemaVersion, datasets: [...published.datasets, ...local.datasets] };
  }

  loadManifest(ref: DatasetRef): Promise<DatasetManifest> {
    return this.sourceFor(ref).loadManifest(ref);
  }

  loadRegions(ref: DatasetRef, parcellation: ParcellationId): Promise<readonly RegionMetadata[]> {
    return this.sourceFor(ref).loadRegions(ref, parcellation);
  }

  loadFeature(
    ref: DatasetRef,
    featureId: string,
    representation: RepresentationKind,
    parcellation?: ParcellationId,
  ): Promise<FeaturePayload> {
    return this.sourceFor(ref).loadFeature(ref, featureId, representation, parcellation);
  }

  async prefetchFeature(
    ref: DatasetRef,
    featureId: string,
    representation: RepresentationKind,
    parcellation?: ParcellationId,
    signal?: AbortSignal,
  ): Promise<void> {
    const source = this.sourceFor(ref);
    if (source.prefetchFeature) await source.prefetchFeature(ref, featureId, representation, parcellation, signal);
    else await source.loadFeature(ref, featureId, representation, parcellation, signal);
  }

  private sourceFor(ref: DatasetRef): DatasetSource {
    return ref.datasetId === 'local' ? this.local : this.published;
  }
}
