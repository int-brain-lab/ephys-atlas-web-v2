import { ComparisonSession, type ComparisonItemState } from '../application/comparison-session.js';
import { reconcileComparison, type ComparisonMode, type ComparisonState } from '../domain/comparison.js';
import type { SliceAxis } from '../core/spatial.js';
import {
  SYNTHETIC_COMPARISON_SCENARIOS,
  SYNTHETIC_NORMALIZATION_ID,
  SyntheticComparisonPort,
  type SyntheticComparisonScenario,
  type SyntheticPlanePayload,
} from './synthetic-comparison-port.js';
import './multi-feature-lab.css';

const GALLERY_TILE_WIDTH = 250;
const GALLERY_ROW_HEIGHT = 238;
const PROFILE_ROW_HEIGHT = 48;
const OVERSCAN_ROWS = 1;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  result.className = className;
  return result;
}

function button(label: string, className = ''): HTMLButtonElement {
  const result = element('button', className);
  result.type = 'button';
  result.textContent = label;
  return result;
}

function formatValue(value: number | null, digits = 2): string {
  return value === null ? 'Unavailable' : value.toFixed(digits);
}

class MultiFeatureLab {
  private readonly port = new SyntheticComparisonPort();
  private readonly session = new ComparisonSession(this.port, () => this.paintVisible(), 4);
  private readonly app = element('main', 'comparison-lab');
  private readonly scenarioSelect = element('select', 'comparison-lab__select');
  private readonly search = element('input', 'comparison-lab__search');
  private readonly summary = element('div', 'comparison-lab__summary');
  private readonly canvas = element('section', 'comparison-lab__canvas');
  private readonly modeButtons = new Map<ComparisonMode, HTMLButtonElement>();
  private readonly orientationButtons = new Map<SliceAxis, HTMLButtonElement>();
  private scenario: SyntheticComparisonScenario = SYNTHETIC_COMPARISON_SCENARIOS[0]!;
  private state: ComparisonState;
  private filteredIds: readonly string[] = [];
  private visibleIds: readonly string[] = [];
  private itemHost: HTMLElement | null = null;
  private scrollHost: HTMLElement | null = null;
  private stopMode: () => void = () => undefined;
  private pinned = new Set<string>();

  constructor(private readonly root: HTMLElement) {
    this.state = {
      dataset: this.scenario.release.dataset,
      scope: { kind: 'all' },
      mode: 'gallery',
      orientation: 'coronal',
      target: this.scenario.target,
      normalizationId: SYNTHETIC_NORMALIZATION_ID,
      activeFeatureId: null,
      pinnedFeatureIds: [],
    };
    this.buildShell();
    this.activateScenario(this.scenario);
  }

  dispose(): void {
    this.stopMode();
    this.stopMode = () => undefined;
    this.itemHost = null;
    this.scrollHost = null;
    this.session.dispose();
  }

