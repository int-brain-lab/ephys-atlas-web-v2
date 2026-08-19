import type { DatasetCatalog, DatasetManifest, FeaturePayload } from '../data/contracts.js';
import type { AppState, DatasetRef, ParcellationId, RepresentationKind, SliceAxis, StatisticId } from '../domain/types.js';
import type { SliceRenderer } from '../rendering/interfaces.js';

export interface AppShellCallbacks {
  setDataset(ref: DatasetRef): void;
  setFeature(featureId: string | null, representation?: RepresentationKind): void;
  setParcellation(parcellation: ParcellationId): void;
  setStatistic(statistic: StatisticId): void;
  setColormap(colormap: string): void;
  setSlice(axis: SliceAxis, index: number): void;
  clearSelection(): void;
  importLocal(files: FileList): Promise<void>;
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
  private readonly viewButtons = new Map<WorkspaceView, HTMLButtonElement>();
  private readonly datasetContext: ContextFieldNodes;
  private readonly featureContext: ContextFieldNodes;
  private readonly representationContext: ContextFieldNodes;
  private overflowActions: HTMLDetailsElement | null = null;
  private activeView: WorkspaceView = 'coronal';

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
    context.append(
      this.datasetContext.field,
      this.featureContext.field,
      this.representationContext.field,
    );

    const actions = element('nav', 'app-header__actions');
    actions.setAttribute('aria-label', 'Atlas actions');
    actions.append(
      this.drawerButton('regions', 'Regions', '☰'),
      this.drawerButton('settings', 'Settings', '⚙'),
    );

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

    const panelHeader = this.panelHeader('Brain regions', () => this.closeDrawers());
    const searchPlaceholder = element('div', 'region-pane__search-placeholder');
    searchPlaceholder.append(placeholderLine('long'));

    const browser = element('div', 'region-pane__browser');
    browser.setAttribute('aria-label', 'Region browser placeholder');
    for (let i = 0; i < 9; i += 1) {
      const row = element('div', 'region-pane__row-placeholder');
      row.append(placeholderLine(i % 3 === 0 ? 'long' : i % 2 === 0 ? 'short' : 'medium'));
      browser.append(row);
    }

    const selected = element('section', 'region-pane__selected');
    selected.append(heading('Selected regions', 3), placeholderLine('medium'));

    pane.append(panelHeader, searchPlaceholder, browser, selected);
    return pane;
  }

  private createSettingsPane(): HTMLElement {
    const pane = element('aside', 'settings-pane panel');
    pane.id = 'settings-pane';
    pane.setAttribute('aria-label', 'Visualization settings');
    pane.dataset.open = 'false';

    const panelHeader = this.panelHeader('Visualization settings', () => this.closeDrawers());
    const content = element('div', 'settings-pane__content');
    content.append(
      this.createSettingsGroup('Data interpretation', 3),
      this.createSettingsGroup('Color', 4),
      this.createSettingsGroup('Display', 2),
    );
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
    slices.append(
      this.createViewFrame('coronal'),
      this.createViewFrame('sagittal'),
      this.createViewFrame('horizontal'),
    );

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
    frame.setAttribute('aria-label', `${axis} view`);
    const title = `${axis[0]?.toUpperCase() ?? ''}${axis.slice(1)}`;
    frame.append(this.frameHeader(title));

    const viewport = element('div', 'view-frame__viewport');
    viewport.setAttribute('aria-label', `${axis} renderer target`);
    const coordinate = element('span', 'view-frame__coordinate');
    coordinate.textContent = axis === 'coronal' ? 'AP —' : axis === 'sagittal' ? 'ML —' : 'DV —';
    viewport.append(coordinate);

    const footer = element('div', 'view-frame__footer');
    footer.append(placeholderLine('long'));
    frame.append(viewport, footer);
    return frame;
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
    for (const [id, button] of this.viewButtons) {
      button.setAttribute('aria-pressed', id === view ? 'true' : 'false');
    }
  }

  private openDrawer(drawer: DrawerName): void {
    const pane = drawer === 'regions' ? this.regionPane : this.settingsPane;
    const other = drawer === 'regions' ? this.settingsPane : this.regionPane;
    if (this.overflowActions) this.overflowActions.open = false;
    other.dataset.open = 'false';
    pane.dataset.open = 'true';
    this.app.dataset.drawerOpen = drawer;
    this.syncDrawerButtons(drawer);
    pane.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus();
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
    if (mode === 'wide') {
      this.closeDrawers();
    } else if (mode === 'compact' && this.regionPane.dataset.open === 'true') {
      this.closeDrawers();
    }
  }

  private readonly onResize = (): void => this.syncLayoutMode();

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (this.app.dataset.drawerOpen) {
      this.closeDrawers();
      return;
    }
    if (this.overflowActions?.open) this.overflowActions.open = false;
  };
}
