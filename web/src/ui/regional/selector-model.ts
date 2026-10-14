import type { RegionMetadata } from '../../data/contracts.js';
import { buildGreyMatterHierarchy, type RegionHierarchyRow } from '../../data/region-hierarchy.js';
import type { RegionOrder } from '../../domain/types.js';
import { rankRegionsByValue, regionSearchContext } from './model.js';

export interface SelectorInitialState {
  query?: string;
  collapsed?: readonly string[];
  selected?: readonly string[];
  order?: RegionOrder;
  multiple?: boolean;
  focus?: string | null;
  anchor?: string | null;
  values?: Readonly<Record<string, number | null>>;
}
export type SelectorEffect = { kind: 'select'; id: string; additive: boolean }
  | { kind: 'range'; ids: readonly string[]; id: string } | { kind: 'toggle'; id: string };
export interface SelectorModifiers { ctrl?: boolean; meta?: boolean; shift?: boolean; keyboard?: boolean }

/** Renderer-neutral Regions interaction state. Host selection remains authoritative
 * in the DOM adapter; standalone transitions apply the same selection policy. */
export class SelectorModel {
  private regions: readonly RegionMetadata[];
  private byId = new Map<string, RegionMetadata>();
  private hierarchy: readonly RegionHierarchyRow[];
  private rankedRows: readonly RegionHierarchyRow[] | null = null;
  readonly collapsed = new Set<string>();
  readonly searchCollapsed = new Set<string>();
  requiredExpanded: ReadonlySet<string> = new Set();
  private matches: ReadonlySet<string> = new Set();
  private retained: ReadonlySet<string> = new Set();
  private selected = new Set<string>();
  private pendingRangeSelection: string | null = null;
  private values: ReadonlyMap<string, number> = new Map();
  query = '';
  requestedOrder: RegionOrder = 'anatomy';
  multiple = false;
  focus: string | null = null;
  anchor: string | null = null;
  hover: string | null = null;

