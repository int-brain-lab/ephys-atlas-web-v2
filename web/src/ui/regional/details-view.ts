import type { DistributionBinning, FeaturePayload, RegionMetadata, RegionalFeaturePayload } from '../../data/contracts.js';
import type { ResolvedPresentationScale } from '../../application/presentation-scale.js';
import type { ColorRange, StatisticId } from '../../domain/types.js';
import type { ScaleSpec } from '../../domain/scale-spec.js';
import { scaleNormalize } from '../../domain/scale-spec.js';
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

function histogramPosition(
  value: number,
  edges: readonly number[],
  axisScale: ScaleSpec,
): number | null {
  const firstEdge = edges[0];
  const lastEdge = edges.at(-1);
  if (firstEdge === undefined || lastEdge === undefined) return null;
  const normalized = scaleNormalize(value, [firstEdge, lastEdge], axisScale);
  return normalized === null || normalized < 0 || normalized > 1
    ? null
    : normalized * CHART_WIDTH;
}

function histogramNormalizedPosition(
  value: number,
  edges: readonly number[],
  axisScale: ScaleSpec,
): number | null {
  const firstEdge = edges[0];
  const lastEdge = edges.at(-1);
  return firstEdge === undefined || lastEdge === undefined
    ? null
    : scaleNormalize(value, [firstEdge, lastEdge], axisScale);
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
  feature: FeaturePayload,
  unit: string | null,
  featureDescription: string,
): void {
  if (feature.representation === 'regional' && !feature.global) {
    target.replaceChildren();
    return;
  }
  const fields: readonly (readonly [string, number | null | undefined, StatisticId])[] = feature.representation === 'regional'
    ? [
      ['Observations', feature.global?.count, 'count'],
      ['Mean', feature.global?.mean, 'mean'],
      ['Median', feature.global?.median, 'median'],
      ['Std. deviation', feature.global?.std, 'mean'],
    ]
    : [
      ['Valid voxels', feature.summary.validVoxelCount, 'count'],
      ['Mean', feature.summary.validStatistics.mean, 'mean'],
      ['Median', feature.summary.validStatistics.median, 'median'],
      ['Std. deviation', feature.summary.validStatistics.std, 'mean'],
    ];
  const list = html('dl', 'feature-summary');
  for (const [label, value, statistic] of fields) {
    if (value === undefined || value === null || !Number.isFinite(value)) continue;
    const card = html('div', 'feature-summary__item');
    const term = html('dt', 'feature-summary__label');
    term.textContent = label;
    const description = html('dd', 'feature-summary__value');
    description.textContent = formatRegionalValue(value, statistic, unit);
    card.append(term, description);
    list.append(card);
  }
  const content = html('div', 'feature-summary-content');
  const summaryNote = feature.representation === 'volume'
    ? `${feature.summary.totalVoxelCount.toLocaleString('en-US')} grid voxels: ${feature.summary.validVoxelCount.toLocaleString('en-US')} valid, ${feature.summary.outsideVoxelCount.toLocaleString('en-US')} outside, and ${feature.summary.missingVoxelCount.toLocaleString('en-US')} missing. Statistics and distribution use valid voxels only.`
    : '';
  if (featureDescription || summaryNote) {
    const description = html('p', 'feature-summary__description');
    description.textContent = [featureDescription, summaryNote].filter(Boolean).join(' ');
    content.append(description);
  }
  content.append(list);
  target.replaceChildren(content);
}

