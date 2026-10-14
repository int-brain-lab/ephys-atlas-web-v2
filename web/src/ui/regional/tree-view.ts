import type { RegionMetadata } from '../../data/contracts.js';
import { SelectorModel } from './selector-model.js';
import type { RegionOrder, StatisticId } from '../../domain/types.js';
import { html, required } from './dom.js';
import { formatRegionalValue, regionHighlightSpans, regionalStatisticExtent } from './model.js';
import { createRegionRow, type RegionalValueColorbar } from './row-view.js';
import { OperationStatus } from '../operation-status.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createOrderIcon(order: RegionOrder): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('region-order__icon');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-width', '1.35');
  path.setAttribute('d', {
    anatomy: 'M8 2.25v3M3.25 7.5V5.25h9.5V7.5M3.25 7.5v2.25M8 5.25v4.5M12.75 7.5v2.25M1.75 9.75h3v3h-3zM6.5 9.75h3v3h-3zM11.25 9.75h3v3h-3z',
    'value-asc': 'M3.25 12.5v-9m-2 2 2-2 2 2M7 4h2M7 8h4M7 12h6',
    'value-desc': 'M3.25 3.5v9m-2-2 2 2 2-2M7 4h6M7 8h4M7 12h2',
  }[order]);
  svg.append(path);
  return svg;
}

export interface RegionalTreeCallbacks {
  selectRegion(regionId: string, additive: boolean): void;
  selectRegionRange(regionIds: readonly string[], targetRegionId: string): void;
  setMultiSelection(enabled: boolean): void;
  setAutoSlice(enabled: boolean): void;
  setRegionOrder(order: RegionOrder): void;
  hoverRegion(regionId: string | null): void;
}

export class RegionalTreeView {
  readonly search: HTMLInputElement;
  readonly source: HTMLElement;
  readonly resultCount: HTMLElement;
  private readonly pane: HTMLElement;
  private readonly autoSlice: HTMLButtonElement;
  private readonly autoSliceTooltip: HTMLElement;
  private readonly autoSliceStatus: HTMLElement;
  private readonly multiSelection: HTMLButtonElement;
  private readonly multiSelectionTooltip: HTMLElement;
  private readonly searchClear: HTMLButtonElement;
  private readonly collapseAllButton: HTMLButtonElement;
  private readonly expandAllButton: HTMLButtonElement;
  private readonly treeControls: HTMLElement;
  private readonly orderButton: HTMLButtonElement;
  private readonly list: HTMLUListElement;
  private readonly statisticDomain: HTMLElement;
  private readonly regionById = new Map<string, RegionMetadata>();
  private readonly rowById = new Map<string, HTMLLIElement>();
  private readonly selector = new SelectorModel();
  private displayOrder: RegionOrder = 'anatomy';
  private rovingButton: HTMLButtonElement | null = null;
  private hoveredRegionId: string | null = null;
  private localHoverRegionId: string | null = null;
  private currentOrder: RegionOrder = 'anatomy';
  private valueState: 'ready' | 'loading' | 'error' | 'anatomy' | 'empty' = 'ready';
  private readonly valueStatus = new OperationStatus('inline');
  private lastRender: {
    regions: readonly RegionMetadata[];
    values: ReadonlyMap<string, number>;
    statistic: StatisticId;
    unit: string | null;
    selection: string;
    order: RegionOrder;
    displayOrder: RegionOrder;
    colorbar: RegionalValueColorbar | null;
    colorbarKey: string;
    valueState: 'ready' | 'loading' | 'error' | 'anatomy' | 'empty';
  } | null = null;

