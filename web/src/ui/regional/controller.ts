import type {
  DatasetManifest,
  DistributionBinning,
  FeaturePayload,
  RegionMetadata,
  RepresentationDisplay,
} from '../../data/contracts.js';
import type { ResolvedPresentationScale } from '../../application/presentation-scale.js';
import type {
  AppState,
  ColorScaleSelection,
  DistributionDomainSelection,
  RegionOrder,
  StatisticId,
  VolumeRegionHemisphere,
} from '../../domain/types.js';
import { effectiveScalarColorRange } from '../../application/scalar-colormap.js';
import { required, message } from './dom.js';
import {
  renderFeatureSummary,
  renderSelectedRegions,
} from './details-view.js';
import { renderAnalysis } from './comparison-view.js';
import {
  renderDistribution,
  updateDistributionColorRange,
  updateDistributionHover,
  type VolumeRegionalDistributionModel,
} from './distribution-view.js';
import { buildRegionalValueMap } from './model.js';
import { RegionalTreeView } from './tree-view.js';
import { buildVolumeDistributionExport } from './volume-distribution-export.js';
import { OperationStatus } from '../operation-status.js';

export interface RegionalPanelCallbacks {
  selectRegion(regionId: string, additive: boolean): void;
  setMultiSelection(enabled: boolean): void;
  setAutoSlice(enabled: boolean): void;
  toggleSelection(regionId: string): void;
  setRegionOrder(order: RegionOrder): void;
  setColorScale(scale: ColorScaleSelection): void;
  setDistributionDomain(domain: DistributionDomainSelection): void;
  clearSelection(): void;
  hoverRegion(regionId: string | null): void;
  downloadComparison(): void;
  comparisonUsed?(): void;
  setVolumeRegionHemisphere(hemisphere: VolumeRegionHemisphere): void;
  downloadVolumeRegionDistribution(csv: string, filename: string): void;
  retryFeature(): void;
  retryAnatomy?(): void;
}

export interface RegionalPanelModel {
  state: AppState;
  manifest: DatasetManifest | null;
  feature: FeaturePayload | null;
  featureLoading: boolean;
  featureError: string | null;
  regions: readonly RegionMetadata[];
  physicalRegions: readonly RegionMetadata[];
  anatomyAtlas: string | null;
  autoSliceStatus?: string;
  anatomyLoading?: boolean;
  anatomyError?: string | null;
  hoveredRegionId: string | null;
  presentationScale: ResolvedPresentationScale;
  representationDisplay: RepresentationDisplay | undefined;
}

export class RegionalPanelController {
  private readonly pane: HTMLElement;
  private readonly tree: RegionalTreeView;
  private readonly selectedList: HTMLUListElement;
  private readonly selectedSection: HTMLElement;
  private readonly clearSelectionButton: HTMLButtonElement;
  private readonly summary: HTMLElement;
  private readonly distribution: HTMLElement;
  private readonly analysis: HTMLElement;
  private readonly analysisPanel: HTMLElement;
  private readonly analysisToggle: HTMLButtonElement;
  private readonly analysisDialog: HTMLDialogElement;
  private readonly analysisClose: HTMLButtonElement;
  private readonly analysisCount: HTMLElement;
  private readonly analysisDialogCount: HTMLElement;
  private readonly modalComparisonQuery: MediaQueryList;
  private analysisExpanded = false;
  private selectionCount = 0;
  private restoreAnalysisFocus = false;
  private lastFeature: FeaturePayload | null = null;
  private lastRegions: readonly RegionMetadata[] | null = null;
  private lastStatistic: StatisticId | null = null;
  private lastRegionOrder: RegionOrder | null = null;
  private lastPresentationScale: ResolvedPresentationScale | null = null;
  private lastSelectionKey = '';
  private lastFixture = false;
  private lastAnatomyAtlas: string | null = null;
  private lastHemisphere: VolumeRegionHemisphere | null = null;
  private lastFeatureLoading = false;
  private lastFeatureError: string | null = null;
  private lastFeatureIdentity = '';
  private readonly summaryStatus = new OperationStatus('inline');
  private readonly distributionStatus = new OperationStatus('inline');
  private readonly analysisStatus = new OperationStatus('inline');
  private readonly anatomyStatus = new OperationStatus('inline');
  private volumeRegionalKey = '';
  private volumeRegionalStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  private volumeRegionalBinning: DistributionBinning | null = null;
  private volumeRegionalError: string | null = null;
  private volumeRegionalAbort: AbortController | null = null;
  private latestModel: RegionalPanelModel | null = null;

