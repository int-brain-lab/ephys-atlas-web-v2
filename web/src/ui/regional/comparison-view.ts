import type { DistributionBinning, RegionMetadata, RegionalFeaturePayload } from '../../data/contracts.js';
import type { StatisticId } from '../../domain/types.js';
import { html } from './dom.js';
import {
  formatRegionalValue,
  histogramDistribution,
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

export function renderAnalysis(
  target: HTMLElement,
  feature: RegionalFeaturePayload,
  regions: readonly RegionMetadata[],
  selected: ReadonlySet<string>,
  values: ReadonlyMap<string, number>,
  statistic: StatisticId,
  unit: string | null,
  fixture: boolean,
  binning: DistributionBinning | undefined,
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
  wrap.append(renderComparisonTable(feature, regions, selected, statistic, unit, binning));
  target.replaceChildren(wrap);
}

function renderComparisonTable(
  feature: RegionalFeaturePayload,
  regions: readonly RegionMetadata[],
  selected: ReadonlySet<string>,
  statistic: StatisticId,
  unit: string | null,
  binning: DistributionBinning | undefined,
): HTMLElement {
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const indexById = new Map(feature.regionIds.map((id, index) => [id, index]));
  const section = html('section', 'regional-comparison__statistics');
  const headerRow = html('div', 'regional-comparison__section-header');
  const download = html('button', 'regional-comparison__download');
  download.type = 'button';
  download.dataset.downloadComparison = 'true';
  download.textContent = 'Download comparison';
  headerRow.append(download);
  const note = html('p', 'regional-comparison__note');
  const unitNote = unit ? `Feature values are shown in ${unit}.` : 'Feature units are not declared for this release.';
  note.textContent = `Each curve uses its complete population as the denominator; Focused distributions report observations outside the visible interval as exact tails. All rows share the feature-value axis and probability scale. ${unitNote}`;
  const scroller = html('div', 'regional-comparison__table-scroll');
  const table = html('table', 'regional-comparison__table');
  const caption = document.createElement('caption');
  caption.textContent = 'Normalized distributions and descriptive statistics for selected regions and the global population';
  const distributions = new Map(
    selectedRegionHistogramDistributions(feature, selected, binning).map((distribution) => [distribution.regionId, distribution]),
  );
  const globalDistribution = binning ? histogramDistribution(binning.global) : null;
  const maxProbability = Math.max(
    0,
    ...(globalDistribution?.probabilities ?? []),
    ...[...distributions.values()].flatMap((distribution) => distribution.probabilities),
  );
  const head = document.createElement('thead');
  const header = document.createElement('tr');
  const columns = [
    ['region', 'Region'],
    ['distribution', 'Distribution'],
    ['count', 'n'],
    ['mean', 'Mean'],
    ['median', 'Median'],
    ['std', 'Std'],
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
    row.classList.add('regional-distribution');
    row.style.setProperty('--selection-color', selectionColor(selectionIndex));
    const identity = document.createElement('th');
    identity.scope = 'row';
    identity.textContent = region ? `${region.acronym} · ${region.name}` : regionId;
    row.append(identity);
    appendDistributionCell(
      row,
      distributions.get(regionId),
      globalDistribution?.probabilities,
      maxProbability,
      `${region?.acronym ?? regionId} normalized distribution`,
      false,
    );
    const value = (field: keyof RegionalFeaturePayload['statistics']): number | undefined => (
      rowIndex === undefined ? undefined : feature.statistics[field]?.[rowIndex]
    );
    appendStatisticCell(row, value('count'), 'count', 'count', unit, statistic === 'count');
    appendStatisticCell(row, value('mean'), 'mean', 'mean', null, statistic === 'mean');
    appendStatisticCell(row, value('median'), 'median', 'median', null, statistic === 'median');
    appendStatisticCell(row, value('std'), 'std', 'mean', null, false);
    appendRangeCell(row, value('min'), value('max'), null, statistic === 'min' || statistic === 'max');
    body.append(row);
  });
  if (feature.global) {
    const row = document.createElement('tr');
    row.dataset.series = 'global';
    row.classList.add('regional-distribution');
    const identity = document.createElement('th');
    identity.scope = 'row';
    identity.textContent = 'Global population';
    row.append(identity);
    appendDistributionCell(
      row,
      globalDistribution ?? undefined,
      undefined,
      maxProbability,
      'Global population normalized distribution',
      true,
    );
    appendStatisticCell(row, feature.global.count, 'count', 'count', unit, statistic === 'count');
    appendStatisticCell(row, feature.global.mean, 'mean', 'mean', null, statistic === 'mean');
    appendStatisticCell(row, feature.global.median, 'median', 'median', null, statistic === 'median');
    appendStatisticCell(row, feature.global.std, 'std', 'mean', null, false);
    appendRangeCell(row, feature.global.min, feature.global.max, null, statistic === 'min' || statistic === 'max');
    body.append(row);
  }
  table.append(caption, head, body);
  if (binning) {
    table.append(renderDistributionAxis(binning, unit, columns.length));
  }
  scroller.append(table);
  section.append(headerRow, note, scroller);
  return section;
}

