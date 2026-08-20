import type { DatasetCatalog, DatasetManifest, FeaturePayload } from '../data/contracts.js';
import type { AppState, ColorMode, DatasetRef, ParcellationId, RepresentationKind, SliceAxis, StatisticId } from '../domain/types.js';
import type { SliceRenderer } from '../rendering/interfaces.js';
import { formatRegionalCoordinate, maxRegionalSliceIndex } from '../rendering/slice-calibration.js';

export interface AppShellCallbacks {
  setDataset(ref: DatasetRef): void;
  setFeature(featureId: string | null, representation?: RepresentationKind): void;
  setParcellation(parcellation: ParcellationId): void;
  setStatistic(statistic: StatisticId): void;
  setColorMode(mode: ColorMode): void;
  setColormap(colormap: string): void;
  setSlice(axis: SliceAxis, index: number): void;
  clearSelection(): void;
  importLocal(files: FileList): Promise<void>;
  reportError(error: unknown): void;
}

export interface ShellModel {
  state: AppState;
  catalog: DatasetCatalog | null;
  manifest: DatasetManifest | null;
  feature: FeaturePayload | null;
}

type LayoutMode = 'wide' | 'compact' | 'narrow' | 'phone';
type DrawerName = 'regions' | 'settings';
type WorkspaceView = SliceAxis | 'context';
type HeaderAction = 'share' | 'download' | 'info';

interface ContextFieldNodes {
  field: HTMLElement;
  value: HTMLElement;
  release?: HTMLElement;
}

interface ViewFrameNodes {
  frame: HTMLElement;
  target: HTMLElement;
  coordinate: HTMLElement;
  slider: HTMLInputElement;
  index: HTMLOutputElement;
  status: HTMLElement;
  maximize: HTMLButtonElement;
  renderKey: string;
  renderToken: number;
}

interface PrototypeRegion {
  id: string;
  acronym: string;
  name: string;
  depth: 0 | 1 | 2;
  value: number | null;
  hasChildren?: boolean;
}

const VIEW_LABELS: ReadonlyArray<{ id: WorkspaceView; label: string }> = [
  { id: 'coronal', label: 'Coronal' },
  { id: 'sagittal', label: 'Sagittal' },
  { id: 'horizontal', label: 'Horizontal' },
  { id: 'context', label: 'Context' },
];

const ACTION_ICONS: Record<HeaderAction, string> = {
  share: '↗',
  download: '↓',
  info: 'i',
};

// Phase 3 UX-only representative content. These labels and normalized bars are not
// loaded from, or written to, the scientific dataset/domain state.
const PROTOTYPE_REGIONS: readonly PrototypeRegion[] = [
  { id: 'CTX', acronym: 'CTX', name: 'Cerebral cortex', depth: 0, value: 72, hasChildren: true },
  { id: 'VIS', acronym: 'VIS', name: 'Visual areas', depth: 1, value: 66, hasChildren: true },
  { id: 'VISp', acronym: 'VISp', name: 'Primary visual area', depth: 2, value: 81 },
  { id: 'VISrl', acronym: 'VISrl', name: 'Rostrolateral visual area', depth: 2, value: 47 },
  { id: 'SSp-bfd', acronym: 'SSp-bfd', name: 'Primary somatosensory area, barrel field', depth: 1, value: 58 },
  { id: 'MOs', acronym: 'MOs', name: 'Secondary motor area', depth: 1, value: 39 },
  { id: 'HPF', acronym: 'HPF', name: 'Hippocampal formation', depth: 0, value: 54, hasChildren: true },
  { id: 'CA1', acronym: 'CA1', name: 'Field CA1', depth: 1, value: 62 },
  { id: 'DG', acronym: 'DG', name: 'Dentate gyrus', depth: 1, value: 44 },
  { id: 'TH', acronym: 'TH', name: 'Thalamus', depth: 0, value: 35, hasChildren: true },
  { id: 'LGd', acronym: 'LGd', name: 'Dorsal lateral geniculate complex', depth: 1, value: 69 },
  { id: 'POL', acronym: 'POL', name: 'Posterior limiting nucleus of the thalamus', depth: 1, value: null },
  { id: 'STR', acronym: 'STR', name: 'Striatum', depth: 0, value: 31, hasChildren: true },
  { id: 'CP', acronym: 'CP', name: 'Caudoputamen', depth: 1, value: 28 },
];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function heading(text: string, level: 1 | 2 | 3 = 2): HTMLHeadingElement {
  const node = document.createElement(`h${level}`);
  node.textContent = text;
  return node;
}