  constructor(root: ParentNode, private readonly callbacks: RegionalTreeCallbacks) {
    this.pane = required(root, '.region-pane');
    this.search = required(root, '.region-search__input');
    this.searchClear = required(root, '.region-search__clear');
    this.source = required(root, '.region-search__source');
    this.resultCount = required(root, '.region-search__count');
    this.list = required(root, '.region-list');
    this.statisticDomain = html('div', 'region-statistic-domain');
    this.statisticDomain.setAttribute('role', 'note');
    this.list.before(this.statisticDomain);
    this.orderButton = html('button', 'region-order');
    this.orderButton.type = 'button';
    this.treeControls = html('span', 'region-tree-controls');
    this.collapseAllButton = this.treeControl('⊟', 'Collapse all regions');
    this.expandAllButton = this.treeControl('⊞', 'Expand all regions');
    this.treeControls.append(this.collapseAllButton, this.expandAllButton);
    this.resultCount.before(this.treeControls);
    this.resultCount.after(this.orderButton);
    this.list.setAttribute('role', 'tree');
    this.list.setAttribute('aria-multiselectable', 'true');
    const selectionControls = html('span', 'region-selection-controls');
    [this.multiSelection, this.multiSelectionTooltip] = this.selectionControl(
      'Select multiple', 'multiple',
    );
    [this.autoSlice, this.autoSliceTooltip] = this.selectionControl('Auto-slice', 'target');
    selectionControls.append(this.multiSelection.parentElement!, this.autoSlice.parentElement!);
    this.treeControls.after(selectionControls);
    this.syncMultiSelection(false);
    this.autoSliceStatus = html('span', 'region-auto-slice-status');
    this.autoSliceStatus.setAttribute('role', 'status');
    this.autoSliceStatus.hidden = true;
    this.search.closest('.region-search')!.append(this.autoSliceStatus);
    this.updateAutoSlice(true, '');
    this.multiSelection.addEventListener('click', this.onSelectionModeChange);
    this.autoSlice.addEventListener('click', this.onAutoSliceChange);

    this.search.addEventListener('input', this.filterRegions);
    this.searchClear.addEventListener('click', this.clearSearch);
    this.orderButton.addEventListener('click', this.cycleOrder);
    this.collapseAllButton.addEventListener('click', this.collapseAllRegions);
    this.expandAllButton.addEventListener('click', this.expandAllRegions);
    this.list.addEventListener('click', this.onTreeClick);
    this.list.addEventListener('keydown', this.onTreeKeyDown);
    this.list.addEventListener('pointerover', this.onTreePointerOver);
    this.list.addEventListener('pointerout', this.onTreePointerOut);
    this.list.addEventListener('focusin', this.onTreeFocusIn);
    this.list.addEventListener('focusout', this.onTreeFocusOut);
    this.pane.addEventListener('pointerover', this.onPanePointerOver);
  }

  destroy(): void {
    this.autoSlice.removeEventListener('click', this.onAutoSliceChange);
    this.multiSelection.removeEventListener('click', this.onSelectionModeChange);
    this.search.removeEventListener('input', this.filterRegions);
    this.searchClear.removeEventListener('click', this.clearSearch);
    this.orderButton.removeEventListener('click', this.cycleOrder);
    this.collapseAllButton.removeEventListener('click', this.collapseAllRegions);
    this.expandAllButton.removeEventListener('click', this.expandAllRegions);
    this.list.removeEventListener('click', this.onTreeClick);
    this.list.removeEventListener('keydown', this.onTreeKeyDown);
    this.list.removeEventListener('pointerover', this.onTreePointerOver);
    this.list.removeEventListener('pointerout', this.onTreePointerOut);
    this.list.removeEventListener('focusin', this.onTreeFocusIn);
    this.list.removeEventListener('focusout', this.onTreeFocusOut);
    this.pane.removeEventListener('pointerover', this.onPanePointerOver);
  }

  updateAutoSlice(enabled: boolean, status: string): void {
    this.autoSlice.setAttribute('aria-pressed', String(enabled));
    this.autoSliceTooltip.textContent = `Auto-slice ${enabled ? 'on for selections from Regions. Click to keep slices fixed.' : 'off. Click to follow selections from Regions.'} Clicking a brain view always keeps slices fixed.${status ? ` ${status}` : ''}`;
    this.autoSliceStatus.textContent = status;
    this.autoSliceStatus.classList.toggle('region-auto-slice-status--quiet', status === 'Finding slices for the selected region…');
    this.autoSliceStatus.hidden = !status;
  }

