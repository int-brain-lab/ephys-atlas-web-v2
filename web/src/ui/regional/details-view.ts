import type { FeaturePayload, RegionMetadata } from '../../data/contracts.js';
import type { StatisticId } from '../../domain/types.js';
import { html } from './dom.js';
import { buildRegionalValueMap, formatRegionalValue, selectionColor } from './model.js';

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
