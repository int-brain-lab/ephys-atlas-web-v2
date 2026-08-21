import type { DatasetCatalog, DatasetManifest, FeaturePayload } from '../data/contracts.js';
import type {
  AppState,
  ColorMode,
  ColorRange,
  ColorScale,
  DatasetId,
  DatasetRef,
  ParcellationId,
  RepresentationKind,
  SliceAxis,
  StatisticId,
} from '../domain/types.js';
import type { RegionInspection, SliceRenderer } from '../rendering/interfaces.js';
import { regionalColorRange } from '../rendering/scalar-colormap.js';
import { formatRegionalCoordinate, maxRegionalSliceIndex } from '../rendering/slice-calibration.js';
import { ColorRangeControl } from './color-range-control.js';
import { ContextMenu, type ContextMenuOption } from './context-menu.js';
import type { DisplaySliceInventory } from '../rendering/display-slice-inventory.js';
import type { RegionTooltipModel } from './regional/model.js';

export interface AppShellCallbacks {
  setDataset(ref: DatasetRef): void;
  setFeature(featureId: string | null, representation?: RepresentationKind): void;
  setParcellation(parcellation: ParcellationId): void;
  setStatistic(statistic: StatisticId): void;
  setColorMode(mode: ColorMode): void;
  setColormap(colormap: string): void;
  setColorRange(range: ColorRange): void;
  setColorScale(scale: ColorScale): void;
  setSlice(axis: SliceAxis, index: number): void;
  clearSelection(): void;
  shareCurrentView(): Promise<void>;
  downloadCurrentFeature(): void;
  importLocal(files: FileList): Promise<void>;
  reportError(error: unknown): void;
}

export interface ShellModel {
  state: AppState;
  catalog: DatasetCatalog | null;
  manifest: DatasetManifest | null;
  feature: FeaturePayload | null;
  displaySliceInventories: Readonly<Record<SliceAxis, DisplaySliceInventory>> | null;
}

type LayoutMode = 'wide' | 'compact' | 'narrow' | 'phone';
type DrawerName = 'regions' | 'settings';
type WorkspaceView = SliceAxis | 'context';
type HeaderAction = 'share' | 'download' | 'info';

interface ViewFrameNodes {
  frame: HTMLElement;
  target: HTMLElement;
  coordinate: HTMLElement;
  slider: HTMLInputElement;
  index: HTMLOutputElement;
  status: HTMLElement;
  maximize: HTMLButtonElement;
  tooltip: HTMLElement;
  tooltipIdentity: HTMLElement;
  tooltipValue: HTMLElement;
  tooltipMeta: HTMLElement;
  renderKey: string;
  geometryKey: string;
  renderToken: number;
  loadingNoticeTimer: number | null;
}

