import type { DatasetManifest, FeaturePayload, RegionMetadata } from '../../data/contracts.js';
import type { AppState, StatisticId } from '../../domain/types.js';
import { regionalColorRange } from '../../rendering/scalar-colormap.js';
import { required, message } from './dom.js';
import {
  renderAnalysis,
  renderDistribution,
  renderFeatureSummary,
  renderSelectedRegions,
} from './details-view.js';
import { buildRegionalValueMap } from './model.js';
import { RegionalTreeView } from './tree-view.js';

export interface RegionalPanelCallbacks {
  toggleSelection(regionId: string): void;
  clearSelection(): void;
  hoverRegion(regionId: string | null): void;
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
  private analysisExpanded = false;
  private hasSelection = false;
  private lastFeature: FeaturePayload | null = null;
  private lastRegions: readonly RegionMetadata[] | null = null;
  private lastStatistic: StatisticId | null = null;
  private lastSelectionKey = '';
  private lastFixture = false;
  private lastAnatomyAtlas: string | null = null;

  constructor(root: ParentNode, private readonly callbacks: RegionalPanelCallbacks) {
    this.pane = required(root, '.region-pane');
    this.selectedList = required(root, '.selected-regions__list');
    this.selectedSection = required(root, '.region-pane__selected');
    this.clearSelectionButton = required(root, '.selected-regions__clear');
    this.summary = required(root, '.secondary-view__surface');
    this.distribution = required(root, '.distribution-band__surface');
    this.analysis = required(root, '.analysis-panel__surface');
    this.analysisPanel = required(root, '.analysis-panel');
    this.analysisToggle = required(root, '.analysis-panel__toggle');
    this.tree = new RegionalTreeView(root, callbacks);
    this.clearSelectionButton.addEventListener('click', this.clearSelection);
    this.analysisToggle.addEventListener('click', this.toggleAnalysis);
    this.selectedList.addEventListener('click', this.onSelectedClick);
  }

  render(model: RegionalPanelModel): void {
    const feature = model.feature?.representation === 'regional' ? model.feature : null;
    const statistic = model.state.view.coloring.statistic;
    const fixture = model.manifest?.dataset.fixture === true;
    const selectionKey = model.state.view.selection.join(',');
    if (
      feature === this.lastFeature
      && model.regions === this.lastRegions
      && statistic === this.lastStatistic
      && selectionKey === this.lastSelectionKey
      && fixture === this.lastFixture
      && model.anatomyAtlas === this.lastAnatomyAtlas
    ) {
      this.tree.updateHoveredRegion(model.hoveredRegionId);
      return;
    }
    this.lastFeature = feature;
    this.lastRegions = model.regions;
    this.lastStatistic = statistic;
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
    this.updateAnalysisDisclosure(selected.size > 0);
    const range = feature ? regionalColorRange(feature, model.state.view.coloring) : null;
    const unit = descriptor?.unit ?? null;

    this.tree.source.textContent = model.anatomyAtlas
      ? `${model.anatomyAtlas} · official colors`
      : fixture
        ? 'Synthetic schema-v0.1 fixture'
        : `${model.state.view.parcellation.toUpperCase()} regional values`;
    this.tree.render(model.regions, values, statistic, unit, range, selected);
    renderSelectedRegions(this.detailsTargets(), model.regions, selected, values, statistic, unit);
    if (feature) {
      renderFeatureSummary(this.summary, feature, unit);
      renderDistribution(this.distribution, feature, selected, model.regions, statistic, unit, fixture);
      renderAnalysis(this.analysis, feature, model.regions, selected, values, statistic, unit, fixture);
    } else {
      this.summary.replaceChildren();
      this.distribution.replaceChildren(message('No regional distribution loaded'));
      this.analysis.replaceChildren(message('No feature values are available for this parcellation'));
    }
    this.tree.updateHoveredRegion(model.hoveredRegionId);
  }

  destroy(): void {
    this.tree.destroy();
    this.clearSelectionButton.removeEventListener('click', this.clearSelection);
    this.analysisToggle.removeEventListener('click', this.toggleAnalysis);
    this.selectedList.removeEventListener('click', this.onSelectedClick);
  }

  private renderEmpty(model: RegionalPanelModel): void {
    this.selectedSection.dataset.empty = 'true';
    this.updateAnalysisDisclosure(false);
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

  private readonly onSelectedClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLButtonElement>('[data-remove-region]');
    if (button?.dataset.removeRegion) this.callbacks.toggleSelection(button.dataset.removeRegion);
  };

  private readonly toggleAnalysis = (): void => {
    if (!this.hasSelection) return;
    this.analysisExpanded = !this.analysisExpanded;
    this.syncAnalysisDisclosure();
  };

  private updateAnalysisDisclosure(hasSelection: boolean): void {
    if (hasSelection && !this.hasSelection) this.analysisExpanded = true;
    if (!hasSelection) this.analysisExpanded = false;
    this.hasSelection = hasSelection;
    this.syncAnalysisDisclosure();
  }

  private syncAnalysisDisclosure(): void {
    this.analysisPanel.dataset.empty = String(!this.hasSelection);
    this.analysisPanel.dataset.expanded = String(this.hasSelection && this.analysisExpanded);
    this.analysisToggle.disabled = !this.hasSelection;
    this.analysisToggle.setAttribute('aria-expanded', String(this.hasSelection && this.analysisExpanded));
    this.analysisToggle.setAttribute('aria-label', `${this.analysisExpanded ? 'Collapse' : 'Expand'} selected-region comparison`);
    const chevron = this.analysisToggle.querySelector<HTMLElement>('.analysis-panel__chevron');
    if (chevron) {
      chevron.hidden = !this.hasSelection;
      chevron.textContent = this.analysisExpanded ? '⌄' : '⌃';
    }
  }
}
