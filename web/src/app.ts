import { DatasetSession } from './application/dataset-session.js';
import { maxRegionalSliceIndex } from './core/slice-calibration.js';
import { loadAtlasRegionCatalog, type AtlasRegionCatalog } from './data/atlas-regions.js';
import { HttpDatasetSource } from './data/http-source.js';
import { LocalDatasetSource } from './data/local-source.js';
import { DatasetRepository } from './data/repository.js';
import { DEFAULT_APP_STATE, DEFAULT_VIEW_STATE } from './domain/defaults.js';
import { resolveColoringState } from './domain/color-scale.js';
import { deriveRegionalSliceIndices } from './domain/navigation.js';
import { createAppStore, type AppStore } from './domain/store.js';
import type { SliceAxis, ViewState } from './domain/types.js';
import type { DisplaySliceInventory } from './rendering/display-slice-inventory.js';
import {
  type RegionInspection,
  NullProjectionViewportFactory,
  type ProjectionPresentation,
  type ProjectionViewportFactory,
} from './rendering/projection-viewport.js';
import { AppShell, type ShellModel } from './ui/app-shell.js';
import { RegionalPanelController } from './ui/regional-panel.js';
import { buildSelectedComparisonExport } from './ui/regional/comparison-export.js';
import { buildRegionTooltipModel } from './ui/regional/model.js';
import { UrlStateController } from './url/url-state.js';

export interface AppOptions {
  catalogUrl?: string;
  atlasRegionsUrl?: string;
  defaultView?: ViewState;
  viewportFactory?: ProjectionViewportFactory;
}

/**
 * Browser composition root. Data lifecycle lives in DatasetSession; this class
 * wires state, URL synchronization, rendering, and concrete UI adapters.
 */
export class AtlasApp {
  private readonly store: AppStore;
  private readonly localSource = new LocalDatasetSource();
  private readonly session: DatasetSession;
  private readonly urlController: UrlStateController;
  private readonly shell: AppShell;
  private readonly regionalPanel: RegionalPanelController;
  private readonly viewportFactory: ProjectionViewportFactory;
  private displaySliceInventories: Readonly<Record<SliceAxis, DisplaySliceInventory>> | null = null;
  private atlasRegions: AtlasRegionCatalog | null = null;
  private hoveredRegionId: string | null = null;
  private viewportPresentation: ProjectionPresentation | null = null;

  constructor(root: HTMLElement, private readonly options: AppOptions = {}) {
    const defaultView = options.defaultView ?? DEFAULT_VIEW_STATE;
    this.store = createAppStore({ ...DEFAULT_APP_STATE, view: defaultView });
    const catalogUrl = new URL(options.catalogUrl ?? '/fixtures/catalog.json', window.location.href).toString();
    const repository = new DatasetRepository(new HttpDatasetSource(catalogUrl), this.localSource);
    this.session = new DatasetSession(repository, this.store, () => this.render());
    this.urlController = new UrlStateController(this.store, window, defaultView);
    this.viewportFactory = options.viewportFactory ?? new NullProjectionViewportFactory();
    this.shell = new AppShell(root, {
      setDataset: (ref) => this.store.dispatch({ type: 'dataset/set', dataset: ref, history: 'push' }),
      setFeature: (featureId, representation) => this.store.dispatch({
        type: 'feature/set',
        featureId,
        history: 'push',
        ...(representation ? { representation } : {}),
      }),
      setParcellation: (parcellation) => this.store.dispatch({
        type: 'parcellation/set',
        parcellation,
        history: 'push',
      }),
      setStatistic: (statistic) => this.store.dispatch({ type: 'color/statistic', statistic }),
      setColorMode: (mode) => this.store.dispatch({ type: 'color/mode', mode }),
      setColormap: (colormap) => this.store.dispatch({ type: 'color/colormap', colormap }),
      setColorRange: (range) => this.store.dispatch({ type: 'color/range', range }),
      setColorScale: (scale) => this.store.dispatch({ type: 'color/scale', scale }),
      setSlice: (axis, index) => this.setSlice(axis, index),
      setActiveCompactView: (view) => this.store.dispatch({ type: 'workspace/compact-view', view }),
      setMaximizedView: (view) => this.store.dispatch({ type: 'workspace/maximized-view', view }),
      clearSelection: () => this.store.dispatch({ type: 'selection/clear' }),
      shareCurrentView: () => this.copyCurrentUrl(),
      downloadCurrentFeature: () => this.downloadCurrentFeature(),
      importLocal: (files) => this.importLocal(files),
      reportError: (error) => this.reportRuntimeError(error),
    }, this.viewportFactory);
    this.regionalPanel = new RegionalPanelController(root, {
      toggleSelection: (regionId) => this.store.dispatch({ type: 'selection/toggle', regionId }),
      setRegionOrder: (order) => this.store.dispatch({ type: 'regions/order', order }),
      clearSelection: () => this.store.dispatch({ type: 'selection/clear' }),
      hoverRegion: (regionId) => {
        this.shell.hideRegionTooltip();
        this.setHoveredRegion(regionId);
      },
      downloadComparison: () => this.downloadSelectedComparison(),
    });
    this.viewportFactory.setInteractionSink({
      hover: (hit) => this.setHoveredRegion(hit?.regionId ?? null),
      inspect: (inspection) => this.inspectRegion(inspection),
      toggleSelection: (hit) => this.store.dispatch({ type: 'selection/toggle', regionId: hit.regionId }),
      stepSlice: (axis, delta) => this.stepSlice(axis, delta),
      moveCursor: (cursor) => this.store.dispatch({ type: 'cursor/set', cursor }),
      reportError: (error) => this.reportRuntimeError(error),
    });
  }