  constructor(root: ParentNode, private readonly callbacks: RegionalPanelCallbacks) {
    this.pane = required(root, '.region-pane');
    this.selectedList = required(root, '.selected-regions__list');
    this.selectedSection = required(root, '.region-pane__selected');
    this.clearSelectionButton = required(root, '.selected-regions__clear');
    this.summary = required(root, '.secondary-view__summary');
    this.distribution = required(root, '.distribution-band__surface');
    this.distribution.addEventListener('click', this.onDistributionClick);
    this.analysis = required(root, '.analysis-panel__surface');
    this.analysisPanel = required(root, '.analysis-panel');
    this.analysisToggle = required(root, '.analysis-panel__toggle');
    this.analysisDialog = required(root, '.analysis-dialog');
    this.analysisClose = required(root, '.analysis-dialog__close');
    this.analysisCount = required(root, '.analysis-panel__count');
    this.analysisDialogCount = required(root, '.analysis-dialog__count');
    this.modalComparisonQuery = this.analysisDialog.ownerDocument.defaultView?.matchMedia('(max-width: 759px)')
      ?? window.matchMedia('(max-width: 759px)');
    this.tree = new RegionalTreeView(root, callbacks);
    this.tree.source.parentElement!.after(this.anatomyStatus.element);
    this.clearSelectionButton.addEventListener('click', this.clearSelection);
    this.analysisToggle.addEventListener('click', this.toggleAnalysis);
    this.analysisClose.addEventListener('click', this.closeAnalysis);
    this.analysisDialog.addEventListener('close', this.onAnalysisClose);
    this.analysisDialog.addEventListener('click', this.onAnalysisBackdropClick);
    this.analysisDialog.ownerDocument.addEventListener('keydown', this.onAnalysisKeyDown);
    this.analysis.addEventListener('click', this.onAnalysisClick);
    this.selectedList.addEventListener('click', this.onSelectedClick);
  }

