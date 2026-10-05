import { DatasetSession } from './application/dataset-session.js';
import { trackOnce } from './analytics.js';
import { resolvePresentationScale } from './application/presentation-scale.js';
import { resolvePresentationColormap } from './application/presentation-colormap.js';
import { effectiveScalarColorRange } from './application/scalar-colormap.js';
import {
  resolveDatasetNavigation,
  resolveDatasetNavigationRequest,
  selectNavigationEdition,
  switchNavigationDataset,
} from './application/dataset-navigation.js';
import {
  regionalPresentationsEqual,
  resolveRegionalPresentation,
  retainRegionalPresentationWhileMappingLoads,
} from './application/regional-presentation.js';
import { maxRegionalSliceIndex } from './core/slice-calibration.js';
import { loadAtlasRegionCatalog, type AtlasRegionCatalog } from './data/atlas-regions.js';
import type { ResourceIntegrity } from './data/cache.js';
import type { DatasetCatalog } from './data/contracts.js';
import { HttpDatasetSource } from './data/http-source.js';
import { LocalDatasetSource } from './data/local-source.js';
import type { PreparedLocalArchive, LocalArchivePreview } from './data/local-archive.js';
import { DatasetRepository } from './data/repository.js';
import { DEFAULT_APP_STATE, DEFAULT_VIEW_STATE } from './domain/defaults.js';
import { isDatasetNavigationAction } from './domain/actions.js';
import {
  deriveRegionalSliceIndices,
} from './domain/navigation.js';
import { createAppStore, type AppStore } from './domain/store.js';
import type { DatasetRef, ExactDatasetRef, SliceAxis, ViewState } from './domain/types.js';
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
import type { DataChooserSelection, NavigationRecoveryAction } from './ui/data-chooser.js';
import { RegionalPanelController } from './ui/regional-panel.js';
import { buildSelectedComparisonExport } from './ui/regional/comparison-export.js';
import { buildRegionTooltipModel, regionTooltipIdentity } from './ui/regional/model.js';
import { parseNavigationRequest, UrlStateController } from './url/url-state.js';

export interface AppOptions {
  catalogUrl?: string;
  atlasRegionsUrl?: string;
  atlasRegionsIntegrity?: ResourceIntegrity;
  defaultView?: ViewState;
  viewportFactory?: ProjectionViewportFactory;
  scene3dFactory?: BrainScene3DViewportFactory;
}