  async start(): Promise<void> {
    this.urlController.start();
    this.store.subscribe((state, action) => {
      if (action.type === 'dataset/set' || action.type === 'view/hydrate' || action.type === 'parcellation/set') {
        this.hoveredRegionId = null;
      }
      this.render();
      if (action.type === 'dataset/set' || action.type === 'view/hydrate') {
        void this.session.loadDataset(state.view.dataset);
      }
      if (action.type === 'feature/set') void this.session.loadCurrentFeature();
      if (action.type === 'parcellation/set') {
        void this.session.loadRegions(state.view.dataset, state.view.parcellation);
        void this.session.loadCurrentFeature();
      }
    });
    this.render();
    this.loadRendererInventory();
    this.loadAtlasRegions();
    await this.session.loadCatalog();
    await this.session.loadDataset(this.store.getState().view.dataset);
  }

  stop(): void {
    this.session.stop();
    this.urlController.stop();
    this.regionalPanel.destroy();
    this.shell.destroy();
  }

  private render(): void {
    const state = this.store.getState();
    const data = this.session.snapshot();
    const anatomyRegions = this.atlasRegions?.mappings[state.view.parcellation] ?? data.regions;
    const rendererRegions = state.view.coloring.mode === 'anatomy' ? anatomyRegions : data.regions;
    const descriptor = data.manifest?.features.find(({ id }) => id === state.view.featureId);
    const presentation: ProjectionPresentation = {
      feature: data.feature,
      regions: rendererRegions,
      anatomyRegions,
      coloring: resolveColoringState(state.view.coloring, descriptor?.display?.scale),
      selectedRegionIds: state.view.selection,
      hoveredRegionId: this.hoveredRegionId,
    };
    if (this.presentationChanged(presentation)) {
      this.viewportPresentation = presentation;
      this.viewportFactory.updatePresentation(presentation);
    }

    const model: ShellModel = {
      state,
      catalog: data.catalog,
      manifest: data.manifest,
      feature: data.feature,
      displaySliceInventories: this.displaySliceInventories,
    };
    this.shell.render(model);
    this.regionalPanel.render({
      state,
      manifest: data.manifest,
      feature: data.feature,
      regions: anatomyRegions,
      anatomyAtlas: this.atlasRegions?.atlas ?? null,
      hoveredRegionId: this.hoveredRegionId,
    });
  }

  private presentationChanged(next: ProjectionPresentation): boolean {
    const previous = this.viewportPresentation;
    return !previous
      || previous.feature !== next.feature
      || previous.regions !== next.regions
      || previous.anatomyRegions !== next.anatomyRegions
      || previous.coloring.mode !== next.coloring.mode
      || previous.coloring.statistic !== next.coloring.statistic
      || previous.coloring.colormap !== next.coloring.colormap
      || previous.coloring.range !== next.coloring.range
      || previous.coloring.scale !== next.coloring.scale
      || previous.selectedRegionIds !== next.selectedRegionIds
      || previous.hoveredRegionId !== next.hoveredRegionId;
  }

  private setSlice(axis: SliceAxis, index: number): void {
    const clamped = Math.min(maxRegionalSliceIndex(axis), Math.max(0, Math.trunc(index)));
    this.store.dispatch({ type: 'slice/set', axis, index: clamped });
  }

  private stepSlice(axis: SliceAxis, delta: number): void {
    const view = this.store.getState().view;
    const inventory = view.representation === 'regional' ? this.displaySliceInventories?.[axis] : undefined;
    const native = deriveRegionalSliceIndices(view.cursor)[axis];
    const next = inventory
      ? inventory.nativeIndexAtOrdinal(inventory.step(inventory.ordinalForNativeIndex(native), delta))
      : native + delta * 4;
    this.setSlice(axis, next);
  }