  private buildShell(): void {
    document.title = 'Multi-feature comparison UX lab';
    const header = element('header', 'comparison-lab__header');
    const titleBlock = element('div');
    const eyebrow = element('p', 'comparison-lab__eyebrow');
    eyebrow.textContent = 'IBL Ephys Atlas · development workbench';
    const title = element('h1');
    title.textContent = 'Multi-feature comparison UX lab';
    const subtitle = element('p', 'comparison-lab__subtitle');
    subtitle.textContent = 'Test Focus, virtualized Gallery, and Profile before product integration.';
    titleBlock.append(eyebrow, title, subtitle);
    const badges = element('div', 'comparison-lab__badges');
    for (const label of ['Development only', 'Synthetic demonstration data']) {
      const badge = element('span', 'comparison-lab__badge');
      badge.textContent = label;
      badges.append(badge);
    }
    header.append(titleBlock, badges);

    const controls = element('aside', 'comparison-lab__controls');
    controls.setAttribute('aria-label', 'Lab controls');
    const scenarioLabel = element('label', 'comparison-lab__field');
    scenarioLabel.append('Scenario', this.scenarioSelect);
    this.scenarioSelect.setAttribute('aria-label', 'Synthetic scenario');
    for (const item of SYNTHETIC_COMPARISON_SCENARIOS) {
      const option = element('option');
      option.value = item.id;
      option.textContent = item.label;
      this.scenarioSelect.append(option);
    }
    this.scenarioSelect.addEventListener('change', () => {
      const selected = SYNTHETIC_COMPARISON_SCENARIOS.find(({ id }) => id === this.scenarioSelect.value);
      if (selected) this.activateScenario(selected);
    });

    const searchLabel = element('label', 'comparison-lab__field');
    this.search.type = 'search';
    this.search.placeholder = 'Filter features';
    this.search.setAttribute('aria-label', 'Filter synthetic features');
    this.search.addEventListener('input', () => this.reconcileAndRender());
    searchLabel.append('Filter', this.search);

    const modeGroup = this.segmented('Comparison mode', ['focus', 'gallery', 'profile'], (value) => {
      this.state = { ...this.state, mode: value as ComparisonMode };
      this.renderMode();
    });
    for (const item of modeGroup.querySelectorAll<HTMLButtonElement>('button')) {
      this.modeButtons.set(item.dataset.value as ComparisonMode, item);
    }
    const orientationGroup = this.segmented('Slice orientation', ['coronal', 'sagittal', 'horizontal'], (value) => {
      this.state = { ...this.state, orientation: value as SliceAxis };
      this.renderMode();
    });
    for (const item of orientationGroup.querySelectorAll<HTMLButtonElement>('button')) {
      this.orientationButtons.set(item.dataset.value as SliceAxis, item);
    }

    const note = element('section', 'comparison-lab__note');
    note.innerHTML = '<strong>Encoding</strong><span>Shared symmetric z-score scale (−3 to +3)</span><small>Explicit synthetic parameters; Q17 remains unresolved for real data.</small>';
    controls.append(scenarioLabel, searchLabel, modeGroup, orientationGroup, note, this.summary);

    const body = element('div', 'comparison-lab__body');
    body.append(controls, this.canvas);
    this.app.append(header, body);
    this.root.replaceChildren(this.app);
  }

  private segmented(label: string, values: readonly string[], changed: (value: string) => void): HTMLElement {
    const field = element('section', 'comparison-lab__field');
    const heading = element('span');
    heading.textContent = label;
    const group = element('div', 'comparison-lab__segments');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    for (const value of values) {
      const item = button(value[0]!.toUpperCase() + value.slice(1));
      item.dataset.value = value;
      item.addEventListener('click', () => changed(value));
      group.append(item);
    }
    field.append(heading, group);
    return field;
  }

  private activateScenario(next: SyntheticComparisonScenario): void {
    this.scenario = next;
    this.port.useScenario(next);
    this.search.value = '';
    this.pinned.clear();
    this.state = {
      ...this.state,
      dataset: next.release.dataset,
      target: next.target,
      scope: { kind: 'all' },
      activeFeatureId: null,
      pinnedFeatureIds: [],
    };
    this.reconcileAndRender();
  }

  private reconcileAndRender(): void {
    const resolved = reconcileComparison(this.state, this.scenario.release);
    this.state = resolved.state;
    const query = this.search.value.trim().toLocaleLowerCase();
    const byId = new Map(this.scenario.features.map((feature) => [feature.id, feature]));
    this.filteredIds = resolved.featureIds.filter((id) => {
      const feature = byId.get(id);
      return !query || feature?.label.toLocaleLowerCase().includes(query)
        || feature?.group.toLocaleLowerCase().includes(query);
    });
    const excluded = this.scenario.features.length - resolved.featureIds.length;
    this.summary.innerHTML = '';
    const description = element('p');
    description.textContent = this.scenario.description;
    const counts = element('dl', 'comparison-lab__counts');
    const entries: ReadonlyArray<readonly [string, string]> = [
      ['Scope', this.scenario.features.length.toLocaleString()],
      ['Compatible', resolved.featureIds.length.toLocaleString()],
      ['Filtered', this.filteredIds.length.toLocaleString()],
      ['Excluded', excluded.toLocaleString()],
    ];
    for (const [label, value] of entries) {
      const term = element('dt'); term.textContent = label;
      const data = element('dd'); data.textContent = value;
      counts.append(term, data);
    }
    this.summary.append(description, counts);
    this.renderMode();
  }

