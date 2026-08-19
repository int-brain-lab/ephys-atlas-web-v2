import type { DatasetCatalog, DatasetManifest, FeaturePayload, RegionMetadata } from './data/contracts.js';
import { HttpDatasetSource } from './data/http-source.js';
import { LocalDatasetSource } from './data/local-source.js';
import { PrefetchQueue } from './data/prefetch.js';
import { DatasetRepository } from './data/repository.js';
import { DEFAULT_APP_STATE } from './domain/defaults.js';
import { createAppStore } from './domain/store.js';
import type { DatasetRef, ParcellationId, RepresentationKind } from './domain/types.js';
import { NullSliceRenderer, type SliceRenderer } from './rendering/interfaces.js';
import { AppShell, type ShellModel } from './ui/app-shell.js';
import { UrlStateController } from './url/url-state.js';

export interface AppOptions {
  catalogUrl?: string;
  renderer?: SliceRenderer;
}

export class AtlasApp {
  private readonly store = createAppStore(DEFAULT_APP_STATE);
  private readonly localSource = new LocalDatasetSource();
  private readonly repository: DatasetRepository;
  private readonly urlController: UrlStateController;
  private readonly shell: AppShell;
  private readonly prefetch = new PrefetchQueue();
  private catalog: DatasetCatalog | null = null;
  private manifest: DatasetManifest | null = null;
  private feature: FeaturePayload | null = null;
  private regions: readonly RegionMetadata[] = [];
  private loadGeneration = 0;

  constructor(root: HTMLElement, options: AppOptions = {}) {
    const catalogUrl = options.catalogUrl ?? new URL('/fixtures/catalog.json', window.location.href).toString();
    const published = new HttpDatasetSource(catalogUrl);
    this.repository = new DatasetRepository(published, this.localSource);
    this.urlController = new UrlStateController(this.store);
    const renderer = options.renderer ?? new NullSliceRenderer();
    this.shell = new AppShell(root, {
      setDataset: (ref) => this.store.dispatch({ type: 'dataset/set', dataset: ref }),
      setFeature: (featureId, representation) => this.store.dispatch({ type: 'feature/set', featureId, ...(representation ? { representation } : {}) }),
      setParcellation: (parcellation) => this.store.dispatch({ type: 'parcellation/set', parcellation }),
      setStatistic: (statistic) => this.store.dispatch({ type: 'color/statistic', statistic }),
      setColormap: (colormap) => this.store.dispatch({ type: 'color/colormap', colormap }),
      setSlice: (axis, index) => this.store.dispatch({ type: 'slice/set', axis, index }),
      toggleSelection: (regionId) => this.store.dispatch({ type: 'selection/toggle', regionId }),
      clearSelection: () => this.store.dispatch({ type: 'selection/clear' }),
      importLocal: (files) => this.importLocal(files),
    }, renderer);
    renderer.setInteractionSink?.({
      hover: () => undefined,
      toggleSelection: (hit) => this.store.dispatch({ type: 'selection/toggle', regionId: hit.regionId }),
      moveCursor: (cursor) => this.store.dispatch({ type: 'cursor/set', cursor }),
    });
  }

  async start(): Promise<void> {
    this.urlController.start();
    this.store.subscribe((state, action) => {
      this.render();
      if (action.type === 'dataset/set' || action.type === 'view/hydrate') void this.loadDataset(state.view.dataset);
      if (action.type === 'feature/set') void this.loadCurrentFeature();
      if (action.type === 'parcellation/set') {
        void this.loadRegions(state.view.dataset, state.view.parcellation, this.loadGeneration);
        void this.loadCurrentFeature();
      }
    });
    this.render();
    await this.loadCatalog();
    await this.loadDataset(this.store.getState().view.dataset);
  }

  stop(): void {
    this.prefetch.cancel();
    this.urlController.stop();
    this.shell.destroy();
  }

  private render(): void {
    const model: ShellModel = {
      state: this.store.getState(),
      catalog: this.catalog,
      manifest: this.manifest,
      feature: this.feature,
      regions: this.regions,
    };
    this.shell.render(model);
  }

  private async loadCatalog(): Promise<void> {
    this.store.dispatch({ type: 'runtime/catalog', status: 'loading' });
    try {
      this.catalog = await this.repository.loadCatalog();
      this.store.dispatch({ type: 'runtime/catalog', status: 'ready' });
      this.render();
    } catch (error) {
      this.store.dispatch({ type: 'runtime/catalog', status: 'error', error: this.message(error) });
    }
  }

  private async loadDataset(ref: DatasetRef): Promise<void> {
    const generation = ++this.loadGeneration;
    this.prefetch.cancel();
    this.feature = null;
    this.regions = [];
    this.manifest = null;
    this.store.dispatch({ type: 'runtime/dataset', status: 'loading' });
    try {
      const manifest = await this.repository.loadManifest(ref);
      if (generation !== this.loadGeneration) return;
      this.manifest = manifest;
      const state = this.store.getState();
      await this.loadRegions(state.view.dataset, state.view.parcellation, generation);
      if (generation !== this.loadGeneration) return;
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
      this.render();
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      this.store.dispatch({ type: 'runtime/dataset', status: 'error', error: this.message(error) });
    }
  }

  private async loadRegions(ref: DatasetRef, parcellation: ParcellationId, generation: number): Promise<void> {
    if (!this.manifest?.parcellations.includes(parcellation)) {
      this.regions = [];
      this.render();
      return;
    }
    try {
      const regions = await this.repository.loadRegions(ref, parcellation);
      if (generation !== this.loadGeneration) return;
      this.regions = regions;
      this.render();
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      this.regions = [];
      this.store.dispatch({ type: 'runtime/dataset', status: 'error', error: this.message(error) });
    }
  }

  private async loadCurrentFeature(): Promise<void> {
    const state = this.store.getState();
    const { featureId, representation, parcellation, dataset } = state.view;
    if (!featureId || !this.manifest) {
      this.feature = null;
      this.render();
      return;
    }
    const generation = this.loadGeneration;
    try {
      this.feature = await this.repository.loadFeature(
        dataset,
        featureId,
        representation,
        representation === 'regional' ? parcellation : undefined,
      );
      if (generation !== this.loadGeneration) return;
      this.schedulePrefetch(featureId, dataset, representation, parcellation);
      this.render();
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      this.feature = null;
      this.store.dispatch({ type: 'runtime/dataset', status: 'error', error: this.message(error) });
    }
  }

  private schedulePrefetch(
    featureId: string,
    ref: DatasetRef,
    representation: RepresentationKind,
    parcellation: ParcellationId,
  ): void {
    if (!this.manifest) return;
    const index = this.manifest.features.findIndex((item) => item.id === featureId);
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

  private async importLocal(files: FileList): Promise<void> {
    try {
      const manifest = await this.localSource.importFiles(files);
      await this.loadCatalog();
      this.store.dispatch({
        type: 'dataset/set',
        dataset: { datasetId: 'local', releaseId: manifest.dataset.release },
      });
    } catch (error) {
      this.store.dispatch({ type: 'runtime/dataset', status: 'error', error: this.message(error) });
    }
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
