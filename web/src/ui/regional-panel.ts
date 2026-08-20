import type {
  DatasetManifest,
  FeaturePayload,
  RegionMetadata,
  RegionalFeaturePayload,
} from '../data/contracts.js';
import { buildRegionHierarchy } from '../data/region-hierarchy.js';
import type { AppState, StatisticId } from '../domain/types.js';
import { regionalColorRange } from '../rendering/scalar-colormap.js';

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

function required<T extends Element>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`Missing regional panel node: ${selector}`);
  return node;
}

function html<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function featureValues(feature: RegionalFeaturePayload, statistic: StatisticId): readonly number[] | undefined {
  return feature.statistics[statistic] ?? feature.statistics.mean ?? Object.values(feature.statistics)[0];
}

function formatValue(value: number, statistic: StatisticId, unit: string | null): string {
  const body = statistic === 'count'
    ? Math.round(value).toLocaleString('en-US')
    : new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 }).format(value);
  return unit && statistic !== 'count' ? `${body} ${unit}` : body;
}

export class RegionalPanelController {
  private readonly pane: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly searchClear: HTMLButtonElement;
  private readonly source: HTMLElement;
  private readonly resultCount: HTMLElement;
  private readonly expandAllButton: HTMLButtonElement;
  private readonly collapseAllButton: HTMLButtonElement;
  private readonly list: HTMLUListElement;
  private readonly selectedList: HTMLUListElement;
  private readonly selectedSection: HTMLElement;
  private readonly clearSelectionButton: HTMLButtonElement;
  private readonly distribution: HTMLElement;
  private readonly analysis: HTMLElement;
  private readonly analysisPanel: HTMLElement;
  private readonly analysisToggle: HTMLButtonElement;
  private currentRegions: readonly RegionMetadata[] = [];
  private lastFeature: FeaturePayload | null = null;
  private lastRegions: readonly RegionMetadata[] | null = null;
  private lastStatistic: StatisticId | null = null;
  private lastSelectionKey = '';
  private lastFixture = false;
  private lastAnatomyAtlas: string | null = null;
  private lastHoveredRegionId: string | null = null;
  private readonly collapsedRegionIds = new Set<string>();
  private readonly rowById = new Map<string, HTMLLIElement>();
  private readonly regionById = new Map<string, RegionMetadata>();
  private rovingButton: HTMLButtonElement | null = null;
  private analysisExpanded = false;
  private hadSelection = false;

  constructor(root: ParentNode, private readonly callbacks: RegionalPanelCallbacks) {
    this.pane = required(root, '.region-pane');
    this.search = required(root, '.region-search__input');
    this.searchClear = required(root, '.region-search__clear');
    this.source = required(root, '.region-search__source');
    this.resultCount = required(root, '.region-search__count');
    const treeControls = html('span', 'region-tree-controls');
    this.collapseAllButton = html('button', 'region-tree-controls__button');
    this.collapseAllButton.type = 'button';
    this.collapseAllButton.textContent = '⊟';
    this.collapseAllButton.title = 'Collapse all regions';
    this.collapseAllButton.setAttribute('aria-label', 'Collapse all regions');
    this.expandAllButton = html('button', 'region-tree-controls__button');
    this.expandAllButton.type = 'button';
    this.expandAllButton.textContent = '⊞';
    this.expandAllButton.title = 'Expand all regions';
    this.expandAllButton.setAttribute('aria-label', 'Expand all regions');
    treeControls.append(this.collapseAllButton, this.expandAllButton);
    this.resultCount.before(treeControls);
    this.list = required(root, '.region-list');
    this.list.setAttribute('role', 'tree');
    this.selectedList = required(root, '.selected-regions__list');
    this.selectedSection = required(root, '.region-pane__selected');
    this.clearSelectionButton = required(root, '.selected-regions__clear');
    this.distribution = required(root, '.distribution-band__surface');
    this.analysis = required(root, '.analysis-panel__surface');
    this.analysisPanel = required(root, '.analysis-panel');
    this.analysisToggle = required(root, '.analysis-panel__toggle');

    this.search.addEventListener('input', this.filterRegions);
    this.searchClear.addEventListener('click', this.clearSearch);
    this.clearSelectionButton.addEventListener('click', () => this.callbacks.clearSelection());
    this.analysisToggle.addEventListener('click', this.toggleAnalysis);
    this.collapseAllButton.addEventListener('click', this.collapseAllRegions);
    this.expandAllButton.addEventListener('click', this.expandAllRegions);
  }