  private readonly onAutoSliceChange = (): void => {
    this.callbacks.setAutoSlice(this.autoSlice.getAttribute('aria-pressed') !== 'true');
  };

  setRegions(regions: readonly RegionMetadata[]): void {
    this.selector.setRegions(regions);
    this.regionById.clear();
    regions.forEach((region) => this.regionById.set(region.id, region));
  }

  render(
    regions: readonly RegionMetadata[],
    values: ReadonlyMap<string, number>,
    statistic: StatisticId,
    unit: string | null,
    selected: ReadonlySet<string>,
    order: RegionOrder,
    valueState: 'ready' | 'loading' | 'error' | 'anatomy' | 'empty' = 'ready',
    colorbar: RegionalValueColorbar | null = null,
  ): void {
    this.source.title = this.source.textContent ?? '';
    // Volume switches have no regional values: keep the anatomical DOM, focus,
    // collapsed branches and scroll position intact while summaries change.
    unit = values.size ? unit : null;
    const selection = JSON.stringify([...selected]);
    const last = this.lastRender;
    const displayOrder = this.search.value.trim() ? 'anatomy' : order;
    const colorbarKey = JSON.stringify(colorbar);
    this.selector.setSelected(selected);
    if (last && last.regions === regions && last.statistic === statistic && last.unit === unit
      && last.order === order && last.displayOrder === displayOrder && last.colorbarKey === colorbarKey && last.valueState === valueState && last.values.size === values.size
      && [...values].every(([id, value]) => last.values.has(id) && Object.is(last.values.get(id), value))) {
      // Selection does not change hierarchy, values, filtering or keyboard focus.
      // Touch only rows whose membership changed instead of recreating every value.
      const previous = new Set(JSON.parse(last.selection) as string[]);
      for (const id of new Set([...previous, ...selected])) {
        if (previous.has(id) === selected.has(id)) continue;
        const row = this.rowById.get(id);
        if (!row) continue;
        const pressed = String(selected.has(id));
        row.dataset.selected = pressed;
        row.setAttribute('aria-selected', pressed);
        if (row.dataset.branch !== 'true') {
          row.querySelector('.region-row__button')?.setAttribute('aria-pressed', pressed);
        }
      }
      this.lastRender = { ...last, values, selection };
      return;
    }
    this.lastRender = { regions, values, statistic, unit, selection, order, displayOrder, colorbar, colorbarKey, valueState };
    this.valueState = valueState;
    this.setRegions(regions);
    this.currentOrder = order;
    this.displayOrder = displayOrder;
    this.syncOrderButton();
    this.list.dataset.order = displayOrder;
    const extent = regionalStatisticExtent(values);
    const statisticLabel = statistic === 'count' ? 'Count' : `${statistic[0]?.toUpperCase() ?? ''}${statistic.slice(1)}`;
    const domainText = extent
      ? `${statisticLabel}: ${formatRegionalValue(extent[0], statistic, null)}–${formatRegionalValue(extent[1], statistic, null)}${unit && statistic !== 'count' ? ` ${unit}` : ''}`
      : `${statisticLabel}: no finite regional values`;
    if (valueState === 'ready') this.statisticDomain.textContent = domainText;
    else {
      this.valueStatus.update({
        state: valueState === 'anatomy' ? 'empty' : valueState,
        title: valueState === 'loading' ? 'Loading regional values…'
          : valueState === 'error' ? 'Regional values unavailable'
          : valueState === 'anatomy' ? 'Anatomy only · regional values are not defined in volume mode'
          : 'No regional feature loaded',
      });
      if (this.valueStatus.element.parentElement !== this.statisticDomain) {
        this.statisticDomain.replaceChildren(this.valueStatus.element);
      }
    }
    const previousRovingId = this.rovingButton?.dataset.regionButton;
    const restoreFocus = document.activeElement === this.rovingButton;
    this.selector.setValues(values);
    this.selector.setOrder(order);
    this.selector.setQuery(this.search.value);
    const rowModels = this.selector.rows;
    const retainRows = last?.regions === regions && last.displayOrder === displayOrder && this.rowById.size === rowModels.length;
    const rows = rowModels.map(({ region, depth, hasChildren }) => {
      const next = createRegionRow(region, depth, hasChildren, values.get(region.id), statistic, unit, extent, selected, this.activeCollapsedRegionIds, colorbar);
      if (valueState !== 'ready') {
        next.querySelector('.region-row__value')?.setAttribute('aria-hidden', 'true');
        next.querySelector('.region-row__button')?.removeAttribute('title');
      }
      const existing = retainRows ? this.rowById.get(region.id) : undefined;
      if (!existing) return next;
      existing.dataset.missing = next.dataset.missing!;
      existing.dataset.selected = next.dataset.selected!;
      const existingButton = existing.querySelector<HTMLButtonElement>('.region-row__button');
      if (existingButton) existingButton.title = next.querySelector<HTMLButtonElement>('.region-row__button')?.title ?? '';
      existing.setAttribute('aria-selected', String(selected.has(region.id)));
      if (!hasChildren) existing.querySelector('.region-row__button')?.setAttribute('aria-pressed', String(selected.has(region.id)));
      existing.querySelector('.region-row__value')?.replaceWith(next.querySelector('.region-row__value')!);
      return existing;
    });
    if (!retainRows || rows.some((row, index) => this.list.children[index] !== row)) {
      this.list.replaceChildren(...rows);
    }
    this.rowById.clear();
    rows.forEach((row) => {
      const id = row.dataset.regionId;
      if (id) this.rowById.set(id, row);
    });
    if (this.hoveredRegionId) this.rowById.get(this.hoveredRegionId)?.setAttribute('data-hovered', 'true');
    this.rovingButton = previousRovingId
      ? this.rowById.get(previousRovingId)?.querySelector<HTMLButtonElement>('.region-row__button') ?? null
      : null;
    this.rovingButton ??= rows[0]?.querySelector<HTMLButtonElement>('.region-row__button') ?? null;
    if (this.rovingButton) this.rovingButton.tabIndex = 0;
    if (restoreFocus) this.rovingButton?.focus();
    this.filterRegions();
  }