  private renderMode(): void {
    this.stopMode();
    this.stopMode = () => undefined;
    for (const [mode, item] of this.modeButtons) item.setAttribute('aria-pressed', String(mode === this.state.mode));
    for (const [axis, item] of this.orientationButtons) item.setAttribute('aria-pressed', String(axis === this.state.orientation));
    this.visibleIds = [];
    this.itemHost = null;
    this.scrollHost = null;
    this.canvas.replaceChildren();
    this.canvas.dataset.mode = this.state.mode;

    const heading = element('header', 'comparison-lab__canvas-header');
    const title = element('h2');
    title.textContent = this.state.mode === 'focus' ? 'Focus · close spatial comparison'
      : this.state.mode === 'gallery' ? 'Gallery · scan spatial patterns'
        : 'Profile · compare at the shared cursor';
    const meta = element('span');
    meta.textContent = `${this.state.orientation} · ML −0.24 / AP −1.20 / DV −3.67 mm`;
    heading.append(title, meta);
    this.canvas.append(heading);

    if (this.filteredIds.length === 0) {
      const empty = element('p', 'comparison-lab__empty');
      empty.textContent = 'No compatible features match this filter.';
      this.canvas.append(empty);
      this.scheduleVisible([]);
      return;
    }
    if (this.state.mode === 'focus') this.renderFocus();
    else if (this.state.mode === 'gallery') this.renderGallery();
    else this.renderProfile();
  }

  private renderFocus(): void {
    const focus = element('div', 'comparison-lab__focus');
    this.itemHost = focus;
    this.canvas.append(focus);
    const ordered = [...this.pinned, ...this.filteredIds].filter((id, index, ids) => ids.indexOf(id) === index);
    this.scheduleVisible(ordered.slice(0, 3));
  }

  private renderGallery(): void {
    const viewport = element('div', 'comparison-lab__virtual comparison-lab__virtual--gallery');
    viewport.setAttribute('aria-label', 'Virtualized feature gallery');
    const spacer = element('div', 'comparison-lab__spacer');
    const items = element('div', 'comparison-lab__virtual-items');
    spacer.append(items);
    viewport.append(spacer);
    this.itemHost = items;
    this.scrollHost = viewport;
    this.canvas.append(viewport);
    const update = () => {
      const columns = Math.max(1, Math.floor(viewport.clientWidth / GALLERY_TILE_WIDTH));
      const rows = Math.ceil(this.filteredIds.length / columns);
      spacer.style.height = `${rows * GALLERY_ROW_HEIGHT}px`;
      const firstRow = Math.max(0, Math.floor(viewport.scrollTop / GALLERY_ROW_HEIGHT) - OVERSCAN_ROWS);
      const visibleRows = Math.ceil(viewport.clientHeight / GALLERY_ROW_HEIGHT) + OVERSCAN_ROWS * 2;
      const start = firstRow * columns;
      const end = Math.min(this.filteredIds.length, (firstRow + visibleRows) * columns);
      items.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
      items.style.top = `${firstRow * GALLERY_ROW_HEIGHT}px`;
      this.scheduleVisible(this.filteredIds.slice(start, end));
    };
    viewport.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    this.stopMode = () => {
      viewport.removeEventListener('scroll', update);
      observer.disconnect();
    };
    requestAnimationFrame(update);
  }

  private renderProfile(): void {
    const viewport = element('div', 'comparison-lab__virtual comparison-lab__virtual--profile');
    viewport.setAttribute('aria-label', 'Virtualized feature profile');
    const spacer = element('div', 'comparison-lab__spacer');
    const items = element('div', 'comparison-lab__virtual-items');
    spacer.style.height = `${this.filteredIds.length * PROFILE_ROW_HEIGHT}px`;
    spacer.append(items);
    viewport.append(spacer);
    this.itemHost = items;
    this.scrollHost = viewport;
    this.canvas.append(viewport);
    const update = () => {
      const first = Math.max(0, Math.floor(viewport.scrollTop / PROFILE_ROW_HEIGHT) - 2);
      const count = Math.ceil(viewport.clientHeight / PROFILE_ROW_HEIGHT) + 4;
      items.style.top = `${first * PROFILE_ROW_HEIGHT}px`;
      this.scheduleVisible(this.filteredIds.slice(first, first + count));
    };
    viewport.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    this.stopMode = () => {
      viewport.removeEventListener('scroll', update);
      observer.disconnect();
    };
    requestAnimationFrame(update);
  }