const SLICE_LOADING_NOTICE_DELAY_MS = 400;

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
  private readonly infoDialog: HTMLDialogElement;
  private readonly infoContent: HTMLElement;
  private readonly viewButtons = new Map<WorkspaceView, HTMLButtonElement>();
  private readonly viewFrames = new Map<SliceAxis, ViewFrameNodes>();
  private readonly headerActionButtons = new Map<HeaderAction, HTMLButtonElement[]>();
  private readonly datasetContext: ContextMenu;
  private readonly featureContext: ContextMenu;
  private readonly representationContext: ContextMenu;
  private readonly contextMenus: readonly ContextMenu[];
  private readonly featureRepresentation = new Map<string, RepresentationKind>();
  private overflowActions: HTMLDetailsElement | null = null;
  private regionSearch!: HTMLInputElement;
  private colorModeSelect!: HTMLSelectElement;
  private statisticSelect!: HTMLSelectElement;
  private colormapSelect!: HTMLSelectElement;
  private scaleSelect!: HTMLSelectElement;
  private rangeModeSelect!: HTMLSelectElement;
  private colorRangeControl!: ColorRangeControl;
  private featureId: string | null = null;
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

    this.datasetContext = new ContextMenu({
      fieldName: 'dataset',
      label: 'Dataset',
      onOpen: (menu) => {
        this.closeDrawers();
        this.closeContextMenus(menu);
      },
      onSelect: (option) => {
        const [datasetId, releaseId] = JSON.parse(option.id) as [DatasetId, string];
        this.callbacks.setDataset({ datasetId, releaseId });
      },
    });
    this.featureContext = new ContextMenu({
      fieldName: 'feature',
      label: 'Feature',
      searchable: true,
      searchPlaceholder: 'Search features, units, or IDs',
      onOpen: (menu) => {
        this.closeDrawers();
        this.closeContextMenus(menu);
      },
      onSelect: (option) => this.callbacks.setFeature(option.id, this.featureRepresentation.get(option.id)),
    });
    this.representationContext = new ContextMenu({
      fieldName: 'representation',
      label: 'Representation',
      multiselectable: true,
      onOpen: (menu) => {
        this.closeDrawers();
        this.closeContextMenus(menu);
      },
      onSelect: (option) => {
        const [kind, id] = option.id.split(':', 2);
        if (kind === 'representation') this.callbacks.setFeature(this.featureId, id as RepresentationKind);
        if (kind === 'parcellation') this.callbacks.setParcellation(id as ParcellationId);
      },
    });
    this.contextMenus = [this.datasetContext, this.featureContext, this.representationContext];

    this.regionPane = this.createRegionPane();
    this.settingsPane = this.createSettingsPane();
    this.backdrop = this.createBackdrop();
    const info = this.createInfoDialog();
    this.infoDialog = info.dialog;
    this.infoContent = info.content;

    const header = this.createHeader();
    const body = element('main', 'app-body');
    const workspace = this.createWorkspace();
    body.append(this.regionPane, workspace, this.settingsPane);

    this.app.append(header, body, this.backdrop, this.infoDialog);
    root.append(this.app);

    this.backdrop.addEventListener('click', () => this.closeDrawers());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);
    this.syncLayoutMode();
  }

  render(model: ShellModel): void {
    this.currentModel = model;
    const { state, catalog, manifest } = model;
    const view = state.view;
    const datasetEntry = catalog?.datasets.find((entry) => entry.id === view.dataset.datasetId);
    const featureEntry = manifest?.features.find((entry) => entry.id === view.featureId);

    const datasetLabel = datasetEntry?.title ?? manifest?.dataset.title ?? titleCaseToken(view.dataset.datasetId);
    const releaseLabel = view.dataset.releaseId ?? manifest?.dataset.release ?? datasetEntry?.defaultRelease ?? '';
    const featureLabel = featureEntry?.label ?? (view.featureId ? titleCaseToken(view.featureId) : 'No feature selected');
    const representationLabel = view.representation === 'regional' ? 'Regional' : 'Volume';

    this.datasetContext.setDisplay(datasetLabel, releaseLabel);
    this.featureContext.setDisplay(featureLabel, featureEntry?.unit ?? '');
    this.representationContext.setDisplay(`${representationLabel} · ${titleCaseToken(view.parcellation)}`, 'Allen CCFv3 · 10 µm');
    this.renderContextMenus(model);
    this.renderColorSettings(model);
    this.renderInfo(model);
    this.setHeaderActionDisabled('share', false);
    this.setHeaderActionDisabled('info', manifest === null);
    this.setHeaderActionDisabled('download', model.feature?.representation !== 'regional');

    for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
      this.renderViewFrame(axis, model);
    }
  }

  showRegionTooltip(inspection: RegionInspection, model: RegionTooltipModel): void {
    const nodes = this.viewFrames.get(inspection.axis);
    if (!nodes) return;
    for (const [axis, frame] of this.viewFrames) {
      if (axis !== inspection.axis) frame.tooltip.hidden = true;
    }
    const contentKey = `${inspection.regionId}\u0000${model.acronym}\u0000${model.name}\u0000${model.valueLabel ?? ''}\u0000${model.valueText ?? ''}\u0000${model.meta}`;
    if (nodes.tooltip.dataset.contentKey !== contentKey) {
      nodes.tooltip.dataset.contentKey = contentKey;
      nodes.tooltip.dataset.regionId = inspection.regionId;
      nodes.tooltipIdentity.replaceChildren();
      const acronym = element('strong', 'region-tooltip__acronym');
      acronym.textContent = model.acronym;
      const name = element('span', 'region-tooltip__name');
      name.textContent = model.name;
      nodes.tooltipIdentity.append(acronym, name);
      nodes.tooltipValue.hidden = !model.valueLabel || !model.valueText;
      nodes.tooltipValue.replaceChildren();
      if (model.valueLabel && model.valueText) {
        const label = element('span', 'region-tooltip__value-label');
        label.textContent = model.valueLabel;
        const value = element('strong', 'region-tooltip__value-text');
        value.textContent = model.valueText;
        nodes.tooltipValue.append(label, value);
      }
      nodes.tooltipMeta.textContent = model.meta;
    }
    nodes.tooltip.hidden = false;
    const viewport = nodes.tooltip.parentElement?.getBoundingClientRect();
    if (!viewport) return;
    const bounds = nodes.tooltip.getBoundingClientRect();
    const gap = 12;
    const padding = 8;
    const localX = inspection.clientX - viewport.left;
    const localY = inspection.clientY - viewport.top;
    const preferredX = localX + gap + bounds.width <= viewport.width - padding
      ? localX + gap
      : localX - gap - bounds.width;
    const preferredY = localY + gap + bounds.height <= viewport.height - padding
      ? localY + gap
      : localY - gap - bounds.height;
    const x = Math.max(padding, Math.min(viewport.width - bounds.width - padding, preferredX));
    const y = Math.max(padding, Math.min(viewport.height - bounds.height - padding, preferredY));
    nodes.tooltip.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
  }

  hideRegionTooltip(axis?: SliceAxis): void {
    if (axis) {
      const tooltip = this.viewFrames.get(axis)?.tooltip;
      if (tooltip) tooltip.hidden = true;
      return;
    }
    for (const nodes of this.viewFrames.values()) nodes.tooltip.hidden = true;
  }

  destroy(): void {
    this.colorRangeControl.destroy();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);
    this.contextMenus.forEach((menu) => menu.destroy());
    for (const nodes of this.viewFrames.values()) {
      if (nodes.loadingNoticeTimer !== null) window.clearTimeout(nodes.loadingNoticeTimer);
    }
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
      this.headerActionButton('Share', 'share'),
      this.headerActionButton('Download', 'download'),
      this.headerActionButton('Info', 'info'),
    );
    actions.append(desktopActions, this.createOverflowActions());

    header.append(brand, context, actions);
    return header;
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

  private headerActionButton(label: string, action: HeaderAction): HTMLButtonElement {
    const button = element('button', 'app-header__action');
    button.type = 'button';
    button.dataset.headerAction = action;
    button.append(this.actionIcon(ACTION_ICONS[action]), this.actionLabel(label));
    button.addEventListener('click', () => void this.runHeaderAction(action, button));
    const buttons = this.headerActionButtons.get(action) ?? [];
    buttons.push(button);
    this.headerActionButtons.set(action, buttons);
    return button;
  }

  private async runHeaderAction(action: HeaderAction, button: HTMLButtonElement): Promise<void> {
    if (action === 'info') {
      if (!this.infoDialog.open) this.infoDialog.showModal();
      if (this.overflowActions) this.overflowActions.open = false;
      return;
    }
    if (action === 'download') {
      this.callbacks.downloadCurrentFeature();
      if (this.overflowActions) this.overflowActions.open = false;
      return;
    }
    try {
      await this.callbacks.shareCurrentView();
      this.showActionFeedback('share', 'Copied', 'Link copied to clipboard');
    } catch (error) {
      button.title = 'Could not copy link';
      this.callbacks.reportError(error);
    }
    if (this.overflowActions) this.overflowActions.open = false;
  }

  private showActionFeedback(action: HeaderAction, label: string, title: string): void {
    for (const button of this.headerActionButtons.get(action) ?? []) {
      const text = button.querySelector<HTMLElement>('.app-header__action-label');
      if (text) text.textContent = label;
      button.title = title;
    }
    window.setTimeout(() => {
      for (const button of this.headerActionButtons.get(action) ?? []) {
        const text = button.querySelector<HTMLElement>('.app-header__action-label');
        if (text) text.textContent = action === 'share' ? 'Share' : action === 'download' ? 'Download' : 'Info';
        button.removeAttribute('title');
      }
    }, 1600);
  }

  private setHeaderActionDisabled(action: HeaderAction, disabled: boolean): void {
    for (const button of this.headerActionButtons.get(action) ?? []) button.disabled = disabled;
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
      this.headerActionButton('Share', 'share'),
      this.headerActionButton('Download', 'download'),
      this.headerActionButton('Info', 'info'),
    );
    details.append(summary, menu);
    this.overflowActions = details;
    return details;
  }

  private createInfoDialog(): { dialog: HTMLDialogElement; content: HTMLElement } {
    const dialog = element('dialog', 'info-dialog');
    dialog.setAttribute('aria-labelledby', 'info-dialog-title');
    const header = element('header', 'info-dialog__header');
    const title = heading('Dataset information', 2);
    title.id = 'info-dialog-title';
    const close = element('button', 'info-dialog__close');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => dialog.close());
    header.append(title, close);
    const content = element('div', 'info-dialog__content');
    dialog.append(header, content);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    return { dialog, content };
  }

  private renderInfo(model: ShellModel): void {
    const { manifest, state } = model;
    if (!manifest) {
      this.infoContent.replaceChildren();
      return;
    }
    const feature = manifest.features.find((item) => item.id === state.view.featureId);
    const releaseStatus = manifest.release.paperSnapshot
      ? 'Frozen paper snapshot'
      : manifest.dataset.fixture ? 'Synthetic test fixture' : 'Immutable development release';
    const summary = element('section', 'info-dialog__section');
    const status = element('span', 'info-dialog__status');
    status.dataset.fixture = String(Boolean(manifest.dataset.fixture));
    status.textContent = releaseStatus;
    summary.append(status, heading(manifest.dataset.title, 3));
    if (manifest.dataset.description) summary.append(this.infoParagraph(manifest.dataset.description));
    summary.append(this.infoList([
      ['Dataset', manifest.dataset.id],
      ['Release', manifest.release.releaseId],
      ['Created', new Date(manifest.release.createdAt).toLocaleString()],
      ['Parcellation', titleCaseToken(state.view.parcellation)],
    ]));

    const sections: HTMLElement[] = [summary];
    if (feature) {
      const featureSection = element('section', 'info-dialog__section');
      featureSection.append(heading(feature.label, 3));
      if (feature.description) featureSection.append(this.infoParagraph(feature.description));
      featureSection.append(this.infoList([
        ['Feature ID', feature.id],
        ...(feature.unit ? [['Unit', feature.unit] as const] : []),
        ['Quantity', feature.valueSemantics.quantity],
        ['Transform', feature.valueSemantics.transform],
        ['Population', feature.valueSemantics.sourcePopulation],
        ['Missing values', feature.valueSemantics.missingValues],
        ...(feature.valueSemantics.qcFilter ? [['QC filter', feature.valueSemantics.qcFilter] as const] : []),
      ]));
      sections.push(featureSection);
    }

    const provenance = element('section', 'info-dialog__section');
    provenance.append(heading('Provenance', 3), this.infoList([
      ['Recipe', String(manifest.provenance.recipe.id)],
      ['Builder', `${manifest.provenance.builder.name} ${manifest.provenance.builder.version}`.trim()],
      ['Command', manifest.provenance.builder.command],
      ...(manifest.provenance.builder.commit ? [['Builder commit', manifest.provenance.builder.commit] as const] : []),
    ]));
    if (manifest.provenance.sources.length) {
      const sources = element('ul', 'info-dialog__sources');
      for (const source of manifest.provenance.sources) {
        const item = element('li');
        item.append(document.createTextNode(source.description));
        const identity = source.release ?? source.commit ?? source.sha256;
        if (identity) {
          const code = element('code');
          code.textContent = identity;
          item.append(document.createTextNode(' '), code);
        }
        sources.append(item);
      }
      provenance.append(sources);
    }
    sections.push(provenance);
    this.infoContent.replaceChildren(...sections);
  }

  private infoParagraph(text: string): HTMLParagraphElement {
    const paragraph = element('p');
    paragraph.textContent = text;
    return paragraph;
  }

  private infoList(rows: readonly (readonly [string, string])[]): HTMLDListElement {
    const list = element('dl', 'info-dialog__list');
    for (const [labelText, value] of rows) {
      const label = element('dt');
      label.textContent = labelText;
      const data = element('dd');
      data.textContent = value;
      list.append(label, data);
    }
    return list;
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
    const searchClear = element('button', 'region-search__clear');
    searchClear.type = 'button';
    searchClear.textContent = '×';
    searchClear.setAttribute('aria-label', 'Clear region search');
    searchClear.hidden = true;
    inputWrap.append(searchIcon, this.regionSearch, searchClear);

    const meta = element('div', 'region-search__meta');
    const source = element('span', 'region-search__source');
    source.textContent = 'Loading regional catalog';
    const resultCount = element('span', 'region-search__count');
    resultCount.setAttribute('role', 'status');
    resultCount.setAttribute('aria-live', 'polite');
    meta.append(source, resultCount);
    search.append(inputWrap, meta);

    const browser = element('div', 'region-pane__browser');
    browser.setAttribute('aria-label', 'Region browser');
    browser.append(element('ul', 'region-list'));

    const selected = element('section', 'region-pane__selected');
    const selectedHeader = element('div', 'selected-regions__header');
    selectedHeader.append(heading('Selected regions', 3));
    const clearSelection = element('button', 'selected-regions__clear');
    clearSelection.type = 'button';
    clearSelection.textContent = 'Clear';
    selectedHeader.append(clearSelection);
    selected.append(selectedHeader, element('ul', 'selected-regions__list'));

    pane.append(panelHeader, search, browser, selected);
    return pane;
  }

  private createSettingsPane(): HTMLElement {
    const pane = element('aside', 'settings-pane panel');
    pane.id = 'settings-pane';
    pane.setAttribute('aria-label', 'Visualization settings');
    pane.dataset.open = 'false';
    const panelHeader = this.panelHeader('Visualization settings', () => this.closeDrawers());
    const content = element('div', 'settings-pane__content');
    content.append(this.createColorSettings());
    pane.append(panelHeader, content);
    return pane;
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
    const scale = this.settingsSelect('Scale', [['linear', 'Linear'], ['log', 'Logarithmic']]);
    this.scaleSelect = scale.select;
    this.scaleSelect.setAttribute('aria-label', 'Color scale');
    this.scaleSelect.addEventListener('change', () => this.callbacks.setColorScale(this.scaleSelect.value as ColorScale));
    const rangeMode = this.settingsSelect('Range', [['auto', 'Robust auto'], ['fixed', 'Manual']]);
    this.rangeModeSelect = rangeMode.select;
    this.rangeModeSelect.setAttribute('aria-label', 'Color range mode');
    this.rangeModeSelect.addEventListener('change', () => this.onRangeModeChanged());

    this.colorRangeControl = new ColorRangeControl((range) => this.callbacks.setColorRange(range));

    group.append(colorMode.row, statistic.row, colormap.row, scale.row, rangeMode.row, this.colorRangeControl.element);
    return group;
  }

  private renderContextMenus(model: ShellModel): void {
    const { catalog, manifest, state } = model;
    this.featureId = state.view.featureId;
    const datasetOptions: ContextMenuOption[] = catalog?.datasets.flatMap((dataset) => dataset.releases.map((release) => ({
      id: JSON.stringify([dataset.id, release.id]),
      label: release.label,
      ...(dataset.description ? { description: dataset.description } : {}),
      group: dataset.title,
      keywords: `${dataset.id} ${release.id}`,
    }))) ?? [];
    const datasetId = state.view.dataset.releaseId
      ? JSON.stringify([state.view.dataset.datasetId, state.view.dataset.releaseId])
      : '';
    this.datasetContext.setOptions(datasetOptions, [datasetId], datasetOptions.length === 0);

    this.featureRepresentation.clear();
    const featureOptions: ContextMenuOption[] = manifest?.features.map((feature) => {
      const representations = this.featureRepresentations(feature);
      const preferred = representations.includes(state.view.representation) ? state.view.representation : representations[0];
      if (preferred) this.featureRepresentation.set(feature.id, preferred);
      return {
        id: feature.id,
        label: feature.label,
        description: [feature.unit, representations.map(titleCaseToken).join(' / ')].filter(Boolean).join(' · '),
        keywords: `${feature.id} ${feature.description} ${feature.valueSemantics.quantity}`,
      };
    }) ?? [];
    this.featureContext.setOptions(featureOptions, state.view.featureId ? [state.view.featureId] : [], featureOptions.length === 0);

    const selectedFeature = manifest?.features.find((feature) => feature.id === state.view.featureId);
    const representations = selectedFeature ? this.featureRepresentations(selectedFeature) : [];
    const availableParcellations = selectedFeature?.representations.regional && state.view.representation === 'regional'
      ? Object.keys(selectedFeature.representations.regional.parcellations) as ParcellationId[]
      : manifest?.parcellations ?? [];
    const representationOptions: ContextMenuOption[] = representations.map((value) => ({
      id: `representation:${value}`,
      label: value === 'regional' ? 'Regional' : 'Volume',
      description: value === 'regional' ? 'Region-level descriptive summaries' : 'Voxel-space scalar volume',
      group: 'Representation',
      disabled: representations.length < 2,
    }));
    const parcellationOptions: ContextMenuOption[] = availableParcellations.map((value) => ({
      id: `parcellation:${value}`,
      label: value === 'allen' ? 'Allen' : value === 'beryl' ? 'Beryl' : 'Cosmos',
      description: value === 'allen' ? 'Full Allen ontology' : `${titleCaseToken(value)} reduced mapping`,
      group: 'Parcellation',
      disabled: state.view.representation !== 'regional' || availableParcellations.length < 2,
    }));
    this.representationContext.setOptions(
      [...representationOptions, ...parcellationOptions],
      [`representation:${state.view.representation}`, `parcellation:${state.view.parcellation}`],
      representationOptions.length + parcellationOptions.length === 0,
    );
  }

  private renderColorSettings(model: ShellModel): void {
    const { state, manifest, feature } = model;
    const view = state.view;
    const descriptor = manifest?.features.find((item) => item.id === view.featureId);
    this.colorModeSelect.value = view.coloring.mode ?? 'feature';
    const statistics = feature?.representation === 'regional'
      ? (['mean', 'median', 'min', 'max', 'count'] as const).filter((statistic) => feature.statistics[statistic] !== undefined)
      : descriptor?.statistics ?? [];
    this.syncOptions(this.statisticSelect, statistics.map((value) => ({ value, label: titleCaseToken(value) })), view.coloring.statistic);
    this.colormapSelect.value = view.coloring.colormap;
    this.scaleSelect.value = view.coloring.scale;
    this.rangeModeSelect.value = view.coloring.range.mode;
    const featureColors = (view.coloring.mode ?? 'feature') === 'feature' && feature !== null;
    this.statisticSelect.disabled = !featureColors || statistics.length < 2;
    this.colormapSelect.disabled = !featureColors;
    this.scaleSelect.disabled = !featureColors;
    this.rangeModeSelect.disabled = !featureColors;

    const range = feature?.representation === 'regional'
      ? regionalColorRange(feature, view.coloring)
      : feature?.descriptor.valueRange?.every((value) => value !== null)
        ? feature.descriptor.valueRange as readonly [number, number]
        : null;
    if (feature && range) {
      const usesRobustQuantiles = view.coloring.range.mode === 'auto'
        && feature.representation === 'regional'
        && view.coloring.statistic !== 'count'
        && feature.global?.q05 !== undefined
        && feature.global.q95 !== undefined;
      const scope = feature.representation === 'regional' ? 'Left hemisphere' : 'Volume';
      const context = view.coloring.range.mode === 'fixed'
        ? `${scope} · manual range`
        : usesRobustQuantiles ? `${scope} · robust 5–95%` : `${scope} · automatic range`;
      this.colorRangeControl.render({
        feature,
        statistic: view.coloring.statistic,
        effectiveRange: range,
        mode: view.coloring.range.mode,
        colormap: view.coloring.colormap,
        unit: descriptor?.unit ?? null,
        context,
        enabled: featureColors,
      });
    } else {
      this.colorRangeControl.hide();
    }
  }

  private featureRepresentations(feature: DatasetManifest['features'][number]): RepresentationKind[] {
    const representations: RepresentationKind[] = [];
    if (feature.representations.regional) representations.push('regional');
    if (feature.representations.volume) representations.push('volume');
    return representations;
  }

  private syncOptions(
    select: HTMLSelectElement,
    options: readonly { value: string; label: string }[],
    selectedValue: string,
  ): void {
    const signature = JSON.stringify(options.map(({ value, label }) => [value, label]));
    if (select.dataset.options !== signature) {
      select.replaceChildren(...options.map(({ value, label }) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        return option;
      }));
      select.dataset.options = signature;
    }
    select.value = options.some((option) => option.value === selectedValue) ? selectedValue : options[0]?.value ?? '';
  }

  private onRangeModeChanged(): void {
    if (this.rangeModeSelect.value === 'auto') {
      this.colorRangeControl.setAutomaticRange();
      return;
    }
    this.colorRangeControl.commitCurrentRange();
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
    secondary.append(this.frameHeader('Feature summary'), element('div', 'secondary-view__surface'));
    const distribution = element('section', 'distribution-band panel');
    distribution.append(this.frameHeader('Global distribution'), element('div', 'distribution-band__surface'));
    context.append(secondary, distribution);
    const analysis = element('section', 'analysis-panel panel');
    analysis.dataset.empty = 'true';
    analysis.dataset.expanded = 'false';
    analysis.setAttribute('aria-label', 'Compare selected regions');
    const analysisHeader = element('div', 'analysis-panel__header view-frame__header');
    const analysisToggle = element('button', 'analysis-panel__toggle');
    analysisToggle.type = 'button';
    analysisToggle.setAttribute('aria-controls', 'analysis-panel-surface');
    analysisToggle.setAttribute('aria-expanded', 'false');
    analysisToggle.setAttribute('aria-label', 'Expand selected-region comparison');
    const analysisTitle = element('span', 'analysis-panel__title');
    analysisTitle.textContent = 'Compare selected regions';
    const analysisChevron = element('span', 'analysis-panel__chevron');
    analysisChevron.textContent = '⌃';
    analysisChevron.setAttribute('aria-hidden', 'true');
    analysisToggle.append(analysisTitle, analysisChevron);
    analysisHeader.append(analysisToggle);
    const analysisSurface = element('div', 'analysis-panel__surface');
    analysisSurface.id = 'analysis-panel-surface';
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
    stateText.textContent = 'Loading registered anatomy…';
    const tooltip = element('div', 'region-tooltip');
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    const tooltipIdentity = element('div', 'region-tooltip__identity');
    const tooltipValue = element('div', 'region-tooltip__value');
    const tooltipMeta = element('div', 'region-tooltip__meta');
    tooltip.append(tooltipIdentity, tooltipValue, tooltipMeta);
    viewport.append(target, stateText, tooltip);

    const footer = element('div', 'view-frame__footer');
    const slider = element('input', 'view-frame__slider');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(maxRegionalSliceIndex(axis));
    slider.step = '1';
    slider.value = '0';
    slider.setAttribute('aria-label', `${axis} slice`);
    slider.addEventListener('input', () => {
      const model = this.currentModel;
      const inventory = model?.state.view.representation === 'regional' ? model.displaySliceInventories?.[axis] : undefined;
      this.callbacks.setSlice(axis, inventory?.nativeIndexAtOrdinal(slider.valueAsNumber) ?? slider.valueAsNumber);
    });
    const index = element('output', 'view-frame__index');
    index.htmlFor = slider.id = `${axis}-slice-slider`;
    index.textContent = `0 / ${maxRegionalSliceIndex(axis)}`;
    footer.append(slider, index);

    frame.append(header, viewport, footer);
    this.viewFrames.set(axis, {
      frame, target, coordinate, slider, index, status, maximize,
      tooltip, tooltipIdentity, tooltipValue, tooltipMeta,
      renderKey: '', geometryKey: '', renderToken: 0, loadingNoticeTimer: null,
    });
    return frame;
  }

  private currentModel: ShellModel | null = null;

  private renderViewFrame(axis: SliceAxis, model: ShellModel): void {
    const nodes = this.viewFrames.get(axis);
    if (!nodes) return;
    const view = model.state.view;
    const inventory = view.representation === 'regional' ? model.displaySliceInventories?.[axis] : undefined;
    const sliceIndex = Math.min(maxRegionalSliceIndex(axis), Math.max(0, Math.round(view.slices[axis])));
    const displayOrdinal = inventory?.ordinalForNativeIndex(sliceIndex) ?? sliceIndex;
    const displayMax = inventory ? inventory.count - 1 : maxRegionalSliceIndex(axis);
    nodes.coordinate.textContent = formatRegionalCoordinate(axis, sliceIndex);
    nodes.slider.max = String(displayMax);
    nodes.slider.value = String(displayOrdinal);
    nodes.index.textContent = `${displayOrdinal} / ${displayMax}`;

    const geometryKey = `${view.representation}:${view.parcellation}:${model.feature?.featureId ?? ''}:${sliceIndex}`;
    const renderKey = view.representation === 'volume'
      ? geometryKey
      : `${geometryKey}:${view.slices.coronal}:${view.slices.sagittal}:${view.slices.horizontal}`;
    if (nodes.renderKey === renderKey) return;
    nodes.renderKey = renderKey;
    const geometryChanged = nodes.geometryKey !== geometryKey;
    nodes.geometryKey = geometryKey;
    const token = ++nodes.renderToken;
    const retainsAnatomy = view.representation !== 'volume'
      && nodes.target.dataset.sliceAsset?.startsWith('generated-anatomy-') === true;
    const stateMessage = nodes.frame.querySelector<HTMLElement>('.view-frame__state-message');
    if (nodes.loadingNoticeTimer !== null) {
      window.clearTimeout(nodes.loadingNoticeTimer);
      nodes.loadingNoticeTimer = null;
    }
    if (!geometryChanged && nodes.status.textContent === 'Loading slice…') nodes.status.textContent = '';
    if (geometryChanged) {
      this.hideRegionTooltip(axis);
      nodes.frame.dataset.state = retainsAnatomy ? 'ready' : 'loading';
      nodes.status.removeAttribute('aria-label');
      nodes.status.textContent = retainsAnatomy ? '' : 'Loading';
      if (retainsAnatomy) {
        nodes.loadingNoticeTimer = window.setTimeout(() => {
          nodes.loadingNoticeTimer = null;
          if (nodes.renderToken === token) nodes.status.textContent = 'Loading slice…';
        }, SLICE_LOADING_NOTICE_DELAY_MS);
      }
      if (stateMessage) {
        stateMessage.textContent = retainsAnatomy
          ? ''
          : view.representation === 'volume'
            ? 'Loading scientific volume…'
            : 'Loading registered anatomy…';
      }
    }

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
      if (!geometryChanged) return;
      if (nodes.loadingNoticeTimer !== null) {
        window.clearTimeout(nodes.loadingNoticeTimer);
        nodes.loadingNoticeTimer = null;
      }
      nodes.frame.dataset.state = 'ready';
      nodes.status.textContent = '';
      nodes.status.setAttribute('aria-label', view.representation === 'volume' ? 'Scientific volume ready' : 'Registered anatomy ready');
    }).catch((error: unknown) => {
      if (nodes.renderToken !== token) return;
      if (nodes.loadingNoticeTimer !== null) {
        window.clearTimeout(nodes.loadingNoticeTimer);
        nodes.loadingNoticeTimer = null;
      }
      if (!geometryChanged || retainsAnatomy) {
        nodes.frame.dataset.state = 'ready';
        if (geometryChanged) nodes.status.textContent = 'Previous slice';
      } else {
        nodes.frame.dataset.state = 'error';
        nodes.status.textContent = 'Unavailable';
        this.renderer.clear(nodes.target);
        if (stateMessage) {
          stateMessage.textContent = error instanceof Error ? error.message : 'Registered anatomy could not be loaded';
        }
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

  private closeContextMenus(except?: ContextMenu): boolean {
    let closed = false;
    for (const menu of this.contextMenus) {
      if (menu !== except && menu.isOpen) {
        menu.close();
        closed = true;
      }
    }
    return closed;
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

  private readonly onResize = (): void => {
    this.hideRegionTooltip();
    this.syncLayoutMode();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (this.closeContextMenus()) return;
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
