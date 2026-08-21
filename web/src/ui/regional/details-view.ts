import type { RegionMetadata, RegionalFeaturePayload } from '../../data/contracts.js';
import type { StatisticId } from '../../domain/types.js';
import { html, message } from './dom.js';
import {
  buildRegionalValueMap,
  formatRegionalValue,
  histogramDistribution,
  selectedRegionHistogramDistributions,
  selectionColor,
} from './model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHART_WIDTH = 1000;
const CHART_HEIGHT = 100;

function probabilitySum(values: readonly number[]): string {
  return String(Math.round(values.reduce((sum, value) => sum + value, 0) * 1e12) / 1e12);
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function stepPath(values: readonly number[], maxValue: number, close: boolean): string {
  if (values.length === 0) return '';
  const width = CHART_WIDTH / values.length;
  const y = (value: number): number => CHART_HEIGHT - (maxValue > 0 ? value / maxValue : 0) * (CHART_HEIGHT - 5);
  let path = close ? `M 0 ${CHART_HEIGHT} L 0 ${y(values[0] ?? 0)}` : `M 0 ${y(values[0] ?? 0)}`;
  values.forEach((value, index) => {
    const right = (index + 1) * width;
    path += ` H ${right}`;
    const next = values[index + 1];
    if (next !== undefined) path += ` V ${y(next)}`;
  });
  if (close) path += ` L ${CHART_WIDTH} ${CHART_HEIGHT} Z`;
  return path;
}

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
  const items = [...selected].map((regionId, selectionIndex) => {
    const region = byId.get(regionId);
    const item = html('li', 'selected-region');
    item.dataset.regionId = regionId;
    item.style.setProperty('--selection-color', selectionColor(selectionIndex));
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
  const global = histogramDistribution(histogram.globalCounts);
  const selectedDistributions = selectedRegionHistogramDistributions(feature, selected);
  const maxProbability = Math.max(
    0,
    ...global.probabilities,
    ...selectedDistributions.flatMap((distribution) => distribution.probabilities),
  );
  const values = buildRegionalValueMap(feature, statistic);
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const chart = html('div', 'distribution-chart');
  chart.dataset.fixture = String(fixture);
  const meta = html('div', 'distribution-chart__meta');
  const label = html('span');
  label.textContent = `Observation distribution${unit ? ` · ${unit}` : ''}`;
  const population = html('span');
  population.textContent = feature.population ?? `${regions.length} regions`;
  meta.append(label, population);
  const plot = html('div', 'distribution-chart__plot');
  const svg = svgElement('svg');
  svg.classList.add('distribution-chart__svg');
  svg.setAttribute('viewBox', `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-label', 'Normalized global and selected-region distributions');
  const globalArea = svgElement('path');
  globalArea.classList.add('distribution-chart__global');
  globalArea.setAttribute('d', stepPath(global.probabilities, maxProbability, true));
  globalArea.dataset.total = String(global.total);
  globalArea.dataset.probabilitySum = probabilitySum(global.probabilities);
  const globalTitle = svgElement('title');
  globalTitle.textContent = `Global population · n=${global.total.toLocaleString('en-US')}`;
  globalArea.append(globalTitle);
  svg.append(globalArea);

  selectedDistributions.forEach((distribution, selectionIndex) => {
    const region = regionById.get(distribution.regionId);
    const color = selectionColor(selectionIndex);
    const line = svgElement('path');
    line.classList.add('distribution-chart__region');
    line.dataset.regionId = distribution.regionId;
    line.dataset.total = String(distribution.total);
    line.dataset.probabilitySum = probabilitySum(distribution.probabilities);
    line.setAttribute('d', stepPath(distribution.probabilities, maxProbability, false));
    line.style.setProperty('--selection-color', color);
    const title = svgElement('title');
    title.textContent = `${region?.acronym ?? distribution.regionId} · normalized within region · n=${distribution.total.toLocaleString('en-US')}`;
    line.append(title);
    svg.append(line);

    const markerValue = statistic === 'count' ? undefined : values.get(distribution.regionId);
    const firstEdge = histogram.edges[0];
    const lastEdge = histogram.edges.at(-1);
    if (markerValue !== undefined && Number.isFinite(markerValue) && firstEdge !== undefined && lastEdge !== undefined && lastEdge > firstEdge) {
      const marker = svgElement('line');
      marker.classList.add('distribution-chart__marker');
      marker.dataset.regionId = distribution.regionId;
      const x = Math.max(0, Math.min(CHART_WIDTH, ((markerValue - firstEdge) / (lastEdge - firstEdge)) * CHART_WIDTH));
      marker.setAttribute('x1', String(x));
      marker.setAttribute('x2', String(x));
      marker.setAttribute('y1', '0');
      marker.setAttribute('y2', String(CHART_HEIGHT));
      marker.style.setProperty('--selection-color', color);
      const markerTitle = svgElement('title');
      markerTitle.textContent = `${region?.acronym ?? distribution.regionId} ${statistic}: ${formatRegionalValue(markerValue, statistic, unit)}`;
      marker.append(markerTitle);
      svg.append(marker);
    }
  });

  const bins = html('div', 'distribution-chart__bins');
  histogram.globalCounts.forEach((count, bin) => {
    const cell = html('div', 'distribution-chart__bin');
    const globalPercent = (global.probabilities[bin] ?? 0) * 100;
    const selectedText = selectedDistributions.map((distribution) => {
      const region = regionById.get(distribution.regionId);
      return `${region?.acronym ?? distribution.regionId} ${((distribution.probabilities[bin] ?? 0) * 100).toFixed(1)}% (${distribution.counts[bin] ?? 0})`;
    }).join('; ');
    cell.title = `${histogram.edges[bin] ?? '?'}–${histogram.edges[bin + 1] ?? '?'}: global ${globalPercent.toFixed(1)}% (${count})${selectedText ? `; ${selectedText}` : ''}`;
    bins.append(cell);
  });
  plot.append(svg, bins);

  const legend = html('div', 'distribution-chart__legend');
  const globalLegend = html('span', 'distribution-chart__legend-item');
  globalLegend.dataset.series = 'global';
  globalLegend.textContent = `Global · n=${global.total.toLocaleString('en-US')}`;
  legend.append(globalLegend);
  selectedDistributions.forEach((distribution, selectionIndex) => {
    const item = html('span', 'distribution-chart__legend-item');
    item.dataset.regionId = distribution.regionId;
    item.style.setProperty('--selection-color', selectionColor(selectionIndex));
    item.textContent = `${regionById.get(distribution.regionId)?.acronym ?? distribution.regionId} · n=${distribution.total.toLocaleString('en-US')}`;
    legend.append(item);
  });
  chart.append(meta, plot, legend);
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