function requireExactDataset(ref: DatasetRef): ExactDatasetRef {
  if (!ref.releaseId) throw new Error(`An exact release is required for dataset ${ref.datasetId}`);
  return { datasetId: ref.datasetId, releaseId: ref.releaseId };
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
  private anatomyLoading = true;
  private anatomyError: string | null = null;
  private hoveredRegionId: string | null = null;
  private multiSelection = false;
  private viewportPresentation: ProjectionPresentation | null = null;
  private presentationReconciliationPending = false;
  private pendingLocalArchive: PreparedLocalArchive | null = null;
  private localImportAbort: AbortController | null = null;
  private stopApplicationStore: (() => void) | null = null;
  private startup: Promise<void> | null = null;
  private stopped = false;
  private catalogRequestGeneration = 0;

  constructor(root: HTMLElement, private readonly options: AppOptions = {}) {
    const defaultView = options.defaultView ?? DEFAULT_VIEW_STATE;
    this.store = createAppStore({ ...DEFAULT_APP_STATE, view: defaultView });
    const catalogUrl = new URL(options.catalogUrl ?? '/catalog.json', window.location.href).toString();
    this.repository = new DatasetRepository(new HttpDatasetSource(catalogUrl), this.localSource);
    this.session = new DatasetSession(this.repository, this.store, () => this.render());
    this.urlController = new UrlStateController(this.store, window, defaultView);
    this.viewportFactory = options.viewportFactory ?? new NullProjectionViewportFactory();
    this.shell = new AppShell(root, {
      setDataset: (ref) => this.trackExploration(() => this.selectDataset(ref)),
      selectData: (selection) => this.trackExploration(() => this.selectData(selection)),
      recoverNavigation: (action) => this.recoverNavigation(action),
      selectEdition: (projectId, editionId) => this.trackExploration(() => this.selectEdition(projectId, editionId)),
      setFeature: (featureId, representation) => this.trackExploration(() => this.store.dispatch({
        type: 'feature/set',
        featureId,
        history: 'push',
        ...(representation ? { representation } : {}),
      })),
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
      setColorMapping: (mode) => this.store.dispatch({ type: 'color/mapping', mode }),
      setPseudoLogStrength: (strength) => this.store.dispatch({ type: 'color/pseudolog-strength', strength }),
      setDistributionDomain: (domain) => this.store.dispatch({ type: 'distribution/domain', domain }),
      setVolumeOpacity: (opacity) => this.store.dispatch({ type: 'layers/volume-opacity', opacity }),
      setAnatomyOutlines: (visible) => this.store.dispatch({ type: 'layers/anatomy-outlines', visible }),
      setAnatomyColors: (visible) => this.store.dispatch({ type: 'layers/anatomy-colors', visible }),
      setSlice: (axis, index) => this.setSlice(axis, index),
      setActiveCompactView: (view) => this.store.dispatch({ type: 'workspace/compact-view', view }),
      setSecondaryTab: (tab) => this.store.dispatch({ type: 'workspace/secondary-tab', tab }),
      setMaximizedView: (view) => this.store.dispatch({ type: 'workspace/maximized-view', view }),
      setScene3DExplode: (explode) => this.store.dispatch({ type: 'scene3d/explode', explode }),
      clearSelection: () => this.store.dispatch({ type: 'selection/clear' }),
      shareCurrentView: () => this.copyCurrentUrl(),
      downloadCurrentFeature: () => this.downloadCurrentFeature(),
      retryFeature: () => this.retryFeature(),
      refreshSliceInventory: () => { if (!this.displaySliceInventories) this.loadRendererInventory(); },
      downloadArtifact: (artifactId, featureId) => this.downloadArtifact(artifactId, featureId),
      prepareLocal: (file) => this.prepareLocal(file),
      admitLocal: () => this.admitLocal(),
      cancelLocal: () => this.cancelLocal(),
      deleteLocal: (selector) => this.deleteLocal(selector),
      inspectLocalStorage: () => this.localSource.inspectStorage(),
      verifyLocal: (selector) => this.localSource.verifyRelease(selector),
      reportError: (error) => this.reportRuntimeError(error),
    }, this.viewportFactory, options.scene3dFactory);
    this.regionalPanel = new RegionalPanelController(root, {
      selectRegion: (regionId, additive) => this.selectRegion(regionId, additive),
      setMultiSelection: (enabled) => { this.multiSelection = enabled; },
      toggleSelection: (regionId) => this.store.dispatch({ type: 'selection/toggle', regionId }),
      setRegionOrder: (order) => this.store.dispatch({ type: 'regions/order', order }),
      setColorScale: (scale) => this.store.dispatch({ type: 'color/scale', scale }),
      setDistributionDomain: (domain) => this.store.dispatch({ type: 'distribution/domain', domain }),
      setVolumeRegionHemisphere: (hemisphere) => this.store.dispatch({ type: 'distribution/hemisphere', hemisphere }),
      downloadVolumeRegionDistribution: (csv, filename) => this.triggerCsvDownload(csv, filename),
      clearSelection: () => this.store.dispatch({ type: 'selection/clear' }),
      hoverRegion: (regionId) => {
        this.shell.hideRegionTooltip();
        this.setHoveredRegion(regionId);
      },
      downloadComparison: () => this.downloadSelectedComparison(),
      comparisonUsed: () => trackOnce('comparison_used'),
      retryFeature: () => this.retryFeature(),
      retryAnatomy: () => this.loadAtlasRegions(),
    });
    this.viewportFactory.setInteractionSink({
      hover: (hit) => this.setHoveredRegion(
        this.projectionMappingIsCurrent() ? hit?.regionId ?? null : null,
      ),
      inspect: (inspection) => this.inspectProjection(inspection),
      selectRegion: (hit, additive) => {
        if (this.projectionMappingIsCurrent()) {
          this.selectRegion(hit.regionId, additive);
        }
      },
      stepSlice: (axis, delta) => this.stepSlice(axis, delta),
      moveCursor: (cursor) => this.store.dispatch({ type: 'cursor/set', cursor }),
      reportError: (error) => this.reportRuntimeError(error),
    });
    options.scene3dFactory?.setInteractionSink({
      regionPointer: ({ type, regionId, originalEvent }) => {
        const logicalRegionId = regionId === null ? null : String(-Math.abs(regionId));
        if (type === 'select' && logicalRegionId !== null) {
          this.selectRegion(logicalRegionId, originalEvent.ctrlKey || originalEvent.metaKey);
        } else {
          this.setHoveredRegion(type === 'hover' && regionId !== null ? String(regionId) : null);
        }
      },
      cameraChanged: (camera) => this.store.dispatch({ type: 'scene3d/camera', camera }),
      // The 3-D panel observes renderer errors and offers Retry independently
      // of dataset readiness; optional anatomy failures must not fail the data.
    });
  }

  private selectRegion(regionId: string, additive: boolean): void {
    this.trackExploration(() => this.store.dispatch(additive || this.multiSelection
      ? { type: 'selection/toggle', regionId }
      : { type: 'selection/set', regionIds: [regionId] }));
  }

  /** Measure accepted user intent, never automatic reconciliation or URL hydration. */
  private trackExploration(change: () => void): void {
    const before = this.store.getState().view;
    change();
    const after = this.store.getState().view;
    if (before.dataset.datasetId !== after.dataset.datasetId
      || before.dataset.releaseId !== after.dataset.releaseId
      || before.featureId !== after.featureId
      || before.representation !== after.representation
      || after.selection.some((id) => !before.selection.includes(id))) {
      trackOnce('exploration_started');
    }
  }

  start(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.startup ??= this.startApplication();
    return this.startup;
  }

  private async startApplication(): Promise<void> {
    this.render();
    this.loadRendererInventory();
    this.loadAtlasRegions();
    let catalog;
    try {
      catalog = await this.loadCatalog({
        allowLocalOnly: parseNavigationRequest(window.location.search).context === 'local',
      });
      if (!catalog) return;
      this.urlController.start(catalog);
    } catch {
      // Catalog and navigation failures are already retained in their distinct
      // runtime domains. Never continue into immutable release loading.
      this.render();
      return;
    }
    this.activateApplication();
    await this.session.loadDataset(requireExactDataset(this.store.getState().view.dataset));
  }

  openHelpGuide(): void {
    this.shell.openHelpGuide();
  }

  private activateApplication(): void {
    if (this.stopped || this.stopApplicationStore) return;
    this.stopApplicationStore = this.store.subscribe((state, action) => {
      if (isDatasetNavigationAction(action) || action.type === 'view/hydrate' || action.type === 'parcellation/set') {
        this.hoveredRegionId = null;
      }
      this.render();
      if (isDatasetNavigationAction(action) || action.type === 'view/hydrate') {
        void this.session.loadDataset(requireExactDataset(state.view.dataset));
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
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.catalogRequestGeneration += 1;
    this.cancelLocal();
    this.stopApplicationStore?.();
    this.stopApplicationStore = null;
    this.session.stop();
    this.urlController.stop();
    this.regionalPanel.destroy();
    this.shell.destroy();
  }

  private render(): void {
    if (this.stopped) return;
    const state = this.store.getState();
    const snapshot = this.session.snapshot();
    const manifestMatches = snapshot.manifest?.dataset.id === state.view.dataset.datasetId
      && snapshot.manifest?.dataset.release === state.view.dataset.releaseId;
    const featureMatches = manifestMatches && snapshot.feature?.featureId === state.view.featureId
      && snapshot.feature?.representation === state.view.representation
      && (snapshot.feature?.representation !== 'regional'
        || snapshot.feature.parcellation === state.view.parcellation);
    const data = { ...snapshot, feature: featureMatches ? snapshot.feature : null };
    const featureError = snapshot.featureError ?? snapshot.datasetError;
    const featureLoading = featureError === null
      && (!manifestMatches || (!!state.view.featureId && !featureMatches));
    // Payload availability is distinct from first-frame renderer readiness.
    if (data.feature && !featureLoading && !featureError) trackOnce('data_loaded');
    const anatomyRegions = this.atlasRegions?.left[state.view.parcellation] ?? data.regions;
    const descriptor = data.manifest?.features.find(({ id }) => id === state.view.featureId);
    const representationDisplay = data.feature
      ? descriptor?.display?.[data.feature.representation]
      : undefined;
    const presentationScale = resolvePresentationScale(
      data.feature,
      state.view.coloring,
      representationDisplay,
      state.view.distribution.domain,
    );
    const presentationColormap = resolvePresentationColormap(state.view.coloring.colormap, representationDisplay);
    const unsupportedExplicitScale = state.view.coloring.scale !== 'auto'
      && presentationScale.effectiveScale !== state.view.coloring.scale;
    const unsupportedExplicitDomain = state.view.distribution.domain !== 'auto'
      && presentationScale.effectiveDistributionDomain !== state.view.distribution.domain;
    if (
      (unsupportedExplicitScale || unsupportedExplicitDomain)
      && data.feature !== null
      && data.feature.featureId === state.view.featureId
      && !this.presentationReconciliationPending
    ) {
      this.presentationReconciliationPending = true;
      queueMicrotask(() => {
        this.presentationReconciliationPending = false;
        this.store.dispatch({ type: 'presentation/reconcile', scale: 'linear', domain: 'full', history: 'replace' });
      });
    }
    const effectiveRange = data.feature
      ? effectiveScalarColorRange(data.feature, state.view.coloring, representationDisplay)
      : null;
    const coloring = {
      ...state.view.coloring,
      colormap: presentationColormap.effectiveColormap,
      range: effectiveRange
        ? { mode: 'fixed' as const, min: effectiveRange[0], max: effectiveRange[1] }
        : state.view.coloring.range,
      scale: presentationScale.effectiveScaleSpec,
      colorMapping: state.view.coloring.colorMapping,
      pseudoLogStrength: state.view.coloring.pseudoLogStrength,
      ...(presentationColormap.divergingCenter !== undefined
        ? { divergingCenter: presentationColormap.divergingCenter }
        : {}),
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
      anatomyColors: state.view.layers.anatomyColors,
    };
    if ((featureLoading || featureError) && this.hoveredRegionId === null
      && this.viewportPresentation?.regional.highlightedRegionId != null) {
      this.viewportPresentation = {
        ...this.viewportPresentation,
        regional: { ...this.viewportPresentation.regional, highlightedRegionId: null },
      };
      this.viewportFactory.updatePresentation(this.viewportPresentation);
    }
    if (!featureLoading && !featureError && this.presentationChanged(presentation)) {
      this.viewportPresentation = presentation;
      this.viewportFactory.updatePresentation(presentation);
    }

    const model: ShellModel = {
      state,
      catalog: data.catalog,
      manifest: data.manifest,
      feature: data.feature,
      featureLoading,
      featureError,
      displaySliceInventories: this.displaySliceInventories,
      regionalPresentation: this.viewportPresentation?.regional ?? presentation.regional,
      presentationScale,
      presentationColormap,
      representationDisplay,
      navigationRecovery: this.navigationRecovery(),
    };
    this.shell.render(model);
    this.regionalPanel.render({
      state,
      manifest: data.manifest,
      feature: data.feature,
      featureLoading,
      featureError,
      regions: anatomyRegions,
      // D078 companion rows follow the release's mutually exclusive physical
      // mapping, not the display atlas's complete (and potentially overlapping)
      // ontology rows.
      physicalRegions: data.feature?.representation === 'volume' ? data.regions : [],
      anatomyAtlas: this.atlasRegions?.atlas ?? null,
      anatomyLoading: this.anatomyLoading,
      anatomyError: this.anatomyError,
      // The tree and feature rows use logical identities, while rendering
      // retains the signed physical side of a 3-D hover.
      hoveredRegionId: this.hoveredRegionId === null ? null : String(-Math.abs(Number(this.hoveredRegionId))),
      presentationScale,
      representationDisplay,
    });
  }

  private presentationChanged(next: ProjectionPresentation): boolean {
    const previous = this.viewportPresentation;
    const sameRange = previous?.coloring.range.mode === next.coloring.range.mode
      && (previous?.coloring.range.mode === 'auto'
        || (next.coloring.range.mode === 'fixed'
          && previous.coloring.range.min === next.coloring.range.min
          && previous.coloring.range.max === next.coloring.range.max));
    return !previous
      || previous.feature !== next.feature
      || !regionalPresentationsEqual(previous.regional, next.regional)
      || previous.coloring.mode !== next.coloring.mode
      || previous.coloring.statistic !== next.coloring.statistic
      || previous.coloring.colormap !== next.coloring.colormap
      || previous.coloring.divergingCenter !== next.coloring.divergingCenter
      || !sameRange
      || JSON.stringify(previous.coloring.scale) !== JSON.stringify(next.coloring.scale)
      || previous.coloring.colorMapping !== next.coloring.colorMapping
      || previous.coloring.pseudoLogStrength !== next.coloring.pseudoLogStrength
      || previous.volumeOpacity !== next.volumeOpacity
      || previous.anatomyOutlines !== next.anatomyOutlines
      || previous.anatomyColors !== next.anatomyColors;
  }

  private setSlice(axis: SliceAxis, index: number): void {
    const clamped = Math.min(maxRegionalSliceIndex(axis), Math.max(0, Math.trunc(index)));
    this.store.dispatch({ type: 'slice/set', axis, index: clamped });
  }

  private selectDataset(ref: DatasetRef): void {
    const catalog = this.session.snapshot().catalog;
    if (!catalog || !ref.releaseId) {
      this.reportRuntimeError(new Error('Dataset selection requires the loaded catalog and an exact release'));
      return;
    }
    try {
      const currentView = this.store.getState().view;
      const targetDataset = catalog.datasets.find(({ id }) => id === ref.datasetId);
      if (!targetDataset) throw new Error(`Unknown dataset ${ref.datasetId}`);
      let resolved;
      if (ref.datasetId === 'local') {
        resolved = resolveDatasetNavigation(catalog, 'local', ref.releaseId, { kind: 'local' });
      } else if (currentView.navigation.kind === 'edition') {
        const editionId = currentView.navigation.editionId;
        const current = resolveDatasetNavigation(
          catalog,
          currentView.dataset.datasetId,
          currentView.dataset.releaseId ?? undefined,
          currentView.navigation,
        );
        const mapped = targetDataset.projectId === currentView.navigation.projectId
          ? current.project?.editions.find(({ id }) => id === editionId)
          : undefined;
        const mappedRelease = mapped?.datasetReleases.get(ref.datasetId);
        resolved = mappedRelease === ref.releaseId
          ? switchNavigationDataset(catalog, current, ref.datasetId)
          : resolveDatasetNavigationRequest(catalog, {
            context: 'custom', projectId: targetDataset.projectId,
            ...(targetDataset.projectId === currentView.navigation.projectId
              ? { baseEditionId: currentView.navigation.editionId }
              : {}),
            datasetId: ref.datasetId, releaseId: ref.releaseId,
          });
      } else {
        resolved = resolveDatasetNavigationRequest(catalog, {
          context: 'custom',
          projectId: targetDataset.projectId,
          ...(currentView.navigation.kind === 'custom'
            && targetDataset.projectId === currentView.navigation.projectId
            && currentView.navigation.baseEditionId
            ? { baseEditionId: currentView.navigation.baseEditionId }
            : {}),
          datasetId: ref.datasetId,
          releaseId: ref.releaseId,
        });
      }
      this.store.dispatch({
        type: resolved.context.kind === 'local'
          ? 'navigation/local'
          : resolved.context.kind === 'edition'
            ? 'navigation/dataset'
            : 'navigation/release',
        navigation: resolved.context,
        dataset: { datasetId: resolved.dataset.id, releaseId: resolved.releaseId },
        history: 'push',
      });
    } catch (error) {
      this.store.dispatch({
        type: 'runtime/navigation', status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private selectData(selection: DataChooserSelection): void {
    const catalog = this.session.snapshot().catalog;
    if (!catalog) {
      this.reportRuntimeError(new Error('Data selection requires the loaded catalog'));
      return;
    }
    try {
      const resolved = resolveDatasetNavigation(
        catalog,
        selection.dataset.datasetId,
        selection.dataset.releaseId,
        selection.navigation,
      );
      this.commitNavigation(
        resolved.context.kind === 'local' ? 'navigation/local'
          : resolved.context.kind === 'edition' ? 'navigation/dataset' : 'navigation/release',
        resolved,
      );
    } catch (error) {
      this.store.dispatch({
        type: 'runtime/navigation', status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private navigationRecovery(): ShellModel['navigationRecovery'] {
    const runtime = this.store.getState().runtime;
    if (runtime.navigationStatus !== 'error' || !runtime.navigationError) return null;
    const request = parseNavigationRequest(window.location.search);
    const editionMismatch = request.context === 'edition'
      && Boolean(request.projectId && request.editionId && request.datasetId && request.releaseId);
    return {
      message: runtime.navigationError,
      canReturnToEdition: editionMismatch,
      canOpenExactAsCustom: editionMismatch,
    };
  }

  private recoverNavigation(action: NavigationRecoveryAction): void {
    if (action === 'catalog') {
      void this.retryCatalog();
      return;
    }
    const request = parseNavigationRequest(window.location.search);
    try {
      const recoveryRequest = action === 'default' ? {}
        : action === 'edition' && request.projectId && request.editionId && request.datasetId
          ? {
            context: 'edition' as const,
            projectId: request.projectId,
            editionId: request.editionId,
            datasetId: request.datasetId,
          }
          : action === 'custom' && request.projectId && request.editionId && request.datasetId && request.releaseId
            ? {
              context: 'custom' as const,
              projectId: request.projectId,
              baseEditionId: request.editionId,
              datasetId: request.datasetId,
              releaseId: request.releaseId,
            }
            : null;
      if (!recoveryRequest) throw new Error(`Navigation recovery ${action} is not available for this request`);
      const wasActive = this.stopApplicationStore !== null;
      const recovered = this.urlController.recover(recoveryRequest);
      this.activateApplication();
      this.render();
      if (!wasActive) void this.session.loadDataset(requireExactDataset(recovered.dataset));
    } catch (error) {
      this.store.dispatch({
        type: 'runtime/navigation', status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      this.render();
    }
  }

  private retryFeature(): void {
    if (this.session.snapshot().featureError !== null) {
      void this.session.loadCurrentFeature();
    } else {
      void this.session.loadDataset(requireExactDataset(this.store.getState().view.dataset));
    }
  }

  private async retryCatalog(): Promise<void> {
    try {
      const catalog = await this.loadCatalog({
        allowLocalOnly: parseNavigationRequest(window.location.search).context === 'local',
      });
      if (!catalog) return;
      if (this.stopApplicationStore) {
        this.urlController.setCatalog(catalog);
        this.render();
        return;
      }
      this.urlController.start(catalog);
      this.activateApplication();
      await this.session.loadDataset(requireExactDataset(this.store.getState().view.dataset));
    } catch {
      this.render();
    }
  }

  /** Only the latest app-owned refresh may apply catalog-dependent navigation. */
  private async loadCatalog(options: { allowLocalOnly?: boolean } = {}): Promise<DatasetCatalog | null> {
    if (this.stopped) return null;
    const generation = ++this.catalogRequestGeneration;
    try {
      const catalog = await this.session.loadCatalog(options);
      return !this.stopped && generation === this.catalogRequestGeneration ? catalog : null;
    } catch (error) {
      if (this.stopped || generation !== this.catalogRequestGeneration) return null;
      throw error;
    }
  }

  private selectEdition(projectId: string, editionId: string): void {
    const catalog = this.session.snapshot().catalog;
    if (!catalog) return;
    this.commitNavigation('navigation/edition', selectNavigationEdition(catalog, projectId, editionId));
  }


  private commitNavigation(
    type: 'navigation/project' | 'navigation/edition' | 'navigation/dataset' | 'navigation/release' | 'navigation/local',
    resolved: ReturnType<typeof resolveDatasetNavigation>,
  ): void {
    this.store.dispatch({
      type,
      navigation: resolved.context,
      dataset: { datasetId: resolved.dataset.id, releaseId: resolved.releaseId },
      history: 'push',
    });
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
    const regions = this.atlasRegions?.left[state.view.parcellation] ?? data.regions;
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
    // Only samples inside the volume extent carry information worth a tooltip.
    if (inspection.status === 'outside' || inspection.status === 'out-of-grid') {
      this.shell.hideRegionTooltip(inspection.projectionId);
      return;
    }
    const regions = this.atlasRegions?.left[inspection.parcellation] ?? data.regions;
    const region = inspection.regionId ? regions.find(({ id }) => id === inspection.regionId) : undefined;
    const descriptor = data.manifest?.features.find(({ id }) => id === state.view.featureId);
    const coordinate = (value: number, axis: string) => `${axis} ${value >= 0 ? '+' : ''}${(value / 1000).toFixed(2)}`;
    const coordinates = [
      coordinate(inspection.world.ml, 'ML'),
      coordinate(inspection.world.ap, 'AP'),
      coordinate(inspection.world.dv, 'DV'),
    ];
    const voxel = `voxel ${inspection.voxelIndex?.join(',') ?? '?'}`;
    const statusLabel = inspection.status === 'valid'
      ? 'Valid voxel'
      : inspection.status === 'missing'
        ? 'Missing value'
        : 'Validity mask unsupported';
    const valueText = inspection.status === 'valid' && inspection.value !== undefined
      ? `${Number(inspection.value.toPrecision(6)).toLocaleString('en-US')}${descriptor?.unit ? ` ${descriptor.unit}` : ''}`
      : statusLabel;
    this.shell.showVolumeTooltip(inspection, {
      ...(region ? regionTooltipIdentity(regions, region) : { acronym: 'Voxel', name: 'Volume sample' }),
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
      // Each viewport reports projection-pack failures in its own status/retry UI.
      .catch(() => this.render());
  }

  private loadAtlasRegions(): void {
    this.anatomyLoading = true;
    this.anatomyError = null;
    this.render();
    void loadAtlasRegionCatalog(this.options.atlasRegionsUrl, fetch.bind(globalThis), this.options.atlasRegionsIntegrity)
      .then((catalog) => {
        this.atlasRegions = catalog;
        this.anatomyLoading = false;
        this.render();
      })
      .catch((error: unknown) => {
        this.anatomyLoading = false;
        this.anatomyError = error instanceof Error ? error.message : String(error);
        this.render();
      });
  }

  private async prepareLocal(file: File): Promise<LocalArchivePreview> {
    this.cancelLocal();
    const controller = new AbortController();
    this.localImportAbort = controller;
    try {
      const prepared = await this.localSource.prepareArchive(file, controller.signal);
      if (controller.signal.aborted) throw controller.signal.reason;
      this.pendingLocalArchive = prepared;
      return prepared.preview;
    } catch (error) {
      if (this.localImportAbort === controller) this.localImportAbort = null;
      throw error;
    }
  }

  private async admitLocal(): Promise<void> {
    const prepared = this.pendingLocalArchive;
    if (!prepared) throw new Error('No validated local dataset is ready to import');
    const manifest = await this.localSource.admitPrepared(prepared);
    trackOnce('local_imported');
    this.pendingLocalArchive = null;
    this.localImportAbort = null;
    const catalog = await this.loadCatalog();
    if (!catalog) return;
    this.urlController.setCatalog(catalog);
    this.store.dispatch({
      type: 'navigation/local',
      navigation: { kind: 'local' },
      dataset: { datasetId: 'local', releaseId: manifest.dataset.release },
      history: 'push',
    });
  }

  private cancelLocal(): void {
    this.localImportAbort?.abort(new DOMException('Local dataset import cancelled', 'AbortError'));
    this.localImportAbort = null;
    this.pendingLocalArchive = null;
  }

  private async deleteLocal(selector: string): Promise<void> {
    const current = this.store.getState().view.dataset;
    const deletingActive = current.datasetId === 'local' && current.releaseId === selector;
    const catalog = this.session.snapshot().catalog;
    const published = deletingActive
      ? catalog?.datasets.find((dataset) => (
        dataset.id !== 'local'
        && dataset.releases.some((release) => release.id === dataset.defaultRelease)
      ))
      : undefined;
    if (deletingActive && !published) {
      throw new Error('Select another available dataset before deleting this local release');
    }

    await this.localSource.deleteRelease(selector);
    if (this.stopped) return;
    if (deletingActive && published) {
      this.store.dispatch({
        type: 'navigation/release',
        navigation: { kind: 'custom', projectId: published.projectId },
        dataset: { datasetId: published.id, releaseId: published.defaultRelease },
        history: 'replace',
      });
    }
    const refreshedCatalog = await this.loadCatalog();
    if (refreshedCatalog) this.urlController.setCatalog(refreshedCatalog);
  }

  private async copyCurrentUrl(): Promise<void> {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable in this browser');
    await navigator.clipboard.writeText(window.location.href);
    trackOnce('share_copied');
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
    const regions = this.atlasRegions?.left[state.parcellation] ?? featureRegions;
    const presentationScale = resolvePresentationScale(
      feature,
      state.coloring,
      descriptor?.display?.regional,
      state.distribution.domain,
    );
    const comparison = buildSelectedComparisonExport({
      datasetId: state.dataset.datasetId,
      releaseId: state.dataset.releaseId ?? manifest.release.releaseId,
      feature,
      ...(presentationScale.histogram ? { binning: presentationScale.histogram } : {}),
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
    trackOnce('download_started');
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
