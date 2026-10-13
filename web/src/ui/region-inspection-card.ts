import type { ProjectionId } from '../domain/types.js';
import type { RegionTooltipModel } from './regional/model.js';
import { element } from './dom-helpers.js';

interface InspectionContent {
  model: RegionTooltipModel;
  regionId?: string;
  projectionId?: ProjectionId;
  volume?: boolean;
}

/** One retained inspection card, docked beside anatomy or below the active view. */
export class RegionInspectionCard {
  readonly element = element('details', 'region-inspection');
  private readonly summary = element('summary', 'region-inspection__summary');
  private readonly card = element('div', 'region-tooltip');
  private selected: readonly InspectionContent[] = [];
  private hovered: InspectionContent | null = null;
  private recent: InspectionContent | null = null;
  private contentKey = '';

  constructor(private readonly place: (projectionId?: ProjectionId) => { host: HTMLElement; docked: boolean }) {
    this.element.setAttribute('aria-label', 'Region inspection');
    this.element.append(this.summary, this.card);
    this.element.addEventListener('toggle', () => {
      if (this.element.dataset.placement === 'docked' && !this.element.open) this.element.open = true;
    });
    this.update();
  }

  setSelected(regions: readonly { model: RegionTooltipModel; regionId: string }[]): void {
    this.selected = regions;
    this.update();
  }

  show(content: InspectionContent): void {
    this.hovered = content;
    this.recent = content;
    this.update();
  }

  clear(projectionId?: ProjectionId): void {
    if (projectionId && (this.hovered?.projectionId ?? this.recent?.projectionId) !== projectionId) return;
    this.hovered = null;
    if (projectionId) this.recent = null;
    this.update();
  }

  reset(): void {
    this.hovered = null;
    this.recent = null;
    this.update();
  }

  update(): void {
    const content = this.hovered ?? this.selected.at(-1) ?? this.recent;
    const { host, docked } = this.place(content?.projectionId ?? this.recent?.projectionId);
    if (this.element.parentElement !== host) {
      if (!docked) this.element.open = false;
      host.append(this.element);
    }
    this.summary.tabIndex = docked ? -1 : 0;
    const placement = docked ? 'docked' : 'strip';
    if (this.element.dataset.placement !== placement) {
      this.element.dataset.placement = placement;
      this.element.open = docked;
    }
    const key = JSON.stringify([content, this.selected, this.hovered ? 'hover' : this.selected.length ? 'selected' : 'recent']);
    if (key === this.contentKey) return;
    this.contentKey = key;
    this.card.hidden = !content;
    this.element.dataset.source = this.hovered ? 'hover' : this.selected.length ? 'selected' : content ? 'recent' : 'empty';
    if (content?.regionId) this.card.dataset.regionId = content.regionId;
    else delete this.card.dataset.regionId;
    this.card.dataset.kind = content?.volume ? 'volume' : 'region';
    this.summary.replaceChildren();
    const label = element('span', 'region-inspection__label');
    label.textContent = this.hovered ? 'Inspecting' : this.selected.length > 1 ? `${this.selected.length} regions selected` : this.selected.length ? 'Selected region' : content ? 'Last inspected' : 'Hover or select a region';
    const title = element('span', 'region-inspection__title');
    title.textContent = 'Region info';
    this.summary.append(title, label);
    if (!content) {
      this.card.replaceChildren();
      return;
    }
    const { model } = content;
    const compact = element('strong', 'region-inspection__compact');
    compact.textContent = [model.acronym, model.valueText].filter(Boolean).join(' · ');
    compact.textContent = !this.hovered && this.selected.length > 1
      ? this.selected.map(({ model }) => model.acronym).join(', ') : compact.textContent;
    this.summary.append(compact);
    if (!this.hovered && this.selected.length > 1) {
      delete this.card.dataset.regionId;
      const list = element('ul', 'region-inspection__selections');
      for (const selected of this.selected) {
        const row = element('li', 'region-inspection__selection');
        row.dataset.regionId = selected.regionId;
        row.title = selected.model.name;
        const acronym = element('strong');
        acronym.textContent = selected.model.acronym;
        const value = element('span');
        value.textContent = selected.model.valueText ?? '—';
        row.append(acronym, value);
        list.append(row);
      }
      this.card.replaceChildren(list);
      return;
    }
    const identity = element('div', 'region-tooltip__identity');
    const acronym = element('strong', 'region-tooltip__acronym');
    acronym.textContent = model.acronym;
    const name = element('span', 'region-tooltip__name');
    name.textContent = model.name;
    identity.append(acronym, name);
    if (model.atlasId !== undefined) {
      const id = element('span', 'region-tooltip__id');
      id.textContent = String(model.atlasId);
      id.title = 'Allen structure ID';
      identity.append(id);
    }
    const lineage = element('div', 'region-tooltip__lineage');
    lineage.textContent = model.lineage?.join(' › ') ?? '';
    lineage.hidden = !model.lineage?.length;
    const value = element('div', 'region-tooltip__value');
    value.hidden = !model.valueText;
    if (model.valueText) {
      if (model.valueLabel) {
        const term = element('span', 'region-tooltip__value-label');
        term.textContent = model.valueLabel;
        value.append(term);
      }
      const text = element('strong', 'region-tooltip__value-text');
      text.textContent = model.valueText;
      value.append(text);
    }
    const meta = element('div', 'region-tooltip__meta');
    meta.textContent = model.meta;
    const hint = element('div', 'region-tooltip__hint');
    hint.textContent = 'Hold A for anatomy colours';
    hint.hidden = !content.volume;
    this.card.replaceChildren(identity, lineage, value, meta, hint);
  }
}