  render(model: RegionalPanelModel): void {
    this.latestModel = model;
    this.tree.updateAutoSlice(model.state.view.autoSlice, model.autoSliceStatus ?? '');
    this.anatomyStatus.update({
      state: model.anatomyLoading ? 'loading' : model.anatomyError ? 'error' : 'ready',
      title: model.anatomyLoading ? 'Loading region names…' : 'Couldn’t load region names',
      ...(model.anatomyError ? { detail: model.anatomyError,
        ...(this.callbacks.retryAnatomy ? { retry: this.callbacks.retryAnatomy } : {}) } : {}),
    });
    const feature = model.feature;
    const regionalFeature = feature?.representation === 'regional' ? feature : null;
    const statistic = model.state.view.coloring.statistic;
    const regionOrder = model.state.view.regionOrder;
    const fixture = model.manifest?.dataset.fixture === true;
    const selectionKey = model.state.view.selection.join(',');
    const featureIdentity = JSON.stringify([model.state.view.dataset, model.state.view.featureId,
      model.state.view.representation, model.state.view.parcellation]);
    const volumeRegional = this.syncVolumeRegionalDistribution(model, selectionKey);
    const range = feature
      ? effectiveScalarColorRange(feature, model.state.view.coloring, model.representationDisplay)
      : null;
    if (
      feature === this.lastFeature
      && model.regions === this.lastRegions
      && statistic === this.lastStatistic
      && regionOrder === this.lastRegionOrder
      && model.presentationScale.effectiveScale === this.lastPresentationScale?.effectiveScale
      && model.presentationScale.effectiveDistributionDomain === this.lastPresentationScale?.effectiveDistributionDomain
      && model.presentationScale.selection === this.lastPresentationScale.selection
      && model.presentationScale.distributionSelection === this.lastPresentationScale.distributionSelection
      && selectionKey === this.lastSelectionKey
      && fixture === this.lastFixture
      && model.anatomyAtlas === this.lastAnatomyAtlas
      && model.state.view.distribution.hemisphere === this.lastHemisphere
      && model.featureLoading === this.lastFeatureLoading
      && model.featureError === this.lastFeatureError
      && featureIdentity === this.lastFeatureIdentity
    ) {
      this.tree.updateHoveredRegion(model.hoveredRegionId);
      if (feature) {
        const descriptor = model.manifest?.features.find((item) => item.id === feature.featureId);
        updateDistributionColorRange(
          this.distribution,
          feature,
          model.presentationScale.histogram,
          model.presentationScale.effectiveScaleSpec,
          range,
          model.state.view.coloring.range.mode,
        );
        if (feature.representation === 'regional') {
          updateDistributionHover(
            this.distribution,
            feature,
            model.presentationScale.histogram,
            model.presentationScale.effectiveScaleSpec,
            model.regions,
            model.hoveredRegionId,
            statistic,
            descriptor?.unit ?? null,
          );
        }
      }
      return;
    }
    this.lastFeature = feature;
    this.lastRegions = model.regions;
    this.lastStatistic = statistic;
    this.lastRegionOrder = regionOrder;
    this.lastPresentationScale = model.presentationScale;
    this.lastSelectionKey = selectionKey;
    this.lastFixture = fixture;
    this.lastAnatomyAtlas = model.anatomyAtlas;
    this.lastHemisphere = model.state.view.distribution.hemisphere;
    this.lastFeatureLoading = model.featureLoading;
    this.lastFeatureError = model.featureError;
    this.lastFeatureIdentity = featureIdentity;
    this.pane.dataset.phase = feature || model.anatomyAtlas ? 'regional-data' : 'empty';
    this.pane.dataset.fixture = String(fixture);

    if (feature?.representation !== 'volume' && model.regions.length === 0) {
      this.renderEmpty(model);
      return;
    }

    const descriptor = feature
      ? model.manifest?.features.find((item) => item.id === feature.featureId)
      : undefined;
    const values = regionalFeature ? buildRegionalValueMap(regionalFeature, statistic) : new Map<string, number>();
    const selected = new Set(model.state.view.selection);
    this.updateAnalysisDisclosure(selected.size);
    const unit = descriptor?.unit ?? null;

    this.tree.source.textContent = model.anatomyAtlas
      ? model.anatomyAtlas
      : fixture && regionalFeature
        ? 'Synthetic schema-v1 fixture'
        : regionalFeature
          ? `${model.state.view.parcellation.toUpperCase()} regional values`
          : `${model.state.view.parcellation.toUpperCase()} anatomy overlay`;
    this.tree.render(model.regions, values, statistic, unit, selected, regionOrder,
      model.featureLoading ? 'loading' : model.featureError ? 'error'
        : regionalFeature ? 'ready' : model.state.view.representation === 'volume' ? 'anatomy' : 'empty');
    renderSelectedRegions(this.detailsTargets(), model.regions, selected, values, statistic, unit);
    if (feature) {
      this.summary.removeAttribute('aria-busy');
      this.distribution.removeAttribute('aria-busy');
      this.analysis.removeAttribute('aria-busy');
      renderFeatureSummary(this.summary, feature, unit, descriptor?.description ?? '');
      renderDistribution(
        this.distribution,
        feature,
        selected,
        model.regions,
        statistic,
        unit,
        fixture,
        model.presentationScale,
        volumeRegional,
      );
      updateDistributionColorRange(
        this.distribution,
        feature,
        model.presentationScale.histogram,
        model.presentationScale.effectiveScaleSpec,
        range,
        model.state.view.coloring.range.mode,
      );
      if (feature.representation === 'regional') {
        updateDistributionHover(
          this.distribution,
          feature,
          model.presentationScale.histogram,
          model.presentationScale.effectiveScaleSpec,
          model.regions,
          model.hoveredRegionId,
          statistic,
          unit,
        );
        renderAnalysis(
          this.analysis,
          feature,
          model.regions,
          selected,
          values,
          statistic,
          unit,
          fixture,
          model.presentationScale.histogram,
        );
        this.reportComparisonUse();
      } else {
        this.analysis.replaceChildren(message(volumeRegional?.unavailableReason ?? 'Exact selected-region voxel distributions are overlaid in the distribution chart above; regional summary statistics are not derived from the volume.'));
      }
    } else {
      this.renderFeatureStatus(model);
    }
    this.tree.updateHoveredRegion(model.hoveredRegionId);
  }

