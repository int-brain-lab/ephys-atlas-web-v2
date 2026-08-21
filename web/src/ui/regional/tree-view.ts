import type { RegionMetadata } from '../../data/contracts.js';
import { buildGreyMatterHierarchy } from '../../data/region-hierarchy.js';
import type { RegionOrder, StatisticId } from '../../domain/types.js';
import { html, required } from './dom.js';
import { rankRegionsByValue, regionMatchesQuery } from './model.js';
import { createRegionRow } from './row-view.js';

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
  toggleSelection(regionId: string): void;
  setRegionOrder(order: RegionOrder): void;
  hoverRegion(regionId: string | null): void;
}

export class RegionalTreeView {
  readonly search: HTMLInputElement;
  readonly source: HTMLElement;
  readonly resultCount: HTMLElement;
  private readonly pane: HTMLElement;
  private readonly searchClear: HTMLButtonElement;
  private readonly collapseAllButton: HTMLButtonElement;
  private readonly expandAllButton: HTMLButtonElement;
  private readonly treeControls: HTMLElement;
  private readonly orderButton: HTMLButtonElement;
  private readonly list: HTMLUListElement;
  private readonly regionById = new Map<string, RegionMetadata>();
  private readonly rowById = new Map<string, HTMLLIElement>();
  private readonly collapsedRegionIds = new Set<string>();
  private rovingButton: HTMLButtonElement | null = null;
  private hoveredRegionId: string | null = null;
  private currentOrder: RegionOrder = 'anatomy';

  constructor(root: ParentNode, private readonly callbacks: RegionalTreeCallbacks) {
    this.pane = required(root, '.region-pane');
    this.search = required(root, '.region-search__input');
    this.searchClear = required(root, '.region-search__clear');
    this.source = required(root, '.region-search__source');
    this.resultCount = required(root, '.region-search__count');
    this.list = required(root, '.region-list');
    this.orderButton = html('button', 'region-order');
    this.orderButton.type = 'button';
    this.treeControls = html('span', 'region-tree-controls');
    this.collapseAllButton = this.treeControl('⊟', 'Collapse all regions');
    this.expandAllButton = this.treeControl('⊞', 'Expand all regions');
    this.treeControls.append(this.collapseAllButton, this.expandAllButton);
    this.resultCount.before(this.orderButton, this.treeControls);
    this.list.setAttribute('role', 'tree');

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

  setRegions(regions: readonly RegionMetadata[]): void {
    this.regionById.clear();
    regions.forEach((region) => this.regionById.set(region.id, region));
  }

  render(
    regions: readonly RegionMetadata[],
    values: ReadonlyMap<string, number>,
    statistic: StatisticId,
    unit: string | null,
    range: readonly [number, number] | null,
    selected: ReadonlySet<string>,
    order: RegionOrder,
  ): void {
    this.setRegions(regions);
    this.currentOrder = order;
    this.syncOrderButton();
    this.list.dataset.order = order;
    const previousRovingId = this.rovingButton?.dataset.regionButton;
    const restoreFocus = document.activeElement === this.rovingButton;
    const rowModels = order === 'anatomy'
      ? buildGreyMatterHierarchy(regions)
      : rankRegionsByValue(regions, values, order).map((region) => ({
        region: { ...region, parentId: null },
        depth: 0,
        hasChildren: false,
      }));
    const rows = rowModels.map(({ region, depth, hasChildren }) =>
      createRegionRow(region, depth, hasChildren, values.get(region.id), statistic, unit, range, selected, this.collapsedRegionIds));
    this.list.replaceChildren(...rows);
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
    this.source.textContent = 'No regional values';
    this.resultCount.textContent = '0 regions';
  }

  updateHoveredRegion(regionId: string | null): void {
    if (regionId === this.hoveredRegionId) return;
    if (this.hoveredRegionId) this.rowById.get(this.hoveredRegionId)?.removeAttribute('data-hovered');
    if (regionId) this.rowById.get(regionId)?.setAttribute('data-hovered', 'true');
    this.hoveredRegionId = regionId;
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
    const query = this.search.value;
    let visible = 0;
    for (const [regionId, row] of this.rowById) {
      const region = this.regionById.get(regionId);
      const matches = region ? regionMatchesQuery(region, query) : false;
      const hiddenByCollapsedAncestor = !query.trim() && this.hasCollapsedAncestor(regionId);
      row.hidden = !matches || hiddenByCollapsedAncestor;
      if (!row.hidden) visible += 1;
    }
    this.searchClear.hidden = !query.trim();
    this.resultCount.textContent = `${visible} ${visible === 1 ? 'region' : 'regions'}`;
    this.syncTreeControls(query.trim().length > 0);
    if (this.rovingButton?.closest<HTMLLIElement>('.region-row')?.hidden) {
      const first = this.list.querySelector<HTMLButtonElement>('.region-row:not([hidden]) .region-row__button');
      if (first) this.setRovingButton(first);
    }
  };

  private readonly clearSearch = (): void => {
    this.search.value = '';
    this.filterRegions();
    this.search.focus();
  };

  private readonly cycleOrder = (): void => {
    const next: Record<RegionOrder, RegionOrder> = {
      anatomy: 'value-asc',
      'value-asc': 'value-desc',
      'value-desc': 'anatomy',
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
      anatomy: 'Value ascending',
      'value-asc': 'Value descending',
      'value-desc': 'Anatomy',
    };
    this.orderButton.dataset.order = this.currentOrder;
    this.orderButton.replaceChildren(createOrderIcon(this.currentOrder));
    this.orderButton.setAttribute(
      'aria-label',
      `Region order: ${labels[this.currentOrder]}. Activate for ${nextLabels[this.currentOrder]}.`,
    );
    this.orderButton.title = `Order: ${labels[this.currentOrder]} · Next: ${nextLabels[this.currentOrder]}`;
  }

  private readonly onTreeClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    const toggle = target?.closest<HTMLButtonElement>('[data-region-toggle]');
    if (toggle?.dataset.regionToggle) {
      this.toggleBranch(toggle.dataset.regionToggle);
      return;
    }
    const button = target?.closest<HTMLButtonElement>('[data-region-button]');
    const id = button?.dataset.regionButton;
    if (!id || this.regionById.get(id)?.mappingMember === false) return;
    this.callbacks.toggleSelection(id);
  };