  private scheduleVisible(ids: readonly string[]): void {
    const key = ids.join('\u0000');
    if (key === this.visibleIds.join('\u0000')) {
      this.paintVisible();
      return;
    }
    this.visibleIds = [...ids];
    this.session.setVisible({
      dataset: this.scenario.release.dataset,
      target: this.scenario.target,
      normalizationId: SYNTHETIC_NORMALIZATION_ID,
      orientation: this.state.orientation,
      cursor: { xUm: -239, yUm: -1200, zUm: -3668 },
    }, this.visibleIds);
  }

  private paintVisible(): void {
    if (!this.itemHost) return;
    const snapshot = this.session.snapshot();
    this.itemHost.replaceChildren(...snapshot.items.map((item) => (
      this.state.mode === 'profile' ? this.profileRow(item) : this.mapCard(item)
    )));
    if (this.state.mode === 'gallery') {
      for (const card of this.itemHost.children) (card as HTMLElement).style.height = `${GALLERY_ROW_HEIGHT - 12}px`;
    }
  }

  private mapCard(item: ComparisonItemState<SyntheticPlanePayload>): HTMLElement {
    const card = element('article', 'comparison-lab__card');
    card.dataset.featureId = item.featureId;
    card.dataset.status = item.status;
    const header = element('header');
    const feature = this.scenario.features.find(({ id }) => id === item.featureId);
    const title = element('h3'); title.textContent = feature?.label ?? item.featureId;
    const pin = button(this.pinned.has(item.featureId) ? 'Pinned' : 'Pin', 'comparison-lab__pin');
    pin.setAttribute('aria-pressed', String(this.pinned.has(item.featureId)));
    pin.addEventListener('click', () => {
      if (this.pinned.has(item.featureId)) this.pinned.delete(item.featureId);
      else this.pinned.add(item.featureId);
      this.renderMode();
    });
    header.append(title, pin);
    card.append(header);
    if (item.status !== 'ready') {
      const state = element('div', 'comparison-lab__card-state');
      state.setAttribute('role', 'status');
      state.textContent = item.status === 'error' ? item.error : item.status === 'loading' ? 'Loading synthetic plane…' : 'Queued';
      card.append(state);
      return card;
    }
    const map = element('div', 'comparison-lab__map');
    for (const value of item.payload.cells) {
      const cell = element('span');
      if (value === null) cell.dataset.missing = 'true';
      else cell.style.setProperty('--z', String((value + 3) / 6));
      map.append(cell);
    }
    const detail = element('div', 'comparison-lab__card-detail');
    detail.innerHTML = `<span>${item.payload.group}</span><strong>z ${formatValue(item.payload.zScore)}</strong><span>${formatValue(item.payload.nativeValue)} ${item.payload.unit}</span>`;
    if (item.payload.note) {
      const note = element('small'); note.textContent = item.payload.note; detail.append(note);
    }
    card.append(map, detail);
    return card;
  }

  private profileRow(item: ComparisonItemState<SyntheticPlanePayload>): HTMLElement {
    const row = element('article', 'comparison-lab__profile-row');
    row.dataset.featureId = item.featureId;
    row.dataset.status = item.status;
    const feature = this.scenario.features.find(({ id }) => id === item.featureId);
    const label = element('strong'); label.textContent = feature?.label ?? item.featureId;
    const track = element('div', 'comparison-lab__profile-track');
    const zero = element('i'); track.append(zero);
    const value = element('span');
    if (item.status === 'ready' && item.payload.zScore !== null) {
      value.style.setProperty('--position', `${50 + item.payload.zScore / 6 * 100}%`);
      value.dataset.sign = item.payload.zScore < 0 ? 'negative' : 'positive';
    } else value.dataset.missing = 'true';
    track.append(value);
    const exact = element('span');
    exact.textContent = item.status === 'ready' ? `z ${formatValue(item.payload.zScore)}`
      : item.status === 'error' ? 'Failed' : 'Loading…';
    row.append(label, track, exact);
    return row;
  }
}

export function startMultiFeatureLab(root: HTMLElement): () => void {
  const lab = new MultiFeatureLab(root);
  return () => lab.dispose();
}
