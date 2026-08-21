import type { RegionMetadata, RegionalFeaturePayload } from '../../data/contracts.js';
import type { StatisticId } from '../../domain/types.js';
import { html, message } from './dom.js';
import { formatRegionalValue, selectedHistogramCounts } from './model.js';

export interface RegionalDetailsTargets {
  selectedList: HTMLUListElement;
  selectedSection: HTMLElement;
  clearSelectionButton: HTMLButtonElement;
  summary: HTMLElement;
  distribution: HTMLElement;
  analysis: HTMLElement;
}

export function renderSelectedRegions(
  targets: Pick<RegionalDetailsTargets, 'selectedList' | 'selectedSection' | 'clearSelectionButton'>,
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
    item.dataset.regionId = regionId;
    const identity = html('span', 'selected-region__identity');
    const acronym = html('strong', 'selected-region__acronym');
    acronym.textContent = region?.acronym ?? regionId;
    const name = html('span', 'selected-region__name');
    const value = values.get(regionId);
    name.textContent = region
      ? `${region.name}${value !== undefined && Number.isFinite(value) ? ` · ${formatRegionalValue(value, statistic, unit)}` : ''}`
      : `Region ${regionId}`;
    identity.append(acronym, name);
    const remove = html('button', 'selected-region__remove');
    remove.type = 'button';
    remove.dataset.removeRegion = regionId;
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${region?.acronym ?? regionId} from selected regions`);
    item.append(identity, remove);
    return item;
  });
  targets.selectedSection.dataset.empty = String(items.length === 0);
  targets.selectedList.replaceChildren(...items);
  targets.clearSelectionButton.disabled = selected.size === 0;
}

export function renderFeatureSummary(
  target: HTMLElement,
  feature: RegionalFeaturePayload,
  unit: string | null,
): void {
  if (!feature.global) {
    target.replaceChildren();
    return;
  }
  const fields: readonly (readonly [string, number | undefined, StatisticId])[] = [
    ['Observations', feature.global.count, 'count'],
    ['Mean', feature.global.mean, 'mean'],
    ['Median', feature.global.median, 'median'],
    ['Std. deviation', feature.global.std, 'mean'],
  ];
  const list = html('dl', 'feature-summary');
  for (const [label, value, statistic] of fields) {
    if (value === undefined || !Number.isFinite(value)) continue;
    const card = html('div', 'feature-summary__item');
    const term = html('dt', 'feature-summary__label');
    term.textContent = label;
    const description = html('dd', 'feature-summary__value');
    description.textContent = formatRegionalValue(value, statistic, unit);
    card.append(term, description);
    list.append(card);
  }
  target.replaceChildren(list);
}

export function renderDistribution(
  target: HTMLElement,
  feature: RegionalFeaturePayload,
  selected: ReadonlySet<string>,
  regions: readonly RegionMetadata[],
  statistic: StatisticId,
  unit: string | null,
  fixture: boolean,
): void {
  const histogram = feature.histogram;
  if (!histogram || histogram.globalCounts.length === 0) {
    target.replaceChildren(message('Histogram unavailable for this feature'));
    return;
  }
  const selectedCounts = selectedHistogramCounts(feature, selected);
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
    cell.title = `${histogram.edges[bin] ?? '?'}–${histogram.edges[bin + 1] ?? '?'}: global ${count}, selected ${selectedCounts[bin] ?? 0}`;
    const globalBar = html('span', 'distribution-chart__global');
    globalBar.style.setProperty('--hist-height', `${(count / maxCount) * 100}%`);
    const selectedBar = html('span', 'distribution-chart__selected');
    selectedBar.style.setProperty('--hist-height', `${((selectedCounts[bin] ?? 0) / maxCount) * 100}%`);
    cell.append(globalBar, selectedBar);
    bins.append(cell);
  });
  chart.append(meta, bins);
  target.replaceChildren(chart);
}

export function renderAnalysis(
  target: HTMLElement,
  feature: RegionalFeaturePayload,
  regions: readonly RegionMetadata[],
  selected: ReadonlySet<string>,
  values: ReadonlyMap<string, number>,
  statistic: StatisticId,
  unit: string | null,
  fixture: boolean,
): void {
  if (selected.size === 0) {
    target.replaceChildren();
    return;
  }
  const wrap = html('div', 'regional-comparison');
  wrap.dataset.fixture = String(fixture);
  if (fixture) {
    const badge = html('span', 'regional-comparison__fixture');
    badge.textContent = 'Synthetic integration fixture';
    wrap.append(badge);
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
      ? `${statistic}: ${formatRegionalValue(value, statistic, unit)}`
      : '';
    list.append(term, description);
  }
  if (feature.global) {
    const term = html('dt');
    term.textContent = 'Global population';
    const description = html('dd');
    const globalValue = feature.global[statistic as keyof typeof feature.global];
    description.textContent = typeof globalValue === 'number'
      ? `${statistic}: ${formatRegionalValue(globalValue, statistic, unit)}`
      : `${feature.global.count ?? 0} observations`;
    list.append(term, description);
  }
  wrap.append(list);
  target.replaceChildren(wrap);
}
