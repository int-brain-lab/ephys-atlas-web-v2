import {
  cursorStateToWorld,
} from '../core/spatial.js';
import {
  regionalIndicesToWorld,
  worldToRegionalIndices,
} from '../core/slice-calibration.js';
import { isViewAction } from '../domain/actions.js';
import { DEFAULT_VIEW_STATE } from '../domain/defaults.js';
import { WORKSPACE_VIEW_IDS } from '../domain/projections.js';
import { normalizeBrainCameraPose } from '../domain/scene3d.js';
import { isColormapId } from '../application/colormap-palettes.js';
import type { AppStore } from '../domain/store.js';
import type { DatasetCatalog } from '../data/contracts.js';
import type {
  ColorRange,
  ColorStatisticId,
  DatasetId,
  ParcellationId,
  RegionOrder,
  RepresentationKind,
  SecondaryTabId,
  ViewState,
  WorkspaceViewId,
  BrainCameraPose,
} from '../domain/types.js';
import type {
  DatasetNavigationRequest,
} from '../domain/types.js';
import type { ResolvedDatasetNavigation } from '../application/dataset-navigation.js';
import { resolveDatasetNavigationRequest } from '../application/dataset-navigation.js';

const URL_VERSION = 4;
const NAVIGATION_URL_DEBOUNCE_MS = 120;
const PARCELLATIONS = new Set<ParcellationId>(['allen', 'beryl', 'cosmos']);
const REPRESENTATIONS = new Set<RepresentationKind>(['regional', 'volume']);
const COLOR_STATISTICS = new Set<ColorStatisticId>(['mean', 'median', 'std', 'min', 'max']);
const REGION_ORDERS = new Set<RegionOrder>(['anatomy', 'value-asc', 'value-desc']);
const SECONDARY_TABS = new Set<SecondaryTabId>(['summary', 'top', 'swanson', 'brain-3d']);

/** Raw URL navigation intent. It is deliberately separate from ViewState: the
 * catalog is required before these identifiers can be resolved. */
export function parseNavigationRequest(search: string): DatasetNavigationRequest {
  const params = new URLSearchParams(search);
  const version = Number(params.get('v'));
  if (params.size > 0 && version !== URL_VERSION) return {};
  const context = params.get('context');
  const editionId = params.get('edition');
  const baseEditionId = params.get('base_edition');
  const projectId = params.get('project') ?? undefined;
  const datasetId = params.get('dataset') ?? undefined;
  const releaseId = params.get('release') ?? undefined;
  if (context === 'local') {
    return {
      context: 'local',
      ...(projectId ? { projectId } : {}),
      ...(editionId ? { editionId } : {}),
      ...(baseEditionId ? { baseEditionId } : {}),
      ...(datasetId ? { datasetId } : {}),
      ...(releaseId ? { releaseId } : {}),
    };
  }
  if (context === 'edition' || editionId) {
    return {
      context: 'edition', ...(editionId ? { editionId } : {}),
      ...(projectId ? { projectId } : {}), ...(datasetId ? { datasetId } : {}), ...(releaseId ? { releaseId } : {}),
    };
  }
  const explicitCustom = context === 'custom' || Boolean(datasetId || releaseId || baseEditionId);
  return {
    ...(explicitCustom ? { context: 'custom' as const } : {}),
    ...(projectId ? { projectId } : {}), ...(baseEditionId ? { baseEditionId } : {}),
    ...(datasetId ? { datasetId } : {}), ...(releaseId ? { releaseId } : {}),
  };
}

/** Serialize the exact resolved navigation identity, without aliases. */
export function serializeNavigationRequest(navigation: ResolvedDatasetNavigation): string {
  const params = new URLSearchParams();
  params.set('v', String(URL_VERSION));
  params.set('dataset', navigation.dataset.id);
  params.set('release', navigation.releaseId);
  if (navigation.context.kind === 'local') {
    params.set('context', 'local');
  } else {
    params.set('project', navigation.context.projectId);
    if (navigation.context.kind === 'edition') params.set('edition', navigation.context.editionId);
    else {
      params.set('context', 'custom');
      if (navigation.context.baseEditionId) params.set('base_edition', navigation.context.baseEditionId);
    }
  }
  return params.toString();
}