function appendDistributionCell(
  row: HTMLTableRowElement,
  distribution: ReturnType<typeof histogramDistribution> | undefined,
  globalProbabilities: readonly number[] | undefined,
  maxProbability: number,
  accessibleLabel: string,
  global: boolean,
): void {
  const probabilities = distribution?.probabilities;
  const cell = document.createElement('td');
  cell.classList.add('regional-comparison__distribution-cell');
  cell.dataset.statistic = 'distribution';
  if (!probabilities || probabilities.length === 0) {
    cell.textContent = '—';
    row.append(cell);
    return;
  }
  const plot = svgElement('svg');
  plot.classList.add('regional-distribution__plot');
  plot.setAttribute('viewBox', `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`);
  plot.setAttribute('preserveAspectRatio', 'none');
  plot.setAttribute('role', 'img');
  plot.setAttribute('aria-label', accessibleLabel);
  if (globalProbabilities) {
    const globalLine = svgElement('path');
    globalLine.classList.add('regional-distribution__global');
    globalLine.setAttribute('d', smoothHistogramPath(globalProbabilities, maxProbability, false, CHART_WIDTH, CHART_HEIGHT));
    plot.append(globalLine);
  }
  const populationArea = svgElement('path');
  populationArea.classList.add(global ? 'regional-distribution__population' : 'regional-distribution__region');
  populationArea.setAttribute('d', smoothHistogramPath(probabilities, maxProbability, true, CHART_WIDTH, CHART_HEIGHT));
  populationArea.dataset.probabilitySum = probabilitySum(probabilities);
  plot.append(populationArea);
  cell.append(plot);
  if (distribution && (distribution.underflowCount > 0 || distribution.overflowCount > 0)) {
    const tails = html('span', 'regional-distribution__tails');
    tails.textContent = `tails: ${distribution.underflowCount.toLocaleString('en-US')} below · ${distribution.overflowCount.toLocaleString('en-US')} above`;
    cell.append(tails);
  }
  row.append(cell);
}

function renderDistributionAxis(
  binning: DistributionBinning,
  unit: string | null,
  columnCount: number,
): HTMLTableSectionElement {
  const foot = document.createElement('tfoot');
  const row = document.createElement('tr');
  const label = document.createElement('th');
  label.scope = 'row';
  label.textContent = 'Feature value';
  const cell = document.createElement('td');
  const axis = html('div', 'regional-distribution__axis');
  const firstEdge = binning.edges[0];
  const lastEdge = binning.edges.at(-1);
  axis.setAttribute('aria-label', `Feature-value axis${unit ? ` in ${unit}` : ''}`);
  const start = html('span');
  start.textContent = firstEdge === undefined ? '' : formatRegionalValue(firstEdge, 'mean', null);
  const axisLabel = html('span');
  axisLabel.textContent = unit ?? '';
  const end = html('span');
  end.textContent = lastEdge === undefined ? '' : formatRegionalValue(lastEdge, 'mean', null);
  axis.append(start, axisLabel, end);
  cell.append(axis);
  const remainder = document.createElement('td');
  remainder.colSpan = columnCount - 2;
  row.append(label, cell, remainder);
  foot.append(row);
  return foot;
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