function placeholderLine(width: 'short' | 'medium' | 'long' = 'medium'): HTMLSpanElement {
  const line = element('span', 'placeholder-line');
  line.dataset.width = width;
  line.setAttribute('aria-hidden', 'true');
  return line;
}

function titleCaseToken(value: string): string {
  const words = value.replaceAll('_', ' ').replaceAll('-', ' ').trim();
  return words ? words[0]?.toUpperCase() + words.slice(1) : 'Unavailable';
}

export class AppShell {
  private readonly app: HTMLDivElement;
  private readonly regionPane: HTMLElement;
  private readonly settingsPane: HTMLElement;
  private readonly backdrop: HTMLButtonElement;
  private readonly viewButtons = new Map<WorkspaceView, HTMLButtonElement>();
  private readonly viewFrames = new Map<SliceAxis, ViewFrameNodes>();
  private readonly datasetContext: ContextFieldNodes;
  private readonly featureContext: ContextFieldNodes;
  private readonly representationContext: ContextFieldNodes;
  private readonly regionButtons = new Map<string, HTMLButtonElement>();
  private readonly selectedPrototypeRegions = new Set<string>(['VISp', 'MOs']);
  private overflowActions: HTMLDetailsElement | null = null;
  private regionSearch!: HTMLInputElement;
  private regionSearchClear!: HTMLButtonElement;
  private regionResultCount!: HTMLElement;
  private regionList!: HTMLUListElement;
  private selectedRegionList!: HTMLUListElement;
  private clearPrototypeSelection!: HTMLButtonElement;
  private colorModeSelect!: HTMLSelectElement;
  private statisticSelect!: HTMLSelectElement;
  private colormapSelect!: HTMLSelectElement;
  private activePrototypeRegion = 'CA1';
  private activeView: WorkspaceView = 'coronal';
  private maximizedView: SliceAxis | null = null;