  destroy(): void {
    this.volumeRegionalAbort?.abort();
    this.tree.destroy();
    this.distribution.removeEventListener('click', this.onDistributionClick);
    this.clearSelectionButton.removeEventListener('click', this.clearSelection);
    this.analysisToggle.removeEventListener('click', this.toggleAnalysis);
    this.analysisClose.removeEventListener('click', this.closeAnalysis);
    this.analysisDialog.removeEventListener('close', this.onAnalysisClose);
    this.analysisDialog.removeEventListener('click', this.onAnalysisBackdropClick);
    this.analysisDialog.ownerDocument.removeEventListener('keydown', this.onAnalysisKeyDown);
    this.analysis.removeEventListener('click', this.onAnalysisClick);
    this.selectedList.removeEventListener('click', this.onSelectedClick);
  }

  private renderEmpty(model: RegionalPanelModel): void {
    this.selectedSection.dataset.empty = 'true';
    this.updateAnalysisDisclosure(0);
    this.tree.renderEmpty(
      model.featureLoading ? 'Loading regions…'
        : model.featureError ? 'Regions unavailable'
        : 'No regions available for this parcellation',
    );
    this.tree.source.textContent = 'Region catalog';
    this.selectedList.replaceChildren();
    this.clearSelectionButton.disabled = true;
    this.renderFeatureStatus(model);
  }

  private renderFeatureStatus(model: RegionalPanelModel): void {
    const state = model.featureLoading ? 'loading' : model.featureError ? 'error' : 'empty';
    const entries = [
      [this.summary, this.summaryStatus, 'feature summary'],
      [this.distribution, this.distributionStatus, 'feature distribution'],
      [this.analysis, this.analysisStatus, 'feature comparison'],
    ] as const;
    for (const [target, status, label] of entries) {
      target.removeAttribute('aria-busy');
      status.update({
        state,
        title: state === 'loading' ? `Loading ${label}…`
          : state === 'error' ? `${label[0]!.toUpperCase()}${label.slice(1)} unavailable`
          : `No ${label} loaded`,
        ...(state === 'error' && target === this.distribution
          ? { detail: model.featureError!, retry: this.callbacks.retryFeature } : {}),
      });
      if (status.element.parentElement !== target) target.replaceChildren(status.element);
    }
  }

  private detailsTargets() {
    return {
      selectedList: this.selectedList,
      selectedSection: this.selectedSection,
      clearSelectionButton: this.clearSelectionButton,
      summary: this.summary,
      distribution: this.distribution,
      analysis: this.analysis,
    };
  }

  private readonly clearSelection = (): void => this.callbacks.clearSelection();

