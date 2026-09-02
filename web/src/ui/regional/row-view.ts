import type { RegionMetadata } from '../../data/contracts.js';
import type { StatisticId } from '../../domain/types.js';
import { html } from './dom.js';
import { formatRegionalValue, regionalStatisticPosition } from './model.js';

export function createRegionRow(
  region: RegionMetadata,
  depth: number,
  hasChildren: boolean,
  value: number | undefined,
  statistic: StatisticId,
  unit: string | null,
  extent: readonly [number, number] | null,
  selected: ReadonlySet<string>,
  collapsedRegionIds: ReadonlySet<string>,
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
  if (hasChildren) item.setAttribute('aria-expanded', String(!collapsedRegionIds.has(region.id)));

  const toggle = hasChildren ? html('button', 'region-row__toggle') : html('span', 'region-row__toggle-placeholder');
  if (toggle instanceof HTMLButtonElement) {
    toggle.type = 'button';
    toggle.tabIndex = -1;
    toggle.dataset.regionToggle = region.id;
    toggle.textContent = '›';
    toggle.setAttribute('aria-label', `${collapsedRegionIds.has(region.id) ? 'Expand' : 'Collapse'} ${region.acronym}`);
    toggle.setAttribute('aria-expanded', String(!collapsedRegionIds.has(region.id)));
  } else toggle.setAttribute('aria-hidden', 'true');

  const button = html('button', 'region-row__button');
  button.type = 'button';
  button.tabIndex = -1;
  button.dataset.regionButton = region.id;
  button.setAttribute('aria-pressed', String(selected.has(region.id)));
  button.setAttribute('aria-label', `${region.acronym}, ${region.name}`);
  if (region.mappingMember === false) button.setAttribute('aria-disabled', 'true');

  const disclosure = html('span', 'region-row__disclosure');
  if (region.colorHex) {
    disclosure.classList.add('region-row__swatch');
    disclosure.style.backgroundColor = region.colorHex;
    disclosure.title = `Official atlas color ${region.colorHex}`;
  } else disclosure.textContent = '·';
  disclosure.setAttribute('aria-hidden', 'true');

  const identity = html('span', 'region-row__identity');
  const acronym = html('span', 'region-row__acronym');
  acronym.textContent = region.acronym;
  const name = html('span', 'region-row__name');
  name.textContent = region.name;
  name.title = region.name;
  identity.append(acronym, name);

  const valueNode = html('span', 'region-row__value');
  if (region.mappingMember === false) valueNode.setAttribute('aria-hidden', 'true');
  else if (value === undefined || !Number.isFinite(value)) valueNode.setAttribute('aria-label', 'Value unavailable');
  else {
    const formatted = formatRegionalValue(value, statistic, unit);
    valueNode.title = `${statistic}: ${formatted}`;
    valueNode.setAttribute('aria-label', `${statistic} ${formatted}`);
    const track = html('span', 'region-row__track');
    const dot = html('span', 'region-row__dot');
    dot.style.setProperty('--region-value', `${(regionalStatisticPosition(value, extent) ?? 0.5) * 100}%`);
    dot.setAttribute('aria-hidden', 'true');
    track.append(dot);
    valueNode.append(track);
  }
  button.append(disclosure, identity, valueNode);
  item.append(toggle, button);
  return item;
}