function finiteNumber(value: string | null, fallback: number): number {
  if (value === null || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseTriple(value: string | null, fallback: readonly number[]): [number, number, number] {
  if (!value) return [fallback[0] ?? 0, fallback[1] ?? 0, fallback[2] ?? 0];
  const parts = value.split(',');
  if (parts.length !== 3) return [fallback[0] ?? 0, fallback[1] ?? 0, fallback[2] ?? 0];
  return [
    finiteNumber(parts[0] ?? null, fallback[0] ?? 0),
    finiteNumber(parts[1] ?? null, fallback[1] ?? 0),
    finiteNumber(parts[2] ?? null, fallback[2] ?? 0),
  ];
}

function parseRange(value: string | null, fallback: ColorRange): ColorRange {
  if (!value || value === 'auto') return { mode: 'auto' };
  const parts = value.split(',');
  if (parts.length !== 2) return fallback;
  const min = Number(parts[0]);
  const max = Number(parts[1]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return fallback;
  return { mode: 'fixed', min, max };
}

function parseDatasetId(value: string | null, fallback: DatasetId): DatasetId {
  const parsed = value?.trim();
  return parsed ? parsed : fallback;
}

function parseOpacity(value: string | null, fallback: number): number {
  if (value === null || value.trim() === '') return fallback;
  const opacity = Number(value);
  return Number.isFinite(opacity) && opacity >= 0 && opacity <= 1 ? opacity : fallback;
}

function parseCameraPose(value: string | null, fallback: BrainCameraPose | null): BrainCameraPose | null {
  if (!value) return fallback;
  const parts = value.split(',');
  if (parts.length !== 9) return fallback;
  const numbers = parts.map(Number);
  if (numbers.some((component) => !Number.isFinite(component))) return fallback;
  return normalizeBrainCameraPose({
    positionUm: [numbers[0]!, numbers[1]!, numbers[2]!],
    targetUm: [numbers[3]!, numbers[4]!, numbers[5]!],
    up: [numbers[6]!, numbers[7]!, numbers[8]!],
  }) ?? fallback;
}

export function parseViewState(search: string, defaults: ViewState = DEFAULT_VIEW_STATE): ViewState {
  const params = new URLSearchParams(search);
  const version = Number(params.get('v'));
  if (params.size > 0 && version !== URL_VERSION) return defaults;

  const datasetId = parseDatasetId(params.get('dataset'), defaults.dataset.datasetId);
  const releaseId = params.has('release')
    ? params.get('release') || null
    : datasetId === defaults.dataset.datasetId ? defaults.dataset.releaseId : null;
  const featureId = params.has('feature') ? params.get('feature') || null : defaults.featureId;
  const representation = REPRESENTATIONS.has(params.get('repr') as RepresentationKind)
    ? params.get('repr') as RepresentationKind
    : defaults.representation;
  const parcellation = PARCELLATIONS.has(params.get('parcel') as ParcellationId)
    ? params.get('parcel') as ParcellationId
    : defaults.parcellation;
  const statistic = COLOR_STATISTICS.has(params.get('stat') as ColorStatisticId)
    ? params.get('stat') as ColorStatisticId
    : defaults.coloring.statistic;
  const requestedColormap = params.get('cmap');
  const colormap = requestedColormap !== null && isColormapId(requestedColormap)
    ? requestedColormap
    : 'auto';
  const regionOrder = REGION_ORDERS.has(params.get('order') as RegionOrder)
    ? params.get('order') as RegionOrder
    : defaults.regionOrder;
  const [xUm, yUm, zUm] = parseTriple(params.get('cursor'), [
    defaults.cursor.xUm,
    defaults.cursor.yUm,
    defaults.cursor.zUm,
  ]);
  const slices = worldToRegionalIndices(cursorStateToWorld({ xUm, yUm, zUm }));
  const canonicalWorld = regionalIndicesToWorld(slices);
  const cursor = { xUm: canonicalWorld.ml, yUm: canonicalWorld.ap, zUm: canonicalWorld.dv };
  const selection = params.get('selected')?.split(',').map(decodeURIComponent).filter(Boolean) ?? defaults.selection;
  const secondaryTab = SECONDARY_TABS.has(params.get('secondary') as SecondaryTabId)
    ? params.get('secondary') as SecondaryTabId
    : defaults.workspace.secondaryTab;
  const activeCompactView = WORKSPACE_VIEW_IDS.has(params.get('compact') as WorkspaceViewId)
    ? params.get('compact') as WorkspaceViewId
    : defaults.workspace.activeCompactView;
  const maximizedView = WORKSPACE_VIEW_IDS.has(params.get('max') as WorkspaceViewId)
    ? params.get('max') as WorkspaceViewId
    : defaults.workspace.maximizedView;

  return {
    urlVersion: URL_VERSION,
    navigation: defaults.navigation,
    dataset: { datasetId, releaseId },
    featureId,
    representation,
    parcellation,
    regionOrder,
    // Preserve the encoded selection order because it determines identity colors.
    selection: [...new Set(selection)],
    cursor,
    workspace: { secondaryTab, activeCompactView, maximizedView },
    layers: {
      volumeOpacity: parseOpacity(params.get('opacity'), defaults.layers.volumeOpacity),
      anatomyOutlines: params.get('outlines') === '0' ? false : defaults.layers.anatomyOutlines,
    },
    scene3d: {
      explode: parseOpacity(params.get('explode3d'), defaults.scene3d.explode),
      camera: parseCameraPose(params.get('camera3d'), defaults.scene3d.camera),
    },
    coloring: {
      mode: params.get('colors') === 'anatomy' ? 'anatomy' : 'feature',
      statistic,
      colormap,
      range: parseRange(params.get('range'), defaults.coloring.range),
      scale: params.get('scale') === 'log' || params.get('scale') === 'linear' || params.get('scale') === 'symlog'
        ? params.get('scale') as 'linear' | 'log' | 'symlog'
        : 'auto',
    },
    distribution: {
      domain: params.get('dist') === 'full' || params.get('dist') === 'focused'
        ? params.get('dist') as 'full' | 'focused'
        : 'auto',
    },
  };
}

function sameTriple(values: readonly number[], defaults: readonly number[]): boolean {
  return values.every((value, index) => value === defaults[index]);
}

function sameCamera(left: BrainCameraPose | null, right: BrainCameraPose | null): boolean {
  if (left === null || right === null) return left === right;
  return sameTriple(left.positionUm, right.positionUm)
    && sameTriple(left.targetUm, right.targetUm)
    && sameTriple(left.up, right.up);
}

export function serializeViewState(view: ViewState, defaults: ViewState = DEFAULT_VIEW_STATE): string {
  const params = new URLSearchParams();
  params.set('v', String(URL_VERSION));
  if (view.dataset.releaseId) {
    params.set('dataset', view.dataset.datasetId);
    params.set('release', view.dataset.releaseId);
    if (view.navigation.kind === 'local') {
      params.set('context', 'local');
    } else {
      params.set('project', view.navigation.projectId);
      if (view.navigation.kind === 'edition') params.set('edition', view.navigation.editionId);
      else {
        params.set('context', 'custom');
        if (view.navigation.baseEditionId) params.set('base_edition', view.navigation.baseEditionId);
      }
    }
  }
  if (view.featureId && view.featureId !== defaults.featureId) params.set('feature', view.featureId);
  if (view.representation !== defaults.representation) params.set('repr', view.representation);
  if (view.parcellation !== defaults.parcellation) params.set('parcel', view.parcellation);
  if (view.regionOrder !== defaults.regionOrder) params.set('order', view.regionOrder);
  if (view.coloring.statistic !== defaults.coloring.statistic) params.set('stat', view.coloring.statistic);
  if (view.coloring.mode === 'anatomy' && defaults.coloring.mode !== 'anatomy') params.set('colors', 'anatomy');
  if (view.coloring.colormap !== 'auto') params.set('cmap', view.coloring.colormap);
  if (view.coloring.range.mode === 'fixed') params.set('range', `${view.coloring.range.min},${view.coloring.range.max}`);
  if (view.coloring.scale !== 'auto') params.set('scale', view.coloring.scale);
  if (view.distribution.domain !== 'auto') params.set('dist', view.distribution.domain);

  const cursor = [view.cursor.xUm, view.cursor.yUm, view.cursor.zUm];
  const defaultCursor = [defaults.cursor.xUm, defaults.cursor.yUm, defaults.cursor.zUm];
  if (!sameTriple(cursor, defaultCursor)) params.set('cursor', cursor.join(','));

  if (view.workspace.secondaryTab !== defaults.workspace.secondaryTab) {
    params.set('secondary', view.workspace.secondaryTab);
  }
  if (view.workspace.activeCompactView !== defaults.workspace.activeCompactView) {
    params.set('compact', view.workspace.activeCompactView);
  }
  if (view.workspace.maximizedView !== null) params.set('max', view.workspace.maximizedView);
  if (view.layers.volumeOpacity !== defaults.layers.volumeOpacity) {
    params.set('opacity', String(view.layers.volumeOpacity));
  }
  if (view.layers.anatomyOutlines !== defaults.layers.anatomyOutlines) {
    params.set('outlines', view.layers.anatomyOutlines ? '1' : '0');
  }
  if (view.scene3d.explode !== defaults.scene3d.explode) params.set('explode3d', String(view.scene3d.explode));
  if (view.scene3d.camera !== null && !sameCamera(view.scene3d.camera, defaults.scene3d.camera)) {
    params.set('camera3d', [
      ...view.scene3d.camera.positionUm,
      ...view.scene3d.camera.targetUm,
      ...view.scene3d.camera.up,
    ].join(','));
  }

  if (view.selection.length) params.set('selected', view.selection.map(encodeURIComponent).join(','));
  return params.toString();
}

export class UrlStateController {
  private stopStore: (() => void) | null = null;
  private applyingPopState = false;
  private pendingView: ViewState | null = null;
  private urlWriteTimer: ReturnType<typeof setTimeout> | null = null;
  private catalog: DatasetCatalog | null = null;

  constructor(
    private readonly store: AppStore,
    private readonly win: Pick<Window, 'location' | 'history' | 'addEventListener' | 'removeEventListener'> = window,
    private readonly defaults: ViewState = DEFAULT_VIEW_STATE,
  ) {}

  start(catalog: DatasetCatalog): void {
    this.catalog = catalog;
    let initial: ViewState;
    try {
      initial = this.resolveView(this.win.location.search);
    } catch (error) {
      this.store.dispatch({
        type: 'runtime/navigation', status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    this.store.dispatch({ type: 'view/hydrate', view: initial });
    this.store.dispatch({ type: 'runtime/navigation', status: 'ready' });
    this.writeUrl(initial, 'replace');

    this.stopStore = this.store.subscribe((state, action) => {
      if (this.applyingPopState || !isViewAction(action)) return;
      if (action.history === 'none') {
        this.cancelScheduledWrite();
        return;
      }
      if (action.type === 'slice/set' || action.type === 'cursor/set' || action.type === 'scene3d/camera') {
        this.scheduleUrlWrite(state.view);
      } else {
        const mode = action.history ?? 'replace';
        if (mode === 'push') this.flushScheduledWrite();
        else this.cancelScheduledWrite();
        this.writeUrl(state.view, mode);
      }
    });
    this.win.addEventListener('popstate', this.onPopState);
  }

  stop(): void {
    this.flushScheduledWrite();
    this.stopStore?.();
    this.stopStore = null;
    this.win.removeEventListener('popstate', this.onPopState);
  }

  /** Refresh resolver authority after local inventory composition changes. */
  setCatalog(catalog: DatasetCatalog): void {
    this.catalog = catalog;
  }

  private readonly onPopState = (): void => {
    this.cancelScheduledWrite();
    this.applyingPopState = true;
    try {
      const view = this.resolveView(this.win.location.search);
      this.store.dispatch({ type: 'view/hydrate', view });
      this.store.dispatch({ type: 'runtime/navigation', status: 'ready' });
      this.writeUrl(view, 'replace');
    } catch (error) {
      this.store.dispatch({
        type: 'runtime/navigation', status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.applyingPopState = false;
    }
  };

  private resolveView(search: string): ViewState {
    if (!this.catalog) throw new Error('Dataset catalog is not loaded');
    const requestedView = parseViewState(search, this.defaults);
    const resolved = resolveDatasetNavigationRequest(this.catalog, parseNavigationRequest(search));
    return {
      ...requestedView,
      navigation: resolved.context,
      dataset: { datasetId: resolved.dataset.id, releaseId: resolved.releaseId },
    };
  }

  private scheduleUrlWrite(view: ViewState): void {
    this.pendingView = view;
    if (this.urlWriteTimer !== null) clearTimeout(this.urlWriteTimer);
    this.urlWriteTimer = setTimeout(() => this.flushScheduledWrite(), NAVIGATION_URL_DEBOUNCE_MS);
  }

  private flushScheduledWrite(): void {
    const view = this.pendingView;
    this.cancelScheduledWrite();
    if (view) this.writeUrl(view, 'replace');
  }

  private cancelScheduledWrite(): void {
    if (this.urlWriteTimer !== null) clearTimeout(this.urlWriteTimer);
    this.urlWriteTimer = null;
    this.pendingView = null;
  }

  private writeUrl(view: ViewState, mode: 'push' | 'replace'): void {
    const query = serializeViewState(view, this.defaults);
    const url = `${this.win.location.pathname}${query ? `?${query}` : ''}${this.win.location.hash}`;
    const current = `${this.win.location.pathname}${this.win.location.search}${this.win.location.hash}`;
    if (url === current) return;
    const state = { app: 'ibl-ephys-atlas', urlVersion: URL_VERSION };
    if (mode === 'push') this.win.history.pushState(state, '', url);
    else this.win.history.replaceState(state, '', url);
  }
}
