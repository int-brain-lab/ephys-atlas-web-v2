import type { DatasetCatalog, DatasetManifest, FeaturePayload, RepresentationDisplay } from '../data/contracts.js';
import type { LocalArchivePreview } from '../data/local-archive.js';
import type { LocalReleaseInspection, LocalStorageInspection } from '../data/local-source.js';
import type {
  AppState,
  ColorMode,
  ColorRange,
  ColorScaleSelection,
  DistributionDomainSelection,
  DatasetId,
  DatasetRef,
  ParcellationId,
  RepresentationKind,
  SecondaryTabId,
  SliceAxis,
  StaticProjectionId,
  ColorStatisticId,
  ColormapSelection,
  WorkspaceViewId,
} from '../domain/types.js';
import { deriveOrthogonalNavigation } from '../domain/navigation.js';
import {
  ORTHOGONAL_PROJECTION_REGISTRY,
  STATIC_PROJECTION_REGISTRY,
  SECONDARY_CONTENT_BY_ID,
  SECONDARY_CONTENT_REGISTRY,
  WORKSPACE_VIEW_REGISTRY,
} from '../domain/projections.js';
import type {
  ProjectionViewport,
  ProjectionViewportFactory,
  RegionInspection,
  StaticProjectionViewport,
  VolumeInspection,
} from '../rendering/projection-viewport.js';
import { effectiveScalarColorRange } from '../application/scalar-colormap.js';
import type { ResolvedPresentationScale } from '../application/presentation-scale.js';
import { COLORMAPS } from '../application/colormap-palettes.js';
import { colormapLabel } from '../application/colormap-palettes.js';
import type { ResolvedPresentationColormap } from '../application/presentation-colormap.js';
import { formatRegionalCoordinate, maxRegionalSliceIndex } from '../rendering/slice-calibration.js';
import { ColorRangeControl } from './color-range-control.js';
import { ContextMenu, type ContextMenuOption } from './context-menu.js';
import {
  DataChooser,
  type DataChooserSelection,
  type NavigationRecovery,
  type NavigationRecoveryAction,
} from './data-chooser.js';
import type { DisplaySliceInventory } from '../rendering/display-slice-inventory.js';
import type { RegionTooltipModel } from './regional/model.js';
import type { RegionalPresentation } from '../application/regional-presentation.js';
import type {
  BrainScene3DViewport,
  BrainScene3DViewportFactory,
} from '../rendering/3d/brain-scene-viewport.js';
import {
  LAYOUT_PREFERENCES_KEY,
  PANEL_WIDTH_LIMITS,
  clampPanelWidth,
  parseLayoutPreferences,
  serializeLayoutPreferences,
  type LayoutPanel,
  type LayoutPreferences,
} from '../application/layout-preferences.js';
import { presentDatasetTitle } from './dataset-presentation.js';
import { HelpGuide } from './help-guide.js';
import { HelpTour, type HelpTourAnchor } from './help-tour.js';

export interface AppShellCallbacks {
  setDataset(ref: DatasetRef): void;
  selectData(selection: DataChooserSelection): void;
  recoverNavigation(action: NavigationRecoveryAction): void;
  selectProject(projectId: string): void;
  selectEdition(projectId: string, editionId: string): void;
  browseCustomVersions(projectId: string): void;
  setFeature(featureId: string | null, representation?: RepresentationKind): void;
  setParcellation(parcellation: ParcellationId): void;
  setStatistic(statistic: ColorStatisticId): void;
  setColorMode(mode: ColorMode): void;
  setColormap(colormap: ColormapSelection): void;
  setColorRange(range: ColorRange): void;
  setColorScale(scale: ColorScaleSelection): void;
  setDistributionDomain(domain: DistributionDomainSelection): void;
  setVolumeOpacity(opacity: number): void;
  setAnatomyOutlines(visible: boolean): void;
  setSlice(axis: SliceAxis, index: number): void;
  setActiveCompactView(view: WorkspaceViewId): void;
  setSecondaryTab(tab: SecondaryTabId): void;
  setMaximizedView(view: WorkspaceViewId | null): void;
  setScene3DExplode(explode: number): void;
  clearSelection(): void;
  shareCurrentView(): Promise<void>;
  downloadCurrentFeature(): void;
  downloadArtifact(artifactId: string, featureId?: string): Promise<void>;
  prepareLocal(file: File): Promise<LocalArchivePreview>;
  admitLocal(): Promise<void>;
  cancelLocal(): void;
  deleteLocal(selector: string): Promise<void>;
  inspectLocalStorage(): Promise<LocalStorageInspection>;
  verifyLocal(selector: string): Promise<LocalReleaseInspection>;
  reportError(error: unknown): void;
}

export interface ShellModel {
  state: AppState;
  catalog: DatasetCatalog | null;
  manifest: DatasetManifest | null;
  feature: FeaturePayload | null;
  displaySliceInventories: Readonly<Record<SliceAxis, DisplaySliceInventory>> | null;
  regionalPresentation: RegionalPresentation;
  presentationScale: ResolvedPresentationScale;
  presentationColormap: ResolvedPresentationColormap;
  representationDisplay: RepresentationDisplay | undefined;
  navigationRecovery: NavigationRecovery | null;
}

type LayoutMode = 'wide' | 'compact' | 'narrow' | 'phone';
type DrawerName = 'regions' | 'settings';
type HeaderAction = 'share' | 'download' | 'info' | 'help';