  renderEmpty(text: string): void {
    this.lastRender = null;
    this.rowById.clear();
    this.regionById.clear();
    this.rovingButton = null;
    this.hoveredRegionId = null;
    this.collapseAllButton.disabled = true;
    this.expandAllButton.disabled = true;
    this.orderButton.disabled = true;
    this.treeControls.hidden = true;
    const item = html('li', 'selected-regions__empty');
    item.textContent = text;
    this.list.replaceChildren(item);
    this.statisticDomain.textContent = '';
    this.source.textContent = 'No regional values';
    this.resultCount.textContent = '0 regions';
  }

  updateHoveredRegion(regionId: string | null): void {
    if (regionId === this.hoveredRegionId) return;
    if (this.hoveredRegionId) this.rowById.get(this.hoveredRegionId)?.removeAttribute('data-hovered');
    if (regionId) this.rowById.get(regionId)?.setAttribute('data-hovered', 'true');
    this.hoveredRegionId = regionId;
  }

  private selectionControl(label: string, icon: 'target' | 'multiple'): [HTMLButtonElement, HTMLElement] {
    const wrapper = html('span', 'region-selection-control');
    const button = html('button', 'region-selection-controls__button');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    const tooltip = html('span', 'region-selection-control__tooltip');
    tooltip.id = icon === 'target' ? 'auto-slice-hint' : 'multi-selection-hint';
    tooltip.setAttribute('role', 'tooltip');
    button.setAttribute('aria-describedby', tooltip.id);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.35');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('d', icon === 'target'
      ? 'M8 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4M8 1v3M8 12v3M1 8h3M12 8h3'
      : 'M6 2h7v7M3 5h7v8H3zM5 9l1.5 1.5L9 8');
    svg.append(path);
    button.append(svg);
    wrapper.append(button, tooltip);
    wrapper.addEventListener('pointerenter', () => delete wrapper.dataset.dismissed);
    wrapper.addEventListener('focusin', () => delete wrapper.dataset.dismissed);
    wrapper.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') wrapper.dataset.dismissed = 'true';
    });
    return [button, tooltip];
  }

  private syncMultiSelection(enabled: boolean): void {
    this.selector.setMultiple(enabled);
    this.multiSelection.setAttribute('aria-pressed', String(enabled));
    this.multiSelectionTooltip.textContent = `Select multiple ${enabled ? 'on. Click to select one region at a time.' : 'off. Click to compare multiple regions.'} Ctrl/Cmd-click toggles selection. Shift-click adds a visible sibling range. Branches expand; leaves select.`;
  }

  private treeControl(text: string, label: string): HTMLButtonElement {
    const button = html('button', 'region-tree-controls__button');
    button.type = 'button';
    button.textContent = text;
    button.title = label;
    button.setAttribute('aria-label', label);
    return button;
  }

  private readonly filterRegions = (): void => {
    const query = this.search.value.trim();
    const last = this.lastRender;
    const desiredOrder = query ? 'anatomy' : this.currentOrder;
    if (last && this.displayOrder !== desiredOrder) {
      this.render(last.regions, last.values, last.statistic, last.unit,
        new Set(JSON.parse(last.selection) as string[]), last.order, last.valueState, last.colorbar);
      return;
    }
    this.selector.setQuery(query);
    if (this.localHoverRegionId && !this.selector.hover) this.hoverRegion(null);
    const matches = new Set(this.selector.snapshot().matches);
    let visible = 0;
    let matchCount = 0;
    for (const [regionId, row] of this.rowById) {
      const region = this.regionById.get(regionId);
      if (!region) continue;
      this.highlightText(row.querySelector('.region-row__acronym'), region.acronym, query);
      this.highlightText(row.querySelector('.region-row__name'), region.name, query);
      row.hidden = !this.selector.isVisible(regionId);
      if (matches.has(regionId)) matchCount += 1;
      if (!row.hidden) visible += 1;
      if (row.dataset.branch === 'true') this.syncBranchDisclosure(row);
    }
    this.searchClear.hidden = !query;
    this.resultCount.textContent = query
      ? `${matchCount} ${matchCount === 1 ? 'match' : 'matches'}`
      : `${visible} ${visible === 1 ? 'region' : 'regions'}`;
    this.syncOrderButton();
    this.syncTreeControls(query.length > 0);
    if (this.rovingButton?.closest<HTMLLIElement>('.region-row')?.hidden) {
      const first = this.list.querySelector<HTMLButtonElement>('.region-row:not([hidden]) .region-row__button');
      if (first) this.setRovingButton(first);
    }
  };

  private get activeCollapsedRegionIds(): Set<string> {
    return this.selector.activeCollapsed;
  }

  private highlightText(element: Element | null, text: string, query: string): void {
    if (!element) return;
    element.replaceChildren();
    const points = Array.from(text);
    let position = 0;
    for (const [start, end] of regionHighlightSpans(text, query)) {
      element.append(document.createTextNode(points.slice(position, start).join('')));
      const mark = html('mark', 'region-search__match');
      mark.textContent = points.slice(start, end).join('');
      element.append(mark);
      position = end;
    }
    element.append(document.createTextNode(points.slice(position).join('')));
  }

  private readonly clearSearch = (): void => {
    this.search.value = '';
    this.filterRegions();
    this.search.focus();
  };

  private readonly cycleOrder = (): void => {
    const next: Record<RegionOrder, RegionOrder> = {
      anatomy: 'value-desc',
      'value-asc': 'anatomy',
      'value-desc': 'value-asc',
    };
    this.callbacks.setRegionOrder(next[this.currentOrder]);
  };

  private syncOrderButton(): void {
    const labels: Record<RegionOrder, string> = {
      anatomy: 'Anatomy',
      'value-asc': 'Value ↑',
      'value-desc': 'Value ↓',
    };
    const nextLabels: Record<RegionOrder, string> = {
      anatomy: 'Value descending',
      'value-asc': 'Anatomy',
      'value-desc': 'Value ascending',
    };
    this.orderButton.dataset.order = this.displayOrder;
    this.orderButton.replaceChildren(createOrderIcon(this.displayOrder));
    if (this.search.value.trim()) {
      const label = `Region order: Anatomy during search. Clear search to restore ${labels[this.currentOrder]}.`;
      this.orderButton.setAttribute('aria-label', label);
      this.orderButton.title = label;
      return;
    }
    this.orderButton.setAttribute(
      'aria-label',
      `Region order: ${labels[this.currentOrder]}. Activate for ${nextLabels[this.currentOrder]}.`,
    );
    this.orderButton.title = `Order: ${labels[this.currentOrder]} · Next: ${nextLabels[this.currentOrder]}`;
  }

  private readonly onSelectionModeChange = (): void => {
    const enabled = this.multiSelection.getAttribute('aria-pressed') !== 'true';
    this.syncMultiSelection(enabled);
    this.callbacks.setMultiSelection(enabled);
  };

  private readonly onTreeClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const toggle = target?.closest<HTMLButtonElement>('[data-region-toggle]');
    if (toggle?.dataset.regionToggle) {
      this.toggleBranch(toggle.dataset.regionToggle);
      return;
    }
    const button = target?.closest<HTMLButtonElement>('[data-region-button]');
    const id = button?.dataset.regionButton;
    if (id) this.activateRegion(id, event.ctrlKey || event.metaKey, event.shiftKey);
  };

  private readonly onTreeKeyDown = (event: KeyboardEvent): void => {
    const button = event.target instanceof HTMLButtonElement
      ? event.target.closest<HTMLButtonElement>('[data-region-button]')
      : null;
    if (!button) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const id = button.dataset.regionButton;
      if (id) this.activateRegion(id, event.ctrlKey || event.metaKey);
    } else this.navigateRegions(event, button);
  };

  private activateRegion(id: string, additive: boolean, range = false): void {
    if (this.rowById.get(id)?.dataset.branch === 'true') {
      this.toggleBranch(id);
      return;
    }
    const effect = this.selector.activate(id, { ctrl: additive, shift: range }, true);
    if (effect?.kind === 'range') this.callbacks.selectRegionRange(effect.ids, effect.id);
    else if (effect?.kind === 'select') this.callbacks.selectRegion(effect.id, effect.additive);
  }

  private hoverRegion(id: string | null): void {
    this.selector.setHover(id);
    this.localHoverRegionId = this.selector.hover;
    this.callbacks.hoverRegion(this.selector.hover);
  }

  private readonly onTreePointerOver = (event: PointerEvent): void => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-region-button]') : null;
    if (!button || (event.relatedTarget instanceof Node && button.contains(event.relatedTarget))) return;
    const id = button.dataset.regionButton;
    this.hoverRegion(id ?? null);
  };

  private readonly onTreePointerOut = (event: PointerEvent): void => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-region-button]') : null;
    if (!button || (event.relatedTarget instanceof Node && button.contains(event.relatedTarget))) return;
    this.hoverRegion(null);
  };

  private readonly onPanePointerOver = (event: PointerEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('[data-region-button]')) this.hoverRegion(null);
  };

  private readonly onTreeFocusIn = (event: FocusEvent): void => {
    const button = event.target instanceof HTMLButtonElement ? event.target.closest<HTMLButtonElement>('[data-region-button]') : null;
    if (!button) return;
    this.setRovingButton(button);
    const id = button.dataset.regionButton;
    this.hoverRegion(id ?? null);
  };

  private readonly onTreeFocusOut = (event: FocusEvent): void => {
    if (event.target instanceof HTMLButtonElement && event.target.dataset.regionButton) this.hoverRegion(null);
  };

  private navigateRegions(event: KeyboardEvent, current: HTMLButtonElement): void {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const id = current.dataset.regionButton;
    if (!id) return;
    this.selector.setFocus(id);
    const branch = current.closest<HTMLLIElement>('.region-row')?.dataset.branch === 'true';
    const folding = this.displayOrder === 'anatomy' && branch
      && ((event.key === 'ArrowRight' && this.activeCollapsedRegionIds.has(id))
        || (event.key === 'ArrowLeft' && !this.activeCollapsedRegionIds.has(id)));
    if (folding) this.animateTreeMutation(() => this.selector.navigate(event.key));
    else this.selector.navigate(event.key);
    const focus = this.selector.focus;
    if (focus !== id || (this.displayOrder === 'anatomy' && ['ArrowLeft', 'ArrowRight'].includes(event.key))) {
      event.preventDefault();
      this.focusRegionButton(focus ? this.rowById.get(focus)?.querySelector<HTMLButtonElement>('.region-row__button') ?? null : null);
    }
  }

  private toggleBranch(regionId: string): void {
    const row = this.rowById.get(regionId);
    if (!row || row.dataset.branch !== 'true' || this.selector.requiredExpanded.has(regionId)) return;
    this.animateTreeMutation(() => {
      this.selector.toggleBranch(regionId);
      this.syncBranchDisclosure(row);
    });
  }

  private readonly collapseAllRegions = (): void => this.setAllBranchesExpanded(false);
  private readonly expandAllRegions = (): void => this.setAllBranchesExpanded(true);

  private setAllBranchesExpanded(expanded: boolean): void {
    this.animateTreeMutation(() => {
      this.selector.setAllExpanded(expanded);
      for (const row of this.rowById.values()) {
        if (row.dataset.branch === 'true') this.syncBranchDisclosure(row);
      }
    });
  }

  private syncBranchDisclosure(row: HTMLLIElement): void {
    const regionId = row.dataset.regionId;
    if (!regionId) return;
    const expanded = !this.activeCollapsedRegionIds.has(regionId);
    row.setAttribute('aria-expanded', String(expanded));
    row.querySelector('.region-row__button')?.setAttribute('aria-expanded', String(expanded));
    const toggle = row.querySelector<HTMLButtonElement>('.region-row__toggle');
    if (!toggle) return;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} ${this.regionById.get(regionId)?.acronym ?? regionId}`);
  }

  private animateTreeMutation(mutation: () => void): void {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const before = reduceMotion ? new Map<string, number>() : this.captureVisibleRowTops();
    mutation();
    this.filterRegions();
    if (!reduceMotion) this.animateVisibleRowReflow(before);
  }

  private syncTreeControls(filtering: boolean): void {
    this.orderButton.disabled = filtering || this.rowById.size === 0 || this.valueState !== 'ready';
    this.treeControls.hidden = this.displayOrder !== 'anatomy';
    if (this.displayOrder !== 'anatomy') {
      this.collapseAllButton.disabled = true;
      this.expandAllButton.disabled = true;
      return;
    }
    const branches = [...this.rowById].filter(([, row]) => row.dataset.branch === 'true');
    this.collapseAllButton.disabled = filtering || branches.length === 0 || branches.every(([id]) => this.activeCollapsedRegionIds.has(id));
    this.expandAllButton.disabled = filtering || !branches.some(([id]) => this.activeCollapsedRegionIds.has(id));
  }

  private captureVisibleRowTops(): Map<string, number> {
    for (const row of this.rowById.values()) row.getAnimations().forEach((animation) => animation.finish());
    const viewport = this.pane.querySelector<HTMLElement>('.region-pane__browser')?.getBoundingClientRect();
    const tops = new Map<string, number>();
    for (const [id, row] of this.rowById) {
      if (row.hidden) continue;
      const rect = row.getBoundingClientRect();
      if (!viewport || (rect.bottom >= viewport.top - 40 && rect.top <= viewport.bottom + 40)) tops.set(id, rect.top);
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

  private setRovingButton(button: HTMLButtonElement): void {
    if (this.rovingButton === button) return;
    if (this.rovingButton) this.rovingButton.tabIndex = -1;
    button.tabIndex = 0;
    this.rovingButton = button;
    this.selector.setFocus(button.dataset.regionButton ?? null);
  }

  private focusRegionButton(button: HTMLButtonElement | null): void {
    if (!button) return;
    this.setRovingButton(button);
    button.focus();
  }
}