  private readonly onTreeKeyDown = (event: KeyboardEvent): void => {
    const button = event.target instanceof HTMLButtonElement
      ? event.target.closest<HTMLButtonElement>('[data-region-button]')
      : null;
    if (button) this.navigateRegions(event, button);
  };

  private readonly onTreePointerOver = (event: PointerEvent): void => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-region-button]') : null;
    if (!button || (event.relatedTarget instanceof Node && button.contains(event.relatedTarget))) return;
    const id = button.dataset.regionButton;
    this.callbacks.hoverRegion(id && this.regionById.get(id)?.mappingMember !== false ? id : null);
  };

  private readonly onTreePointerOut = (event: PointerEvent): void => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-region-button]') : null;
    if (!button || (event.relatedTarget instanceof Node && button.contains(event.relatedTarget))) return;
    this.callbacks.hoverRegion(null);
  };

  private readonly onPanePointerOver = (event: PointerEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('[data-region-button]')) this.callbacks.hoverRegion(null);
  };

  private readonly onTreeFocusIn = (event: FocusEvent): void => {
    const button = event.target instanceof HTMLButtonElement ? event.target.closest<HTMLButtonElement>('[data-region-button]') : null;
    if (!button) return;
    this.setRovingButton(button);
    const id = button.dataset.regionButton;
    this.callbacks.hoverRegion(id && this.regionById.get(id)?.mappingMember !== false ? id : null);
  };

  private readonly onTreeFocusOut = (event: FocusEvent): void => {
    if (event.target instanceof HTMLButtonElement && event.target.dataset.regionButton) this.callbacks.hoverRegion(null);
  };

  private navigateRegions(event: KeyboardEvent, current: HTMLButtonElement): void {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const row = current.closest<HTMLLIElement>('.region-row');
    const regionId = row?.dataset.regionId;
    if (this.currentOrder === 'anatomy' && regionId && event.key === 'ArrowRight') {
      event.preventDefault();
      if (row.dataset.branch === 'true' && this.collapsedRegionIds.has(regionId)) this.toggleBranch(regionId);
      else {
        const child = [...this.list.querySelectorAll<HTMLLIElement>('.region-row:not([hidden])')]
          .find((candidate) => candidate.dataset.parentId === regionId);
        this.focusRegionButton(child?.querySelector<HTMLButtonElement>('.region-row__button') ?? null);
      }
      return;
    }
    if (this.currentOrder === 'anatomy' && regionId && event.key === 'ArrowLeft') {
      event.preventDefault();
      if (row.dataset.branch === 'true' && !this.collapsedRegionIds.has(regionId)) this.toggleBranch(regionId);
      else if (row.dataset.parentId) this.focusRegionButton(
        this.rowById.get(row.dataset.parentId)?.querySelector<HTMLButtonElement>('.region-row__button') ?? null,
      );
      return;
    }
    const visible = [...this.list.querySelectorAll<HTMLButtonElement>('.region-row:not([hidden]) .region-row__button')];
    if (visible.length === 0) return;
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
    this.animateTreeMutation(() => {
      if (this.collapsedRegionIds.has(regionId)) this.collapsedRegionIds.delete(regionId);
      else this.collapsedRegionIds.add(regionId);
      this.syncBranchDisclosure(row);
    });
  }

  private readonly collapseAllRegions = (): void => this.setAllBranchesExpanded(false);
  private readonly expandAllRegions = (): void => this.setAllBranchesExpanded(true);

  private setAllBranchesExpanded(expanded: boolean): void {
    this.animateTreeMutation(() => {
      for (const [id, row] of this.rowById) {
        if (row.dataset.branch !== 'true') continue;
        if (expanded) this.collapsedRegionIds.delete(id);
        else this.collapsedRegionIds.add(id);
        this.syncBranchDisclosure(row);
      }
    });
  }

  private syncBranchDisclosure(row: HTMLLIElement): void {
    const regionId = row.dataset.regionId;
    if (!regionId) return;
    const expanded = !this.collapsedRegionIds.has(regionId);
    row.setAttribute('aria-expanded', String(expanded));
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
    this.orderButton.disabled = this.rowById.size === 0;
    this.treeControls.hidden = this.currentOrder !== 'anatomy';
    if (this.currentOrder !== 'anatomy') {
      this.collapseAllButton.disabled = true;
      this.expandAllButton.disabled = true;
      return;
    }
    const branches = [...this.rowById].filter(([, row]) => row.dataset.branch === 'true');
    this.collapseAllButton.disabled = filtering || branches.length === 0 || branches.every(([id]) => this.collapsedRegionIds.has(id));
    this.expandAllButton.disabled = filtering || !branches.some(([id]) => this.collapsedRegionIds.has(id));
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

  private hasCollapsedAncestor(regionId: string): boolean {
    if (this.currentOrder !== 'anatomy') return false;
    let parentId = this.regionById.get(regionId)?.parentId;
    const visited = new Set<string>();
    while (parentId !== undefined && parentId !== null && !visited.has(parentId)) {
      if (this.collapsedRegionIds.has(parentId)) return true;
      visited.add(parentId);
      parentId = this.regionById.get(parentId)?.parentId;
    }
    return false;
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
}
