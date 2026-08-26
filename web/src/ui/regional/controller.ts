import type { DatasetManifest, FeaturePayload, RegionMetadata } from '../../data/contracts.js';
import { selectRegionalHistogram } from '../../data/regional-data.js';
import type { AppState, HistogramAxisScaleSelection, RegionOrder, StatisticId } from '../../domain/types.js';
import { regionalColorRange } from '../../application/scalar-colormap.js';
import { required, message } from './dom.js';
import {
  renderAnalysis,
  renderDistribution,
  renderFeatureSummary,
  renderSelectedRegions,
  updateDistributionColorRange,
  updateDistributionHover,
} from './details-view.js';
import { buildRegionalValueMap } from './model.js';
import { RegionalTreeView } from './tree-view.js';

export interface RegionalPanelCallbacks {
  toggleSelection(regionId: string): void;
  setRegionOrder(order: RegionOrder): void;
  setHistogramAxisScale(scale: HistogramAxisScaleSelection): void;
  clearSelection(): void;
  hoverRegion(regionId: string | null): void;
  downloadComparison(): void;
}

export interface RegionalPanelModel {
  state: AppState;
  manifest: DatasetManifest | null;
  feature: FeaturePayload | null;
  regions: readonly RegionMetadata[];
  anatomyAtlas: string | null;
  hoveredRegionId: string | null;
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
  private lastHistogramAxisScale: HistogramAxisScaleSelection | null = null;
  private lastSelectionKey = '';
  private lastFixture = false;
  private lastAnatomyAtlas: string | null = null;

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
    const feature = model.feature?.representation === 'regional' ? model.feature : null;
    const statistic = model.state.view.coloring.statistic;
    const regionOrder = model.state.view.regionOrder;
    const fixture = model.manifest?.dataset.fixture === true;
    const selectionKey = model.state.view.selection.join(',');
    const histogramSelection = model.state.view.histogramAxisScale;
    const selectedHistogram = feature ? selectRegionalHistogram(feature, histogramSelection) : null;
    const displayFeature = feature && selectedHistogram?.histogram
      ? { ...feature, histogram: selectedHistogram.histogram }
      : feature;
    const range = feature ? regionalColorRange(feature, model.state.view.coloring) : null;
    if (
      feature === this.lastFeature
      && model.regions === this.lastRegions
      && statistic === this.lastStatistic
      && regionOrder === this.lastRegionOrder
      && histogramSelection === this.lastHistogramAxisScale
      && selectionKey === this.lastSelectionKey
      && fixture === this.lastFixture
      && model.anatomyAtlas === this.lastAnatomyAtlas
    ) {
      this.tree.updateHoveredRegion(model.hoveredRegionId);
      if (displayFeature) {
        const descriptor = model.manifest?.features.find((item) => item.id === displayFeature.featureId);
        updateDistributionColorRange(
          this.distribution,
          displayFeature,
          range,
          model.state.view.coloring.range.mode,
        );
        updateDistributionHover(
          this.distribution,
          displayFeature,
          model.regions,
          model.hoveredRegionId,
          statistic,
          descriptor?.unit ?? null,
        );
      }
      return;
    }
    this.lastFeature = feature;
    this.lastRegions = model.regions;
    this.lastStatistic = statistic;
    this.lastRegionOrder = regionOrder;
    this.lastHistogramAxisScale = histogramSelection;
    this.lastSelectionKey = selectionKey;
    this.lastFixture = fixture;
    this.lastAnatomyAtlas = model.anatomyAtlas;
    this.pane.dataset.phase = feature || model.anatomyAtlas ? 'regional-data' : 'empty';
    this.pane.dataset.fixture = String(fixture);

    if ((!feature && !model.anatomyAtlas) || model.regions.length === 0) {
      this.renderEmpty(model);
      return;
    }

    const descriptor = feature
      ? model.manifest?.features.find((item) => item.id === feature.featureId)
      : undefined;
    const values = feature ? buildRegionalValueMap(feature, statistic) : new Map<string, number>();
    const selected = new Set(model.state.view.selection);
    this.updateAnalysisDisclosure(selected.size);
    const unit = descriptor?.unit ?? null;

    this.tree.source.textContent = model.anatomyAtlas
      ? model.anatomyAtlas
      : fixture
        ? 'Synthetic schema-v1 fixture'
        : `${model.state.view.parcellation.toUpperCase()} regional values`;
    this.tree.render(model.regions, values, statistic, unit, range, selected, regionOrder);
    renderSelectedRegions(this.detailsTargets(), model.regions, selected, values, statistic, unit);
    if (feature && displayFeature && selectedHistogram) {
      renderFeatureSummary(this.summary, feature, unit, descriptor?.description ?? '');
      renderDistribution(
        this.distribution,
        displayFeature,
        selected,
        model.regions,
        statistic,
        unit,
        fixture,
        selectedHistogram.axisScale,
        selectedHistogram.logAvailable,
        histogramSelection,
      );
      updateDistributionColorRange(
        this.distribution,
        displayFeature,
        range,
        model.state.view.coloring.range.mode,
      );
      updateDistributionHover(
        this.distribution,
        displayFeature,
        model.regions,
        model.hoveredRegionId,
        statistic,
        unit,
      );
      renderAnalysis(this.analysis, displayFeature, model.regions, selected, values, statistic, unit, fixture);
    } else {
      this.summary.replaceChildren();
      this.distribution.replaceChildren(message('No regional distribution loaded'));
      this.analysis.replaceChildren(message('No feature values are available for this parcellation'));
    }
    this.tree.updateHoveredRegion(model.hoveredRegionId);
  }

  destroy(): void {
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
      model.state.view.representation === 'volume'
        ? 'Region values are unavailable in volume mode'
        : 'Regional data is loading or unavailable',
    );
    this.selectedList.replaceChildren();
    this.clearSelectionButton.disabled = true;
    this.summary.replaceChildren();
    this.distribution.replaceChildren(message('No regional distribution loaded'));
    this.analysis.replaceChildren(message('Select a regional feature to compare regions'));
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
    const button = target?.closest<HTMLButtonElement>('[data-histogram-axis-scale]');
    const scale = button?.dataset.histogramAxisScale;
    if (!button || button.disabled || (scale !== 'linear' && scale !== 'log')) return;
    this.callbacks.setHistogramAxisScale(scale);
  };

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
  };

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