  constructor(
    root: HTMLElement,
    private readonly callbacks: AppShellCallbacks,
    private readonly renderer: SliceRenderer,
  ) {
    root.replaceChildren();

    this.app = element('div', 'atlas-app');
    this.app.dataset.activeView = this.activeView;

    this.datasetContext = this.createContextField('Dataset', 'dataset', true);
    this.featureContext = this.createContextField('Feature', 'feature');
    this.representationContext = this.createContextField('Representation', 'representation');

    this.regionPane = this.createRegionPane();
    this.settingsPane = this.createSettingsPane();
    this.backdrop = this.createBackdrop();

    const header = this.createHeader();
    const body = element('main', 'app-body');
    const workspace = this.createWorkspace();
    body.append(this.regionPane, workspace, this.settingsPane);

    this.app.append(header, body, this.backdrop);
    root.append(this.app);

    this.backdrop.addEventListener('click', () => this.closeDrawers());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);
    this.syncLayoutMode();
    this.updatePrototypeRegionState();
  }

  render(model: ShellModel): void {
    const { state, catalog, manifest } = model;
    const view = state.view;
    const datasetEntry = catalog?.datasets.find((entry) => entry.id === view.dataset.datasetId);
    const featureEntry = manifest?.features.find((entry) => entry.id === view.featureId);

    const datasetLabel = datasetEntry?.title ?? manifest?.dataset.title ?? titleCaseToken(view.dataset.datasetId);
    const releaseLabel = view.dataset.releaseId ?? manifest?.dataset.release ?? datasetEntry?.defaultRelease ?? '';
    const featureLabel = featureEntry?.label ?? (view.featureId ? titleCaseToken(view.featureId) : 'No feature selected');
    const representationLabel = view.representation === 'regional' ? 'Regional' : 'Volume';

    this.setContextValue(this.datasetContext, datasetLabel, releaseLabel);
    this.setContextValue(this.featureContext, featureLabel);
    this.setContextValue(this.representationContext, representationLabel);
    this.colorModeSelect.value = view.coloring.mode ?? 'feature';
    this.statisticSelect.value = view.coloring.statistic;
    this.colormapSelect.value = view.coloring.colormap;
    const featureColors = (view.coloring.mode ?? 'feature') === 'feature';
    this.statisticSelect.disabled = !featureColors;
    this.colormapSelect.disabled = !featureColors;

    for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
      this.renderViewFrame(axis, model);
    }
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);
    this.renderer.destroy?.();
  }

  private createHeader(): HTMLElement {
    const header = element('header', 'app-header');

    const brand = element('div', 'app-header__brand');
    const mark = element('span', 'app-header__mark');
    mark.setAttribute('aria-hidden', 'true');
    const brandText = element('div', 'app-header__brand-text');
    const title = heading('IBL Ephys Atlas', 1);
    const version = element('span', 'app-header__version');
    version.textContent = 'v2';
    brandText.append(title, version);
    brand.append(mark, brandText);

    const context = element('dl', 'app-header__context');
    context.setAttribute('aria-label', 'Atlas context');
    context.append(this.datasetContext.field, this.featureContext.field, this.representationContext.field);

    const actions = element('nav', 'app-header__actions');
    actions.setAttribute('aria-label', 'Atlas actions');
    actions.append(this.drawerButton('regions', 'Regions', '☰'), this.drawerButton('settings', 'Settings', '⚙'));

    const desktopActions = element('div', 'app-header__desktop-actions');
    desktopActions.append(
      this.placeholderActionButton('Share', 'share'),
      this.placeholderActionButton('Download', 'download'),
      this.placeholderActionButton('Info', 'info'),
    );
    actions.append(desktopActions, this.createOverflowActions());

    header.append(brand, context, actions);
    return header;
  }

  private createContextField(labelText: string, fieldName: string, withRelease = false): ContextFieldNodes {
    const field = element('div', 'context-field');
    field.dataset.contextField = fieldName;
    const label = element('dt', 'context-field__label');
    label.textContent = labelText;
    const data = element('dd', 'context-field__data');
    const value = element('span', 'context-field__value');
    value.textContent = '—';
    data.append(value);
    let release: HTMLElement | undefined;
    if (withRelease) {
      release = element('span', 'context-field__release');
      release.hidden = true;
      data.append(release);
    }
    field.append(label, data);
    return { field, value, ...(release ? { release } : {}) };
  }

  private setContextValue(nodes: ContextFieldNodes, value: string, release = ''): void {
    nodes.value.textContent = value;
    nodes.value.title = value;
    if (!nodes.release) return;
    nodes.release.textContent = release;
    nodes.release.title = release;
    nodes.release.hidden = !release;
  }

  private drawerButton(drawer: DrawerName, label: string, iconText: string): HTMLButtonElement {
    const button = element('button', 'app-header__panel-button');
    button.type = 'button';
    button.dataset.drawerTrigger = drawer;
    button.setAttribute('aria-controls', `${drawer}-pane`);
    button.setAttribute('aria-expanded', 'false');
    button.append(this.actionIcon(iconText), this.actionLabel(label));
    button.addEventListener('click', () => this.openDrawer(drawer));
    return button;
  }

  private placeholderActionButton(label: string, action: HeaderAction): HTMLButtonElement {
    const button = element('button', 'app-header__action');
    button.type = 'button';
    button.dataset.headerAction = action;
    button.setAttribute('aria-disabled', 'true');
    button.title = `${label} will be implemented in a later phase`;
    button.append(this.actionIcon(ACTION_ICONS[action]), this.actionLabel(label));
    button.addEventListener('click', (event) => event.preventDefault());
    return button;
  }

  private actionIcon(text: string): HTMLSpanElement {
    const icon = element('span', 'app-header__action-icon');
    icon.textContent = text;
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  private actionLabel(text: string): HTMLSpanElement {
    const label = element('span', 'app-header__action-label');
    label.textContent = text;
    return label;
  }

  private createOverflowActions(): HTMLDetailsElement {
    const details = element('details', 'app-header__overflow');
    const summary = element('summary', 'app-header__overflow-trigger');
    summary.setAttribute('aria-label', 'More actions');
    summary.append(this.actionIcon('⋯'));
    const menu = element('div', 'app-header__overflow-menu');
    menu.append(
      this.placeholderActionButton('Share', 'share'),
      this.placeholderActionButton('Download', 'download'),
      this.placeholderActionButton('Info', 'info'),
    );
    details.append(summary, menu);
    this.overflowActions = details;
    return details;
  }

  private createRegionPane(): HTMLElement {
    const pane = element('aside', 'region-pane panel');
    pane.id = 'regions-pane';
    pane.setAttribute('aria-label', 'Brain regions');
    pane.dataset.open = 'false';
    pane.dataset.phase = 'prototype';

    const panelHeader = this.panelHeader('Brain regions', () => this.closeDrawers());
    const search = element('form', 'region-search');
    search.setAttribute('role', 'search');
    search.addEventListener('submit', (event) => event.preventDefault());

    const inputWrap = element('div', 'region-search__input-wrap');
    const searchIcon = element('span', 'region-search__icon');
    searchIcon.textContent = '⌕';
    searchIcon.setAttribute('aria-hidden', 'true');
    this.regionSearch = element('input', 'region-search__input');
    this.regionSearch.type = 'search';
    this.regionSearch.autocomplete = 'off';
    this.regionSearch.spellcheck = false;
    this.regionSearch.placeholder = 'Search regions';
    this.regionSearch.setAttribute('aria-label', 'Search brain regions');
    this.regionSearch.addEventListener('input', () => this.filterPrototypeRegions());
    this.regionSearchClear = element('button', 'region-search__clear');
    this.regionSearchClear.type = 'button';
    this.regionSearchClear.textContent = '×';
    this.regionSearchClear.setAttribute('aria-label', 'Clear region search');
    this.regionSearchClear.hidden = true;
    this.regionSearchClear.addEventListener('click', () => {
      this.regionSearch.value = '';
      this.filterPrototypeRegions();
      this.regionSearch.focus();
    });
    inputWrap.append(searchIcon, this.regionSearch, this.regionSearchClear);

    const meta = element('div', 'region-search__meta');
    const source = element('span', 'region-search__source');
    source.textContent = 'Representative hierarchy';
    this.regionResultCount = element('span', 'region-search__count');
    this.regionResultCount.setAttribute('role', 'status');
    this.regionResultCount.setAttribute('aria-live', 'polite');
    meta.append(source, this.regionResultCount);
    search.append(inputWrap, meta);

    const browser = element('div', 'region-pane__browser');
    browser.setAttribute('aria-label', 'Representative region browser');
    this.regionList = element('ul', 'region-list');
    for (const region of PROTOTYPE_REGIONS) this.regionList.append(this.createRegionRow(region));
    browser.append(this.regionList);

    const selected = element('section', 'region-pane__selected');
    const selectedHeader = element('div', 'selected-regions__header');
    selectedHeader.append(heading('Selected regions', 3));
    this.clearPrototypeSelection = element('button', 'selected-regions__clear');
    this.clearPrototypeSelection.type = 'button';
    this.clearPrototypeSelection.textContent = 'Clear';
    this.clearPrototypeSelection.addEventListener('click', () => {
      this.selectedPrototypeRegions.clear();
      this.updatePrototypeRegionState();
    });
    selectedHeader.append(this.clearPrototypeSelection);
    this.selectedRegionList = element('ul', 'selected-regions__list');
    selected.append(selectedHeader, this.selectedRegionList);

    pane.append(panelHeader, search, browser, selected);
    return pane;
  }

  private createRegionRow(region: PrototypeRegion): HTMLLIElement {
    const item = element('li', 'region-row');
    item.dataset.regionId = region.id;
    item.dataset.depth = String(region.depth);
    item.dataset.missing = String(region.value === null);

    const button = element('button', 'region-row__button');
    button.type = 'button';
    button.dataset.regionButton = region.id;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', `${region.acronym}, ${region.name}`);

    const disclosure = element('span', 'region-row__disclosure');
    disclosure.textContent = region.hasChildren ? '▾' : '·';
    disclosure.setAttribute('aria-hidden', 'true');

    const identity = element('span', 'region-row__identity');
    const acronym = element('span', 'region-row__acronym');
    acronym.textContent = region.acronym;
    const name = element('span', 'region-row__name');
    name.textContent = region.name;
    name.title = region.name;
    identity.append(acronym, name);

    const value = element('span', 'region-row__value');
    if (region.value === null) {
      const missing = element('span', 'region-row__missing');
      missing.textContent = 'no value';
      value.append(missing);
    } else {
      const bar = element('span', 'region-row__bar');
      const fill = element('span', 'region-row__bar-fill');
      fill.style.setProperty('--region-value', `${region.value}%`);
      bar.append(fill);
      value.append(bar);
      value.setAttribute('aria-label', 'Representative relative value');
    }

    button.append(disclosure, identity, value);
    button.addEventListener('click', () => this.togglePrototypeRegion(region.id));
    button.addEventListener('keydown', (event) => this.navigatePrototypeRegions(event, button));
    this.regionButtons.set(region.id, button);
    item.append(button);
    return item;
  }

  private togglePrototypeRegion(regionId: string): void {
    this.activePrototypeRegion = regionId;
    if (this.selectedPrototypeRegions.has(regionId)) this.selectedPrototypeRegions.delete(regionId);
    else this.selectedPrototypeRegions.add(regionId);
    this.updatePrototypeRegionState();
  }

  private removePrototypeRegion(regionId: string): void {
    this.selectedPrototypeRegions.delete(regionId);
    this.updatePrototypeRegionState();
    this.regionButtons.get(regionId)?.focus();
  }

  private updatePrototypeRegionState(): void {
    for (const region of PROTOTYPE_REGIONS) {
      const button = this.regionButtons.get(region.id);
      const row = button?.closest<HTMLElement>('.region-row');
      if (!button || !row) continue;
      const selected = this.selectedPrototypeRegions.has(region.id);
      row.dataset.selected = String(selected);
      row.dataset.active = String(this.activePrototypeRegion === region.id);
      button.setAttribute('aria-pressed', String(selected));
    }

    const selectedRegions = PROTOTYPE_REGIONS.filter((region) => this.selectedPrototypeRegions.has(region.id));
    const selectedItems = selectedRegions.map((region) => {
      const item = element('li', 'selected-region');
      const identity = element('span', 'selected-region__identity');
      const acronym = element('strong', 'selected-region__acronym');
      acronym.textContent = region.acronym;
      const name = element('span', 'selected-region__name');
      name.textContent = region.name;
      identity.append(acronym, name);
      const remove = element('button', 'selected-region__remove');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${region.acronym} from selected regions`);
      remove.addEventListener('click', () => this.removePrototypeRegion(region.id));
      item.append(identity, remove);
      return item;
    });
    if (!selectedItems.length) {
      const empty = element('li', 'selected-regions__empty');
      empty.textContent = 'No regions selected';
      selectedItems.push(empty);
    }
    this.selectedRegionList.replaceChildren(...selectedItems);
    this.clearPrototypeSelection.disabled = selectedRegions.length === 0;
    this.filterPrototypeRegions();
  }

  private filterPrototypeRegions(): void {
    if (!this.regionSearch || !this.regionResultCount) return;
    const query = this.regionSearch.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const region of PROTOTYPE_REGIONS) {
      const matches = !query || region.acronym.toLocaleLowerCase().includes(query) || region.name.toLocaleLowerCase().includes(query);
      const row = this.regionButtons.get(region.id)?.closest<HTMLLIElement>('.region-row');
      if (row) row.hidden = !matches;
      if (matches) visible += 1;
    }
    this.regionSearchClear.hidden = !query;
    this.regionResultCount.textContent = `${visible} ${visible === 1 ? 'region' : 'regions'}`;
  }

  private navigatePrototypeRegions(event: KeyboardEvent, current: HTMLButtonElement): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const visible = [...this.regionList.querySelectorAll<HTMLButtonElement>('.region-row:not([hidden]) .region-row__button')];
    if (!visible.length) return;
    const index = visible.indexOf(current);
    let target = index;
    if (event.key === 'ArrowDown') target = Math.min(visible.length - 1, index + 1);
    if (event.key === 'ArrowUp') target = Math.max(0, index - 1);
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = visible.length - 1;
    if (target !== index) {
      event.preventDefault();
      visible[target]?.focus();
    }
  }

  private createSettingsPane(): HTMLElement {
    const pane = element('aside', 'settings-pane panel');
    pane.id = 'settings-pane';
    pane.setAttribute('aria-label', 'Visualization settings');
    pane.dataset.open = 'false';
    const panelHeader = this.panelHeader('Visualization settings', () => this.closeDrawers());
    const content = element('div', 'settings-pane__content');
    content.append(this.createSettingsGroup('Data interpretation', 3), this.createColorSettings(), this.createSettingsGroup('Display', 2));
    pane.append(panelHeader, content);
    return pane;
  }

  private createSettingsGroup(labelText: string, rows: number): HTMLElement {
    const group = element('section', 'settings-placeholder');
    group.append(heading(labelText, 3));
    for (let i = 0; i < rows; i += 1) {
      const row = element('div', 'settings-placeholder__row');
      row.append(placeholderLine(i % 2 ? 'medium' : 'short'), placeholderLine('medium'));
      group.append(row);
    }
    return group;
  }

  private createColorSettings(): HTMLElement {
    const group = element('section', 'settings-placeholder settings-controls');
    group.append(heading('Color', 3));
    const colorMode = this.settingsSelect('Region fill', [
      ['feature', 'Feature values'],
      ['anatomy', 'Allen anatomy'],
    ]);
    this.colorModeSelect = colorMode.select;
    this.colorModeSelect.setAttribute('aria-label', 'Region color mode');
    this.colorModeSelect.addEventListener('change', () => this.callbacks.setColorMode(this.colorModeSelect.value as ColorMode));
    const statistic = this.settingsSelect('Statistic', [
      ['mean', 'Mean'], ['median', 'Median'], ['min', 'Minimum'], ['max', 'Maximum'], ['count', 'Count'],
    ]);
    this.statisticSelect = statistic.select;
    this.statisticSelect.setAttribute('aria-label', 'Regional statistic');
    this.statisticSelect.addEventListener('change', () => this.callbacks.setStatistic(this.statisticSelect.value as StatisticId));
    const colormap = this.settingsSelect('Colormap', [['viridis', 'Viridis'], ['magma', 'Magma']]);
    this.colormapSelect = colormap.select;
    this.colormapSelect.setAttribute('aria-label', 'Feature colormap');
    this.colormapSelect.addEventListener('change', () => this.callbacks.setColormap(this.colormapSelect.value));
    group.append(colorMode.row, statistic.row, colormap.row);
    return group;
  }

  private settingsSelect(labelText: string, options: readonly (readonly [string, string])[]): { row: HTMLLabelElement; select: HTMLSelectElement } {
    const row = element('label', 'settings-control');
    const label = element('span', 'settings-control__label');
    label.textContent = labelText;
    const select = element('select', 'settings-control__select');
    for (const [value, text] of options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    row.append(label, select);
    return { row, select };
  }

  private panelHeader(titleText: string, onClose: () => void): HTMLElement {
    const header = element('div', 'panel__header');
    header.append(heading(titleText, 2));
    const close = element('button', 'panel__close');
    close.type = 'button';
    close.textContent = 'Close';
    close.setAttribute('aria-label', `Close ${titleText}`);
    close.addEventListener('click', onClose);
    header.append(close);
    return header;
  }

  private createWorkspace(): HTMLElement {
    const workspace = element('section', 'workspace');
    workspace.setAttribute('aria-label', 'Atlas workspace');
    const switcher = element('nav', 'view-switcher');
    switcher.setAttribute('aria-label', 'Workspace view');
    for (const item of VIEW_LABELS) {
      const button = element('button', 'view-switcher__button');
      button.type = 'button';
      button.textContent = item.label;
      button.dataset.viewTarget = item.id;
      button.setAttribute('aria-pressed', item.id === this.activeView ? 'true' : 'false');
      button.addEventListener('click', () => this.setActiveView(item.id));
      this.viewButtons.set(item.id, button);
      switcher.append(button);
    }
    const slices = element('section', 'slice-strip');
    slices.setAttribute('aria-label', 'Orthogonal brain slices');
    slices.append(this.createViewFrame('coronal'), this.createViewFrame('sagittal'), this.createViewFrame('horizontal'));
    const context = element('section', 'context-strip');
    context.setAttribute('aria-label', 'Secondary atlas context');
    const secondary = element('section', 'secondary-view panel');
    secondary.append(this.frameHeader('Secondary view'), element('div', 'secondary-view__surface'));
    const distribution = element('section', 'distribution-band panel');
    distribution.append(this.frameHeader('Global distribution'), element('div', 'distribution-band__surface'));
    context.append(secondary, distribution);
    const analysis = element('section', 'analysis-panel panel');
    analysis.dataset.state = 'compact';
    analysis.setAttribute('aria-label', 'Analysis and comparison');
    const analysisHeader = this.frameHeader('Analysis / comparison');
    const analysisSurface = element('div', 'analysis-panel__surface');
    analysisSurface.append(placeholderLine('long'), placeholderLine('medium'));
    analysis.append(analysisHeader, analysisSurface);
    workspace.append(switcher, slices, context, analysis);
    return workspace;
  }

  private createViewFrame(axis: SliceAxis): HTMLElement {
    const frame = element('section', 'view-frame panel');
    frame.dataset.view = axis;
    frame.dataset.state = 'idle';
    frame.dataset.maximized = 'false';
    frame.setAttribute('aria-label', `${axis} view`);

    const title = `${axis[0]?.toUpperCase() ?? ''}${axis.slice(1)}`;
    const header = element('div', 'view-frame__header');
    header.append(heading(title, 3));
    const headerMeta = element('div', 'view-frame__header-meta');
    const coordinate = element('span', 'view-frame__coordinate');
    coordinate.textContent = formatRegionalCoordinate(axis, 0);
    const status = element('span', 'view-frame__status');
    status.textContent = 'Waiting';
    const maximize = element('button', 'view-frame__maximize');
    maximize.type = 'button';
    maximize.textContent = '↗';
    maximize.setAttribute('aria-label', `Maximize ${axis} view`);
    maximize.setAttribute('aria-pressed', 'false');
    maximize.addEventListener('click', () => this.toggleMaximizedView(axis));
    headerMeta.append(coordinate, status, maximize);
    header.append(headerMeta);

    const viewport = element('div', 'view-frame__viewport');
    const target = element('div', 'view-frame__renderer');
    target.setAttribute('aria-label', `${axis} renderer target`);
    const stateText = element('div', 'view-frame__state-message');
    stateText.setAttribute('role', 'status');
    stateText.textContent = 'Loading curated anatomy…';
    viewport.append(target, stateText);

    const footer = element('div', 'view-frame__footer');
    const slider = element('input', 'view-frame__slider');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(maxRegionalSliceIndex(axis));
    slider.step = '1';
    slider.value = '0';
    slider.setAttribute('aria-label', `${axis} slice`);
    slider.addEventListener('input', () => this.callbacks.setSlice(axis, slider.valueAsNumber));
    const index = element('output', 'view-frame__index');
    index.htmlFor = slider.id = `${axis}-slice-slider`;
    index.textContent = `0 / ${maxRegionalSliceIndex(axis)}`;
    footer.append(slider, index);

    frame.append(header, viewport, footer);
    this.viewFrames.set(axis, { frame, target, coordinate, slider, index, status, maximize, renderKey: '', renderToken: 0 });
    return frame;
  }

  private renderViewFrame(axis: SliceAxis, model: ShellModel): void {
    const nodes = this.viewFrames.get(axis);
    if (!nodes) return;
    const view = model.state.view;
    const sliceIndex = Math.min(maxRegionalSliceIndex(axis), Math.max(0, Math.round(view.slices[axis])));
    nodes.coordinate.textContent = formatRegionalCoordinate(axis, sliceIndex);
    nodes.slider.value = String(sliceIndex);
    nodes.index.textContent = `${sliceIndex} / ${maxRegionalSliceIndex(axis)}`;

    const renderKey = `${view.parcellation}:${view.slices.coronal}:${view.slices.sagittal}:${view.slices.horizontal}`;
    if (nodes.renderKey === renderKey) return;
    nodes.renderKey = renderKey;
    const token = ++nodes.renderToken;
    nodes.frame.dataset.state = 'loading';
    nodes.status.textContent = 'Loading';
    const stateMessage = nodes.frame.querySelector<HTMLElement>('.view-frame__state-message');
    if (stateMessage) stateMessage.textContent = 'Loading curated anatomy…';

    const pending = this.renderer.render(nodes.target, {
      axis,
      sliceIndex,
      slices: view.slices,
      cursor: view.cursor,
      parcellation: view.parcellation,
      selectedRegionIds: view.selection,
      feature: model.feature,
    });

    Promise.resolve(pending).then(() => {
      if (nodes.renderToken !== token) return;
      nodes.frame.dataset.state = 'ready';
      nodes.status.textContent = 'Curated atlas';
    }).catch((error: unknown) => {
      if (nodes.renderToken !== token) return;
      nodes.frame.dataset.state = 'error';
      nodes.status.textContent = 'Unavailable';
      this.renderer.clear(nodes.target);
      if (stateMessage) {
        stateMessage.textContent = error instanceof Error ? error.message : 'Curated anatomy could not be loaded';
      }
      this.callbacks.reportError(error);
    });
  }

  private toggleMaximizedView(axis: SliceAxis): void {
    this.maximizedView = this.maximizedView === axis ? null : axis;
    if (this.maximizedView) this.closeDrawers();
    if (this.maximizedView) this.app.dataset.maximizedView = this.maximizedView;
    else delete this.app.dataset.maximizedView;
    for (const [id, nodes] of this.viewFrames) {
      const active = id === this.maximizedView;
      nodes.frame.dataset.maximized = String(active);
      nodes.maximize.setAttribute('aria-pressed', String(active));
      nodes.maximize.setAttribute('aria-label', `${active ? 'Restore' : 'Maximize'} ${id} view`);
      nodes.maximize.textContent = active ? '↙' : '↗';
    }
  }

  private frameHeader(titleText: string): HTMLElement {
    const header = element('div', 'view-frame__header');
    header.append(heading(titleText, 3));
    return header;
  }

  private createBackdrop(): HTMLButtonElement {
    const backdrop = element('button', 'drawer-backdrop');
    backdrop.type = 'button';
    backdrop.tabIndex = -1;
    backdrop.setAttribute('aria-label', 'Close panel');
    return backdrop;
  }

  private setActiveView(view: WorkspaceView): void {
    this.activeView = view;
    this.app.dataset.activeView = view;
    for (const [id, button] of this.viewButtons) button.setAttribute('aria-pressed', id === view ? 'true' : 'false');
  }

  private openDrawer(drawer: DrawerName): void {
    const pane = drawer === 'regions' ? this.regionPane : this.settingsPane;
    const other = drawer === 'regions' ? this.settingsPane : this.regionPane;
    if (this.overflowActions) this.overflowActions.open = false;
    other.dataset.open = 'false';
    pane.dataset.open = 'true';
    this.app.dataset.drawerOpen = drawer;
    this.syncDrawerButtons(drawer);
    if (drawer === 'regions') this.regionSearch.focus();
    else pane.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus();
  }

  private closeDrawers(): void {
    this.regionPane.dataset.open = 'false';
    this.settingsPane.dataset.open = 'false';
    delete this.app.dataset.drawerOpen;
    this.syncDrawerButtons(null);
  }

  private syncDrawerButtons(open: DrawerName | null): void {
    for (const button of this.app.querySelectorAll<HTMLButtonElement>('[data-drawer-trigger]')) {
      button.setAttribute('aria-expanded', button.dataset.drawerTrigger === open ? 'true' : 'false');
    }
  }

  private syncLayoutMode(): void {
    const width = window.innerWidth;
    const mode: LayoutMode = width >= 1480 ? 'wide' : width >= 1100 ? 'compact' : width >= 760 ? 'narrow' : 'phone';
    this.app.dataset.layout = mode;
    if (mode !== 'phone' && this.overflowActions) this.overflowActions.open = false;
    if (mode === 'wide') this.closeDrawers();
    else if (mode === 'compact' && this.regionPane.dataset.open === 'true') this.closeDrawers();
  }

  private readonly onResize = (): void => this.syncLayoutMode();

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (this.maximizedView) {
      this.toggleMaximizedView(this.maximizedView);
      return;
    }
    if (this.app.dataset.drawerOpen) {
      this.closeDrawers();
      return;
    }
    if (this.overflowActions?.open) this.overflowActions.open = false;
  };
}