export function renderDistribution(
  target: HTMLElement,
  feature: FeaturePayload,
  selected: ReadonlySet<string>,
  regions: readonly RegionMetadata[],
  statistic: StatisticId,
  unit: string | null,
  fixture: boolean,
  presentationScale: ResolvedPresentationScale,
): void {
  const regionalFeature = feature.representation === 'regional' ? feature : null;
  const histogram = presentationScale.histogram;
  if (!histogram || histogram.global.binCounts.length === 0) {
    target.replaceChildren(message('Histogram unavailable for this feature'));
    return;
  }
  const global = histogramDistribution(histogram.global);
  const selectedDistributions = regionalFeature ? selectedRegionHistogramDistributions(regionalFeature, selected, histogram) : [];
  const maxProbability = Math.max(
    0,
    ...global.probabilities,
    ...selectedDistributions.flatMap((distribution) => distribution.probabilities),
  );
  const values = regionalFeature ? buildRegionalValueMap(regionalFeature, statistic) : new Map<string, number>();
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const chart = html('div', 'distribution-chart');
  chart.dataset.fixture = String(fixture);
  chart.dataset.axisScale = presentationScale.effectiveScale;
  chart.dataset.distributionDomain = presentationScale.effectiveDistributionDomain;
  const meta = html('div', 'distribution-chart__meta');
  const label = html('span');
  label.textContent = `${regionalFeature ? 'Observation' : 'Valid-voxel'} distribution${unit ? ` · ${unit}` : ''}`;
  const population = html('span');
  population.textContent = regionalFeature
    ? regionalFeature.population ?? `${regions.length} regions`
    : 'valid voxels only';
  const scaleControl = html('div', 'distribution-chart__scale-control');
  scaleControl.setAttribute('role', 'group');
  scaleControl.setAttribute('aria-label', 'Value scale');
  for (const [scale, text] of [['linear', 'Linear'], ['log', 'Log'], ['symlog', 'Signed log']] as const) {
    const button = html('button', 'distribution-chart__scale-button');
    button.type = 'button';
    button.dataset.valueScale = scale;
    button.textContent = text;
    button.setAttribute('aria-pressed', String(presentationScale.effectiveScale === scale));
    if (!presentationScale.availableScales.includes(scale)) {
      button.disabled = true;
      button.title = presentationScale.unavailableScaleReasons[scale] ?? `${text} is unavailable.`;
    } else if (presentationScale.selection === 'auto' && presentationScale.effectiveScale === scale) {
      button.title = `${text} is the release-recommended default for this feature.`;
    }
    scaleControl.append(button);
  }
  const domainControl = html('div', 'distribution-chart__domain-control');
  domainControl.setAttribute('role', 'group');
  domainControl.setAttribute('aria-label', 'Distribution domain');
  for (const [domain, text] of [['full', 'Full'], ['focused', 'Focused']] as const) {
    const button = html('button', 'distribution-chart__domain-button');
    button.type = 'button';
    button.dataset.distributionDomain = domain;
    button.textContent = text;
    button.setAttribute('aria-pressed', String(presentationScale.effectiveDistributionDomain === domain));
    if (!presentationScale.availableDistributionDomains.includes(domain)) {
      button.disabled = true;
      button.title = presentationScale.unavailableDistributionReasons[domain] ?? `${text} is unavailable.`;
    } else if (presentationScale.distributionSelection === 'auto' && presentationScale.effectiveDistributionDomain === domain) {
      button.title = `${text} is the release-recommended distribution domain for this feature.`;
    }
    domainControl.append(button);
  }
  meta.append(label, population, scaleControl, domainControl);
  const plot = html('div', 'distribution-chart__plot');
  const svg = svgElement('svg');
  svg.classList.add('distribution-chart__svg');
  svg.setAttribute('viewBox', `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute(
    'aria-label',
    regionalFeature ? 'Normalized global and selected-region distributions' : 'Normalized valid-voxel distribution',
  );
  const globalArea = svgElement('path');
  globalArea.classList.add('distribution-chart__global');
  globalArea.setAttribute('d', smoothHistogramPath(global.probabilities, maxProbability, true, CHART_WIDTH, CHART_HEIGHT));
  globalArea.dataset.total = String(global.total);
  globalArea.dataset.probabilitySum = probabilitySum(global.probabilities);
  const globalTitle = svgElement('title');
  const globalLabel = regionalFeature ? 'Global population' : 'Valid voxels';
  globalTitle.textContent = `${globalLabel} · n=${global.total.toLocaleString('en-US')}`;
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
      : histogramPosition(numericMarkerValue, histogram.edges, presentationScale.effectiveScaleSpec);
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
  histogram.global.binCounts.forEach((count, bin) => {
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

  const tails = html('div', 'distribution-chart__tails');
  tails.dataset.visible = String(global.underflowCount > 0 || global.overflowCount > 0);
  if (global.underflowCount > 0) {
    const underflow = html('span', 'distribution-chart__tail distribution-chart__tail--underflow');
    underflow.textContent = `Below ${minimum.textContent}: ${global.underflowCount.toLocaleString('en-US')} (${(global.underflowProbability * 100).toFixed(2)}%)`;
    tails.append(underflow);
  }
  if (global.overflowCount > 0) {
    const overflow = html('span', 'distribution-chart__tail distribution-chart__tail--overflow');
    overflow.textContent = `Above ${maximum.textContent}: ${global.overflowCount.toLocaleString('en-US')} (${(global.overflowProbability * 100).toFixed(2)}%)`;
    tails.append(overflow);
  }

  const rangeNote = html('div', 'distribution-chart__range-note');
  rangeNote.dataset.visible = 'false';
  rangeNote.hidden = true;

  const legend = html('div', 'distribution-chart__legend');
  const globalLegend = html('span', 'distribution-chart__legend-item');
  globalLegend.dataset.series = 'global';
  globalLegend.textContent = `${regionalFeature ? 'Global' : 'Valid voxels'} · n=${global.total.toLocaleString('en-US')}`;
  legend.append(globalLegend);
  selectedDistributions.forEach((distribution, selectionIndex) => {
    const item = html('span', 'distribution-chart__legend-item');
    item.dataset.regionId = distribution.regionId;
    item.style.setProperty('--selection-color', selectionColor(selectionIndex));
    const tailCount = distribution.underflowCount + distribution.overflowCount;
    item.textContent = `${regionById.get(distribution.regionId)?.acronym ?? distribution.regionId} · n=${distribution.total.toLocaleString('en-US')}${tailCount > 0 ? ` · ${tailCount.toLocaleString('en-US')} outside focus` : ''}`;
    legend.append(item);
  });
  chart.append(meta, plot, axis, tails, rangeNote, legend);
  target.replaceChildren(chart);
}

export function updateDistributionColorRange(
  target: HTMLElement,
  _feature: FeaturePayload,
  histogram: DistributionBinning | undefined,
  scale: ScaleSpec,
  range: readonly [number, number] | null,
  mode: ColorRange['mode'],
): void {
  const layer = target.querySelector<SVGGElement>('.distribution-chart__color-range');
  const note = target.querySelector<HTMLElement>('.distribution-chart__range-note');
  if (!layer) return;
  const hideNote = (): void => {
    if (!note) return;
    note.dataset.visible = 'false';
    note.hidden = true;
    note.textContent = '';
  };
  if (!range || !histogram) {
    layer.dataset.visible = 'false';
    hideNote();
    return;
  }

  const minimum = histogramNormalizedPosition(range[0], histogram.edges, scale);
  const maximum = histogramNormalizedPosition(range[1], histogram.edges, scale);
  if (minimum === null || maximum === null) {
    layer.dataset.visible = 'false';
    if (note && histogram.domain.kind === 'focused') {
      note.textContent = 'Color range is not valid on this value scale.';
      note.dataset.visible = 'true';
      note.hidden = false;
    } else hideNote();
    return;
  }
  const low = Math.min(minimum, maximum);
  const high = Math.max(minimum, maximum);
  const visibleLow = Math.max(0, low);
  const visibleHigh = Math.min(1, high);
  const position = (value: number): 'below' | 'inside' | 'above' => (
    value < 0 ? 'below' : value > 1 ? 'above' : 'inside'
  );
  const minimumPosition = position(minimum);
  const maximumPosition = position(maximum);
  layer.dataset.minimum = String(range[0]);
  layer.dataset.maximum = String(range[1]);
  layer.dataset.minimumPosition = minimumPosition;
  layer.dataset.maximumPosition = maximumPosition;
  layer.dataset.mode = mode;
  if (visibleHigh < visibleLow) {
    layer.dataset.visible = 'false';
  } else {
    layer.dataset.visible = 'true';
  }
  const setRectangle = (selector: string, x: number, width: number): void => {
    const rectangle = layer.querySelector<SVGRectElement>(selector);
    rectangle?.setAttribute('x', String(x));
    rectangle?.setAttribute('width', String(width));
  };
  const setBoundary = (selector: string, normalized: number): void => {
    const boundary = layer.querySelector<SVGLineElement>(selector);
    if (!boundary) return;
    const visible = normalized >= 0 && normalized <= 1;
    boundary.setAttribute('visibility', visible ? 'visible' : 'hidden');
    if (!visible) return;
    boundary.setAttribute('x1', String(normalized * CHART_WIDTH));
    boundary.setAttribute('x2', String(normalized * CHART_WIDTH));
  };
  setRectangle('.distribution-chart__range-outside--left', 0, visibleLow * CHART_WIDTH);
  setRectangle('.distribution-chart__range-selected', visibleLow * CHART_WIDTH, Math.max(0, visibleHigh - visibleLow) * CHART_WIDTH);
  setRectangle('.distribution-chart__range-outside--right', visibleHigh * CHART_WIDTH, Math.max(0, 1 - visibleHigh) * CHART_WIDTH);
  setBoundary('.distribution-chart__range-boundary--min', minimum);
  setBoundary('.distribution-chart__range-boundary--max', maximum);

  const below = minimumPosition === 'below' || maximumPosition === 'below';
  const above = minimumPosition === 'above' || maximumPosition === 'above';
  if (note && histogram.domain.kind === 'focused' && (below || above)) {
    const relation = visibleHigh < visibleLow
      ? below ? 'lies below' : 'lies above'
      : below && above ? 'extends below and above' : below ? 'extends below' : 'extends above';
    note.textContent = `Color range ${relation} the Focused interval.`;
    note.dataset.visible = 'true';
    note.hidden = false;
  } else hideNote();
}

export function updateDistributionHover(
  target: HTMLElement,
  feature: RegionalFeaturePayload,
  histogram: DistributionBinning | undefined,
  scale: ScaleSpec,
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
  if (!hoveredRegionId || statistic === 'count' || !histogram) {
    hide();
    return;
  }

  const row = feature.regionIds.indexOf(hoveredRegionId);
  const value = row < 0 ? undefined : regionalStatisticValues(feature, statistic)?.[row];
  const numericValue = value ?? Number.NaN;
  const x = !Number.isFinite(numericValue)
    ? null
    : histogramPosition(numericValue, histogram.edges, scale);
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
