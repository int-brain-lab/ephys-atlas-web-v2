import type {
  DatasetManifest,
  FeaturePayload,
  RegionMetadata,
  RegionalFeaturePayload,
} from '../data/contracts.js';
import type { AppState, StatisticId } from '../domain/types.js';
import { regionalColorRange } from '../rendering/scalar-colormap.js';

export interface RegionalPanelCallbacks {
  toggleSelection(regionId: string): void;
  clearSelection(): void;
}

export interface RegionalPanelModel {
  state: AppState;
  manifest: DatasetManifest | null;
  feature: FeaturePayload | null;
  regions: readonly RegionMetadata[];
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

function normalizedDepth(depth: number | undefined): string {
  return String(Math.max(0, Math.min(2, depth ?? 0)));
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
  private readonly list: HTMLUListElement;
  private readonly selectedList: HTMLUListElement;
  private readonly clearSelectionButton: HTMLButtonElement;
  private readonly distribution: HTMLElement;
  private readonly analysis: HTMLElement;
  private currentRegions: readonly RegionMetadata[] = [];
  private lastFeature: FeaturePayload | null = null;
  private lastRegions: readonly RegionMetadata[] | null = null;
  private lastStatistic: StatisticId | null = null;
  private lastSelectionKey = '';
  private lastFixture = false;

  constructor(root: ParentNode, private readonly callbacks: RegionalPanelCallbacks) {
    this.pane = required(root, '.region-pane');
    this.search = required(root, '.region-search__input');
    this.searchClear = required(root, '.region-search__clear');
    this.source = required(root, '.region-search__source');
    this.resultCount = required(root, '.region-search__count');
    this.list = required(root, '.region-list');
    this.selectedList = required(root, '.selected-regions__list');
    this.clearSelectionButton = required(root, '.selected-regions__clear');
    this.distribution = required(root, '.distribution-band__surface');
    this.analysis = required(root, '.analysis-panel__surface');

    this.search.addEventListener('input', this.filterRegions);
    this.searchClear.addEventListener('click', this.filterRegions);
    this.clearSelectionButton.addEventListener('click', () => this.callbacks.clearSelection());
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
      fixture === this.lastFixture
    ) return;

    this.lastFeature = feature;
    this.lastRegions = model.regions;
    this.lastStatistic = statistic;
    this.lastSelectionKey = selectionKey;
    this.lastFixture = fixture;
    this.currentRegions = model.regions;
    this.pane.dataset.phase = feature ? 'regional-data' : 'empty';
    this.pane.dataset.fixture = String(fixture);

    if (!feature || !model.regions.length) {
      this.renderEmpty(model);
      return;
    }

    const descriptor = model.manifest?.features.find((item) => item.id === feature.featureId);
    const values = featureValues(feature, statistic);
    const valueById = new Map<string, number>();
    if (values) {
      feature.regionIds.forEach((id, index) => {
        const value = values[index];
        if (value !== undefined) valueById.set(id, value);
      });
    }
    const selected = new Set(model.state.view.selection);
    const range = regionalColorRange(feature, model.state.view.coloring);
    const unit = descriptor?.unit ?? null;

    this.source.textContent = fixture
      ? 'Synthetic schema-v0.1 fixture'
      : `${model.state.view.parcellation.toUpperCase()} regional values`;

    const rows = model.regions.map((region) => this.regionRow(region, valueById.get(region.id), statistic, unit, range, selected));
    this.list.replaceChildren(...rows);
    this.renderSelected(model.regions, selected, valueById, statistic, unit);
    this.renderDistribution(feature, selected, model.regions, statistic, unit, fixture);
    this.renderAnalysis(feature, model.regions, selected, valueById, statistic, unit, fixture);
    this.filterRegions();
  }

  destroy(): void {
    this.search.removeEventListener('input', this.filterRegions);
    this.searchClear.removeEventListener('click', this.filterRegions);
  }

  private renderEmpty(model: RegionalPanelModel): void {
    const item = html('li', 'selected-regions__empty');
    item.textContent = model.state.view.representation === 'volume'
      ? 'Region values are unavailable in volume mode'
      : 'Regional data is loading or unavailable';
    this.list.replaceChildren(item.cloneNode(true));
    this.selectedList.replaceChildren(item);
    this.clearSelectionButton.disabled = true;
    this.source.textContent = 'No regional values';
    this.resultCount.textContent = '0 regions';
    this.distribution.replaceChildren(this.message('No regional distribution loaded'));
    this.analysis.replaceChildren(this.message('Select a regional feature to compare regions'));
  }

  private regionRow(
    region: RegionMetadata,
    value: number | undefined,
    statistic: StatisticId,
    unit: string | null,
    range: readonly [number, number] | null,
    selected: ReadonlySet<string>,
  ): HTMLLIElement {
    const item = html('li', 'region-row');
    item.dataset.regionId = region.id;
    item.dataset.depth = normalizedDepth(region.depth);
    item.dataset.missing = String(value === undefined || !Number.isFinite(value));
    item.dataset.selected = String(selected.has(region.id));

    const button = html('button', 'region-row__button');
    button.type = 'button';
    button.dataset.regionButton = region.id;
    button.setAttribute('aria-pressed', String(selected.has(region.id)));
    button.setAttribute('aria-label', `${region.acronym}, ${region.name}`);
    button.addEventListener('click', () => this.callbacks.toggleSelection(region.id));
    button.addEventListener('keydown', (event) => this.navigateRegions(event, button));

    const disclosure = html('span', 'region-row__disclosure');
    disclosure.textContent = region.parentId !== undefined ? '·' : '·';
    disclosure.setAttribute('aria-hidden', 'true');
    const identity = html('span', 'region-row__identity');
    const acronym = html('span', 'region-row__acronym');
    acronym.textContent = region.acronym;
    const name = html('span', 'region-row__name');
    name.textContent = region.name;
    name.title = region.name;
    identity.append(acronym, name);

    const valueNode = html('span', 'region-row__value');
    if (value === undefined || !Number.isFinite(value)) {
      const missing = html('span', 'region-row__missing');
      missing.textContent = 'no value';
      valueNode.append(missing);
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
    item.append(button);
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
    if (!items.length) {
      const empty = html('li', 'selected-regions__empty');
      empty.textContent = 'No regions selected';
      items.push(empty);
    }
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
      wrap.append(this.message('Select one or more regions to compare with the global distribution'));
      this.analysis.replaceChildren(wrap);
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
        : `${statistic}: no value`;
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
      row.hidden = !matches;
      if (matches) visible += 1;
    }
    this.searchClear.hidden = !query;
    this.resultCount.textContent = `${visible} ${visible === 1 ? 'region' : 'regions'}`;
  };

  private navigateRegions(event: KeyboardEvent, current: HTMLButtonElement): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
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
      visible[target]?.focus();
    }
  }

  private message(text: string): HTMLElement {
    const node = html('p', 'regional-data-message');
    node.textContent = text;
    return node;
  }
}