  render(model: RegionalPanelModel): void {
    const feature = model.feature?.representation === 'regional' ? model.feature : null;
    const statistic = model.state.view.coloring.statistic;
    const selectionKey = model.state.view.selection.join(',');
    const fixture = model.manifest?.dataset.fixture === true;
    if (
      feature === this.lastFeature &&
      model.regions === this.lastRegions &&
      statistic === this.lastStatistic &&
      selectionKey === this.lastSelectionKey &&
      fixture === this.lastFixture &&
      model.anatomyAtlas === this.lastAnatomyAtlas
    ) {
      this.updateHoveredRegion(model.hoveredRegionId);
      return;
    }

    this.lastFeature = feature;
    this.lastRegions = model.regions;
    this.lastStatistic = statistic;
    this.lastSelectionKey = selectionKey;
    this.lastFixture = fixture;
    this.lastAnatomyAtlas = model.anatomyAtlas;
    this.currentRegions = model.regions;
    this.regionById.clear();
    model.regions.forEach((region) => this.regionById.set(region.id, region));
    this.pane.dataset.phase = feature || model.anatomyAtlas ? 'regional-data' : 'empty';
    this.pane.dataset.fixture = String(fixture);

    if ((!feature && !model.anatomyAtlas) || !model.regions.length) {
      this.renderEmpty(model);
      return;
    }

    const descriptor = feature
      ? model.manifest?.features.find((item) => item.id === feature.featureId)
      : undefined;
    const values = feature ? featureValues(feature, statistic) : undefined;
    const valueById = new Map<string, number>();
    if (feature && values) {
      feature.regionIds.forEach((id, index) => {
        const value = values[index];
        if (value !== undefined) valueById.set(id, value);
      });
    }
    const selected = new Set(model.state.view.selection);
    this.updateAnalysisDisclosure(selected.size > 0);
    const range = feature ? regionalColorRange(feature, model.state.view.coloring) : null;
    const unit = descriptor?.unit ?? null;

    this.source.textContent = model.anatomyAtlas
      ? `${model.anatomyAtlas} · official colors`
      : fixture
      ? 'Synthetic schema-v0.1 fixture'
      : `${model.state.view.parcellation.toUpperCase()} regional values`;

    const rovingRegionId = this.rovingButton?.dataset.regionButton;
    const restoreFocus = document.activeElement === this.rovingButton;
    const rows = buildRegionHierarchy(model.regions).map(({ region, depth, hasChildren }) =>
      this.regionRow(region, depth, hasChildren, valueById.get(region.id), statistic, unit, range, selected));
    this.list.replaceChildren(...rows);
    this.rowById.clear();
    rows.forEach((row) => {
      if (row.dataset.regionId) this.rowById.set(row.dataset.regionId, row);
    });
    this.rovingButton = (rovingRegionId
      ? this.rowById.get(rovingRegionId)?.querySelector<HTMLButtonElement>('.region-row__button')
      : null) ?? rows[0]?.querySelector<HTMLButtonElement>('.region-row__button') ?? null;
    if (this.rovingButton) this.rovingButton.tabIndex = 0;
    if (restoreFocus) this.rovingButton?.focus();
    this.lastHoveredRegionId = null;
    this.updateHoveredRegion(model.hoveredRegionId);
    this.renderSelected(model.regions, selected, valueById, statistic, unit);
    if (feature) {
      this.renderDistribution(feature, selected, model.regions, statistic, unit, fixture);
      this.renderAnalysis(feature, model.regions, selected, valueById, statistic, unit, fixture);
    } else {
      this.distribution.replaceChildren(this.message('No regional distribution loaded'));
      this.analysis.replaceChildren(this.message('No feature values are available for this parcellation'));
    }
    this.filterRegions();
  }