  constructor(regions: readonly RegionMetadata[] = [], initial: SelectorInitialState = {}) {
    this.regions = regions;
    this.hierarchy = buildGreyMatterHierarchy(regions);
    this.rankedRows = null;
    this.byId = new Map(regions.map((region) => [region.id, region]));
    initial.collapsed?.forEach((id) => this.collapsed.add(id));
    this.selected = new Set(initial.selected ?? []);
    this.anchor = initial.anchor ?? [...this.selected].at(-1) ?? null;
    this.focus = initial.focus ?? null;
    this.requestedOrder = initial.order ?? 'anatomy';
    this.multiple = initial.multiple ?? false;
    this.setValues(new Map(Object.entries(initial.values ?? {}).map(([id, value]) => [id, value ?? NaN])));
    this.refreshQuery(initial.query ?? '', true);
  }
  get order(): RegionOrder { return this.query ? 'anatomy' : this.requestedOrder; }
  get activeCollapsed(): Set<string> { return this.query ? this.searchCollapsed : this.collapsed; }
  get rows(): readonly RegionHierarchyRow[] {
    const hierarchy = this.hierarchy;
    if (this.order === 'anatomy') return hierarchy;
    if (this.rankedRows) return this.rankedRows;
    const leaves = new Set(hierarchy.filter(({ hasChildren }) => !hasChildren).map(({ region }) => region.id));
    this.rankedRows = rankRegionsByValue(this.regions.filter(({ id }) => leaves.has(id)), this.values, this.order)
      .map((region) => ({ region: { ...region, parentId: null }, depth: 0, hasChildren: false }));
    return this.rankedRows;
  }
  setRegions(regions: readonly RegionMetadata[]): void {
    if (regions === this.regions) return;
    this.regions = regions;
    this.hierarchy = buildGreyMatterHierarchy(regions);
    this.rankedRows = null;
    this.byId = new Map(regions.map((region) => [region.id, region]));
    this.refreshQuery(this.query, true);
  }
  setValues(values: ReadonlyMap<string, number>): void { this.values = values; this.rankedRows = null; }
  setOrder(order: RegionOrder): void {
    if (order !== this.requestedOrder) this.rankedRows = null;
    this.requestedOrder = order;
    this.reconcileFocus();
  }
  setMultiple(enabled: boolean): void { this.multiple = enabled; }
  setFocus(id: string | null): void { this.focus = id; }
  setHover(id: string | null): void {
    this.hover = id && this.rows.some(({ region }) => region.id === id)
      && this.isVisible(id) && this.byId.get(id)?.mappingMember !== false ? id : null;
  }
  setSelected(selected: ReadonlySet<string>): void {
    const serialized = JSON.stringify([...selected]);
    if (serialized !== JSON.stringify([...this.selected])) {
      if (serialized !== this.pendingRangeSelection) {
        const added = [...selected].filter((id) => !this.selected.has(id));
        this.anchor = added.at(-1) ?? [...selected].at(-1) ?? null;
      }
      this.pendingRangeSelection = null;
    }
    this.selected = new Set(selected);
    if (this.anchor && !selected.has(this.anchor)) this.anchor = [...selected].at(-1) ?? null;
  }
  setQuery(query: string): void { this.refreshQuery(query); }
  private refreshQuery(query: string, force = false): void {
    query = query.trim();
    const context = regionSearchContext(this.regions, query);
    this.matches = context.matches;
    this.retained = context.retained;
    this.requiredExpanded = query ? context.requiredExpanded : new Set();
    if (force || query !== this.query) {
      this.searchCollapsed.clear();
      if (query) for (const { region, hasChildren } of this.hierarchy) {
        if (hasChildren && !context.matches.has(region.id) && !context.requiredExpanded.has(region.id)) this.searchCollapsed.add(region.id);
      }
    }
    this.query = query;
    this.reconcileFocus();
  }
  isVisible(id: string): boolean {
    if (this.query && !this.retained.has(id)) return false;
    if (this.order !== 'anatomy') return true;
    let parent = this.byId.get(id)?.parentId;
    const visited = new Set<string>();
    while (parent != null && !visited.has(parent)) {
      if (this.activeCollapsed.has(parent)) return false;
      visited.add(parent);
      parent = this.byId.get(parent)?.parentId;
    }
    return true;
  }
  private reconcileFocus(): void {
    const visible = this.rows.filter(({ region }) => this.isVisible(region.id));
    if (!this.focus || !visible.some(({ region }) => region.id === this.focus)) this.focus = visible[0]?.region.id ?? this.focus;
    if (this.hover && !visible.some(({ region }) => region.id === this.hover)) this.hover = null;
  }
  toggleBranch(id: string): boolean {
    if (!this.rows.some(({ region, hasChildren }) => region.id === id && hasChildren) || this.requiredExpanded.has(id)) return false;
    if (this.activeCollapsed.has(id)) this.activeCollapsed.delete(id);
    else this.activeCollapsed.add(id);
    this.reconcileFocus();
    return true;
  }
  setExpanded(id: string, expanded: boolean): void {
    if (this.activeCollapsed.has(id) === expanded) this.toggleBranch(id);
  }
  setAllExpanded(expanded: boolean): void {
    for (const { region, hasChildren } of this.rows) {
      if (!hasChildren) continue;
      if (expanded || this.requiredExpanded.has(region.id)) this.activeCollapsed.delete(region.id);
      else this.activeCollapsed.add(region.id);
    }
    this.reconcileFocus();
  }
  activate(id: string, modifiers: SelectorModifiers = {}, hostOwned = false): SelectorEffect | null {
    const row = this.rows.find(({ region }) => region.id === id);
    if (!row) return null;
    if (row.hasChildren) return this.toggleBranch(id) ? { kind: 'toggle', id } : null;
    if (this.byId.get(id)?.mappingMember === false) return null;
    if (modifiers.shift && !modifiers.keyboard) {
      const parent = this.byId.get(id)?.parentId;
      if (!this.anchor || parent == null || this.byId.get(this.anchor)?.parentId !== parent) return null;
      const siblings = this.rows.filter(({ region, hasChildren }) => !hasChildren && this.isVisible(region.id)
        && this.byId.get(region.id)?.mappingMember !== false && this.byId.get(region.id)?.parentId === parent).map(({ region }) => region.id);
      const start = siblings.indexOf(this.anchor), end = siblings.indexOf(id);
      if (start < 0 || end < 0) return null;
      const ids = siblings.slice(Math.min(start, end), Math.max(start, end) + 1);
      const selected = new Set(this.selected);
      ids.forEach((value) => selected.add(value));
      const expected = JSON.stringify([...selected]);
      this.pendingRangeSelection = expected === JSON.stringify([...this.selected]) ? null : expected;
      if (!hostOwned) this.setSelected(selected);
      return { kind: 'range', ids, id };
    }
    this.anchor = id;
    const additive = Boolean(modifiers.ctrl || modifiers.meta);
    if (!hostOwned) {
      const selected = new Set(this.selected);
      if (additive || this.multiple || selected.has(id)) {
        if (selected.has(id)) selected.delete(id); else selected.add(id);
      } else { selected.clear(); selected.add(id); }
      this.setSelected(selected);
    }
    return { kind: 'select', id, additive };
  }
  navigate(key: string): void {
    const visible = this.rows.filter(({ region }) => this.isVisible(region.id));
    const row = visible.find(({ region }) => region.id === this.focus);
    if (!row || !visible.length) return;
    if (this.order === 'anatomy' && key === 'ArrowRight') {
      if (row.hasChildren && this.activeCollapsed.has(row.region.id)) this.toggleBranch(row.region.id);
      else this.focus = visible.find(({ region }) => region.parentId === row.region.id)?.region.id ?? this.focus;
    } else if (this.order === 'anatomy' && key === 'ArrowLeft') {
      if (row.hasChildren && !this.activeCollapsed.has(row.region.id)) this.toggleBranch(row.region.id);
      else this.focus = row.region.parentId ?? this.focus;
    } else {
      const index = visible.indexOf(row);
      const target = key === 'Home' ? 0 : key === 'End' ? visible.length - 1
        : key === 'ArrowDown' ? Math.min(visible.length - 1, index + 1)
        : key === 'ArrowUp' ? Math.max(0, index - 1) : index;
      this.focus = visible[target]?.region.id ?? this.focus;
    }
  }
  snapshot() {
    const rows = this.rows;
    const catalog = this.regions.map(({ id }) => id);
    const branches = new Set(rows.filter(({ hasChildren }) => hasChildren).map(({ region }) => region.id));
    return {
      matches: catalog.filter((id) => this.matches.has(id)), retained: catalog.filter((id) => this.retained.has(id)),
      visible: rows.filter(({ region }) => this.isVisible(region.id)).map(({ region }) => region.id),
      expanded: catalog.filter((id) => branches.has(id) && !this.activeCollapsed.has(id)),
      selected: [...this.selected], focus: this.focus, anchor: this.anchor,
      order: this.order, requestedOrder: this.requestedOrder, hover: this.hover,
    };
  }
}