interface ViewFrameNodes {
  frame: HTMLElement;
  target: HTMLElement;
  viewport: ProjectionViewport;
  coordinate: HTMLElement;
  slider: HTMLInputElement;
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

interface ProjectionTooltipNodes {
  tooltip: HTMLElement;
  tooltipIdentity: HTMLElement;
  tooltipValue: HTMLElement;
  tooltipMeta: HTMLElement;
}

interface StaticFrameNodes extends ProjectionTooltipNodes {
  frame: HTMLElement;
  target: HTMLElement;
  viewport: StaticProjectionViewport;
  notice: HTMLElement;
  renderKey: string;
  renderToken: number;
}

const SLICE_LOADING_NOTICE_DELAY_MS = 400;
const LOCAL_IMPORT_OPTION_ID = '__import_local_dataset__';
const LOCAL_MANAGE_OPTION_ID = '__manage_local_datasets__';
const LOCAL_DELETE_OPTION_ID = '__delete_local_dataset__';

const ACTION_ICONS: Record<HeaderAction, string> = {
  share: '↗',
  download: '↓',
  info: 'i',
  help: '?',
};

const ACTION_LABELS: Record<HeaderAction, string> = {
  share: 'Share',
  download: 'Download',
  info: 'Info',
  help: 'Help',
};

function blocksGlobalShortcut(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches('input, textarea, select, [role="textbox"]');
}

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MiB`;
}

export class AppShell {
  private readonly app: HTMLDivElement;
  private readonly header: HTMLElement;
  private readonly body: HTMLElement;
  private readonly regionPane: HTMLElement;
  private readonly settingsPane: HTMLElement;
  private readonly panelCollapseButtons = new Map<LayoutPanel, HTMLButtonElement>();
  private readonly panelRestoreButtons = new Map<LayoutPanel, HTMLButtonElement>();
  private readonly panelResizeHandles = new Map<LayoutPanel, HTMLElement>();
  private layoutPreferences: LayoutPreferences;
  private layoutMode: LayoutMode = 'wide';
  private readonly backdrop: HTMLButtonElement;
  private readonly infoDialog: HTMLDialogElement;
  private readonly infoContent: HTMLElement;
  private readonly downloadDialog: HTMLDialogElement;
  private readonly downloadContent: HTMLElement;
  private readonly helpGuide: HelpGuide;
  private readonly helpDialog: HTMLDialogElement;
  private readonly helpTour: HelpTour;
  private readonly localImportInput: HTMLInputElement;
  private readonly localImportDialog: HTMLDialogElement;
  private readonly localImportStatus: HTMLElement;
  private readonly localImportError: HTMLElement;
  private readonly localImportSummary: HTMLElement;
  private readonly localImportConfirm: HTMLButtonElement;
  private readonly localImportCancel: HTMLButtonElement;
  private readonly localDeleteDialog: HTMLDialogElement;
  private readonly localDeleteIdentity: HTMLElement;
  private readonly localDeleteError: HTMLElement;
  private readonly localDeleteConfirm: HTMLButtonElement;
  private readonly localManagerDialog: HTMLDialogElement;
  private readonly localManagerStatus: HTMLElement;
  private readonly localManagerError: HTMLElement;
  private readonly localManagerContent: HTMLElement;
  private readonly localShareDialog: HTMLDialogElement;
  private readonly localShareError: HTMLElement;
  private readonly localShareConfirm: HTMLButtonElement;
  private readonly localDatasetBadge: HTMLElement;
  private pendingLocalDeleteSelector: string | null = null;
  private localDeleteCommitting = false;
  private localManagerSequence = 0;
  private localImportSequence = 0;
  private localImportActive = false;
  private localImportCommitting = false;
  private analysisDialog!: HTMLDialogElement;
  private readonly shortcutStatus: HTMLElement;
  private readonly viewButtons = new Map<WorkspaceViewId, HTMLButtonElement>();
  private readonly viewFrames = new Map<SliceAxis, ViewFrameNodes>();
  private readonly staticFrames = new Map<StaticProjectionId, StaticFrameNodes>();
  private readonly secondaryTabButtons = new Map<SecondaryTabId, HTMLButtonElement>();
  private readonly secondaryPanels = new Map<SecondaryTabId, HTMLElement>();
  private scene3dHost!: HTMLElement;
  private scene3dNotice!: HTMLElement;
  private scene3dExplodeInput!: HTMLInputElement;
  private scene3dExplodeValue!: HTMLOutputElement;
  private scene3dViewport: BrainScene3DViewport | null = null;
  private scene3dFailed = false;
  private scene3dPresentation: RegionalPresentation | null = null;
  private scene3dViewState: AppState['view']['scene3d'] | null = null;
  private secondaryFrame!: HTMLElement;
  private secondaryMaximize!: HTMLButtonElement;
  private readonly headerActionButtons = new Map<HeaderAction, HTMLButtonElement[]>();
  private headerActions!: HTMLElement;
  private readonly datasetContext: ContextMenu;
  private readonly dataChooser: DataChooser;
  private readonly projectContext: ContextMenu;
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
  private distributionDomainSelect!: HTMLSelectElement;
  private rangeModeSelect!: HTMLSelectElement;
  private colorRangeControl!: ColorRangeControl;
  private volumeLayerSettings!: HTMLElement;
  private volumeOpacityInput!: HTMLInputElement;
  private volumeOpacityValue!: HTMLOutputElement;
  private anatomyOutlinesInput!: HTMLInputElement;
  private featureId: string | null = null;

  constructor(
    root: HTMLElement,
    private readonly callbacks: AppShellCallbacks,
    private readonly viewportFactory: ProjectionViewportFactory,
    private readonly scene3dFactory?: BrainScene3DViewportFactory,
  ) {
    root.replaceChildren();

    this.app = element('div', 'atlas-app');
    this.app.dataset.activeView = 'coronal';
    this.layoutPreferences = this.loadLayoutPreferences();

    this.datasetContext = new ContextMenu({
      fieldName: 'dataset',
      label: 'Dataset',
      onOpen: (menu) => {
        this.closeDrawers();
        this.closeContextMenus(menu);
      },
      onSelect: (option) => {
        if (option.id === LOCAL_IMPORT_OPTION_ID) {
          this.localImportInput.click();
          return;
        }
        if (option.id === LOCAL_MANAGE_OPTION_ID) {
          void this.openLocalManager();
          return;
        }
        if (option.id === LOCAL_DELETE_OPTION_ID) {
          this.openLocalDeleteDialog();
          return;
        }
        const [datasetId, releaseId] = JSON.parse(option.id) as [DatasetId, string];
        this.callbacks.setDataset({ datasetId, releaseId });
      },
    });
    this.dataChooser = new DataChooser(
      (selection) => this.callbacks.selectData(selection),
      () => { this.closeDrawers(); this.closeContextMenus(); },
      (action) => this.callbacks.recoverNavigation(action),
    );
    this.projectContext = new ContextMenu({
      fieldName: 'project',
      label: 'Project',
      onOpen: (menu) => { this.closeDrawers(); this.closeContextMenus(menu); },
      onSelect: (option) => {
        if (option.id.startsWith('edition:')) {
          const [, projectId, editionId] = option.id.split(':');
          if (projectId && editionId) this.callbacks.selectEdition(projectId, editionId);
        } else if (option.id === 'action:custom') {
          const navigation = this.currentModel?.state.view.navigation;
          if (navigation && navigation.kind !== 'local') this.callbacks.browseCustomVersions(navigation.projectId);
        } else if (option.id.startsWith('project:')) {
          this.callbacks.selectProject(option.id.slice('project:'.length));
        } else if (option.id.startsWith('recovery:')) {
          this.callbacks.recoverNavigation(option.id.slice('recovery:'.length) as NavigationRecoveryAction);
        }
      },
    });
    this.localDatasetBadge = element('span', 'context-field__local-badge');
    this.localDatasetBadge.textContent = 'Local';
    this.localDatasetBadge.title = 'Stored only in this browser on this device';
    this.localDatasetBadge.hidden = true;
    this.datasetContext.field.querySelector('.context-field__label')?.append(this.localDatasetBadge);
    this.featureContext = new ContextMenu({
      fieldName: 'feature',
      label: 'Feature',
      keyShortcuts: '/ Shift+ArrowUp Shift+ArrowDown',
      searchable: true,
      searchPlaceholder: 'Search features…',
      onOpen: (menu) => {
        this.closeDrawers();
        this.closeContextMenus(menu);
      },
      onSelect: (option) => this.callbacks.setFeature(option.id, this.featureRepresentation.get(option.id)),
    });
    this.representationContext = new ContextMenu({
      fieldName: 'representation',
      label: 'View',
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
    this.contextMenus = [this.projectContext, this.datasetContext, this.featureContext, this.representationContext];

    this.regionPane = this.createRegionPane();
    this.settingsPane = this.createSettingsPane();
    this.backdrop = this.createBackdrop();
    const info = this.createInfoDialog();
    this.infoDialog = info.dialog;
    this.infoContent = info.content;
    const download = this.createDownloadDialog();
    this.downloadDialog = download.dialog;
    this.downloadContent = download.content;
    this.helpGuide = new HelpGuide(() => this.startHelpTour());
    this.helpDialog = this.helpGuide.dialog;
    const localImport = this.createLocalImportDialog();
    this.localImportDialog = localImport.dialog;
    this.localImportStatus = localImport.status;
    this.localImportError = localImport.error;
    this.localImportSummary = localImport.summary;
    this.localImportConfirm = localImport.confirm;
    this.localImportCancel = localImport.cancel;
    const localDelete = this.createLocalDeleteDialog();
    this.localDeleteDialog = localDelete.dialog;
    this.localDeleteIdentity = localDelete.identity;
    this.localDeleteError = localDelete.error;
    this.localDeleteConfirm = localDelete.confirm;
    const localManager = this.createLocalManagerDialog();
    this.localManagerDialog = localManager.dialog;
    this.localManagerStatus = localManager.status;
    this.localManagerError = localManager.error;
    this.localManagerContent = localManager.content;
    const localShare = this.createLocalShareDialog();
    this.localShareDialog = localShare.dialog;
    this.localShareError = localShare.error;
    this.localShareConfirm = localShare.confirm;
    this.localImportInput = element('input', 'local-import__input');
    this.localImportInput.type = 'file';
    this.localImportInput.accept = '.ibl-ephys-atlas.zip,application/zip';
    this.localImportInput.dataset.localImportInput = '';
    this.localImportInput.setAttribute('aria-label', 'Local dataset ZIP archive');
    this.localImportInput.hidden = true;
    this.localImportInput.addEventListener('change', () => {
      const file = this.localImportInput.files?.item(0);
      this.localImportInput.value = '';
      if (file) void this.prepareLocalImport(file);
    });
    this.shortcutStatus = element('div', 'visually-hidden');
    this.shortcutStatus.setAttribute('role', 'status');
    this.shortcutStatus.setAttribute('aria-live', 'polite');

    this.header = this.createHeader();
    this.body = element('main', 'app-body');
    const workspace = this.createWorkspace();
    this.body.append(
      this.regionPane,
      workspace,
      this.settingsPane,
      this.createPanelRestoreButton('regions'),
      this.createPanelRestoreButton('settings'),
    );

    this.app.append(
      this.header,
      this.body,
      this.backdrop,
      this.infoDialog,
      this.downloadDialog,
      this.helpDialog,
      this.localImportDialog,
      this.localManagerDialog,
      this.localDeleteDialog,
      this.localShareDialog,
      this.localImportInput,
      this.shortcutStatus,
    );
    root.append(this.app);

    this.helpTour = new HelpTour({
      root: this.app,
      resolveTarget: (anchor) => this.resolveHelpTourTarget(anchor),
    });

    this.applyPanelPreferences();
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

    const datasetLabel = presentDatasetTitle(
      datasetEntry?.title ?? manifest?.dataset.title ?? titleCaseToken(view.dataset.datasetId),
    ).title;
    const releaseLabel = view.dataset.releaseId ?? manifest?.dataset.release ?? datasetEntry?.defaultRelease ?? '';
    const featureLabel = featureEntry?.label ?? (view.featureId ? titleCaseToken(view.featureId) : 'No feature selected');
    const representationLabel = view.representation === 'regional' ? 'Regional' : 'Volume';

    const navigationProjectId = view.navigation.kind === 'local' ? undefined : view.navigation.projectId;
    const project = catalog?.projects.find((item) => item.id === navigationProjectId);
    const navigationEditionId = view.navigation.kind === 'edition' ? view.navigation.editionId : undefined;
    const edition = project && navigationEditionId
      ? project.editions.find((item) => item.id === navigationEditionId)
      : undefined;
    const baseEditionId = view.navigation.kind === 'custom' ? view.navigation.baseEditionId : undefined;
    const baseEdition = project && baseEditionId
      ? project.editions.find((item) => item.id === baseEditionId)
      : undefined;
    this.projectContext.setDisplay(
      view.navigation.kind === 'local' ? 'My data' : project?.title ?? titleCaseToken(navigationProjectId ?? ''),
      model.navigationRecovery ? 'Navigation unavailable · open to recover'
        : view.navigation.kind === 'edition' ? edition?.label ?? 'Edition'
        : view.navigation.kind === 'custom'
          ? `Custom versions${baseEdition ? ` · based on ${baseEdition.label}` : ''}`
          : 'Local browser data',
    );
    const release = datasetEntry?.releases.find((item) => item.id === view.dataset.releaseId);
    const releaseMeta = [release?.label ?? releaseLabel, release?.status, release?.id ? `ID · ${release.id}` : '']
      .filter(Boolean).join(' · ');
    this.datasetContext.setDisplay(datasetLabel, releaseMeta);
    this.dataChooser.update({
      catalog,
      catalogStatus: state.runtime.catalogStatus,
      error: state.runtime.catalogError,
      navigation: view.navigation,
      dataset: view.dataset,
      recovery: model.navigationRecovery,
    });
    this.localDatasetBadge.hidden = view.dataset.datasetId !== 'local';
    this.app.toggleAttribute('data-local-dataset', view.dataset.datasetId === 'local');
    this.featureContext.setDisplay(featureLabel, featureEntry?.unit ?? '');
    const parcellationLabel = titleCaseToken(view.parcellation);
    this.representationContext.setDisplay(
      view.representation === 'volume'
        ? `${representationLabel} · ${parcellationLabel} anatomy`
        : `${representationLabel} · ${parcellationLabel}`,
      'Allen CCFv3 · 10 µm',
    );
    this.renderContextMenus(model);
    this.renderColorSettings(model);
    this.renderVolumeLayerSettings(model);
    this.helpGuide.render(view.representation);
    this.renderInfo(model);
    this.renderDownloads(model);
    this.setHeaderActionDisabled('share', false);
    this.setHeaderActionDisabled('info', manifest === null);
    this.setHeaderActionDisabled('download', model.feature === null);
    this.syncWorkspaceState(view.workspace.activeCompactView, view.workspace.maximizedView);
    this.renderSecondaryView(model);

    for (const projection of ORTHOGONAL_PROJECTION_REGISTRY) {
      this.renderViewFrame(projection.id, model);
    }
  }

  showRegionTooltip(inspection: RegionInspection, model: RegionTooltipModel): void {
    this.showProjectionTooltip(inspection, model, inspection.regionId);
  }

  showVolumeTooltip(inspection: VolumeInspection, model: RegionTooltipModel): void {
    this.showProjectionTooltip(inspection, model, inspection.regionId);
  }

  private showProjectionTooltip(
    inspection: Pick<RegionInspection, 'projectionId' | 'clientX' | 'clientY'>,
    model: RegionTooltipModel,
    regionId?: string,
  ): void {
    const nodes = this.projectionTooltip(inspection.projectionId);
    if (!nodes) return;
    for (const [projectionId, frame] of this.viewFrames) {
      if (projectionId !== inspection.projectionId) frame.tooltip.hidden = true;
    }
    for (const [projectionId, frame] of this.staticFrames) {
      if (projectionId !== inspection.projectionId) frame.tooltip.hidden = true;
    }
    const contentKey = `${regionId ?? ''}\u0000${model.acronym}\u0000${model.name}\u0000${model.valueLabel ?? ''}\u0000${model.valueText ?? ''}\u0000${model.meta}`;
    if (nodes.tooltip.dataset.contentKey !== contentKey) {
      nodes.tooltip.dataset.contentKey = contentKey;
      if (regionId) nodes.tooltip.dataset.regionId = regionId;
      else delete nodes.tooltip.dataset.regionId;
      nodes.tooltipIdentity.replaceChildren();
      const acronym = element('strong', 'region-tooltip__acronym');
      acronym.textContent = model.acronym;
      const name = element('span', 'region-tooltip__name');
      name.textContent = model.name;
      nodes.tooltipIdentity.append(acronym, name);
      nodes.tooltipValue.hidden = !model.valueText;
      nodes.tooltipValue.replaceChildren();
      if (model.valueText) {
        if (model.valueLabel) {
          const label = element('span', 'region-tooltip__value-label');
          label.textContent = model.valueLabel;
          nodes.tooltipValue.append(label);
        }
        const value = element('strong', 'region-tooltip__value-text');
        value.textContent = model.valueText;
        nodes.tooltipValue.append(value);
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

  hideRegionTooltip(except?: import('../domain/types.js').ProjectionId): void {
    if (except) {
      const tooltip = this.projectionTooltip(except)?.tooltip;
      if (tooltip) tooltip.hidden = true;
      return;
    }
    for (const nodes of this.viewFrames.values()) nodes.tooltip.hidden = true;
    for (const nodes of this.staticFrames.values()) nodes.tooltip.hidden = true;
  }

  destroy(): void {
    if (this.localImportActive) this.cancelLocalImport();
    this.helpTour.destroy();
    this.colorRangeControl.destroy();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);
    this.contextMenus.forEach((menu) => menu.destroy());
    this.dataChooser.destroy();
    for (const nodes of this.viewFrames.values()) {
      if (nodes.loadingNoticeTimer !== null) window.clearTimeout(nodes.loadingNoticeTimer);
    }
    this.viewportFactory.destroy();
    this.scene3dFactory?.destroy();
  }

  private createHeader(): HTMLElement {
    const header = element('header', 'app-header');

    const brand = element('div', 'app-header__brand');
    const logo = document.createElement('img');
    logo.className = 'app-header__logo';
    logo.src = '/brand/ibl-core-logo.svg';
    logo.alt = 'IBL Core';
    logo.width = 240;
    logo.height = 209;
    const logoLink = element('a', 'app-header__logo-link');
    logoLink.href = 'https://iblcore.org/';
    logoLink.target = '_blank';
    logoLink.rel = 'noopener noreferrer';
    logoLink.setAttribute('aria-label', 'Visit the IBL Core website (opens in a new tab)');
    logoLink.append(logo);
    const brandText = element('div', 'app-header__brand-text');
    const title = heading('Ephys Atlas', 1);
    const version = element('span', 'app-header__version');
    version.textContent = 'v2';
    brandText.append(title, version);
    brand.append(logoLink, brandText);

    const context = element('dl', 'app-header__context');
    context.setAttribute('aria-label', 'Atlas context');
    context.dataset.helpAnchor = 'context';
    context.append(
      this.dataChooser.element,
      this.projectContext.field,
      this.datasetContext.field,
      this.featureContext.field,
      this.representationContext.field,
    );

    const actions = element('nav', 'app-header__actions');
    actions.setAttribute('aria-label', 'Atlas actions');
    this.headerActions = actions;
    actions.append(this.drawerButton('regions', 'Regions', '☰'), this.drawerButton('settings', 'Settings', '⚙'));

    const desktopActions = element('div', 'app-header__desktop-actions');
    desktopActions.dataset.helpAnchor = 'actions';
    desktopActions.append(
      this.headerActionButton('Share', 'share'),
      this.headerActionButton('Download', 'download'),
      this.headerActionButton('Info', 'info'),
      this.headerActionButton('Help', 'help'),
    );
    actions.append(desktopActions, this.createOverflowActions());

    header.append(brand, context, actions);
    return header;
  }

  private drawerButton(drawer: DrawerName, label: string, iconText: string): HTMLButtonElement {
    const button = element('button', 'app-header__panel-button');
    button.type = 'button';
    button.dataset.drawerTrigger = drawer;
    if (drawer === 'regions') button.dataset.helpAnchor = 'regions';
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
    if (action === 'help') {
      this.openHelpDialog();
      return;
    }
    if (action === 'info') {
      if (!this.infoDialog.open) this.infoDialog.showModal();
      if (this.overflowActions) this.overflowActions.open = false;
      return;
    }
    if (action === 'download') {
      if (!this.downloadDialog.open) this.downloadDialog.showModal();
      if (this.overflowActions) this.overflowActions.open = false;
      return;
    }
    if (this.currentModel?.state.view.dataset.datasetId === 'local') {
      this.localShareError.hidden = true;
      this.localShareError.textContent = '';
      this.localShareConfirm.disabled = false;
      if (!this.localShareDialog.open) this.localShareDialog.showModal();
      this.localShareConfirm.focus();
      if (this.overflowActions) this.overflowActions.open = false;
      return;
    }
    try {
      await this.copyCurrentView();
    } catch (error) {
      button.title = 'Could not copy link';
      this.callbacks.reportError(error);
    }
    if (this.overflowActions) this.overflowActions.open = false;
  }

  private async copyCurrentView(): Promise<void> {
    await this.callbacks.shareCurrentView();
    this.showActionFeedback('share', 'Copied', 'Link copied to clipboard');
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
        if (text) text.textContent = ACTION_LABELS[action];
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
    summary.dataset.helpAnchor = 'actions';
    summary.setAttribute('aria-label', 'More actions');
    summary.append(this.actionIcon('⋯'));
    const menu = element('div', 'app-header__overflow-menu');
    menu.append(
      this.headerActionButton('Share', 'share'),
      this.headerActionButton('Download', 'download'),
      this.headerActionButton('Info', 'info'),
      this.headerActionButton('Help', 'help'),
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

  private createDownloadDialog(): { dialog: HTMLDialogElement; content: HTMLElement } {
    const dialog = element('dialog', 'info-dialog download-dialog');
    dialog.setAttribute('aria-labelledby', 'download-dialog-title');
    const header = element('header', 'info-dialog__header');
    const title = heading('Download feature data', 2);
    title.id = 'download-dialog-title';
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

  private createLocalImportDialog(): {
    dialog: HTMLDialogElement;
    status: HTMLElement;
    error: HTMLElement;
    summary: HTMLElement;
    confirm: HTMLButtonElement;
    cancel: HTMLButtonElement;
  } {
    const dialog = element('dialog', 'info-dialog local-import');
    dialog.dataset.localImportDialog = '';
    dialog.setAttribute('aria-labelledby', 'local-import-title');
    dialog.setAttribute('aria-describedby', 'local-import-note');

    const header = element('header', 'info-dialog__header');
    const title = heading('Import local dataset', 2);
    title.id = 'local-import-title';
    const close = element('button', 'info-dialog__close');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.cancelLocalImport());
    header.append(title, close);

    const content = element('div', 'info-dialog__content local-import__content');
    const introduction = element('section', 'info-dialog__section');
    const note = element('p', 'local-import__note');
    note.id = 'local-import-note';
    note.textContent = 'The archive is validated and stored only in this browser on this device. Its contents are not uploaded.';
    const status = element('p', 'local-import__status');
    status.dataset.localImportStatus = '';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const error = element('p', 'download-dialog__error local-import__error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    introduction.append(note, status, error);

    const summary = element('section', 'info-dialog__section local-import__summary');
    summary.dataset.localImportPreview = '';
    summary.hidden = true;

    const actions = element('footer', 'local-import__actions');
    const cancel = element('button', 'local-import__cancel');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.cancelLocalImport());
    const confirm = element('button', 'local-import__confirm');
    confirm.type = 'button';
    confirm.textContent = 'Import';
    confirm.disabled = true;
    confirm.addEventListener('click', () => void this.admitLocalImport());
    actions.append(cancel, confirm);

    content.append(introduction, summary, actions);
    dialog.append(header, content);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.cancelLocalImport();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) this.cancelLocalImport();
    });
    return { dialog, status, error, summary, confirm, cancel };
  }

  private createLocalDeleteDialog(): {
    dialog: HTMLDialogElement;
    identity: HTMLElement;
    error: HTMLElement;
    confirm: HTMLButtonElement;
  } {
    const dialog = element('dialog', 'info-dialog local-delete');
    dialog.dataset.localDeleteDialog = '';
    dialog.setAttribute('aria-labelledby', 'local-delete-title');
    dialog.setAttribute('aria-describedby', 'local-delete-note');
    const header = element('header', 'info-dialog__header');
    const title = heading('Delete local dataset', 2);
    title.id = 'local-delete-title';
    const close = element('button', 'info-dialog__close');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.closeLocalDeleteDialog());
    header.append(title, close);

    const content = element('div', 'info-dialog__content local-delete__content');
    const section = element('section', 'info-dialog__section');
    const note = element('p', 'local-delete__note');
    note.id = 'local-delete-note';
    note.textContent = 'This removes the release and all of its resources from this browser on this device. It does not affect the source archive or published data.';
    const identity = element('p', 'local-delete__identity');
    identity.dataset.localDeleteIdentity = '';
    const error = element('p', 'download-dialog__error local-delete__error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    section.append(note, identity, error);

    const actions = element('footer', 'local-import__actions');
    const cancel = element('button', 'local-import__cancel');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.closeLocalDeleteDialog());
    const confirm = element('button', 'local-delete__confirm');
    confirm.type = 'button';
    confirm.textContent = 'Delete local dataset';
    confirm.addEventListener('click', () => void this.commitLocalDelete());
    actions.append(cancel, confirm);
    content.append(section, actions);
    dialog.append(header, content);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.closeLocalDeleteDialog();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) this.closeLocalDeleteDialog();
    });
    return { dialog, identity, error, confirm };
  }

  private createLocalManagerDialog(): {
    dialog: HTMLDialogElement;
    status: HTMLElement;
    error: HTMLElement;
    content: HTMLElement;
  } {
    const dialog = element('dialog', 'info-dialog local-manager');
    dialog.dataset.localManagerDialog = '';
    dialog.setAttribute('aria-labelledby', 'local-manager-title');
    const header = element('header', 'info-dialog__header');
    const title = heading('Local datasets', 2);
    title.id = 'local-manager-title';
    const close = element('button', 'info-dialog__close');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => dialog.close());
    header.append(title, close);

    const body = element('div', 'info-dialog__content local-manager__body');
    const introduction = element('section', 'info-dialog__section');
    const note = element('p', 'local-manager__note');
    note.textContent = 'These immutable releases are stored separately from published-data caches and remain only in this browser profile.';
    const status = element('p', 'local-manager__status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const error = element('p', 'download-dialog__error local-manager__error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    introduction.append(note, status, error);
    const content = element('section', 'local-manager__content');
    body.append(introduction, content);
    dialog.append(header, body);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    return { dialog, status, error, content };
  }

  private async openLocalManager(): Promise<void> {
    const sequence = ++this.localManagerSequence;
    this.localManagerStatus.textContent = 'Inspecting browser storage…';
    this.localManagerError.hidden = true;
    this.localManagerError.textContent = '';
    this.localManagerContent.replaceChildren();
    if (!this.localManagerDialog.open) this.localManagerDialog.showModal();
    try {
      const inspection = await this.callbacks.inspectLocalStorage();
      if (sequence !== this.localManagerSequence) return;
      this.renderLocalManager(inspection);
      this.localManagerStatus.textContent = inspection.releases.length
        ? `${inspection.releases.length.toLocaleString('en-US')} local release${inspection.releases.length === 1 ? '' : 's'}`
        : 'No local releases are stored.';
    } catch (error) {
      if (sequence !== this.localManagerSequence) return;
      this.localManagerStatus.textContent = 'Local browser storage could not be inspected.';
      this.localManagerError.textContent = error instanceof Error ? error.message : String(error);
      this.localManagerError.hidden = false;
    }
  }

  private renderLocalManager(inspection: LocalStorageInspection): void {
    const storage = element('section', 'local-manager__storage');
    storage.append(heading('Browser storage', 3));
    const storageDetails = element('dl', 'info-dialog__list local-manager__storage-list');
    const storageRows: (readonly [string, string])[] = [];
    if (inspection.usageBytes !== undefined) storageRows.push(['Site data in use', formatBytes(inspection.usageBytes)]);
    if (inspection.quotaBytes !== undefined) storageRows.push(['Estimated site quota', formatBytes(inspection.quotaBytes)]);
    storageRows.push(['Persistence', inspection.persisted === undefined
      ? 'Not reported by this browser'
      : inspection.persisted ? 'Granted' : 'Not granted; the browser may evict site data']);
    for (const [term, description] of storageRows) {
      const dt = element('dt');
      dt.textContent = term;
      const dd = element('dd');
      dd.textContent = description;
      storageDetails.append(dt, dd);
    }
    const caveat = element('p', 'local-manager__storage-note');
    caveat.textContent = 'Usage and quota are browser estimates for all data stored by this site, not just imported releases.';
    storage.append(storageDetails, caveat);

    const releases = element('section', 'local-manager__releases');
    releases.append(heading('Imported releases', 3));
    if (!inspection.releases.length) {
      const empty = element('p', 'local-manager__empty');
      empty.textContent = 'Use “Import local dataset…” to add a validated .ibl-ephys-atlas.zip archive.';
      releases.append(empty);
    } else {
      for (const release of inspection.releases) releases.append(this.localReleaseCard(release));
    }
    this.localManagerContent.replaceChildren(storage, releases);
  }

  private localReleaseCard(release: LocalReleaseInspection): HTMLElement {
    const card = element('article', 'local-manager__release');
    card.dataset.localRelease = release.selector;
    const title = heading(release.title, 3);
    const details = element('dl', 'info-dialog__list local-manager__release-list');
    const checked = release.integrityCheckedAt
      ? ` · checked ${this.formatLocalDate(release.integrityCheckedAt)}`
      : '';
    const integrity = release.integrityState === 'verified'
      ? `Verified${checked}`
      : release.integrityState === 'damaged'
        ? `Damaged${checked}`
        : 'Not verifiable; imported before integrity records were available';
    const rows: readonly (readonly [string, string])[] = [
      ['Source dataset', release.sourceDatasetId],
      ['Source release', release.sourceReleaseId],
      ['Local identity', release.selector],
      ['Imported', release.importedAt ? this.formatLocalDate(release.importedAt) : 'Not recorded'],
      ['Stored data', `${formatBytes(release.storedBytes)} · ${release.resourceCount.toLocaleString('en-US')} resource${release.resourceCount === 1 ? '' : 's'}`],
      ['Integrity', integrity],
    ];
    for (const [term, description] of rows) {
      const dt = element('dt');
      dt.textContent = term;
      const dd = element('dd');
      dd.textContent = description;
      details.append(dt, dd);
    }
    if (release.integrityMessage) {
      const problem = element('p', 'local-manager__integrity-error');
      problem.setAttribute('role', 'alert');
      problem.textContent = `${release.integrityMessage} Remove this damaged release, then import the source archive again.`;
      card.append(title, details, problem);
    } else {
      card.append(title, details);
    }

    const actions = element('div', 'local-manager__release-actions');
    const select = element('button', 'local-manager__select');
    select.type = 'button';
    select.textContent = 'Select';
    select.addEventListener('click', () => {
      this.callbacks.setDataset({ datasetId: 'local', releaseId: release.selector });
      this.localManagerDialog.close();
    });
    const verify = element('button', 'local-manager__verify');
    verify.type = 'button';
    verify.textContent = 'Verify integrity';
    verify.disabled = release.integrityState === 'unverified';
    if (release.integrityState === 'unverified') verify.title = 'Reimport the source archive to enable complete integrity checks';
    verify.addEventListener('click', () => void this.verifyManagedRelease(release.selector, verify));
    const remove = element('button', 'local-manager__remove');
    remove.type = 'button';
    remove.textContent = release.integrityState === 'damaged' ? 'Remove damaged release…' : 'Delete…';
    remove.addEventListener('click', () => {
      this.localManagerDialog.close();
      this.openLocalDeleteDialog(release.selector, `${release.title} · ${release.selector}`);
    });
    actions.append(select, verify, remove);
    card.append(actions);
    return card;
  }

  private async verifyManagedRelease(selector: string, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    this.localManagerStatus.textContent = `Verifying ${selector}…`;
    this.localManagerError.hidden = true;
    try {
      await this.callbacks.verifyLocal(selector);
      await this.openLocalManager();
    } catch (error) {
      this.localManagerStatus.textContent = `Could not verify ${selector}.`;
      this.localManagerError.textContent = error instanceof Error ? error.message : String(error);
      this.localManagerError.hidden = false;
      button.disabled = false;
    }
  }

  private formatLocalDate(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.valueOf())) return value;
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  private openLocalDeleteDialog(selector?: string, label?: string): void {
    const view = this.currentModel?.state.view;
    const activeSelector = view?.dataset.datasetId === 'local' ? view.dataset.releaseId : null;
    const resolvedSelector = selector ?? activeSelector;
    if (!resolvedSelector) return;
    this.pendingLocalDeleteSelector = resolvedSelector;
    const manifest = this.currentModel?.manifest;
    this.localDeleteIdentity.textContent = label ?? (manifest && activeSelector === resolvedSelector
      ? `${manifest.dataset.title} · ${resolvedSelector}`
      : resolvedSelector);
    this.localDeleteError.hidden = true;
    this.localDeleteError.textContent = '';
    this.localDeleteConfirm.disabled = false;
    if (!this.localDeleteDialog.open) this.localDeleteDialog.showModal();
    this.localDeleteConfirm.focus();
  }

  private closeLocalDeleteDialog(): void {
    if (this.localDeleteCommitting) return;
    this.pendingLocalDeleteSelector = null;
    if (this.localDeleteDialog.open) this.localDeleteDialog.close();
  }

  private async commitLocalDelete(): Promise<void> {
    const selector = this.pendingLocalDeleteSelector;
    if (!selector || this.localDeleteCommitting) return;
    this.localDeleteCommitting = true;
    this.localDeleteConfirm.disabled = true;
    this.localDeleteError.hidden = true;
    try {
      await this.callbacks.deleteLocal(selector);
      this.pendingLocalDeleteSelector = null;
      this.localDeleteDialog.close();
    } catch (error) {
      this.localDeleteError.textContent = error instanceof Error ? error.message : String(error);
      this.localDeleteError.hidden = false;
      this.localDeleteConfirm.disabled = false;
    } finally {
      this.localDeleteCommitting = false;
    }
  }

  private createLocalShareDialog(): {
    dialog: HTMLDialogElement;
    error: HTMLElement;
    confirm: HTMLButtonElement;
  } {
    const dialog = element('dialog', 'info-dialog local-share');
    dialog.dataset.localShareDialog = '';
    dialog.setAttribute('aria-labelledby', 'local-share-title');
    dialog.setAttribute('aria-describedby', 'local-share-note');
    const header = element('header', 'info-dialog__header');
    const title = heading('Share local view', 2);
    title.id = 'local-share-title';
    const close = element('button', 'info-dialog__close');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => dialog.close());
    header.append(title, close);
    const content = element('div', 'info-dialog__content local-share__content');
    const section = element('section', 'info-dialog__section');
    const note = element('p', 'local-share__note');
    note.id = 'local-share-note';
    note.textContent = 'This link does not contain or transfer the dataset. It works only in a browser where the exact local release is already imported.';
    const error = element('p', 'download-dialog__error local-share__error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    section.append(note, error);
    const actions = element('footer', 'local-import__actions');
    const cancel = element('button', 'local-import__cancel');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => dialog.close());
    const confirm = element('button', 'local-import__confirm');
    confirm.type = 'button';
    confirm.textContent = 'Copy local link';
    confirm.addEventListener('click', () => void this.confirmLocalShare());
    actions.append(cancel, confirm);
    content.append(section, actions);
    dialog.append(header, content);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      dialog.close();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    return { dialog, error, confirm };
  }

  private async confirmLocalShare(): Promise<void> {
    this.localShareConfirm.disabled = true;
    this.localShareError.hidden = true;
    try {
      await this.copyCurrentView();
      this.localShareDialog.close();
    } catch (error) {
      this.localShareError.textContent = error instanceof Error ? error.message : String(error);
      this.localShareError.hidden = false;
    } finally {
      this.localShareConfirm.disabled = false;
    }
  }

  private async prepareLocalImport(file: File): Promise<void> {
    const sequence = ++this.localImportSequence;
    this.localImportActive = true;
    this.localImportCommitting = false;
    this.localImportConfirm.disabled = true;
    this.localImportCancel.disabled = false;
    this.localImportSummary.hidden = true;
    this.localImportSummary.replaceChildren();
    this.localImportError.hidden = true;
    this.localImportError.textContent = '';
    this.localImportStatus.textContent = `Validating ${file.name}…`;
    if (!this.localImportDialog.open) this.localImportDialog.showModal();

    try {
      if (!file.name.toLocaleLowerCase('en-US').endsWith('.ibl-ephys-atlas.zip')) {
        throw new Error('Choose one .ibl-ephys-atlas.zip archive');
      }
      const preview = await this.callbacks.prepareLocal(file);
      if (sequence !== this.localImportSequence || !this.localImportActive) return;
      this.renderLocalImportPreview(file, preview);
      this.localImportStatus.textContent = 'Validation complete. Review the release before importing it.';
      this.localImportConfirm.disabled = false;
      this.localImportConfirm.focus();
    } catch (error) {
      if (sequence !== this.localImportSequence) return;
      this.callbacks.cancelLocal();
      this.localImportActive = false;
      this.localImportStatus.textContent = `Could not validate ${file.name}.`;
      this.localImportError.textContent = error instanceof Error ? error.message : String(error);
      this.localImportError.hidden = false;
    }
  }

  private renderLocalImportPreview(file: File, preview: LocalArchivePreview): void {
    const headingNode = heading(preview.title, 3);
    const details = element('dl', 'info-dialog__list local-import__list');
    const rows: readonly (readonly [string, string])[] = [
      ['Archive', file.name],
      ['Dataset', preview.datasetId],
      ['Release', preview.releaseId],
      ['Provenance', preview.provenanceSummary],
      ['Features', `${preview.featureCount.toLocaleString('en-US')} · ${preview.featureIds.join(', ')}`],
      ['Representations', preview.representations.map(titleCaseToken).join(', ') || 'None'],
      ['Parcellations', preview.parcellations.map(titleCaseToken).join(', ') || 'None'],
      ['Files', preview.fileCount.toLocaleString('en-US')],
      ['Archive size', formatBytes(preview.archiveBytes)],
      ['Stored size', formatBytes(preview.storedBytes)],
      ['Declared decoded size', formatBytes(preview.declaredDecodedBytes)],
    ];
    for (const [term, description] of rows) {
      const dt = element('dt');
      dt.textContent = term;
      const dd = element('dd');
      dd.textContent = description;
      details.append(dt, dd);
    }
    const identity = element('p', 'local-import__identity');
    identity.textContent = `Local identity: ${preview.selector}`;
    this.localImportSummary.replaceChildren(headingNode, details, identity);
    this.localImportSummary.hidden = false;
  }

  private async admitLocalImport(): Promise<void> {
    if (!this.localImportActive || this.localImportCommitting) return;
    this.localImportCommitting = true;
    this.localImportConfirm.disabled = true;
    this.localImportCancel.disabled = true;
    this.localImportStatus.textContent = 'Storing the validated release on this device…';
    this.localImportError.hidden = true;
    try {
      await this.callbacks.admitLocal();
      this.localImportActive = false;
      this.localImportStatus.textContent = 'Import complete.';
      this.localImportDialog.close();
    } catch (error) {
      this.localImportStatus.textContent = 'The validated release could not be stored.';
      this.localImportError.textContent = error instanceof Error ? error.message : String(error);
      this.localImportError.hidden = false;
      this.localImportConfirm.disabled = false;
      this.localImportCancel.disabled = false;
    } finally {
      this.localImportCommitting = false;
    }
  }

  private cancelLocalImport(): void {
    if (this.localImportCommitting) return;
    this.localImportSequence += 1;
    if (this.localImportActive) this.callbacks.cancelLocal();
    this.localImportActive = false;
    if (this.localImportDialog.open) this.localImportDialog.close();
  }

  private openHelpDialog(): void {
    this.closeContextMenus();
    this.closeDrawers();
    if (this.overflowActions) this.overflowActions.open = false;
    if (!this.helpDialog.open) this.helpDialog.showModal();
  }

  private startHelpTour(): void {
    const representation = this.currentModel?.state.view.representation ?? 'regional';
    const returnFocus = this.layoutMode === 'narrow' || this.layoutMode === 'phone'
      ? this.overflowActions?.querySelector<HTMLElement>('.app-header__overflow-trigger') ?? null
      : (this.headerActionButtons.get('help') ?? []).find((button) => this.isVisibleTourTarget(button)) ?? null;
    this.helpDialog.close();
    this.closeContextMenus();
    this.closeDrawers();
    if (this.overflowActions) this.overflowActions.open = false;
    window.requestAnimationFrame(() => this.helpTour.start(representation, returnFocus));
  }

  private resolveHelpTourTarget(anchor: HelpTourAnchor): HTMLElement | null {
    const candidates = [...this.app.querySelectorAll<HTMLElement>(`[data-help-anchor="${anchor}"]`)]
      .filter((candidate) => this.isVisibleTourTarget(candidate));
    if (anchor === 'navigation') {
      const activeView = this.app.dataset.activeView;
      return candidates.find((candidate) => candidate.dataset.view === activeView) ?? candidates[0] ?? null;
    }
    return candidates[0] ?? null;
  }

  private isVisibleTourTarget(target: HTMLElement): boolean {
    const style = window.getComputedStyle(target);
    const bounds = target.getBoundingClientRect();
    return !target.hidden
      && style.display !== 'none'
      && style.visibility !== 'hidden'
      && bounds.width > 0
      && bounds.height > 0;
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
      [state.view.representation === 'volume' ? 'Anatomy parcellation' : 'Parcellation', titleCaseToken(state.view.parcellation)],
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

  private renderDownloads(model: ShellModel): void {
    const { manifest, feature: payload, state } = model;
    const feature = manifest?.features.find((item) => item.id === state.view.featureId);
    if (!manifest || !feature || !payload) {
      this.downloadContent.replaceChildren();
      return;
    }

    const intro = element('section', 'info-dialog__section download-dialog__intro');
    intro.append(heading(feature.label, 3), this.infoParagraph(
      'Downloads preserve the bytes declared by this immutable release. File descriptions identify their scope; presentation settings do not alter them.',
    ));
    if (state.runtime.datasetStatus === 'error' && state.runtime.error) {
      const error = element('p', 'download-dialog__error');
      error.setAttribute('role', 'alert');
      error.textContent = state.runtime.error;
      intro.append(error);
    }
    const sections: HTMLElement[] = [intro];

    if (payload.representation === 'regional') {
      const derived = element('section', 'info-dialog__section');
      derived.append(heading('Current view export', 3));
      const button = this.downloadButton(
        `Export ${titleCaseToken(state.view.parcellation)} ${titleCaseToken(state.view.coloring.statistic)} as CSV`,
        'Generated from the loaded regional values with dataset, release, feature, representation, parcellation, statistic, unit, and region context.',
        () => {
          this.callbacks.downloadCurrentFeature();
          this.downloadDialog.close();
        },
      );
      derived.append(button);
      sections.push(derived);
    }

    sections.push(this.artifactSection('Feature artifacts', feature.artifacts, feature.id));
    if (manifest.artifacts.length) sections.push(this.artifactSection('Release artifacts', manifest.artifacts));
    this.downloadContent.replaceChildren(...sections);
  }

  private artifactSection(
    title: string,
    artifacts: DatasetManifest['artifacts'],
    featureId?: string,
  ): HTMLElement {
    const section = element('section', 'info-dialog__section');
    section.append(heading(title, 3));
    if (!artifacts.length) {
      const empty = this.infoParagraph('This release declares no downloadable artifacts for the selected feature.');
      empty.className = 'download-dialog__empty';
      section.append(empty);
      return section;
    }
    const list = element('div', 'download-dialog__list');
    for (const artifact of artifacts) {
      const filename = artifact.resource.path.split('/').at(-1) ?? artifact.id;
      const description = artifact.description || `Declared ${titleCaseToken(artifact.role)} artifact`;
      const button = this.downloadButton(
        description,
        `${titleCaseToken(artifact.role)} · ${filename} · ${formatBytes(artifact.resource.bytes)}`,
        async (target) => {
          target.disabled = true;
          target.dataset.loading = 'true';
          try {
            await this.callbacks.downloadArtifact(artifact.id, featureId);
            this.downloadDialog.close();
          } catch (error) {
            this.callbacks.reportError(error);
          } finally {
            target.disabled = false;
            delete target.dataset.loading;
          }
        },
      );
      button.dataset.artifactId = artifact.id;
      list.append(button);
    }
    section.append(list);
    return section;
  }

  private downloadButton(
    label: string,
    detail: string,
    activate: (button: HTMLButtonElement) => void | Promise<void>,
  ): HTMLButtonElement {
    const button = element('button', 'download-dialog__item');
    button.type = 'button';
    const labelNode = element('strong');
    labelNode.textContent = label;
    const detailNode = element('span');
    detailNode.textContent = detail;
    button.append(labelNode, detailNode);
    button.addEventListener('click', () => void activate(button));
    return button;
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
    pane.dataset.helpAnchor = 'regions';

    const panelHeader = this.panelHeader('Brain regions', 'regions', () => this.closeDrawers());
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

    pane.append(panelHeader, search, browser, selected, this.createPanelResizeHandle('regions'));
    return pane;
  }

  private createSettingsPane(): HTMLElement {
    const pane = element('aside', 'settings-pane panel');
    pane.id = 'settings-pane';
    pane.setAttribute('aria-label', 'Visualization settings');
    pane.dataset.open = 'false';
    const panelHeader = this.panelHeader('Visualization settings', 'settings', () => this.closeDrawers());
    const content = element('div', 'settings-pane__content');
    content.append(this.createColorSettings(), this.createVolumeLayerSettings());
    pane.append(panelHeader, content, this.createPanelResizeHandle('settings'));
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
      ['mean', 'Mean'], ['median', 'Median'], ['std', 'Standard deviation'], ['min', 'Minimum'], ['max', 'Maximum'], ['count', 'Count'],
    ]);
    this.statisticSelect = statistic.select;
    this.statisticSelect.setAttribute('aria-label', 'Regional statistic');
    this.statisticSelect.addEventListener('change', () => this.callbacks.setStatistic(this.statisticSelect.value as ColorStatisticId));
    const colormap = this.settingsSelect('Colormap', COLORMAPS.map(({ id, label }) => [id, label]));
    this.colormapSelect = colormap.select;
    this.colormapSelect.setAttribute('aria-label', 'Feature colormap');
    this.colormapSelect.addEventListener('change', () => this.callbacks.setColormap(this.colormapSelect.value as ColormapSelection));
    const scale = this.settingsSelect('Value scale', [['auto', 'Auto (Linear)'], ['linear', 'Linear'], ['log', 'Log'], ['symlog', 'Signed log']]);
    this.scaleSelect = scale.select;
    this.scaleSelect.setAttribute('aria-label', 'Value scale');
    this.scaleSelect.title = 'Controls color normalization, distribution spacing, and range-handle geometry.';
    this.scaleSelect.addEventListener('change', () => this.callbacks.setColorScale(this.scaleSelect.value as ColorScaleSelection));
    const distributionDomain = this.settingsSelect('Distribution domain', [['auto', 'Auto (Full)'], ['full', 'Full'], ['focused', 'Focused']]);
    this.distributionDomainSelect = distributionDomain.select;
    this.distributionDomainSelect.setAttribute('aria-label', 'Distribution domain');
    this.distributionDomainSelect.title = 'Changes the analytical and compact range histogram viewport without changing color bounds or brain coloring.';
    this.distributionDomainSelect.addEventListener('change', () => this.callbacks.setDistributionDomain(
      this.distributionDomainSelect.value as DistributionDomainSelection,
    ));
    const rangeMode = this.settingsSelect('Range', [['auto', 'Robust auto'], ['fixed', 'Manual']]);
    this.rangeModeSelect = rangeMode.select;
    this.rangeModeSelect.setAttribute('aria-label', 'Color range mode');
    this.rangeModeSelect.addEventListener('change', () => this.onRangeModeChanged());

    this.colorRangeControl = new ColorRangeControl(
      (range) => this.callbacks.setColorRange(range),
      () => this.callbacks.setColormap('auto'),
    );

    group.append(colorMode.row, statistic.row, colormap.row, scale.row, distributionDomain.row, rangeMode.row, this.colorRangeControl.element);
    return group;
  }

  private createVolumeLayerSettings(): HTMLElement {
    const group = element('section', 'settings-placeholder settings-controls volume-layer-settings');
    group.append(heading('Volume layers', 3));

    const opacityRow = element('label', 'settings-control');
    const opacityLabel = element('span', 'settings-control__label');
    opacityLabel.textContent = 'Volume opacity';
    this.volumeOpacityInput = element('input', 'settings-control__range');
    this.volumeOpacityInput.type = 'range';
    this.volumeOpacityInput.min = '0';
    this.volumeOpacityInput.max = '1';
    this.volumeOpacityInput.step = '0.05';
    this.volumeOpacityInput.setAttribute('aria-label', 'Volume opacity');
    this.volumeOpacityValue = element('output', 'settings-control__value');
    this.volumeOpacityInput.addEventListener('input', () => {
      const opacity = this.volumeOpacityInput.valueAsNumber;
      this.volumeOpacityValue.value = `${Math.round(opacity * 100)}%`;
      this.callbacks.setVolumeOpacity(opacity);
    });
    opacityRow.append(opacityLabel, this.volumeOpacityInput, this.volumeOpacityValue);

    const outlinesRow = element('label', 'settings-control settings-control--toggle');
    const outlinesLabel = element('span', 'settings-control__label');
    outlinesLabel.textContent = 'Anatomy outlines';
    this.anatomyOutlinesInput = element('input', 'settings-control__checkbox');
    this.anatomyOutlinesInput.type = 'checkbox';
    this.anatomyOutlinesInput.setAttribute('aria-label', 'Show anatomy outlines');
    this.anatomyOutlinesInput.addEventListener('change', () => {
      this.callbacks.setAnatomyOutlines(this.anatomyOutlinesInput.checked);
    });
    outlinesRow.append(outlinesLabel, this.anatomyOutlinesInput);

    group.append(opacityRow, outlinesRow);
    this.volumeLayerSettings = group;
    return group;
  }

  private renderContextMenus(model: ShellModel): void {
    const { catalog, manifest, state } = model;
    this.featureId = state.view.featureId;
    const activeProjectId = state.view.navigation.kind === 'local'
      ? undefined : state.view.navigation.projectId;
    const projectOptions: ContextMenuOption[] = catalog?.projects.map((project) => ({
      id: `project:${project.id}`, label: project.title,
      ...(project.description ? { description: project.description } : {}),
      group: 'Projects', keywords: `${project.id} ${project.title}`,
    })) ?? [];
    if (state.runtime.catalogStatus === 'error') projectOptions.push({
      id: 'recovery:catalog', label: 'Retry catalog',
      description: 'Load and validate the public catalog again.', group: 'Catalog recovery',
    });
    const activeProject = catalog?.projects.find(({ id }) => id === activeProjectId);
    if (activeProject) projectOptions.push(...activeProject.editions.map((edition) => ({
        id: `edition:${activeProject.id}:${edition.id}`, label: edition.label,
        ...(edition.description ? { description: edition.description } : { description: `Coordinated ${activeProject.title} release set` }),
        group: `${activeProject.title} editions`,
        keywords: `${activeProject.id} ${edition.id} ${edition.label}`,
      })));
    if (activeProjectId) projectOptions.push({
      id: 'action:custom', label: 'Browse custom versions', description: 'Choose releases independently.', group: `${activeProject?.title ?? 'Project'} editions`,
    });
    if (model.navigationRecovery) {
      projectOptions.push({
        id: 'recovery:default', label: 'Use catalog default',
        description: 'Replace the invalid request with the catalog-owned default.', group: 'Navigation recovery',
      });
      if (model.navigationRecovery.canReturnToEdition) projectOptions.push({
        id: 'recovery:edition', label: 'Return to edition',
        description: 'Use the exact release mapped by the requested edition.', group: 'Navigation recovery',
      });
      if (model.navigationRecovery.canOpenExactAsCustom) projectOptions.push({
        id: 'recovery:custom', label: 'Open exact release as custom',
        description: 'Keep the requested immutable release outside coordinated edition context.', group: 'Navigation recovery',
      });
    }
    const activeProjectOption = state.view.navigation.kind === 'edition'
      ? `edition:${state.view.navigation.projectId}:${state.view.navigation.editionId}`
      : state.view.navigation.kind === 'custom' ? 'action:custom' : '';
    this.projectContext.setOptions(projectOptions, [activeProjectOption], {
      emptyMessage: state.runtime.catalogStatus === 'error' ? 'Projects unavailable.' : 'Loading projects…',
      busy: state.runtime.catalogStatus === 'loading' || state.runtime.catalogStatus === 'idle',
    });
    const releaseOptions: ContextMenuOption[] = catalog?.datasets
      .filter((dataset) => dataset.source === 'local' || dataset.projectId === activeProjectId)
      .flatMap((dataset) => {
      return dataset.releases.map((release) => ({
        id: JSON.stringify([dataset.id, release.id]),
        label: release.label,
        ...(release.status ? { badge: titleCaseToken(release.status) } : {}),
        ...(release.description || dataset.description
          ? { description: release.description ?? dataset.description }
          : {}),
        ...(dataset.source === 'local' ? { detail: 'Stored only in this browser' } : {}),
        metadata: `Immutable release ID · ${release.id}`,
        group: dataset.source === 'local' ? 'My data' : dataset.title,
        keywords: `${dataset.id} ${dataset.title} ${release.id} ${release.label}`,
        variant: 'dataset-release',
      }));
    }) ?? [];
    const datasetOptions: ContextMenuOption[] = [
      ...releaseOptions,
      {
        id: LOCAL_IMPORT_OPTION_ID,
        label: 'Import local dataset…',
        description: 'Choose one .ibl-ephys-atlas.zip archive from this device.',
        group: 'Local',
        keywords: 'import custom zip local dataset',
      },
      {
        id: LOCAL_MANAGE_OPTION_ID,
        label: 'Manage local datasets…',
        description: 'Inspect storage, integrity, and every imported release.',
        group: 'Local',
        keywords: 'manage inspect verify storage quota local dataset',
      },
      ...(state.view.dataset.datasetId === 'local' && state.view.dataset.releaseId ? [{
        id: LOCAL_DELETE_OPTION_ID,
        label: 'Delete this local dataset…',
        description: 'Remove the selected immutable release from this browser.',
        group: 'Local',
        keywords: 'delete remove local dataset',
      }] : []),
    ];
    const datasetId = state.view.dataset.releaseId
      ? JSON.stringify([state.view.dataset.datasetId, state.view.dataset.releaseId])
      : '';
    this.datasetContext.setOptions(datasetOptions, [datasetId], {
      emptyMessage: state.runtime.catalogStatus === 'error'
        ? `Datasets unavailable: ${state.runtime.error ?? 'The catalog could not be loaded.'}`
        : state.runtime.catalogStatus === 'loading' || state.runtime.catalogStatus === 'idle'
          ? 'Loading datasets…'
          : 'No datasets are available.',
      busy: state.runtime.catalogStatus === 'loading' || state.runtime.catalogStatus === 'idle',
    });

    this.featureRepresentation.clear();
    const featureOptions: ContextMenuOption[] = manifest?.features.map((feature) => {
      const representations = this.featureRepresentations(feature);
      const preferred = representations.includes(state.view.representation) ? state.view.representation : representations[0];
      if (preferred) this.featureRepresentation.set(feature.id, preferred);
      return {
        id: feature.id,
        label: feature.label,
        description: [feature.unit, representations.map(titleCaseToken).join(' / ')].filter(Boolean).join(' · '),
        detail: feature.description,
        keywords: `${feature.id} ${feature.description} ${feature.valueSemantics.quantity}`,
      };
    }) ?? [];
    this.featureContext.setOptions(featureOptions, state.view.featureId ? [state.view.featureId] : [], {
      emptyMessage: state.runtime.datasetStatus === 'error'
        ? `Features unavailable: ${state.runtime.error ?? 'The release could not be loaded.'}`
        : state.runtime.datasetStatus === 'loading' || state.runtime.datasetStatus === 'idle'
          ? 'Loading features…'
          : 'No features are available for this release.',
      busy: state.runtime.datasetStatus === 'loading' || state.runtime.datasetStatus === 'idle',
    });

    const selectedFeature = manifest?.features.find((feature) => feature.id === state.view.featureId);
    const representations = selectedFeature ? this.featureRepresentations(selectedFeature) : [];
    const availableParcellations = state.view.representation === 'volume'
      ? (['allen', 'beryl', 'cosmos'] as const)
      : selectedFeature?.representations.regional
        ? Object.keys(selectedFeature.representations.regional.parcellations) as ParcellationId[]
        : manifest?.parcellations ?? [];
    const representationOptions: ContextMenuOption[] = representations.map((value) => ({
      id: `representation:${value}`,
      label: value === 'regional' ? 'Regional' : 'Volume',
      description: value === 'regional' ? 'Region-level descriptive summaries' : 'Voxel-space scalar volume',
      group: 'View',
      disabled: representations.length < 2,
    }));
    const parcellationOptions: ContextMenuOption[] = availableParcellations.map((value) => ({
      id: `parcellation:${value}`,
      label: value === 'allen' ? 'Allen' : value === 'beryl' ? 'Beryl' : 'Cosmos',
      description: value === 'allen' ? 'Full Allen ontology' : `${titleCaseToken(value)} reduced mapping`,
      group: state.view.representation === 'volume' ? 'Anatomy parcellation' : 'Parcellation',
      disabled: availableParcellations.length < 2,
    }));
    this.representationContext.setOptions(
      [...representationOptions, ...parcellationOptions],
      [`representation:${state.view.representation}`, `parcellation:${state.view.parcellation}`],
      {
        emptyMessage: state.runtime.datasetStatus === 'error'
          ? `Views unavailable: ${state.runtime.error ?? 'The release could not be loaded.'}`
          : state.runtime.datasetStatus === 'loading' || state.runtime.datasetStatus === 'idle'
            ? 'Loading views…'
            : 'Choose a feature to see its available views.',
        busy: state.runtime.datasetStatus === 'loading' || state.runtime.datasetStatus === 'idle',
      },
    );
  }

  private renderColorSettings(model: ShellModel): void {
    const { state, manifest, feature } = model;
    const view = state.view;
    const descriptor = manifest?.features.find((item) => item.id === view.featureId);
    this.colorModeSelect.value = view.coloring.mode ?? 'feature';
    const statistics = feature?.representation === 'regional'
      ? (['mean', 'median', 'std', 'min', 'max'] as const).filter((statistic) => feature.statistics[statistic] !== undefined)
      : (descriptor?.statistics ?? []).filter((statistic): statistic is ColorStatisticId => statistic !== 'count');
    this.syncOptions(this.statisticSelect, statistics.map((value) => ({
      value,
      label: value === 'std' ? 'Standard deviation' : titleCaseToken(value),
    })), view.coloring.statistic);
    const automaticColormap = model.presentationColormap.automaticColormap;
    this.syncOptions(this.colormapSelect, [
      { value: 'auto', label: `Auto (${colormapLabel(automaticColormap)})` },
      ...COLORMAPS.map(({ id, label }) => {
        const unavailable = !model.presentationColormap.availableColormaps.includes(id);
        return {
          value: id,
          label,
          ...(unavailable ? {
            disabled: true,
            title: 'Requires a release-declared diverging center.',
          } : {}),
        };
      }),
    ], view.coloring.colormap);
    const automaticScale = model.presentationScale.automaticScale;
    this.syncOptions(this.scaleSelect, [
      { value: 'auto', label: `Auto (${automaticScale === 'log' ? 'Log' : automaticScale === 'symlog' ? 'Signed log' : 'Linear'})` },
      ...(['linear', 'log', 'symlog'] as const).map((value) => ({
        value,
        label: value === 'log' ? 'Log' : value === 'symlog' ? 'Signed log' : 'Linear',
        disabled: !model.presentationScale.availableScales.includes(value),
        ...(model.presentationScale.unavailableScaleReasons[value]
          ? { title: model.presentationScale.unavailableScaleReasons[value] }
          : {}),
      })),
    ], view.coloring.scale);
    const automaticDomain = model.presentationScale.automaticDistributionDomain;
    this.syncOptions(this.distributionDomainSelect, [
      { value: 'auto', label: `Auto (${automaticDomain === 'focused' ? 'Focused' : 'Full'})` },
      ...(['full', 'focused'] as const).map((value) => ({
        value,
        label: value === 'focused' ? 'Focused' : 'Full',
        disabled: !model.presentationScale.availableDistributionDomains.includes(value),
        ...(model.presentationScale.unavailableDistributionReasons[value]
          ? { title: model.presentationScale.unavailableDistributionReasons[value] }
          : {}),
      })),
    ], view.distribution.domain);
    this.rangeModeSelect.value = view.coloring.range.mode;
    this.syncOptions(this.rangeModeSelect, [
      { value: 'auto', label: model.representationDisplay?.range ? 'Auto (release default)' : 'Robust auto' },
      { value: 'fixed', label: 'Manual' },
    ], view.coloring.range.mode);
    const featureColors = (view.coloring.mode ?? 'feature') === 'feature' && feature !== null;
    this.statisticSelect.disabled = !featureColors || statistics.length < 2;
    this.colormapSelect.disabled = !featureColors;
    this.scaleSelect.disabled = !featureColors;
    this.distributionDomainSelect.disabled = feature === null;
    this.rangeModeSelect.disabled = !featureColors;

    const range = feature
      ? effectiveScalarColorRange(feature, view.coloring, model.representationDisplay)
      : null;
    if (feature && range) {
      const usesReleaseDefault = view.coloring.range.mode === 'auto' && model.representationDisplay?.range !== undefined;
      const usesRobustQuantiles = !usesReleaseDefault && view.coloring.range.mode === 'auto'
        && feature.representation === 'regional'
        && feature.global?.q05 !== undefined
        && feature.global.q95 !== undefined;
      const scope = feature.representation === 'regional' ? 'Left hemisphere' : 'Volume';
      const context = view.coloring.range.mode === 'fixed'
        ? `${scope} · manual range`
        : usesReleaseDefault
          ? `${scope} · release default`
          : usesRobustQuantiles ? `${scope} · robust 5–95%` : `${scope} · automatic range`;
      this.colorRangeControl.render({
        feature,
        statistic: view.coloring.statistic,
        effectiveRange: range,
        mode: view.coloring.range.mode,
        colormap: model.presentationColormap.effectiveColormap,
        ...(model.presentationColormap.divergingCenter !== undefined
          ? { divergingCenter: model.presentationColormap.divergingCenter }
          : {}),
        unit: descriptor?.unit ?? null,
        context,
        enabled: featureColors,
        axisScale: model.presentationScale.effectiveScaleSpec,
        histogram: model.presentationScale.histogram,
      });
    } else {
      this.colorRangeControl.hide();
    }
  }

  private renderVolumeLayerSettings(model: ShellModel): void {
    const volume = model.state.view.representation === 'volume';
    this.volumeLayerSettings.hidden = !volume;
    this.volumeOpacityInput.value = String(model.state.view.layers.volumeOpacity);
    this.volumeOpacityValue.value = `${Math.round(model.state.view.layers.volumeOpacity * 100)}%`;
    this.anatomyOutlinesInput.checked = model.state.view.layers.anatomyOutlines;
  }

  private featureRepresentations(feature: DatasetManifest['features'][number]): RepresentationKind[] {
    const representations: RepresentationKind[] = [];
    if (feature.representations.regional) representations.push('regional');
    if (feature.representations.volume) representations.push('volume');
    return representations;
  }

  private syncOptions(
    select: HTMLSelectElement,
    options: readonly { value: string; label: string; disabled?: boolean; title?: string }[],
    selectedValue: string,
  ): void {
    const signature = JSON.stringify(options);
    if (select.dataset.options !== signature) {
      select.replaceChildren(...options.map(({ value, label, disabled, title }) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.disabled = disabled ?? false;
        if (title) option.title = title;
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

  private panelHeader(titleText: string, panel: LayoutPanel, onClose: () => void): HTMLElement {
    const header = element('div', 'panel__header');
    header.append(heading(titleText, 2));
    const actions = element('div', 'panel__actions');
    const collapse = element('button', 'panel__collapse');
    collapse.type = 'button';
    collapse.textContent = panel === 'regions' ? '‹' : '›';
    collapse.setAttribute('aria-controls', panel === 'regions' ? 'regions-pane' : 'settings-pane');
    collapse.setAttribute('aria-keyshortcuts', panel === 'regions' ? '[' : ']');
    collapse.addEventListener('click', () => this.setPanelCollapsed(panel, true, true));
    this.panelCollapseButtons.set(panel, collapse);
    const close = element('button', 'panel__close');
    close.type = 'button';
    close.textContent = 'Close';
    close.setAttribute('aria-label', `Close ${titleText}`);
    close.addEventListener('click', onClose);
    actions.append(collapse, close);
    header.append(actions);
    return header;
  }

  private createPanelRestoreButton(panel: LayoutPanel): HTMLButtonElement {
    const label = panel === 'regions' ? 'Brain regions' : 'Visualization settings';
    const button = element('button', `panel-restore panel-restore--${panel}`);
    button.type = 'button';
    if (panel === 'regions') button.dataset.helpAnchor = 'regions';
    button.textContent = panel === 'regions' ? '›' : '‹';
    button.setAttribute('aria-label', `Show ${label}`);
    button.setAttribute('aria-controls', panel === 'regions' ? 'regions-pane' : 'settings-pane');
    button.setAttribute('aria-keyshortcuts', panel === 'regions' ? '[' : ']');
    button.addEventListener('click', () => this.setPanelCollapsed(panel, false, true));
    this.panelRestoreButtons.set(panel, button);
    return button;
  }

  private createPanelResizeHandle(panel: LayoutPanel): HTMLElement {
    const limits = PANEL_WIDTH_LIMITS[panel];
    const handle = element('div', `panel-resize-handle panel-resize-handle--${panel}`);
    const label = panel === 'regions' ? 'Resize brain regions panel' : 'Resize visualization settings panel';
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-label', label);
    handle.setAttribute('aria-controls', panel === 'regions' ? 'regions-pane' : 'settings-pane');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-valuemin', String(limits.min));
    handle.setAttribute('aria-valuemax', String(limits.max));
    handle.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight Home End');
    handle.addEventListener('pointerdown', (event) => this.startPanelResize(panel, handle, event));
    handle.addEventListener('dblclick', () => this.resetPanelWidth(panel));
    handle.addEventListener('keydown', (event) => this.onPanelResizeKeyDown(panel, event));
    this.panelResizeHandles.set(panel, handle);
    return handle;
  }

  private loadLayoutPreferences(): LayoutPreferences {
    try {
      return parseLayoutPreferences(window.localStorage.getItem(LAYOUT_PREFERENCES_KEY));
    } catch {
      return parseLayoutPreferences(null);
    }
  }

  private persistLayoutPreferences(): void {
    try {
      window.localStorage.setItem(LAYOUT_PREFERENCES_KEY, serializeLayoutPreferences(this.layoutPreferences));
    } catch {
      // Layout preferences are optional; storage denial must not affect the viewer.
    }
  }

  private applyPanelPreferences(): void {
    this.applyPanelWidth('regions', this.layoutPreferences.regionsWidth);
    this.applyPanelWidth('settings', this.layoutPreferences.settingsWidth);
    this.syncPanelControls();
  }

  private applyPanelWidth(panel: LayoutPanel, width: number | null): void {
    const property = panel === 'regions' ? '--region-pane-width' : '--settings-pane-width';
    if (width === null) this.app.style.removeProperty(property);
    else this.app.style.setProperty(property, `${clampPanelWidth(panel, width)}px`);
    this.syncPanelResizeValue(panel);
  }

  private panelWidth(panel: LayoutPanel): number {
    const pane = panel === 'regions' ? this.regionPane : this.settingsPane;
    return clampPanelWidth(panel, pane.getBoundingClientRect().width);
  }

  private isPanelInline(panel: LayoutPanel): boolean {
    return panel === 'regions'
      ? this.layoutMode === 'wide' || this.layoutMode === 'compact'
      : this.layoutMode === 'wide';
  }

  private isPanelCollapsed(panel: LayoutPanel): boolean {
    return panel === 'regions'
      ? this.layoutPreferences.regionsCollapsed
      : this.layoutPreferences.settingsCollapsed;
  }

  private setPanelCollapsed(panel: LayoutPanel, collapsed: boolean, moveFocus = false): void {
    if (!this.isPanelInline(panel)) return;
    if (panel === 'regions') this.layoutPreferences.regionsCollapsed = collapsed;
    else this.layoutPreferences.settingsCollapsed = collapsed;
    this.persistLayoutPreferences();
    this.syncPanelControls();
    this.shortcutStatus.textContent = `${panel === 'regions' ? 'Brain regions' : 'Visualization settings'} panel ${collapsed ? 'collapsed' : 'expanded'}`;
    if (moveFocus) {
      const target = collapsed ? this.panelRestoreButtons.get(panel) : this.panelCollapseButtons.get(panel);
      window.requestAnimationFrame(() => target?.focus());
    }
  }

  private togglePanel(panel: LayoutPanel): void {
    if (this.isPanelInline(panel)) {
      this.setPanelCollapsed(panel, !this.isPanelCollapsed(panel));
      return;
    }
    const open = this.app.dataset.drawerOpen === panel;
    if (open) this.closeDrawers();
    else this.openDrawer(panel, false);
  }

  private syncPanelControls(): void {
    for (const panel of ['regions', 'settings'] as const) {
      const inline = this.isPanelInline(panel);
      const collapsed = inline && this.isPanelCollapsed(panel);
      const pane = panel === 'regions' ? this.regionPane : this.settingsPane;
      this.app.dataset[panel === 'regions' ? 'regionPanelCollapsed' : 'settingsPanelCollapsed'] = String(collapsed);
      pane.inert = collapsed;
      pane.setAttribute('aria-hidden', String(collapsed));
      const collapse = this.panelCollapseButtons.get(panel);
      collapse?.setAttribute('aria-expanded', String(!collapsed));
      collapse?.setAttribute('aria-label', `Hide ${panel === 'regions' ? 'Brain regions' : 'Visualization settings'}`);
      const restore = this.panelRestoreButtons.get(panel);
      if (restore) restore.hidden = !collapsed;
      this.syncPanelResizeValue(panel);
    }
  }

  private syncPanelResizeValue(panel: LayoutPanel): void {
    const handle = this.panelResizeHandles.get(panel);
    if (!handle || !this.isPanelInline(panel)) return;
    const saved = panel === 'regions' ? this.layoutPreferences.regionsWidth : this.layoutPreferences.settingsWidth;
    const width = saved ?? this.panelWidth(panel);
    handle.setAttribute('aria-valuenow', String(width));
    handle.setAttribute('aria-valuetext', `${width} pixels`);
  }

  private setPanelWidth(panel: LayoutPanel, width: number, persist: boolean): void {
    const clamped = clampPanelWidth(panel, width);
    if (panel === 'regions') this.layoutPreferences.regionsWidth = clamped;
    else this.layoutPreferences.settingsWidth = clamped;
    this.applyPanelWidth(panel, clamped);
    if (persist) this.persistLayoutPreferences();
  }

  private resetPanelWidth(panel: LayoutPanel): void {
    if (panel === 'regions') this.layoutPreferences.regionsWidth = null;
    else this.layoutPreferences.settingsWidth = null;
    this.applyPanelWidth(panel, null);
    this.persistLayoutPreferences();
    window.requestAnimationFrame(() => this.syncPanelResizeValue(panel));
    this.shortcutStatus.textContent = `${panel === 'regions' ? 'Brain regions' : 'Visualization settings'} panel width reset`;
  }

  private startPanelResize(panel: LayoutPanel, handle: HTMLElement, event: PointerEvent): void {
    if (event.button !== 0 || !this.isPanelInline(panel) || this.isPanelCollapsed(panel)) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = this.panelWidth(panel);
    this.app.dataset.panelResizing = panel;
    const move = (moveEvent: PointerEvent): void => {
      const delta = moveEvent.clientX - startX;
      this.setPanelWidth(panel, startWidth + (panel === 'regions' ? delta : -delta), false);
    };
    const finish = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      delete this.app.dataset.panelResizing;
      this.persistLayoutPreferences();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  private onPanelResizeKeyDown(panel: LayoutPanel, event: KeyboardEvent): void {
    if (!this.isPanelInline(panel) || this.isPanelCollapsed(panel)) return;
    const limits = PANEL_WIDTH_LIMITS[panel];
    let width: number | null = null;
    if (event.key === 'Home') width = limits.min;
    if (event.key === 'End') width = limits.max;
    if (event.key === 'ArrowLeft') width = this.panelWidth(panel) + (panel === 'regions' ? -12 : 12);
    if (event.key === 'ArrowRight') width = this.panelWidth(panel) + (panel === 'regions' ? 12 : -12);
    if (width === null) return;
    event.preventDefault();
    this.setPanelWidth(panel, width, true);
  }

  private createWorkspace(): HTMLElement {
    const workspace = element('section', 'workspace');
    workspace.setAttribute('aria-label', 'Atlas workspace');
    const switcher = element('nav', 'view-switcher');
    switcher.setAttribute('aria-label', 'Workspace view');
    for (const item of WORKSPACE_VIEW_REGISTRY) {
      const button = element('button', 'view-switcher__button');
      button.type = 'button';
      button.textContent = item.label;
      button.dataset.viewTarget = item.id;
      if (item.id === 'secondary') button.dataset.helpAnchor = 'values';
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => this.setActiveView(item.id));
      this.viewButtons.set(item.id, button);
      switcher.append(button);
    }
    const slices = element('section', 'slice-strip');
    slices.setAttribute('aria-label', 'Orthogonal brain slices');
    slices.append(...ORTHOGONAL_PROJECTION_REGISTRY.map(({ id }) => this.createViewFrame(id)));
    const context = element('section', 'context-strip');
    context.setAttribute('aria-label', 'Secondary atlas context');
    const secondary = element('section', 'secondary-view panel');
    secondary.dataset.view = 'secondary';
    secondary.dataset.tab = 'summary';
    secondary.dataset.maximized = 'false';
    const secondaryHeader = element('div', 'view-frame__header secondary-view__header');
    const secondaryTabs = element('div', 'secondary-view__tabs');
    secondaryTabs.setAttribute('role', 'tablist');
    for (const { id: tab, label } of SECONDARY_CONTENT_REGISTRY) {
      const button = element('button', 'secondary-view__tab');
      button.type = 'button';
      button.textContent = label;
      button.dataset.secondaryTab = tab;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(tab === 'summary'));
      button.addEventListener('click', () => this.callbacks.setSecondaryTab(tab));
      button.addEventListener('keydown', (event) => this.onSecondaryTabKeyDown(event, tab));
      this.secondaryTabButtons.set(tab, button);
      secondaryTabs.append(button);
    }
    this.secondaryMaximize = element('button', 'view-frame__maximize secondary-view__maximize');
    this.secondaryMaximize.type = 'button';
    this.secondaryMaximize.textContent = '↗';
    this.secondaryMaximize.setAttribute('aria-label', 'Maximize secondary panel');
    this.secondaryMaximize.setAttribute('aria-pressed', 'false');
    this.secondaryMaximize.addEventListener('click', () => this.toggleMaximizedView('secondary'));
    secondaryHeader.append(secondaryTabs, this.secondaryMaximize);
    const secondaryBody = element('div', 'secondary-view__body');
    const summary = element('div', 'secondary-view__surface secondary-view__summary');
    summary.dataset.secondaryPanel = 'summary';
    this.secondaryPanels.set('summary', summary);
    const brain3d = this.createNullScene3DPanel();
    secondaryBody.append(summary, ...STATIC_PROJECTION_REGISTRY.map(({ id }) => this.createStaticFrame(id)), brain3d);
    secondary.append(secondaryHeader, secondaryBody);
    this.secondaryFrame = secondary;
    const distribution = element('section', 'distribution-band panel');
    distribution.dataset.helpAnchor = 'values';
    distribution.append(this.frameHeader('Global distribution'), element('div', 'distribution-band__surface'));
    context.append(secondary, distribution);
    const analysis = element('section', 'analysis-panel panel');
    analysis.dataset.empty = 'true';
    analysis.dataset.expanded = 'false';
    analysis.setAttribute('aria-label', 'Compare selected regions');
    const analysisHeader = element('div', 'analysis-panel__header view-frame__header');
    const analysisToggle = element('button', 'analysis-panel__toggle');
    analysisToggle.type = 'button';
    analysisToggle.setAttribute('aria-controls', 'analysis-dialog');
    analysisToggle.setAttribute('aria-expanded', 'false');
    analysisToggle.setAttribute('aria-label', 'Open selected-region comparison');
    const analysisTitle = element('span', 'analysis-panel__title');
    analysisTitle.textContent = 'Compare selected regions';
    const analysisCount = element('span', 'analysis-panel__count');
    analysisCount.hidden = true;
    const analysisChevron = element('span', 'analysis-panel__chevron');
    analysisChevron.textContent = '↗';
    analysisChevron.setAttribute('aria-hidden', 'true');
    analysisToggle.append(analysisTitle, analysisCount, analysisChevron);
    analysisHeader.append(analysisToggle);
    const analysisDialog = element('dialog', 'analysis-dialog');
    analysisDialog.id = 'analysis-dialog';
    analysisDialog.setAttribute('aria-labelledby', 'analysis-dialog-title');
    const analysisFrame = element('div', 'analysis-dialog__frame');
    const dialogHeader = element('header', 'analysis-dialog__header');
    const dialogHeading = element('div', 'analysis-dialog__heading');
    const dialogTitle = heading('Compare selected regions', 2);
    dialogTitle.id = 'analysis-dialog-title';
    const dialogCount = element('span', 'analysis-dialog__count');
    dialogCount.hidden = true;
    dialogHeading.append(dialogTitle, dialogCount);
    const dialogClose = element('button', 'analysis-dialog__close');
    dialogClose.type = 'button';
    dialogClose.textContent = '⌄';
    dialogClose.setAttribute('aria-label', 'Minimize selected-region comparison');
    dialogHeader.append(dialogHeading, dialogClose);
    const analysisSurface = element('div', 'analysis-panel__surface');
    analysisSurface.id = 'analysis-panel-surface';
    analysisSurface.append(placeholderLine('long'), placeholderLine('medium'));
    analysisFrame.append(dialogHeader, analysisSurface);
    analysisDialog.append(analysisFrame);
    analysis.append(analysisHeader, analysisDialog);
    this.analysisDialog = analysisDialog;
    workspace.append(switcher, slices, context, analysis);
    return workspace;
  }

  private createViewFrame(axis: SliceAxis): HTMLElement {
    const frame = element('section', 'view-frame panel');
    frame.dataset.view = axis;
    frame.dataset.state = 'idle';
    frame.dataset.maximized = 'false';
    frame.dataset.helpAnchor = 'navigation';
    frame.setAttribute('aria-label', `${axis} view`);

    const title = `${axis[0]?.toUpperCase() ?? ''}${axis.slice(1)}`;
    const header = element('div', 'view-frame__header');
    header.append(heading(title, 3));
    const headerMeta = element('div', 'view-frame__header-meta');
    const coordinate = element('span', 'view-frame__coordinate');
    const initialCoordinate = formatRegionalCoordinate(axis, 0);
    coordinate.textContent = initialCoordinate;
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
    const projectionViewport = this.viewportFactory.create(target, axis);
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
    slider.setAttribute('aria-valuetext', initialCoordinate);
    slider.addEventListener('input', () => {
      const model = this.currentModel;
      const inventory = model?.state.view.representation === 'regional' ? model.displaySliceInventories?.[axis] : undefined;
      this.callbacks.setSlice(axis, inventory?.nativeIndexAtOrdinal(slider.valueAsNumber) ?? slider.valueAsNumber);
    });
    slider.id = `${axis}-slice-slider`;
    footer.append(slider);

    frame.append(header, viewport, footer);
    this.viewFrames.set(axis, {
      frame, target, viewport: projectionViewport, coordinate, slider, status, maximize,
      tooltip, tooltipIdentity, tooltipValue, tooltipMeta,
      renderKey: '', geometryKey: '', renderToken: 0, loadingNoticeTimer: null,
    });
    return frame;
  }

  private createStaticFrame(projectionId: StaticProjectionId): HTMLElement {
    const frame = element('section', 'secondary-projection');
    frame.dataset.secondaryPanel = projectionId;
    frame.hidden = true;
    const target = element('div', 'secondary-projection__renderer');
    target.setAttribute('aria-label', `${projectionId} renderer target`);
    const viewport = this.viewportFactory.createStatic(target, projectionId);
    const notice = element('p', 'secondary-projection__notice');
    notice.setAttribute('role', 'status');
    notice.textContent = 'Loading static projection…';
    const tooltip = element('div', 'region-tooltip');
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    const tooltipIdentity = element('div', 'region-tooltip__identity');
    const tooltipValue = element('div', 'region-tooltip__value');
    const tooltipMeta = element('div', 'region-tooltip__meta');
    tooltip.append(tooltipIdentity, tooltipValue, tooltipMeta);
    frame.append(target, notice, tooltip);
    this.staticFrames.set(projectionId, {
      frame, target, viewport, notice, tooltip, tooltipIdentity, tooltipValue, tooltipMeta,
      renderKey: '', renderToken: 0,
    });
    this.secondaryPanels.set(projectionId, frame);
    return frame;
  }

  private onSecondaryTabKeyDown(event: KeyboardEvent, current: SecondaryTabId): void {
    const ids = SECONDARY_CONTENT_REGISTRY.map(({ id }) => id);
    const index = ids.indexOf(current);
    const nextIndex = event.key === 'ArrowRight' ? (index + 1) % ids.length
      : event.key === 'ArrowLeft' ? (index - 1 + ids.length) % ids.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? ids.length - 1
            : -1;
    if (nextIndex < 0) return;
    const next = ids[nextIndex]!;
    event.preventDefault();
    this.callbacks.setSecondaryTab(next);
    this.secondaryTabButtons.get(next)?.focus();
  }

  private createNullScene3DPanel(): HTMLElement {
    const frame = element('section', 'secondary-view__surface secondary-view__scene3d');
    frame.dataset.secondaryPanel = 'brain-3d';
    frame.hidden = true;
    const host = element('div', 'secondary-view__scene3d-host');
    host.dataset.scene3dHost = this.scene3dFactory ? 'available' : 'null';
    host.setAttribute('aria-label', '3-D brain renderer target');
    const notice = element('p', 'secondary-view__scene3d-notice');
    notice.setAttribute('role', 'status');
    notice.textContent = 'Experimental 3-D context is not connected in this build.';
    const controls = element('label', 'secondary-view__scene3d-controls');
    const label = element('span', 'secondary-view__scene3d-control-label');
    label.textContent = 'Explode';
    const explode = element('input', 'secondary-view__scene3d-explode');
    explode.type = 'range';
    explode.min = '0';
    explode.max = '1';
    explode.step = '0.05';
    explode.value = '0';
    explode.setAttribute('aria-label', 'Explode 3-D brain');
    const value = element('output', 'secondary-view__scene3d-control-value');
    value.value = '0%';
    explode.addEventListener('input', () => {
      value.value = `${Math.round(explode.valueAsNumber * 100)}%`;
      this.callbacks.setScene3DExplode(explode.valueAsNumber);
    });
    controls.append(label, explode, value);
    frame.append(host, controls, notice);
    this.scene3dHost = host;
    this.scene3dNotice = notice;
    this.scene3dExplodeInput = explode;
    this.scene3dExplodeValue = value;
    this.secondaryPanels.set('brain-3d', frame);
    return frame;
  }

  private currentModel: ShellModel | null = null;

  private renderSecondaryView(model: ShellModel): void {
    const tab = model.state.view.workspace.secondaryTab;
    this.secondaryFrame.dataset.tab = tab;
    for (const [candidate, button] of this.secondaryTabButtons) {
      const active = candidate === tab;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    }
    for (const [candidate, panel] of this.secondaryPanels) panel.hidden = candidate !== tab;
    const content = SECONDARY_CONTENT_BY_ID[tab];
    this.renderScene3D(model, content.kind === 'scene3d');
    if (content.kind !== 'static-projection') return;
    const nodes = this.staticFrames.get(content.projectionId);
    if (!nodes) return;
    const view = model.state.view;
    const projectionParcellation = model.regionalPresentation.mapping;
    const renderKey = [view.dataset.datasetId, view.dataset.releaseId ?? '', projectionParcellation,
      model.feature?.featureId ?? '', model.feature?.representation ?? ''].join(':');
    if (renderKey === nodes.renderKey) return;
    nodes.renderKey = renderKey;
    const token = ++nodes.renderToken;
    nodes.notice.textContent = 'Loading static projection…';
    const pending = nodes.viewport.render({
      projectionId: content.projectionId,
      parcellation: projectionParcellation,
      feature: model.feature?.representation === 'regional' ? model.feature : null,
    });
    Promise.resolve(pending).then(() => {
      if (nodes.renderToken !== token) return;
      const viewport = nodes.target.querySelector<HTMLElement>('[data-static-source-mode]');
      const sourceMode = viewport?.dataset.staticSourceMode;
      nodes.notice.textContent = sourceMode === 'pinned-review'
        ? model.feature?.representation === 'volume'
          ? 'Anatomy only — volume scalars are not defined on this map'
          : ''
        : sourceMode === 'synthetic-fixture'
        ? model.feature?.representation === 'volume'
          ? 'Synthetic fixture — not scientific data · anatomy only; no volume scalars'
          : 'Synthetic fixture map — not scientific data'
        : model.feature?.representation === 'volume'
          ? 'Anatomy only — volume scalars are not defined on this map'
          : '';
      nodes.notice.hidden = nodes.notice.textContent === '';
    }).catch((error: unknown) => {
      if (nodes.renderToken !== token) return;
      nodes.notice.textContent = 'Static projection unavailable';
      nodes.viewport.showError(error);
      this.callbacks.reportError(error);
    });
  }

  private renderScene3D(model: ShellModel, selected: boolean): void {
    const view = model.state.view;
    this.scene3dExplodeInput.value = String(view.scene3d.explode);
    this.scene3dExplodeValue.value = `${Math.round(view.scene3d.explode * 100)}%`;
    this.scene3dExplodeInput.disabled = !this.scene3dFactory || this.scene3dFailed;
    const maximized = view.workspace.maximizedView;
    const visible = selected && (maximized === 'secondary'
      || (maximized === null && (window.innerWidth >= 1100 || view.workspace.activeCompactView === 'secondary')));
    if (!this.scene3dFactory) {
      this.scene3dNotice.textContent = 'Experimental 3-D context is not connected in this build.';
      this.scene3dNotice.dataset.state = 'unavailable';
      return;
    }
    if (visible && !this.scene3dViewport && !this.scene3dFailed) {
      try {
        this.scene3dViewport = this.scene3dFactory.create(this.scene3dHost);
        this.scene3dHost.dataset.scene3dHost = 'connected';
      } catch (error) {
        this.scene3dFailed = true;
        this.scene3dHost.dataset.scene3dState = 'error';
        this.scene3dNotice.textContent = 'Experimental 3-D context unavailable.';
        this.scene3dNotice.dataset.state = 'error';
        this.callbacks.reportError(error);
        return;
      }
    }
    const viewport = this.scene3dViewport;
    if (!viewport) return;
    try {
      if (this.scene3dHost.dataset.scene3dState === 'error') {
        this.scene3dFailed = true;
        viewport.deactivate();
        this.scene3dNotice.textContent = 'Experimental 3-D context unavailable.';
        this.scene3dNotice.dataset.state = 'error';
        return;
      }
      if (this.scene3dPresentation !== model.regionalPresentation) {
        viewport.setPresentation(model.regionalPresentation);
        this.scene3dPresentation = model.regionalPresentation;
      }
      if (this.scene3dViewState !== view.scene3d) {
        viewport.setViewState(view.scene3d);
        this.scene3dViewState = view.scene3d;
      }
      if (visible) viewport.activate();
      else viewport.deactivate();
      this.scene3dNotice.textContent = view.representation === 'volume'
        ? 'Experimental 3-D context · anatomy only — volume scalars are not defined on this view'
        : 'Experimental 3-D context';
      this.scene3dNotice.dataset.state = 'experimental';
    } catch (error) {
      this.scene3dFailed = true;
      viewport.deactivate();
      this.scene3dNotice.textContent = 'Experimental 3-D context unavailable.';
      this.scene3dNotice.dataset.state = 'error';
      this.callbacks.reportError(error);
    }
  }

  private renderViewFrame(axis: SliceAxis, model: ShellModel): void {
    const nodes = this.viewFrames.get(axis);
    if (!nodes) return;
    const view = model.state.view;
    const inventory = view.representation === 'regional' ? model.displaySliceInventories?.[axis] : undefined;
    const navigation = deriveOrthogonalNavigation(view.cursor, axis);
    const sliceIndex = navigation.nativeIndex;
    const displayOrdinal = inventory?.ordinalForNativeIndex(sliceIndex) ?? sliceIndex;
    const displayMax = inventory ? inventory.count - 1 : maxRegionalSliceIndex(axis);
    const coordinate = formatRegionalCoordinate(axis, sliceIndex);
    nodes.coordinate.textContent = coordinate;
    nodes.slider.max = String(displayMax);
    nodes.slider.value = String(displayOrdinal);
    nodes.slider.setAttribute('aria-valuetext', coordinate);

    const projectionParcellation = model.regionalPresentation.mapping;
    const geometryKey = [
      view.dataset.datasetId,
      view.dataset.releaseId ?? '',
      view.representation,
      model.feature?.representation ?? '',
      projectionParcellation,
      model.feature?.featureId ?? '',
      sliceIndex,
    ].join(':');
    const renderKey = `${geometryKey}:${view.cursor.xUm}:${view.cursor.yUm}:${view.cursor.zUm}`;
    if (nodes.renderKey === renderKey) return;
    nodes.renderKey = renderKey;
    const geometryChanged = nodes.geometryKey !== geometryKey;
    nodes.geometryKey = geometryKey;
    const token = ++nodes.renderToken;
    const retainedSliceAsset = nodes.target.dataset.sliceAsset;
    const retainsRenderedFrame = retainedSliceAsset === 'projection-pack-v1'
      || retainedSliceAsset === 'schema-volume-v1';
    const stateMessage = nodes.frame.querySelector<HTMLElement>('.view-frame__state-message');
    if (nodes.loadingNoticeTimer !== null) {
      window.clearTimeout(nodes.loadingNoticeTimer);
      nodes.loadingNoticeTimer = null;
    }
    if (!geometryChanged && nodes.status.textContent === 'Loading slice…') nodes.status.textContent = '';
    if (geometryChanged) {
      this.hideRegionTooltip(axis);
      nodes.frame.dataset.state = retainsRenderedFrame ? 'ready' : 'loading';
      nodes.status.removeAttribute('aria-label');
      nodes.status.textContent = retainsRenderedFrame ? '' : 'Loading';
      if (retainsRenderedFrame) {
        nodes.loadingNoticeTimer = window.setTimeout(() => {
          nodes.loadingNoticeTimer = null;
          if (nodes.renderToken === token) nodes.status.textContent = 'Loading slice…';
        }, SLICE_LOADING_NOTICE_DELAY_MS);
      }
      if (stateMessage) {
        stateMessage.textContent = retainsRenderedFrame
          ? ''
          : view.representation === 'volume'
            ? 'Loading scientific volume…'
            : 'Loading registered anatomy…';
      }
    }

    const pending = nodes.viewport.render({
      axis,
      sliceIndex,
      cursor: view.cursor,
      parcellation: projectionParcellation,
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
      const preservedSliceAsset = nodes.target.dataset.sliceAsset;
      const preservedFrame = preservedSliceAsset === 'projection-pack-v1'
        || preservedSliceAsset === 'schema-volume-v1';
      if (!geometryChanged || retainsRenderedFrame || preservedFrame) {
        nodes.frame.dataset.state = 'ready';
        if (geometryChanged) {
          nodes.status.textContent = preservedSliceAsset === 'projection-pack-v1' ? 'Anatomy only' : 'Previous slice';
        }
        nodes.viewport.showError(error);
      } else {
        nodes.frame.dataset.state = 'error';
        nodes.status.textContent = 'Unavailable';
        nodes.viewport.clear();
        nodes.viewport.showError(error);
        if (stateMessage) {
          stateMessage.textContent = error instanceof Error ? error.message : 'Registered anatomy could not be loaded';
        }
      }
      this.callbacks.reportError(error);
    });
  }

  private toggleMaximizedView(axis: WorkspaceViewId): void {
    const current = this.currentModel?.state.view.workspace.maximizedView ?? null;
    this.callbacks.setMaximizedView(current === axis ? null : axis);
  }

  private syncWorkspaceState(activeCompactView: WorkspaceViewId, maximizedView: WorkspaceViewId | null): void {
    this.app.dataset.activeView = activeCompactView;
    if (maximizedView) this.closeDrawers();
    this.headerActions.inert = maximizedView !== null;
    if (maximizedView) this.app.dataset.maximizedView = maximizedView;
    else delete this.app.dataset.maximizedView;
    for (const [id, nodes] of this.viewFrames) {
      const active = id === maximizedView;
      nodes.frame.dataset.maximized = String(active);
      nodes.maximize.setAttribute('aria-pressed', String(active));
      nodes.maximize.setAttribute('aria-label', `${active ? 'Restore' : 'Maximize'} ${id} view`);
      nodes.maximize.textContent = active ? '↙' : '↗';
    }
    const secondaryActive = maximizedView === 'secondary';
    this.secondaryFrame.dataset.maximized = String(secondaryActive);
    this.secondaryMaximize.setAttribute('aria-pressed', String(secondaryActive));
    this.secondaryMaximize.setAttribute('aria-label', `${secondaryActive ? 'Restore' : 'Maximize'} secondary panel`);
    this.secondaryMaximize.textContent = secondaryActive ? '↙' : '↗';
    for (const [id, button] of this.viewButtons) {
      button.setAttribute('aria-pressed', id === activeCompactView ? 'true' : 'false');
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

  private setActiveView(view: WorkspaceViewId): void {
    this.callbacks.setActiveCompactView(view);
  }

  private projectionTooltip(projectionId: import('../domain/types.js').ProjectionId): ProjectionTooltipNodes | undefined {
    return projectionId === 'top' || projectionId === 'swanson'
      ? this.staticFrames.get(projectionId)
      : this.viewFrames.get(projectionId);
  }

  private openDrawer(drawer: DrawerName, focusContent = true): void {
    this.closeContextMenus();
    const pane = drawer === 'regions' ? this.regionPane : this.settingsPane;
    const other = drawer === 'regions' ? this.settingsPane : this.regionPane;
    if (this.overflowActions) this.overflowActions.open = false;
    other.dataset.open = 'false';
    pane.dataset.open = 'true';
    this.app.dataset.drawerOpen = drawer;
    this.syncDrawerButtons(drawer);
    if (!focusContent) pane.querySelector<HTMLElement>('.panel__close')?.focus();
    else if (drawer === 'regions') this.regionSearch.focus();
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
    if (this.dataChooser.isOpen) {
      this.dataChooser.close();
      closed = true;
    }
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
    const previousMode = this.layoutMode;
    this.layoutMode = mode;
    this.app.dataset.layout = mode;
    if (mode !== previousMode) {
      if (mode === 'phone') this.closeContextMenus();
      else this.dataChooser.close();
    }
    if (mode !== 'phone' && this.overflowActions) this.overflowActions.open = false;
    if (mode === 'wide') this.closeDrawers();
    else if (mode === 'compact' && this.regionPane.dataset.open === 'true') this.closeDrawers();
    this.syncPanelControls();
  }

  private readonly onResize = (): void => {
    this.hideRegionTooltip();
    this.syncLayoutMode();
    if (this.currentModel) this.renderSecondaryView(this.currentModel);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    if (this.helpTour.active) return;
    if (this.analysisDialog.open && this.analysisDialog.dataset.presentation === 'modal-sheet') return;
    if (event.key === 'Escape') {
      if (this.infoDialog.open || this.downloadDialog.open || this.helpDialog.open) return;
      if (this.closeContextMenus()) return;
      const maximizedView = this.currentModel?.state.view.workspace.maximizedView ?? null;
      if (maximizedView) {
        this.callbacks.setMaximizedView(null);
        return;
      }
      if (this.app.dataset.drawerOpen) {
        this.closeDrawers();
        return;
      }
      if (this.overflowActions?.open) this.overflowActions.open = false;
      return;
    }
    if (blocksGlobalShortcut(event) || this.infoDialog.open || this.downloadDialog.open || this.helpDialog.open) return;
    if (
      (event.key === '[' || event.key === ']')
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
    ) {
      event.preventDefault();
      this.togglePanel(event.key === '[' ? 'regions' : 'settings');
      return;
    }
    if (event.key === '/' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      this.featureContext.open();
      return;
    }
    if (
      event.key === '?'
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
    ) {
      event.preventDefault();
      this.openHelpDialog();
      return;
    }
    if (
      event.shiftKey
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && (event.key === 'ArrowDown' || event.key === 'ArrowUp')
    ) {
      this.stepFeature(event.key === 'ArrowDown' ? 1 : -1);
      event.preventDefault();
    }
  };

  private stepFeature(direction: -1 | 1): void {
    const model = this.currentModel;
    const features = model?.manifest?.features ?? [];
    if (features.length === 0) return;
    const currentIndex = features.findIndex((feature) => feature.id === model?.state.view.featureId);
    const baseIndex = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : features.length;
    const nextIndex = baseIndex + direction;
    const feature = features[nextIndex];
    if (!feature) {
      this.shortcutStatus.textContent = direction > 0 ? 'Last feature' : 'First feature';
      return;
    }
    this.callbacks.setFeature(feature.id, this.featureRepresentation.get(feature.id));
    this.shortcutStatus.textContent = `Feature ${nextIndex + 1} of ${features.length}: ${feature.label}`;
  }
}