  destroy(): void {
    this.search.removeEventListener('input', this.filterRegions);
    this.searchClear.removeEventListener('click', this.clearSearch);
    this.analysisToggle.removeEventListener('click', this.toggleAnalysis);
    this.collapseAllButton.removeEventListener('click', this.collapseAllRegions);
    this.expandAllButton.removeEventListener('click', this.expandAllRegions);
  }

  private renderEmpty(model: RegionalPanelModel): void {
    this.rowById.clear();
    this.rovingButton = null;
    this.lastHoveredRegionId = null;
    this.collapseAllButton.disabled = true;
    this.expandAllButton.disabled = true;
    this.selectedSection.dataset.empty = 'true';
    this.analysisPanel.dataset.empty = 'true';
    this.analysisExpanded = false;
    this.hadSelection = false;
    this.syncAnalysisDisclosure();
    const item = html('li', 'selected-regions__empty');
    item.textContent = model.state.view.representation === 'volume'
      ? 'Region values are unavailable in volume mode'
      : 'Regional data is loading or unavailable';
    this.list.replaceChildren(item.cloneNode(true));
    this.selectedList.replaceChildren();
    this.clearSelectionButton.disabled = true;
    this.source.textContent = 'No regional values';
    this.resultCount.textContent = '0 regions';
    this.distribution.replaceChildren(this.message('No regional distribution loaded'));
    this.analysis.replaceChildren(this.message('Select a regional feature to compare regions'));
  }

