import { DatasetSession } from './application/dataset-session.js';
import { resolvePresentationScale } from './application/presentation-scale.js';
import {
  regionalPresentationsEqual,
  resolveRegionalPresentation,
  retainRegionalPresentationWhileMappingLoads,
} from './application/regional-presentation.js';
import { maxRegionalSliceIndex } from './core/slice-calibration.js';
import { loadAtlasRegionCatalog, type AtlasRegionCatalog } from './data/atlas-regions.js';
import { HttpDatasetSource } from './data/http-source.js';
import { LocalDatasetSource } from './data/local-source.js';
import { DatasetRepository } from './data/repository.js';
import { DEFAULT_APP_STATE, DEFAULT_VIEW_STATE } from './domain/defaults.js';
import { deriveRegionalSliceIndices } from './domain/navigation.js';
import { createAppStore, type AppStore } from './domain/store.js';
import type { SliceAxis, ViewState } from './domain/types.js';
import type { DisplaySliceInventory } from './rendering/display-slice-inventory.js';
import type { BrainScene3DViewportFactory } from './rendering/3d/brain-scene-viewport.js';
import {
  type ProjectionInspection,
  type RegionInspection,
  type VolumeInspection,
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
  scene3dFactory?: BrainScene3DViewportFactory;
}

/**
 * Browser composition root. Data lifecycle lives in DatasetSession; this class
 * wires state, URL synchronization, rendering, and concrete UI adapters.
 */
export class AtlasApp {
  private readonly store: AppStore;
  private readonly localSource = new LocalDatasetSource();
  private readonly repository: DatasetRepository;
  private readonly session: DatasetSession;
  private readonly urlController: UrlStateController;
  private readonly shell: AppShell;
  private readonly regionalPanel: RegionalPanelController;
  private readonly viewportFactory: ProjectionViewportFactory;
  private displaySliceInventories: Readonly<Record<SliceAxis, DisplaySliceInventory>> | null = null;
  private atlasRegions: AtlasRegionCatalog | null = null;
  private hoveredRegionId: string | null = null;
  private viewportPresentation: ProjectionPresentation | null = null;
  private scaleReconciliationPending = false;

