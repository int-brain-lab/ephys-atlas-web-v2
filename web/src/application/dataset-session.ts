import type {
  DatasetCatalog,
  DatasetManifest,
  FeaturePayload,
  RegionMetadata,
} from '../data/contracts.js';
import { PrefetchQueue } from '../data/prefetch.js';
import type { AppStore } from '../domain/store.js';
import type { DatasetRef, ParcellationId, RepresentationKind } from '../domain/types.js';

export interface DatasetRepositoryPort {
  loadCatalog(): Promise<DatasetCatalog>;
  loadManifest(ref: DatasetRef): Promise<DatasetManifest>;
  loadRegions(ref: DatasetRef, parcellation: ParcellationId): Promise<readonly RegionMetadata[]>;
  loadFeature(
    ref: DatasetRef,
    featureId: string,
    representation: RepresentationKind,
    parcellation?: ParcellationId,
  ): Promise<FeaturePayload>;
  prefetchFeature(
    ref: DatasetRef,
    featureId: string,
    representation: RepresentationKind,
    parcellation?: ParcellationId,
  ): Promise<void>;
}

export interface DatasetSessionSnapshot {
  catalog: DatasetCatalog | null;
  manifest: DatasetManifest | null;
  feature: FeaturePayload | null;
  regions: readonly RegionMetadata[];
}

export class DatasetSession {
  private readonly prefetch = new PrefetchQueue();
  private catalog: DatasetCatalog | null = null;
  private manifest: DatasetManifest | null = null;
  private feature: FeaturePayload | null = null;
  private regions: readonly RegionMetadata[] = [];
  private datasetGeneration = 0;
  private regionsGeneration = 0;
  private featureGeneration = 0;

  constructor(
    private readonly repository: DatasetRepositoryPort,
    private readonly store: AppStore,
    private readonly changed: () => void,
  ) {}

  snapshot(): DatasetSessionSnapshot {
    return {
      catalog: this.catalog,
      manifest: this.manifest,
      feature: this.feature,
      regions: this.regions,
    };
  }

  async loadCatalog(): Promise<void> {
    this.store.dispatch({ type: 'runtime/catalog', status: 'loading' });
    try {
      this.catalog = await this.repository.loadCatalog();
      this.store.dispatch({ type: 'runtime/catalog', status: 'ready' });
      this.changed();
    } catch (error) {
      this.store.dispatch({ type: 'runtime/catalog', status: 'error', error: message(error) });
    }
  }

  async loadDataset(ref: DatasetRef): Promise<void> {
    const generation = ++this.datasetGeneration;
    this.regionsGeneration += 1;
    this.featureGeneration += 1;
    this.prefetch.cancel();
    this.feature = null;
    this.regions = [];
    this.manifest = null;
    this.changed();
    this.store.dispatch({ type: 'runtime/dataset', status: 'loading' });

    try {
      const manifest = await this.repository.loadManifest(ref);
      if (!this.isCurrentDataset(generation)) return;
      this.manifest = manifest;
      this.changed();

      const state = this.store.getState();
      const regionsReady = await this.loadRegions(state.view.dataset, state.view.parcellation, generation);
      if (!this.isCurrentDataset(generation) || !regionsReady) return;
      this.store.dispatch({ type: 'runtime/dataset', status: 'ready' });

      const selected = manifest.features.find((item) => item.id === state.view.featureId);
      if (!selected && manifest.features.length) {
        const first = manifest.features[0];
        if (!first) return;
        const representation: RepresentationKind = first.representations.regional ? 'regional' : 'volume';
        this.store.dispatch({ type: 'feature/set', featureId: first.id, representation });
      } else {
        await this.loadCurrentFeature();
      }
      this.changed();
    } catch (error) {
      if (!this.isCurrentDataset(generation)) return;
      this.store.dispatch({ type: 'runtime/dataset', status: 'error', error: message(error) });
    }
  }

  async loadRegions(
    ref: DatasetRef,
    parcellation: ParcellationId,
    datasetGeneration = this.datasetGeneration,
  ): Promise<boolean> {
    const requestGeneration = ++this.regionsGeneration;
    if (!this.manifest?.parcellations.includes(parcellation)) {
      this.regions = [];
      this.changed();
      return true;
    }

    try {
      const regions = await this.repository.loadRegions(ref, parcellation);
      if (!this.isCurrentRegions(datasetGeneration, requestGeneration)) return true;
      this.regions = regions;
      this.changed();
      return true;
    } catch (error) {
      if (!this.isCurrentRegions(datasetGeneration, requestGeneration)) return true;
      this.regions = [];
      this.store.dispatch({ type: 'runtime/dataset', status: 'error', error: message(error) });
      return false;
    }
  }

  async loadCurrentFeature(): Promise<void> {
    const requestGeneration = ++this.featureGeneration;
    const state = this.store.getState();
    const { featureId, representation, parcellation, dataset } = state.view;
    if (!featureId || !this.manifest) {
      this.feature = null;
      this.changed();
      return;
    }

    const datasetGeneration = this.datasetGeneration;
    try {
      const feature = await this.repository.loadFeature(
        dataset,
        featureId,
        representation,
        representation === 'regional' ? parcellation : undefined,
      );
      if (!this.isCurrentFeature(datasetGeneration, requestGeneration)) return;
      const current = this.store.getState().view;
      if (
        current.featureId !== featureId
        || current.representation !== representation
        || current.parcellation !== parcellation
        || current.dataset.datasetId !== dataset.datasetId
        || current.dataset.releaseId !== dataset.releaseId
      ) return;

      this.feature = feature;
      this.schedulePrefetch(featureId, dataset, representation, parcellation);
      this.changed();
    } catch (error) {
      if (!this.isCurrentFeature(datasetGeneration, requestGeneration)) return;
      this.feature = null;
      this.store.dispatch({ type: 'runtime/dataset', status: 'error', error: message(error) });
    }
  }

  stop(): void {
    this.datasetGeneration += 1;
    this.regionsGeneration += 1;
    this.featureGeneration += 1;
    this.prefetch.cancel();
  }

  private schedulePrefetch(
    featureId: string,
    ref: DatasetRef,
    representation: RepresentationKind,
    parcellation: ParcellationId,
  ): void {
    if (!this.manifest) return;
    const index = this.manifest.features.findIndex((item) => item.id === featureId);
    if (index < 0) return;
    const candidates = this.manifest.features.slice(index + 1, index + 3);
    this.prefetch.schedule(candidates.map((feature) => async () => {
      const nextRepresentation: RepresentationKind = feature.representations[representation]
        ? representation
        : feature.representations.regional ? 'regional' : 'volume';
      await this.repository.prefetchFeature(
        ref,
        feature.id,
        nextRepresentation,
        nextRepresentation === 'regional' ? parcellation : undefined,
      );
    }));
  }

  private isCurrentDataset(generation: number): boolean {
    return generation === this.datasetGeneration;
  }

  private isCurrentRegions(datasetGeneration: number, requestGeneration: number): boolean {
    return datasetGeneration === this.datasetGeneration && requestGeneration === this.regionsGeneration;
  }

  private isCurrentFeature(datasetGeneration: number, requestGeneration: number): boolean {
    return datasetGeneration === this.datasetGeneration && requestGeneration === this.featureGeneration;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