  private setHoveredRegion(regionId: string | null): void {
    if (regionId === this.hoveredRegionId) return;
    this.hoveredRegionId = regionId;
    this.render();
  }

  private inspectRegion(inspection: RegionInspection | null): void {
    if (!inspection) {
      this.shell.hideRegionTooltip();
      return;
    }
    const state = this.store.getState();
    const data = this.session.snapshot();
    if (state.view.representation !== 'regional' || inspection.parcellation !== state.view.parcellation) {
      this.shell.hideRegionTooltip();
      return;
    }
    const regions = this.atlasRegions?.mappings[state.view.parcellation] ?? data.regions;
    const descriptor = data.manifest?.features.find(({ id }) => id === state.view.featureId);
    const model = buildRegionTooltipModel(inspection, regions, data.feature, descriptor, state.view.coloring);
    if (model) this.shell.showRegionTooltip(inspection, model);
    else this.shell.hideRegionTooltip(inspection.axis);
  }

  private loadRendererInventory(): void {
    void this.viewportFactory.getDisplaySliceInventories()
      .then((inventories) => {
        this.displaySliceInventories = inventories;
        this.render();
      })
      .catch((error: unknown) => this.reportRuntimeError(error));
  }

  private loadAtlasRegions(): void {
    void loadAtlasRegionCatalog(this.options.atlasRegionsUrl)
      .then((catalog) => {
        this.atlasRegions = catalog;
        this.render();
      })
      .catch((error: unknown) => this.reportRuntimeError(error));
  }

  private async importLocal(files: FileList): Promise<void> {
    try {
      const manifest = await this.localSource.importFiles(files);
      await this.session.loadCatalog();
      this.store.dispatch({
        type: 'dataset/set',
        dataset: { datasetId: 'local', releaseId: manifest.dataset.release },
        history: 'push',
      });
    } catch (error) {
      this.reportRuntimeError(error);
    }
  }

  private async copyCurrentUrl(): Promise<void> {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable in this browser');
    await navigator.clipboard.writeText(window.location.href);
  }

  private downloadCurrentFeature(): void {
    const state = this.store.getState().view;
    const { manifest, feature, regions } = this.session.snapshot();
    if (!manifest || feature?.representation !== 'regional' || !state.featureId) return;
    const values = feature.statistics[state.coloring.statistic];
    if (!values) return;
    const descriptor = manifest.features.find((item) => item.id === state.featureId);
    const regionById = new Map(regions.map((region) => [region.id, region]));
    const fields = [
      'dataset_id', 'release_id', 'feature_id', 'representation', 'parcellation', 'statistic', 'unit',
      'region_id', 'acronym', 'region_name', 'value',
    ];
    const rows = feature.regionIds.map((regionId, index) => {
      const region = regionById.get(regionId);
      const value = values[index];
      return [
        state.dataset.datasetId,
        state.dataset.releaseId ?? manifest.release.releaseId,
        state.featureId ?? '',
        state.representation,
        state.parcellation,
        state.coloring.statistic,
        descriptor?.unit ?? '',
        regionId,
        region?.acronym ?? '',
        region?.name ?? '',
        value !== undefined && Number.isFinite(value) ? String(value) : '',
      ];
    });
    const csv = [fields, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
    const release = state.dataset.releaseId ?? manifest.release.releaseId;
    const filename = `${state.dataset.datasetId}-${release}-${state.featureId}-${state.parcellation}-${state.coloring.statistic}.csv`;
    this.triggerCsvDownload(csv, filename);
  }

  private downloadSelectedComparison(): void {
    const state = this.store.getState().view;
    const { manifest, feature, regions: featureRegions } = this.session.snapshot();
    if (!manifest || feature?.representation !== 'regional' || state.selection.length === 0) return;
    const descriptor = manifest.features.find((item) => item.id === feature.featureId);
    const regions = this.atlasRegions?.mappings[state.parcellation] ?? featureRegions;
    const comparison = buildSelectedComparisonExport({
      datasetId: state.dataset.datasetId,
      releaseId: state.dataset.releaseId ?? manifest.release.releaseId,
      feature,
      ...(descriptor ? { descriptor } : {}),
      regions,
      selectedRegionIds: state.selection,
      statistic: state.coloring.statistic,
    });
    this.triggerCsvDownload(comparison.csv, comparison.filename);
  }

  private triggerCsvDownload(csv: string, filename: string): void {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private reportRuntimeError(error: unknown): void {
    this.store.dispatch({
      type: 'runtime/dataset',
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
