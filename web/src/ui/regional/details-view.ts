import type { RegionMetadata, RegionalFeaturePayload } from '../../data/contracts.js';
import type { ColorRange, StatisticId } from '../../domain/types.js';
import { html, message } from './dom.js';
import {
  buildRegionalValueMap,
  formatRegionalValue,
  histogramDistribution,
  regionalStatisticValues,
  selectedRegionHistogramDistributions,
  selectionColor,
} from './model.js';
import { smoothHistogramPath } from './histogram-curve.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHART_WIDTH = 1000;
const CHART_HEIGHT = 100;

function probabilitySum(values: readonly number[]): string {
  return String(Math.round(values.reduce((sum, value) => sum + value, 0) * 1e12) / 1e12);
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function histogramPosition(value: number, edges: readonly number[]): number | null {
  const firstEdge = edges[0];
  const lastEdge = edges.at(-1);
  if (firstEdge === undefined || lastEdge === undefined || lastEdge <= firstEdge) return null;
  return Math.max(0, Math.min(CHART_WIDTH, ((value - firstEdge) / (lastEdge - firstEdge)) * CHART_WIDTH));
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
  globalArea.setAttribute('d', smoothHistogramPath(global.probabilities, maxProbability, true, CHART_WIDTH, CHART_HEIGHT));
  globalArea.dataset.total = String(global.total);
  globalArea.dataset.probabilitySum = probabilitySum(global.probabilities);
  const globalTitle = svgElement('title');
  globalTitle.textContent = `Global population · n=${global.total.toLocaleString('en-US')}`;
  globalArea.append(globalTitle);
  svg.append(globalArea);

  const colorRange = svgElement('g');
  colorRange.classList.add('distribution-chart__color-range');
  colorRange.dataset.visible = 'false';
  colorRange.setAttribute('aria-hidden', 'true');
  const leftOutsideRange = svgElement('rect');
  leftOutsideRange.classList.add('distribution-chart__range-outside', 'distribution-chart__range-outside--left');
  const selectedRange = svgElement('rect');
  selectedRange.classList.add('distribution-chart__range-selected');
  const rightOutsideRange = svgElement('rect');
  rightOutsideRange.classList.add('distribution-chart__range-outside', 'distribution-chart__range-outside--right');
  for (const rectangle of [leftOutsideRange, selectedRange, rightOutsideRange]) {
    rectangle.setAttribute('y', '0');
    rectangle.setAttribute('height', String(CHART_HEIGHT));
  }
  const minimumBoundary = svgElement('line');
  minimumBoundary.classList.add('distribution-chart__range-boundary', 'distribution-chart__range-boundary--min');
  const maximumBoundary = svgElement('line');
  maximumBoundary.classList.add('distribution-chart__range-boundary', 'distribution-chart__range-boundary--max');
  for (const boundary of [minimumBoundary, maximumBoundary]) {
    boundary.setAttribute('y1', '0');
    boundary.setAttribute('y2', String(CHART_HEIGHT));
  }
  colorRange.append(leftOutsideRange, selectedRange, rightOutsideRange, minimumBoundary, maximumBoundary);
  svg.append(colorRange);

  selectedDistributions.forEach((distribution, selectionIndex) => {
    const region = regionById.get(distribution.regionId);
    const color = selectionColor(selectionIndex);
    const line = svgElement('path');
    line.classList.add('distribution-chart__region');
    line.dataset.regionId = distribution.regionId;
    line.dataset.total = String(distribution.total);
    line.dataset.probabilitySum = probabilitySum(distribution.probabilities);
    line.setAttribute('d', smoothHistogramPath(distribution.probabilities, maxProbability, false, CHART_WIDTH, CHART_HEIGHT));
    line.style.setProperty('--selection-color', color);
    const title = svgElement('title');
    title.textContent = `${region?.acronym ?? distribution.regionId} · normalized within region · n=${distribution.total.toLocaleString('en-US')}`;
    line.append(title);
    svg.append(line);

    const markerValue = statistic === 'count' ? undefined : values.get(distribution.regionId);
    const numericMarkerValue = markerValue ?? Number.NaN;
    const x = !Number.isFinite(numericMarkerValue)
      ? null
      : histogramPosition(numericMarkerValue, histogram.edges);
    if (x !== null) {
      const marker = svgElement('line');
      marker.classList.add('distribution-chart__marker');
      marker.dataset.regionId = distribution.regionId;
      marker.setAttribute('x1', String(x));
      marker.setAttribute('x2', String(x));
      marker.setAttribute('y1', '0');
      marker.setAttribute('y2', String(CHART_HEIGHT));
      marker.style.setProperty('--selection-color', color);
      const markerTitle = svgElement('title');
      markerTitle.textContent = `${region?.acronym ?? distribution.regionId} ${statistic}: ${formatRegionalValue(numericMarkerValue, statistic, unit)}`;
      marker.append(markerTitle);
      svg.append(marker);
    }
  });

  const hoverMarker = svgElement('g');
  hoverMarker.classList.add('distribution-chart__hover-marker');
  hoverMarker.dataset.visible = 'false';
  const hoverLine = svgElement('line');
  hoverLine.classList.add('distribution-chart__hover-line');
  hoverLine.setAttribute('y1', '0');
  hoverLine.setAttribute('y2', String(CHART_HEIGHT));
  const hoverDot = svgElement('circle');
  hoverDot.classList.add('distribution-chart__hover-dot');
  hoverDot.setAttribute('cy', String(CHART_HEIGHT));
  hoverDot.setAttribute('r', '4');
  const hoverTitle = svgElement('title');
  hoverMarker.append(hoverLine, hoverDot, hoverTitle);
  svg.append(hoverMarker);

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
  const hoverLabel = html('span', 'distribution-chart__hover-label');
  hoverLabel.hidden = true;
  hoverLabel.setAttribute('aria-hidden', 'true');
  plot.append(svg, bins, hoverLabel);

  const firstEdge = histogram.edges[0];
  const lastEdge = histogram.edges.at(-1);
  const axis = html('div', 'distribution-chart__axis');
  const minimum = html('span', 'distribution-chart__axis-min');
  const axisUnit = html('span', 'distribution-chart__axis-unit');
  const maximum = html('span', 'distribution-chart__axis-max');
  minimum.textContent = firstEdge === undefined ? '' : formatRegionalValue(firstEdge, 'mean', null);
  axisUnit.textContent = unit ?? '';
  maximum.textContent = lastEdge === undefined ? '' : formatRegionalValue(lastEdge, 'mean', null);
  axis.setAttribute(
    'aria-label',
    `Histogram range ${minimum.textContent}${unit ? ` ${unit}` : ''} to ${maximum.textContent}${unit ? ` ${unit}` : ''}`,
  );
  axis.append(minimum, axisUnit, maximum);

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
  chart.append(meta, plot, axis, legend);
  target.replaceChildren(chart);
}

export function updateDistributionColorRange(
  target: HTMLElement,
  feature: RegionalFeaturePayload,
  range: readonly [number, number] | null,
  mode: ColorRange['mode'],
): void {
  const layer = target.querySelector<SVGGElement>('.distribution-chart__color-range');
  if (!layer) return;
  if (!range || !feature.histogram) {
    layer.dataset.visible = 'false';
    return;
  }

  const minimum = histogramPosition(range[0], feature.histogram.edges);
  const maximum = histogramPosition(range[1], feature.histogram.edges);
  if (minimum === null || maximum === null) {
    layer.dataset.visible = 'false';
    return;
  }
  const low = Math.min(minimum, maximum);
  const high = Math.max(minimum, maximum);
  const setRectangle = (selector: string, x: number, width: number): void => {
    const rectangle = layer.querySelector<SVGRectElement>(selector);
    rectangle?.setAttribute('x', String(x));
    rectangle?.setAttribute('width', String(width));
  };
  const setBoundary = (selector: string, x: number): void => {
    const boundary = layer.querySelector<SVGLineElement>(selector);
    boundary?.setAttribute('x1', String(x));
    boundary?.setAttribute('x2', String(x));
  };
  setRectangle('.distribution-chart__range-outside--left', 0, low);
  setRectangle('.distribution-chart__range-selected', low, high - low);
  setRectangle('.distribution-chart__range-outside--right', high, CHART_WIDTH - high);
  setBoundary('.distribution-chart__range-boundary--min', low);
  setBoundary('.distribution-chart__range-boundary--max', high);
  layer.dataset.minimum = String(range[0]);
  layer.dataset.maximum = String(range[1]);
  layer.dataset.mode = mode;
  layer.dataset.visible = 'true';
}

export function updateDistributionHover(
  target: HTMLElement,
  feature: RegionalFeaturePayload,
  regions: readonly RegionMetadata[],
  hoveredRegionId: string | null,
  statistic: StatisticId,
  unit: string | null,
): void {
  const marker = target.querySelector<SVGGElement>('.distribution-chart__hover-marker');
  const label = target.querySelector<HTMLElement>('.distribution-chart__hover-label');
  if (!marker || !label) return;

  const hide = (): void => {
    marker.dataset.visible = 'false';
    delete marker.dataset.regionId;
    label.hidden = true;
    delete label.dataset.regionId;
  };
  if (!hoveredRegionId || statistic === 'count' || !feature.histogram) {
    hide();
    return;
  }

  const row = feature.regionIds.indexOf(hoveredRegionId);
  const value = row < 0 ? undefined : regionalStatisticValues(feature, statistic)?.[row];
  const numericValue = value ?? Number.NaN;
  const x = !Number.isFinite(numericValue)
    ? null
    : histogramPosition(numericValue, feature.histogram.edges);
  if (x === null) {
    hide();
    return;
  }

  const line = marker.querySelector<SVGLineElement>('.distribution-chart__hover-line');
  const dot = marker.querySelector<SVGCircleElement>('.distribution-chart__hover-dot');
  const title = marker.querySelector<SVGTitleElement>('title');
  if (!line || !dot || !title) return;
  const region = regions.find(({ id }) => id === hoveredRegionId);
  const text = `${region?.acronym ?? hoveredRegionId} · ${formatRegionalValue(numericValue, statistic, unit)}`;
  line.setAttribute('x1', String(x));
  line.setAttribute('x2', String(x));
  dot.setAttribute('cx', String(x));
  title.textContent = text;
  marker.dataset.regionId = hoveredRegionId;
  marker.dataset.visible = 'true';

  const percentage = x / CHART_WIDTH * 100;
  label.textContent = text;
  label.dataset.regionId = hoveredRegionId;
  label.dataset.alignment = percentage < 15 ? 'start' : percentage > 85 ? 'end' : 'center';
  label.style.setProperty('--hover-position', `${percentage}%`);
  label.hidden = false;
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
  const distributions = selectedRegionHistogramDistributions(feature, selected);
  if (feature.histogram && distributions.length > 0) {
    const global = histogramDistribution(feature.histogram.globalCounts);
    const maxProbability = Math.max(
      0,
      ...global.probabilities,
      ...distributions.flatMap((distribution) => distribution.probabilities),
    );
    const section = html('section', 'regional-comparison__distributions');
    const heading = html('h3', 'regional-comparison__heading');
    heading.textContent = 'Normalized distributions';
    const note = html('p', 'regional-comparison__note');
    note.textContent = 'Each curve is normalized within its own population; all rows share the feature-value axis and probability scale.';
    section.append(heading, note);
    distributions.forEach((distribution, selectionIndex) => {
      const region = byId.get(distribution.regionId);
      const row = html('div', 'regional-distribution');
      row.dataset.regionId = distribution.regionId;
      row.style.setProperty('--selection-color', selectionColor(selectionIndex));
      const identity = html('div', 'regional-distribution__identity');
      const acronym = html('strong');
      acronym.textContent = region?.acronym ?? distribution.regionId;
      const name = html('span');
      name.textContent = `${region?.name ?? `Region ${distribution.regionId}`} · n=${distribution.total.toLocaleString('en-US')}`;
      identity.append(acronym, name);
      const plot = svgElement('svg');
      plot.classList.add('regional-distribution__plot');
      plot.setAttribute('viewBox', `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`);
      plot.setAttribute('preserveAspectRatio', 'none');
      plot.setAttribute('aria-label', `${region?.acronym ?? distribution.regionId} normalized distribution`);
      const globalLine = svgElement('path');
      globalLine.classList.add('regional-distribution__global');
      globalLine.setAttribute('d', smoothHistogramPath(global.probabilities, maxProbability, false, CHART_WIDTH, CHART_HEIGHT));
      const regionArea = svgElement('path');
      regionArea.classList.add('regional-distribution__region');
      regionArea.setAttribute('d', smoothHistogramPath(distribution.probabilities, maxProbability, true, CHART_WIDTH, CHART_HEIGHT));
      regionArea.dataset.probabilitySum = probabilitySum(distribution.probabilities);
      plot.append(globalLine, regionArea);
      row.append(identity, plot);
      section.append(row);
    });
    const axis = html('div', 'regional-distribution__axis');
    const firstEdge = feature.histogram.edges[0];
    const lastEdge = feature.histogram.edges.at(-1);
    const start = html('span');
    start.textContent = firstEdge === undefined ? '' : formatRegionalValue(firstEdge, 'mean', unit);
    const axisLabel = html('span');
    axisLabel.textContent = `Feature value${unit ? ` · ${unit}` : ''}`;
    const end = html('span');
    end.textContent = lastEdge === undefined ? '' : formatRegionalValue(lastEdge, 'mean', unit);
    axis.append(start, axisLabel, end);
    section.append(axis);
    wrap.append(section);
  }

  wrap.append(renderComparisonTable(feature, regions, selected, statistic, unit));
  target.replaceChildren(wrap);
}

function renderComparisonTable(
  feature: RegionalFeaturePayload,
  regions: readonly RegionMetadata[],
  selected: ReadonlySet<string>,
  statistic: StatisticId,
  unit: string | null,
): HTMLElement {
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const indexById = new Map(feature.regionIds.map((id, index) => [id, index]));
  const section = html('section', 'regional-comparison__statistics');
  const headerRow = html('div', 'regional-comparison__section-header');
  const heading = html('h3', 'regional-comparison__heading');
  heading.textContent = 'Descriptive statistics';
  const download = html('button', 'regional-comparison__download');
  download.type = 'button';
  download.dataset.downloadComparison = 'true';
  download.textContent = 'Download comparison';
  headerRow.append(heading, download);
  const note = html('p', 'regional-comparison__note');
  note.textContent = unit ? `Feature values are shown in ${unit}.` : 'Feature units are not declared for this release.';
  const scroller = html('div', 'regional-comparison__table-scroll');
  const table = html('table', 'regional-comparison__table');
  const head = document.createElement('thead');
  const header = document.createElement('tr');
  const columns = [
    ['region', 'Region'],
    ['count', 'n'],
    ['mean', 'Mean'],
    ['median', 'Median'],
    ['std', 'Std'],
    ['iqr', 'Q25–Q75'],
    ['range', 'Min–Max'],
  ] as const;
  for (const [key, label] of columns) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.dataset.statistic = key;
    cell.dataset.active = String(key === statistic);
    cell.textContent = label;
    header.append(cell);
  }
  head.append(header);
  const body = document.createElement('tbody');
  [...selected].forEach((regionId, selectionIndex) => {
    const rowIndex = indexById.get(regionId);
    const region = regionById.get(regionId);
    const row = document.createElement('tr');
    row.dataset.regionId = regionId;
    row.style.setProperty('--selection-color', selectionColor(selectionIndex));
    const identity = document.createElement('th');
    identity.scope = 'row';
    identity.textContent = region ? `${region.acronym} · ${region.name}` : regionId;
    row.append(identity);
    const value = (field: keyof RegionalFeaturePayload['statistics']): number | undefined => (
      rowIndex === undefined ? undefined : feature.statistics[field]?.[rowIndex]
    );
    appendStatisticCell(row, value('count'), 'count', 'count', unit, statistic === 'count');
    appendStatisticCell(row, value('mean'), 'mean', 'mean', null, statistic === 'mean');
    appendStatisticCell(row, value('median'), 'median', 'median', null, statistic === 'median');
    appendStatisticCell(row, value('std'), 'std', 'mean', null, false);
    appendRangeCell(row, value('q25'), value('q75'), null, false);
    appendRangeCell(row, value('min'), value('max'), null, statistic === 'min' || statistic === 'max');
    body.append(row);
  });
  if (feature.global) {
    const row = document.createElement('tr');
    row.dataset.series = 'global';
    const identity = document.createElement('th');
    identity.scope = 'row';
    identity.textContent = 'Global population';
    row.append(identity);
    appendStatisticCell(row, feature.global.count, 'count', 'count', unit, statistic === 'count');
    appendStatisticCell(row, feature.global.mean, 'mean', 'mean', null, statistic === 'mean');
    appendStatisticCell(row, feature.global.median, 'median', 'median', null, statistic === 'median');
    appendStatisticCell(row, feature.global.std, 'std', 'mean', null, false);
    appendRangeCell(row, feature.global.q25, feature.global.q75, null, false);
    appendRangeCell(row, feature.global.min, feature.global.max, null, statistic === 'min' || statistic === 'max');
    body.append(row);
  }
  table.append(head, body);
  scroller.append(table);
  section.append(headerRow, note, scroller);
  return section;
}

function appendStatisticCell(
  row: HTMLTableRowElement,
  value: number | undefined,
  field: string,
  formatStatistic: StatisticId,
  unit: string | null,
  active: boolean,
): void {
  const cell = document.createElement('td');
  cell.dataset.statistic = field;
  cell.dataset.active = String(active);
  cell.textContent = value !== undefined && Number.isFinite(value) ? formatRegionalValue(value, formatStatistic, unit) : '—';
  row.append(cell);
}

function appendRangeCell(
  row: HTMLTableRowElement,
  low: number | undefined,
  high: number | undefined,
  unit: string | null,
  active: boolean,
): void {
  const cell = document.createElement('td');
  cell.dataset.statistic = 'range';
  cell.dataset.active = String(active);
  cell.textContent = low !== undefined && high !== undefined && Number.isFinite(low) && Number.isFinite(high)
    ? `${formatRegionalValue(low, 'mean', unit)}–${formatRegionalValue(high, 'mean', unit)}`
    : '—';
  row.append(cell);
}
