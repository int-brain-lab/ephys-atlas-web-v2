import type { DatasetRef, ParcellationId, RepresentationKind } from '../domain/types.js';
import type {
  ArtifactPayload,
  DatasetCatalog,
  DatasetManifest,
  DatasetSource,
  FeaturePayload,
  RegionMetadata,
} from './contracts.js';

export class DatasetRepository {
  constructor(
    private readonly published: DatasetSource,
    private readonly local: DatasetSource,
  ) {}

  async loadCatalog(options: { allowLocalOnly?: boolean } = {}): Promise<DatasetCatalog> {
    let published: DatasetCatalog;
    try {
      published = await this.published.loadCatalog();
    } catch (error) {
      if (!options.allowLocalOnly) throw error;
      const localOnly = await this.local.loadCatalog();
      if (!localOnly.datasets.length) throw error;
      return localOnly;
    }
    let local: DatasetCatalog;
    try {
      local = await this.local.loadCatalog();
    } catch {
      // Local browser storage may be restricted or unavailable. Published
      // exploration remains usable; direct local-release loads still fail
      // explicitly through the local source rather than falling through.
      return published;
    }
    if (published.schemaVersion !== local.schemaVersion) {
      throw new Error(`Catalog schema mismatch: ${published.schemaVersion} vs ${local.schemaVersion}`);
    }
    if (local.datasets.some((dataset) => dataset.id !== 'local' || dataset.source !== 'local')
      || local.projects.some((project) => project.id !== 'local')) {
      throw new Error('Local catalog must use only the reserved local namespace');
    }
    if (published.datasets.some((dataset) => dataset.id === 'local')
      || published.projects.some((project) => project.id === 'local')) {
      throw new Error('Published catalog collides with the reserved local namespace');
    }
    const localDatasets = local.datasets.map((dataset) => ({ ...dataset, source: 'local' as const, projectId: 'local' }));
    const projects = local.datasets.length
      ? [...published.projects, ...local.projects]
      : published.projects;
    return {
      schemaVersion: published.schemaVersion,
      defaultProject: published.defaultProject,
      projects,
      datasets: [...published.datasets, ...localDatasets],
    };
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

  loadArtifact(
    ref: DatasetRef,
    artifactId: string,
    featureId?: string,
    signal?: AbortSignal,
  ): Promise<ArtifactPayload> {
    return this.sourceFor(ref).loadArtifact(ref, artifactId, featureId, signal);
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