  private regionRow(
    region: RegionMetadata,
    depth: number,
    hasChildren: boolean,
    value: number | undefined,
    statistic: StatisticId,
    unit: string | null,
    range: readonly [number, number] | null,
    selected: ReadonlySet<string>,
  ): HTMLLIElement {
    const item = html('li', 'region-row');
    item.dataset.regionId = region.id;
    if (region.parentId !== undefined && region.parentId !== null) item.dataset.parentId = region.parentId;
    item.dataset.depth = String(depth);
    item.dataset.branch = String(hasChildren);
    item.dataset.mappingMember = String(region.mappingMember !== false);
    item.dataset.missing = String(value === undefined || !Number.isFinite(value));
    item.dataset.selected = String(selected.has(region.id));
    item.style.setProperty('--region-indent', `${(depth * 0.42).toFixed(2)}rem`);
    item.setAttribute('role', 'treeitem');
    item.setAttribute('aria-level', String(depth + 1));
    item.setAttribute('aria-selected', String(selected.has(region.id)));
    if (hasChildren) item.setAttribute('aria-expanded', String(!this.collapsedRegionIds.has(region.id)));

    const toggle = hasChildren ? html('button', 'region-row__toggle') : html('span', 'region-row__toggle-placeholder');
    if (toggle instanceof HTMLButtonElement) {
      toggle.type = 'button';
      toggle.tabIndex = -1;
      toggle.dataset.regionToggle = region.id;
      toggle.textContent = '›';
      toggle.setAttribute('aria-label', `${this.collapsedRegionIds.has(region.id) ? 'Expand' : 'Collapse'} ${region.acronym}`);
      toggle.setAttribute('aria-expanded', String(!this.collapsedRegionIds.has(region.id)));
      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggleBranch(region.id);
      });
    } else {
      toggle.setAttribute('aria-hidden', 'true');
    }

    const button = html('button', 'region-row__button');
    button.type = 'button';
    button.tabIndex = -1;
    button.dataset.regionButton = region.id;
    button.setAttribute('aria-pressed', String(selected.has(region.id)));
    button.setAttribute('aria-label', `${region.acronym}, ${region.name}`);
    const selectable = region.mappingMember !== false;
    if (!selectable) button.setAttribute('aria-disabled', 'true');
    button.addEventListener('click', () => {
      if (selectable) this.callbacks.toggleSelection(region.id);
    });
    button.addEventListener('keydown', (event) => this.navigateRegions(event, button));
    button.addEventListener('pointerenter', () => this.callbacks.hoverRegion(selectable ? region.id : null));
    button.addEventListener('pointerleave', () => this.callbacks.hoverRegion(null));
    button.addEventListener('focus', () => {
      this.setRovingButton(button);
      this.callbacks.hoverRegion(selectable ? region.id : null);
    });
    button.addEventListener('blur', () => this.callbacks.hoverRegion(null));

    const disclosure = html('span', 'region-row__disclosure');
    if (region.colorHex) {
      disclosure.classList.add('region-row__swatch');
      disclosure.style.backgroundColor = region.colorHex;
      disclosure.title = `Official atlas color ${region.colorHex}`;
    } else {
      disclosure.textContent = '·';
    }
    disclosure.setAttribute('aria-hidden', 'true');
    const identity = html('span', 'region-row__identity');
    const acronym = html('span', 'region-row__acronym');
    acronym.textContent = region.acronym;
    const name = html('span', 'region-row__name');
    name.textContent = region.name;
    name.title = region.name;
    identity.append(acronym, name);

    const valueNode = html('span', 'region-row__value');
    if (!selectable) {
      valueNode.setAttribute('aria-hidden', 'true');
    } else if (value === undefined || !Number.isFinite(value)) {
      valueNode.setAttribute('aria-label', 'Value unavailable');
    } else {
      const formatted = formatValue(value, statistic, unit);
      valueNode.title = `${statistic}: ${formatted}`;
      valueNode.setAttribute('aria-label', `${statistic} ${formatted}`);
      const bar = html('span', 'region-row__bar');
      const fill = html('span', 'region-row__bar-fill');
      const fraction = range && range[1] > range[0] ? (value - range[0]) / (range[1] - range[0]) : 0.5;
      fill.style.setProperty('--region-value', `${Math.max(0, Math.min(1, fraction)) * 100}%`);
      bar.append(fill);
      valueNode.append(bar);
    }
    button.append(disclosure, identity, valueNode);
    item.append(toggle, button);
    return item;
  }

  private renderSelected(
    regions: readonly RegionMetadata[],
    selected: ReadonlySet<string>,
    values: ReadonlyMap<string, number>,
    statistic: StatisticId,
    unit: string | null,
  ): void {
    const byId = new Map(regions.map((region) => [region.id, region]));
    const items = [...selected].map((regionId) => {
      const region = byId.get(regionId);
      const item = html('li', 'selected-region');
      const identity = html('span', 'selected-region__identity');
      const acronym = html('strong', 'selected-region__acronym');
      acronym.textContent = region?.acronym ?? regionId;
      const name = html('span', 'selected-region__name');
      const value = values.get(regionId);
      name.textContent = region
        ? `${region.name}${value !== undefined && Number.isFinite(value) ? ` · ${formatValue(value, statistic, unit)}` : ''}`
        : `Region ${regionId}`;
      identity.append(acronym, name);
      const remove = html('button', 'selected-region__remove');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${region?.acronym ?? regionId} from selected regions`);
      remove.addEventListener('click', () => this.callbacks.toggleSelection(regionId));
      item.append(identity, remove);
      return item;
    });
    this.selectedSection.dataset.empty = String(items.length === 0);
    this.selectedList.replaceChildren(...items);
    this.clearSelectionButton.disabled = selected.size === 0;
  }

  private renderDistribution(
    feature: RegionalFeaturePayload,
    selected: ReadonlySet<string>,
    regions: readonly RegionMetadata[],
    statistic: StatisticId,
    unit: string | null,
    fixture: boolean,
  ): void {
    const histogram = feature.histogram;
    if (!histogram || histogram.globalCounts.length === 0) {
      this.distribution.replaceChildren(this.message('Histogram unavailable for this feature'));
      return;
    }
    const selectedCounts = new Array<number>(histogram.globalCounts.length).fill(0);
    const indexById = new Map(feature.regionIds.map((id, index) => [id, index]));
    if (histogram.regionalCounts) {
      for (const regionId of selected) {
        const row = indexById.get(regionId);
        const counts = row === undefined ? undefined : histogram.regionalCounts[row];
        if (!counts) continue;
        counts.forEach((count, bin) => { selectedCounts[bin] = (selectedCounts[bin] ?? 0) + count; });
      }
    }
    const maxCount = Math.max(1, ...histogram.globalCounts);
    const chart = html('div', 'distribution-chart');
    chart.dataset.fixture = String(fixture);
    const meta = html('div', 'distribution-chart__meta');
    const label = html('span');
    label.textContent = `${statistic}${unit && statistic !== 'count' ? ` · ${unit}` : ''}`;
    const population = html('span');
    population.textContent = feature.population ?? `${regions.length} regions`;
    meta.append(label, population);
    const bins = html('div', 'distribution-chart__bins');
    histogram.globalCounts.forEach((count, bin) => {
      const cell = html('div', 'distribution-chart__bin');
      const low = histogram.edges[bin];
      const high = histogram.edges[bin + 1];
      cell.title = `${low ?? '?'}–${high ?? '?'}: global ${count}, selected ${selectedCounts[bin] ?? 0}`;
      const globalBar = html('span', 'distribution-chart__global');
      globalBar.style.setProperty('--hist-height', `${(count / maxCount) * 100}%`);
      const selectedBar = html('span', 'distribution-chart__selected');
      selectedBar.style.setProperty('--hist-height', `${((selectedCounts[bin] ?? 0) / maxCount) * 100}%`);
      cell.append(globalBar, selectedBar);
      bins.append(cell);
    });
    chart.append(meta, bins);
    this.distribution.replaceChildren(chart);
  }

  private renderAnalysis(
    feature: RegionalFeaturePayload,
    regions: readonly RegionMetadata[],
    selected: ReadonlySet<string>,
    values: ReadonlyMap<string, number>,
    statistic: StatisticId,
    unit: string | null,
    fixture: boolean,
  ): void {
    const wrap = html('div', 'regional-comparison');
    wrap.dataset.fixture = String(fixture);
    if (fixture) {
      const badge = html('span', 'regional-comparison__fixture');
      badge.textContent = 'Synthetic integration fixture';
      wrap.append(badge);
    }
    if (!selected.size) {
      this.analysis.replaceChildren();
      return;
    }
    const byId = new Map(regions.map((region) => [region.id, region]));
    const list = html('dl', 'regional-comparison__list');
    for (const id of selected) {
      const region = byId.get(id);
      const term = html('dt');
      term.textContent = region ? `${region.acronym} · ${region.name}` : `Region ${id}`;
      const description = html('dd');
      const value = values.get(id);
      description.textContent = value !== undefined && Number.isFinite(value)
        ? `${statistic}: ${formatValue(value, statistic, unit)}`
        : '';
      list.append(term, description);
    }
    if (feature.global) {
      const term = html('dt');
      term.textContent = 'Global population';
      const description = html('dd');
      const globalValue = feature.global[statistic as keyof typeof feature.global];
      description.textContent = typeof globalValue === 'number'
        ? `${statistic}: ${formatValue(globalValue, statistic, unit)}`
        : `${feature.global.count ?? 0} observations`;
      list.append(term, description);
    }
    wrap.append(list);
    this.analysis.replaceChildren(wrap);
  }

  private readonly filterRegions = (): void => {
    const query = this.search.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const row of this.list.querySelectorAll<HTMLLIElement>('.region-row')) {
      const region = this.currentRegions.find((item) => item.id === row.dataset.regionId);
      const matches = !query || !!region && (
        region.acronym.toLocaleLowerCase().includes(query) ||
        region.name.toLocaleLowerCase().includes(query)
      );
      const hiddenByCollapsedAncestor = !query && this.hasCollapsedAncestor(row.dataset.regionId ?? '');
      row.hidden = !matches || hiddenByCollapsedAncestor;
      if (matches && !hiddenByCollapsedAncestor) visible += 1;
    }
    this.searchClear.hidden = !query;
    this.resultCount.textContent = `${visible} ${visible === 1 ? 'region' : 'regions'}`;
    this.syncTreeControls(query.length > 0);
    if (this.rovingButton?.closest<HTMLLIElement>('.region-row')?.hidden) {
      const firstVisible = this.list.querySelector<HTMLButtonElement>('.region-row:not([hidden]) .region-row__button');
      if (firstVisible) this.setRovingButton(firstVisible);
    }
  };

  private readonly clearSearch = (): void => {
    this.search.value = '';
    this.filterRegions();
    this.search.focus();
  };

  private navigateRegions(event: KeyboardEvent, current: HTMLButtonElement): void {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const row = current.closest<HTMLLIElement>('.region-row');
    const regionId = row?.dataset.regionId;
    if (regionId && event.key === 'ArrowRight') {
      event.preventDefault();
      if (row.dataset.branch === 'true' && this.collapsedRegionIds.has(regionId)) {
        this.toggleBranch(regionId);
      } else {
        const child = [...this.list.querySelectorAll<HTMLLIElement>('.region-row:not([hidden])')]
          .find((candidate) => candidate.dataset.parentId === regionId);
        this.focusRegionButton(child?.querySelector<HTMLButtonElement>('.region-row__button') ?? null);
      }
      return;
    }
    if (regionId && event.key === 'ArrowLeft') {
      event.preventDefault();
      if (row.dataset.branch === 'true' && !this.collapsedRegionIds.has(regionId)) {
        this.toggleBranch(regionId);
      } else if (row.dataset.parentId) {
        this.focusRegionButton(this.rowById.get(row.dataset.parentId)?.querySelector<HTMLButtonElement>('.region-row__button') ?? null);
      }
      return;
    }
    const visible = [...this.list.querySelectorAll<HTMLButtonElement>('.region-row:not([hidden]) .region-row__button')];
    if (!visible.length) return;
    const index = visible.indexOf(current);
    let target = index;
    if (event.key === 'ArrowDown') target = Math.min(visible.length - 1, index + 1);
    if (event.key === 'ArrowUp') target = Math.max(0, index - 1);
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = visible.length - 1;
    if (target !== index) {
      event.preventDefault();
      this.focusRegionButton(visible[target] ?? null);
    }
  }

  private toggleBranch(regionId: string): void {
    const row = this.rowById.get(regionId);
    if (!row || row.dataset.branch !== 'true') return;
    const expanded = this.collapsedRegionIds.has(regionId);
    this.animateTreeMutation(() => {
      if (expanded) this.collapsedRegionIds.delete(regionId);
      else this.collapsedRegionIds.add(regionId);
      this.syncBranchDisclosure(row, expanded);
    });
  }

  private readonly collapseAllRegions = (): void => {
    this.setAllBranchesExpanded(false);
  };

  private readonly expandAllRegions = (): void => {
    this.setAllBranchesExpanded(true);
  };

  private setAllBranchesExpanded(expanded: boolean): void {
    this.animateTreeMutation(() => {
      for (const [id, row] of this.rowById) {
        if (row.dataset.branch !== 'true') continue;
        if (expanded) this.collapsedRegionIds.delete(id);
        else this.collapsedRegionIds.add(id);
        this.syncBranchDisclosure(row, expanded);
      }
    });
  }

  private syncBranchDisclosure(row: HTMLLIElement, expanded: boolean): void {
    const regionId = row.dataset.regionId;
    if (!regionId) return;
    row.setAttribute('aria-expanded', String(expanded));
    const toggle = row.querySelector<HTMLButtonElement>('.region-row__toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(expanded));
      const acronym = this.regionById.get(regionId)?.acronym ?? regionId;
      toggle.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} ${acronym}`);
    }
  }

  private animateTreeMutation(mutation: () => void): void {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const before = reduceMotion ? new Map<string, number>() : this.captureVisibleRowTops();
    mutation();
    this.filterRegions();
    if (!reduceMotion) this.animateVisibleRowReflow(before);
  }

  private syncTreeControls(filtering: boolean): void {
    const branchIds = [...this.rowById]
      .filter(([, row]) => row.dataset.branch === 'true')
      .map(([id]) => id);
    this.collapseAllButton.disabled = filtering || !branchIds.length || branchIds.every((id) => this.collapsedRegionIds.has(id));
    this.expandAllButton.disabled = filtering || !branchIds.some((id) => this.collapsedRegionIds.has(id));
  }

  private captureVisibleRowTops(): Map<string, number> {
    for (const row of this.rowById.values()) row.getAnimations().forEach((animation) => animation.finish());
    const viewport = this.pane.querySelector<HTMLElement>('.region-pane__browser')?.getBoundingClientRect();
    const tops = new Map<string, number>();
    for (const [id, row] of this.rowById) {
      if (row.hidden) continue;
      const rect = row.getBoundingClientRect();
      if (!viewport || rect.bottom >= viewport.top - 40 && rect.top <= viewport.bottom + 40) tops.set(id, rect.top);
    }
    return tops;
  }

  private animateVisibleRowReflow(before: ReadonlyMap<string, number>): void {
    const viewport = this.pane.querySelector<HTMLElement>('.region-pane__browser')?.getBoundingClientRect();
    for (const [id, row] of this.rowById) {
      if (row.hidden) continue;
      const rect = row.getBoundingClientRect();
      if (viewport && (rect.bottom < viewport.top - 40 || rect.top > viewport.bottom + 40)) continue;
      const previousTop = before.get(id);
      if (previousTop === undefined) {
        row.animate(
          [{ opacity: 0, transform: 'translateY(-3px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: 150, easing: 'cubic-bezier(.2,.8,.2,1)' },
        );
        continue;
      }
      const delta = previousTop - rect.top;
      if (Math.abs(delta) < 0.5) continue;
      row.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
        { duration: 150, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    }
  }

  private hasCollapsedAncestor(regionId: string): boolean {
    let parentId = this.regionById.get(regionId)?.parentId;
    const visited = new Set<string>();
    while (parentId !== undefined && parentId !== null && !visited.has(parentId)) {
      if (this.collapsedRegionIds.has(parentId)) return true;
      visited.add(parentId);
      parentId = this.regionById.get(parentId)?.parentId;
    }
    return false;
  }

  private updateHoveredRegion(regionId: string | null): void {
    if (regionId === this.lastHoveredRegionId) return;
    if (this.lastHoveredRegionId) this.rowById.get(this.lastHoveredRegionId)?.removeAttribute('data-hovered');
    if (regionId) this.rowById.get(regionId)?.setAttribute('data-hovered', 'true');
    this.lastHoveredRegionId = regionId;
  }

  private setRovingButton(button: HTMLButtonElement): void {
    if (this.rovingButton === button) return;
    if (this.rovingButton) this.rovingButton.tabIndex = -1;
    button.tabIndex = 0;
    this.rovingButton = button;
  }

  private focusRegionButton(button: HTMLButtonElement | null): void {
    if (!button) return;
    this.setRovingButton(button);
    button.focus();
  }

  private readonly toggleAnalysis = (): void => {
    if (!this.hadSelection) return;
    this.analysisExpanded = !this.analysisExpanded;
    this.syncAnalysisDisclosure();
  };

  private updateAnalysisDisclosure(hasSelection: boolean): void {
    if (hasSelection && !this.hadSelection) this.analysisExpanded = true;
    if (!hasSelection) this.analysisExpanded = false;
    this.hadSelection = hasSelection;
    this.syncAnalysisDisclosure();
  }

  private syncAnalysisDisclosure(): void {
    this.analysisPanel.dataset.empty = String(!this.hadSelection);
    this.analysisPanel.dataset.expanded = String(this.hadSelection && this.analysisExpanded);
    this.analysisToggle.disabled = !this.hadSelection;
    this.analysisToggle.setAttribute('aria-expanded', String(this.hadSelection && this.analysisExpanded));
    this.analysisToggle.setAttribute('aria-label', `${this.analysisExpanded ? 'Collapse' : 'Expand'} analysis and comparison`);
    const chevron = this.analysisToggle.querySelector<HTMLElement>('.analysis-panel__chevron');
    if (chevron) {
      chevron.hidden = !this.hadSelection;
      chevron.textContent = this.analysisExpanded ? '⌄' : '⌃';
    }
  }

  private message(text: string): HTMLElement {
    const node = html('p', 'regional-data-message');
    node.textContent = text;
    return node;
  }
}