  private readonly onDistributionClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-download-volume-distributions]')) {
      this.downloadVolumeRegionalDistribution();
      return;
    }
    const scaleButton = target?.closest<HTMLButtonElement>('[data-value-scale]');
    const scale = scaleButton?.dataset.valueScale;
    if (scaleButton && !scaleButton.disabled && (scale === 'linear' || scale === 'log' || scale === 'symlog')) {
      this.callbacks.setColorScale(scale);
      return;
    }
    const domainButton = target?.closest<HTMLButtonElement>('button[data-distribution-domain]');
    const domain = domainButton?.dataset.distributionDomain;
    if (domainButton && !domainButton.disabled && (domain === 'full' || domain === 'focused')) {
      this.callbacks.setDistributionDomain(domain);
      return;
    }
    const hemisphereButton = target?.closest<HTMLButtonElement>('[data-volume-hemisphere]');
    const hemisphere = hemisphereButton?.dataset.volumeHemisphere;
    if (hemisphereButton && (hemisphere === 'both' || hemisphere === 'left' || hemisphere === 'right')) {
      this.callbacks.setVolumeRegionHemisphere(hemisphere);
    }
  };

  private downloadVolumeRegionalDistribution(): void {
    const model = this.latestModel;
    const feature = model?.feature?.representation === 'volume' ? model.feature : null;
    if (!model || !feature || !this.volumeRegionalBinning || model.state.view.selection.length === 0) return;
    const exported = buildVolumeDistributionExport({
      datasetId: model.state.view.dataset.datasetId,
      releaseId: model.state.view.dataset.releaseId ?? model.manifest?.release.releaseId ?? '',
      featureId: feature.featureId,
      parcellation: model.state.view.parcellation,
      hemisphere: model.state.view.distribution.hemisphere,
      selectedRegionIds: model.state.view.selection,
      regions: model.regions,
      physicalRegions: model.physicalRegions,
      binning: this.volumeRegionalBinning,
    });
    this.callbacks.downloadVolumeRegionDistribution(exported.csv, exported.filename);
  }

  private syncVolumeRegionalDistribution(
    model: RegionalPanelModel,
    selectionKey: string,
  ): VolumeRegionalDistributionModel | undefined {
    const feature = model.feature?.representation === 'volume' ? model.feature : null;
    const binning = model.presentationScale.histogram;
    const companion = feature?.summary.regionalDistributions?.find(
      ({ parcellationId }) => parcellationId === model.state.view.parcellation,
    );
    const load = feature?.loadRegionalDistribution;
    const available = load
      && binning
      && companion?.binnings.some(({ binningId }) => binningId === binning.id)
      && model.physicalRegions.length > 0;
    if (!feature || !binning) {
      this.resetVolumeRegionalDistribution();
      return undefined;
    }
    if (!available || !load) {
      this.resetVolumeRegionalDistribution();
      return {
        binning: null,
        physicalRegions: model.physicalRegions,
        hemisphere: model.state.view.distribution.hemisphere,
        status: 'idle',
        error: null,
        processedAgea: false,
        unavailableReason: !companion || !load
          ? 'This release has no regional histograms for this parcellation.'
          : model.physicalRegions.length === 0
            ? 'Region metadata is unavailable for regional histograms.'
            : 'This release has no regional histogram for the current scale and distribution domain.',
      };
    }
    const key = `${model.state.view.dataset.datasetId}/${model.state.view.dataset.releaseId ?? ''}/${feature.featureId}/${model.state.view.parcellation}/${binning.id}`;
    if (key !== this.volumeRegionalKey) {
      this.volumeRegionalAbort?.abort();
      this.volumeRegionalKey = key;
      this.volumeRegionalStatus = 'idle';
      this.volumeRegionalBinning = null;
      this.volumeRegionalError = null;
    }
    if (selectionKey && this.volumeRegionalStatus === 'idle') {
      const controller = new AbortController();
      this.volumeRegionalAbort = controller;
      this.volumeRegionalStatus = 'loading';
      void load(model.state.view.parcellation, binning.id, controller.signal)
        .then((loaded) => {
          if (controller.signal.aborted || this.volumeRegionalKey !== key) return;
          this.volumeRegionalBinning = loaded;
          this.volumeRegionalStatus = 'ready';
          this.volumeRegionalAbort = null;
          this.lastFeature = null;
          if (this.latestModel) this.render(this.latestModel);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || this.volumeRegionalKey !== key) return;
          this.volumeRegionalStatus = 'error';
          this.volumeRegionalError = error instanceof Error ? error.message : String(error);
          this.volumeRegionalAbort = null;
          this.lastFeature = null;
          if (this.latestModel) this.render(this.latestModel);
        });
    }
    return {
      binning: this.volumeRegionalBinning,
      physicalRegions: model.physicalRegions,
      hemisphere: model.state.view.distribution.hemisphere,
      status: this.volumeRegionalStatus,
      error: this.volumeRegionalError,
      ...(this.volumeRegionalStatus === 'error' ? { retry: () => {
        if (this.volumeRegionalKey !== key || this.volumeRegionalStatus !== 'error') return;
        this.volumeRegionalStatus = 'idle';
        this.volumeRegionalError = null;
        this.lastFeature = null;
        if (this.latestModel) this.render(this.latestModel);
      } } : {}),
      processedAgea: model.manifest?.dataset.id === 'agea'
        && model.manifest.provenance.recipe.id.includes('processed'),
    };
  }

  private resetVolumeRegionalDistribution(): void {
    if (!this.volumeRegionalKey && this.volumeRegionalStatus === 'idle') return;
    this.volumeRegionalAbort?.abort();
    this.volumeRegionalAbort = null;
    this.volumeRegionalKey = '';
    this.volumeRegionalStatus = 'idle';
    this.volumeRegionalBinning = null;
    this.volumeRegionalError = null;
  }

  private readonly onSelectedClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLButtonElement>('[data-remove-region]');
    if (button?.dataset.removeRegion) this.callbacks.toggleSelection(button.dataset.removeRegion);
  };

  private readonly toggleAnalysis = (): void => {
    if (this.selectionCount === 0) return;
    if (this.analysisDialog.open) {
      this.closeAnalysisAndRestoreFocus();
      return;
    }
    this.analysisExpanded = true;
    const isModal = this.modalComparisonQuery.matches;
    this.analysisDialog.dataset.presentation = isModal ? 'modal-sheet' : 'tray';
    this.analysisDialog.setAttribute('aria-modal', String(isModal));
    if (isModal) this.analysisDialog.showModal();
    else this.analysisDialog.show();
    this.syncAnalysisDisclosure();
    this.analysisClose.focus();
    this.reportComparisonUse();
  };

  private reportComparisonUse(): void {
    const model = this.latestModel;
    if (!this.analysisDialog.open || !model || model.featureLoading || model.featureError
      || model.feature?.representation !== 'regional') return;
    if (this.analysis.querySelectorAll('.regional-comparison__table tbody tr[data-region-id]').length >= 2) {
      this.callbacks.comparisonUsed?.();
    }
  }

  private readonly closeAnalysis = (): void => {
    this.closeAnalysisAndRestoreFocus();
  };

  private readonly onAnalysisClose = (): void => {
    this.analysisExpanded = false;
    this.syncAnalysisDisclosure();
    if (this.restoreAnalysisFocus && !this.analysisToggle.disabled) this.analysisToggle.focus();
    this.restoreAnalysisFocus = false;
  };

  private readonly onAnalysisBackdropClick = (event: MouseEvent): void => {
    if (event.target === this.analysisDialog) this.closeAnalysisAndRestoreFocus();
  };

  private readonly onAnalysisKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.analysisDialog.open) return;
    event.preventDefault();
    event.stopPropagation();
    this.closeAnalysisAndRestoreFocus();
  };

  private readonly onAnalysisClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-download-comparison]')) this.callbacks.downloadComparison();
  };

  private closeAnalysisAndRestoreFocus(): void {
    if (!this.analysisDialog.open) return;
    this.restoreAnalysisFocus = true;
    this.analysisDialog.close();
  }

  private updateAnalysisDisclosure(selectionCount: number): void {
    if (selectionCount === 0) {
      this.analysisExpanded = false;
      this.restoreAnalysisFocus = false;
      if (this.analysisDialog.open) this.analysisDialog.close();
    }
    this.selectionCount = selectionCount;
    this.syncAnalysisDisclosure();
  }

  private syncAnalysisDisclosure(): void {
    const hasSelection = this.selectionCount > 0;
    const selectionLabel = `${this.selectionCount} selected ${this.selectionCount === 1 ? 'region' : 'regions'}`;
    this.analysisPanel.dataset.empty = String(!hasSelection);
    this.analysisPanel.dataset.expanded = String(hasSelection && this.analysisExpanded);
    this.analysisToggle.disabled = !hasSelection;
    this.analysisToggle.setAttribute('aria-expanded', String(hasSelection && this.analysisExpanded));
    this.analysisToggle.setAttribute(
      'aria-label',
      hasSelection
        ? `${this.analysisExpanded ? 'Minimize' : 'Open'} comparison for ${selectionLabel}`
        : 'Open selected-region comparison',
    );
    this.analysisCount.hidden = !hasSelection;
    this.analysisCount.textContent = String(this.selectionCount);
    this.analysisDialogCount.hidden = !hasSelection;
    this.analysisDialogCount.textContent = selectionLabel;
    const chevron = this.analysisToggle.querySelector<HTMLElement>('.analysis-panel__chevron');
    if (chevron) {
      chevron.hidden = !hasSelection;
      chevron.textContent = this.analysisExpanded ? '⌄' : '⌃';
    }
  }
}