  constructor(root: HTMLElement, private readonly options: AppOptions = {}) {
    const defaultView = options.defaultView ?? DEFAULT_VIEW_STATE;
    this.store = createAppStore({ ...DEFAULT_APP_STATE, view: defaultView });
    const catalogUrl = new URL(options.catalogUrl ?? '/catalog.json', window.location.href).toString();
    this.repository = new DatasetRepository(new HttpDatasetSource(catalogUrl), this.localSource);
    this.session = new DatasetSession(this.repository, this.store, () => this.render());
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
      setVolumeOpacity: (opacity) => this.store.dispatch({ type: 'layers/volume-opacity', opacity }),
      setAnatomyOutlines: (visible) => this.store.dispatch({ type: 'layers/anatomy-outlines', visible }),
      setSlice: (axis, index) => this.setSlice(axis, index),
      setActiveCompactView: (view) => this.store.dispatch({ type: 'workspace/compact-view', view }),
      setSecondaryTab: (tab) => this.store.dispatch({ type: 'workspace/secondary-tab', tab }),
      setMaximizedView: (view) => this.store.dispatch({ type: 'workspace/maximized-view', view }),
      setScene3DExplode: (explode) => this.store.dispatch({ type: 'scene3d/explode', explode }),
      clearSelection: () => this.store.dispatch({ type: 'selection/clear' }),
      shareCurrentView: () => this.copyCurrentUrl(),
      downloadCurrentFeature: () => this.downloadCurrentFeature(),
      downloadArtifact: (artifactId, featureId) => this.downloadArtifact(artifactId, featureId),
      importLocal: (files) => this.importLocal(files),
      reportError: (error) => this.reportRuntimeError(error),
    }, this.viewportFactory, options.scene3dFactory);
    this.regionalPanel = new RegionalPanelController(root, {
      toggleSelection: (regionId) => this.store.dispatch({ type: 'selection/toggle', regionId }),
      setRegionOrder: (order) => this.store.dispatch({ type: 'regions/order', order }),
      setColorScale: (scale) => this.store.dispatch({ type: 'color/scale', scale }),
      clearSelection: () => this.store.dispatch({ type: 'selection/clear' }),
      hoverRegion: (regionId) => {
        this.shell.hideRegionTooltip();
        this.setHoveredRegion(regionId);
      },
      downloadComparison: () => this.downloadSelectedComparison(),
    });
    this.viewportFactory.setInteractionSink({
      hover: (hit) => this.setHoveredRegion(
        this.projectionMappingIsCurrent() ? hit?.regionId ?? null : null,
      ),
      inspect: (inspection) => this.inspectProjection(inspection),
      toggleSelection: (hit) => {
        if (this.projectionMappingIsCurrent()) {
          this.store.dispatch({ type: 'selection/toggle', regionId: hit.regionId });
        }
      },
      stepSlice: (axis, delta) => this.stepSlice(axis, delta),
      moveCursor: (cursor) => this.store.dispatch({ type: 'cursor/set', cursor }),
      reportError: (error) => this.reportRuntimeError(error),
    });
    options.scene3dFactory?.setInteractionSink({
      regionPointer: ({ type, regionId }) => {
        const logicalRegionId = regionId === null ? null : String(-Math.abs(regionId));
        if (type === 'select' && logicalRegionId !== null) {
          this.store.dispatch({ type: 'selection/toggle', regionId: logicalRegionId });
        } else {
          this.setHoveredRegion(type === 'hover' ? logicalRegionId : null);
        }
      },
      cameraChanged: (camera) => this.store.dispatch({ type: 'scene3d/camera', camera }),
      error: (error) => this.reportRuntimeError(error),
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
      if (action.type === 'feature/set') void this.session.loadCurrentFeature(true);
      if (action.type === 'parcellation/set') {
        // Regional parcellations are release payloads; volume parcellations are
        // anatomy-overlay mappings supplied by the canonical atlas catalog.
        if (state.view.representation === 'regional') {
          void this.session.loadRegions(state.view.dataset, state.view.parcellation);
          void this.session.loadCurrentFeature(false);
        }
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
    const descriptor = data.manifest?.features.find(({ id }) => id === state.view.featureId);
    const automaticRange = descriptor?.display?.range;
    const presentationScale = resolvePresentationScale(
      data.feature,
      state.view.coloring,
      descriptor?.display?.scale,
      automaticRange,
    );
    if (
      state.view.coloring.scale === 'log'
      && presentationScale.effectiveScale !== 'log'
      && data.feature !== null
      && data.feature.featureId === state.view.featureId
      && !this.scaleReconciliationPending
    ) {
      this.scaleReconciliationPending = true;
      queueMicrotask(() => {
        this.scaleReconciliationPending = false;
        if (this.store.getState().view.coloring.scale === 'log') {
          this.store.dispatch({ type: 'color/scale', scale: 'linear', history: 'replace' });
        }
      });
    }
    const coloring = {
      ...state.view.coloring,
      range: state.view.coloring.range.mode === 'auto' && automaticRange
        ? { mode: 'fixed' as const, min: automaticRange[0], max: automaticRange[1] }
        : state.view.coloring.range,
      scale: presentationScale.effectiveScale,
    };
    const nextRegionalPresentation = resolveRegionalPresentation({
      mapping: state.view.parcellation,
      feature: data.feature,
      anatomyRegions,
      coloring,
      selectedRegionIds: state.view.selection,
      hoveredRegionId: this.hoveredRegionId,
    });
    const presentation: ProjectionPresentation = {
      regional: retainRegionalPresentationWhileMappingLoads(
        this.viewportPresentation?.regional ?? null,
        nextRegionalPresentation,
        data.feature,
      ),
      feature: data.feature,
      coloring,
      volumeOpacity: state.view.layers.volumeOpacity,
      anatomyOutlines: state.view.layers.anatomyOutlines,
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
      regionalPresentation: this.viewportPresentation?.regional ?? presentation.regional,
      presentationScale,
      automaticRange,
    };
    this.shell.render(model);
    this.regionalPanel.render({
      state,
      manifest: data.manifest,
      feature: data.feature,
      regions: anatomyRegions,
      anatomyAtlas: this.atlasRegions?.atlas ?? null,
      hoveredRegionId: this.hoveredRegionId,
      presentationScale,
      automaticRange,
    });
  }

  private presentationChanged(next: ProjectionPresentation): boolean {
    const previous = this.viewportPresentation;
    return !previous
      || previous.feature !== next.feature
      || !regionalPresentationsEqual(previous.regional, next.regional)
      || previous.coloring.mode !== next.coloring.mode
      || previous.coloring.statistic !== next.coloring.statistic
      || previous.coloring.colormap !== next.coloring.colormap
      || previous.coloring.range !== next.coloring.range
      || previous.coloring.scale !== next.coloring.scale
      || previous.volumeOpacity !== next.volumeOpacity
      || previous.anatomyOutlines !== next.anatomyOutlines;
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

  private projectionMappingIsCurrent(): boolean {
    return this.viewportPresentation?.regional.mapping === this.store.getState().view.parcellation;
  }

  private inspectRegion(inspection: RegionInspection | null): void {
    if (!inspection) {
      this.shell.hideRegionTooltip();
      return;
    }
    const state = this.store.getState();
    const data = this.session.snapshot();
    const staticAnatomyInspection = inspection.sliceIndex === null;
    if ((!staticAnatomyInspection && state.view.representation !== 'regional')
      || inspection.parcellation !== state.view.parcellation) {
      this.shell.hideRegionTooltip();
      return;
    }
    const regions = this.atlasRegions?.mappings[state.view.parcellation] ?? data.regions;
    const descriptor = data.manifest?.features.find(({ id }) => id === state.view.featureId);
    const model = buildRegionTooltipModel(inspection, regions, data.feature, descriptor, state.view.coloring);
    if (model) this.shell.showRegionTooltip(inspection, model);
    else this.shell.hideRegionTooltip(inspection.projectionId);
  }

  private inspectProjection(inspection: ProjectionInspection | null): void {
    if (!inspection) {
      this.shell.hideRegionTooltip();
      return;
    }
    if ((inspection as VolumeInspection).kind === 'volume') {
      this.inspectVolume(inspection as VolumeInspection);
      return;
    }
    this.inspectRegion(inspection as RegionInspection);
  }

  private inspectVolume(inspection: VolumeInspection): void {
    const state = this.store.getState();
    const data = this.session.snapshot();
    if (state.view.representation !== 'volume' || data.feature?.representation !== 'volume') {
      this.shell.hideRegionTooltip(inspection.projectionId);
      return;
    }
    const regions = this.atlasRegions?.mappings[inspection.parcellation] ?? data.regions;
    const region = inspection.regionId ? regions.find(({ id }) => id === inspection.regionId) : undefined;
    const descriptor = data.manifest?.features.find(({ id }) => id === state.view.featureId);
    const coordinate = (value: number, axis: string) => `${axis} ${value >= 0 ? '+' : ''}${(value / 1000).toFixed(2)}`;
    const coordinates = [
      coordinate(inspection.world.ml, 'ML'),
      coordinate(inspection.world.ap, 'AP'),
      coordinate(inspection.world.dv, 'DV'),
    ];
    const voxel = inspection.voxelIndex ? `voxel ${inspection.voxelIndex.join(',')}` : 'outside grid';
    const statusLabel = inspection.status === 'valid'
      ? 'Valid voxel'
      : inspection.status === 'outside'
        ? 'Outside brain'
        : inspection.status === 'missing'
          ? 'Missing value'
          : inspection.status === 'unsupported-validity'
            ? 'Validity mask unsupported'
            : 'Outside volume grid';
    const valueText = inspection.status === 'valid' && inspection.value !== undefined
      ? `${Number(inspection.value.toPrecision(6)).toLocaleString('en-US')}${descriptor?.unit ? ` ${descriptor.unit}` : ''}`
      : statusLabel;
    this.shell.showVolumeTooltip(inspection, {
      acronym: region?.acronym ?? 'Voxel',
      name: region?.name.replace(/\s+\(left\)$/i, '') ?? 'Volume sample',
      valueText,
      meta: [
        inspection.status === 'valid' ? voxel : `${statusLabel} · ${voxel}`,
        `${coordinates.join(' · ')} mm`,
      ].join('\n'),
    });
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

  private async downloadArtifact(artifactId: string, featureId?: string): Promise<void> {
    const state = this.store.getState().view;
    const payload = await this.repository.loadArtifact(state.dataset, artifactId, featureId);
    const pathName = payload.artifact.resource.path.split('/').at(-1) ?? payload.artifact.id;
    const filename = payload.artifact.resource.codec.name === 'gzip' && !pathName.endsWith('.gz')
      ? `${pathName}.gz`
      : pathName;
    const mediaType = payload.artifact.resource.codec.name === 'gzip'
      ? 'application/gzip'
      : payload.artifact.resource.mediaType;
    this.triggerBlobDownload(new Blob([payload.bytes], { type: mediaType }), filename);
  }

  private downloadSelectedComparison(): void {
    const state = this.store.getState().view;
    const { manifest, feature, regions: featureRegions } = this.session.snapshot();
    if (!manifest || feature?.representation !== 'regional' || state.selection.length === 0) return;
    const descriptor = manifest.features.find((item) => item.id === feature.featureId);
    const regions = this.atlasRegions?.mappings[state.parcellation] ?? featureRegions;
    const presentationScale = resolvePresentationScale(
      feature,
      state.coloring,
      descriptor?.display?.scale,
      descriptor?.display?.range,
    );
    const exportFeature = presentationScale.histogram
      ? { ...feature, histogram: presentationScale.histogram }
      : feature;
    const comparison = buildSelectedComparisonExport({
      datasetId: state.dataset.datasetId,
      releaseId: state.dataset.releaseId ?? manifest.release.releaseId,
      feature: exportFeature,
      ...(descriptor ? { descriptor } : {}),
      regions,
      selectedRegionIds: state.selection,
      statistic: state.coloring.statistic,
    });
    this.triggerCsvDownload(comparison.csv, comparison.filename);
  }

  private triggerCsvDownload(csv: string, filename: string): void {
    this.triggerBlobDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
  }

  private triggerBlobDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
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
