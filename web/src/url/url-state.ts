import { isViewAction } from '../domain/actions.js';
import { DEFAULT_VIEW_STATE } from '../domain/defaults.js';
import type { AppStore } from '../domain/store.js';
import type {
  ColorRange,
  DatasetId,
  ParcellationId,
  RepresentationKind,
  StatisticId,
  ViewState,
} from '../domain/types.js';
import { LAUNCH_DATASET_IDS } from '../domain/types.js';

const URL_VERSION = 1;
const PARCELLATIONS = new Set<ParcellationId>(['allen', 'beryl', 'cosmos']);
const REPRESENTATIONS = new Set<RepresentationKind>(['regional', 'volume']);
const STATISTICS = new Set<StatisticId>(['mean', 'median', 'min', 'max', 'count']);

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

function isDatasetId(value: string | null): value is DatasetId {
  return value !== null && (LAUNCH_DATASET_IDS as readonly string[]).includes(value);
}

export function parseViewState(search: string, defaults: ViewState = DEFAULT_VIEW_STATE): ViewState {
  const params = new URLSearchParams(search);
  const version = Number(params.get('v'));
  if (params.has('v') && version !== URL_VERSION) return defaults;

  const datasetId = isDatasetId(params.get('dataset')) ? params.get('dataset') as DatasetId : defaults.dataset.datasetId;
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
  const statistic = STATISTICS.has(params.get('stat') as StatisticId)
    ? params.get('stat') as StatisticId
    : defaults.coloring.statistic;
  const [xUm, yUm, zUm] = parseTriple(params.get('cursor'), [defaults.cursor.xUm, defaults.cursor.yUm, defaults.cursor.zUm]);
  const [coronal, sagittal, horizontal] = parseTriple(params.get('slices'), [defaults.slices.coronal, defaults.slices.sagittal, defaults.slices.horizontal]);
  const selection = params.get('selected')?.split(',').map(decodeURIComponent).filter(Boolean) ?? defaults.selection;

  return {
    urlVersion: URL_VERSION,
    dataset: { datasetId, releaseId },
    featureId,
    representation,
    parcellation,
    selection: [...new Set(selection)].sort(),
    cursor: { xUm, yUm, zUm },
    slices: {
      coronal: Math.max(0, Math.trunc(coronal)),
      sagittal: Math.max(0, Math.trunc(sagittal)),
      horizontal: Math.max(0, Math.trunc(horizontal)),
    },
    coloring: {
      statistic,
      colormap: params.get('cmap') || defaults.coloring.colormap,
      range: parseRange(params.get('range'), defaults.coloring.range),
      scale: params.get('scale') === 'log' ? 'log' : 'linear',
    },
  };
}

function sameTriple(values: readonly number[], defaults: readonly number[]): boolean {
  return values.every((value, index) => value === defaults[index]);
}

export function serializeViewState(view: ViewState, defaults: ViewState = DEFAULT_VIEW_STATE): string {
  const params = new URLSearchParams();
  params.set('v', String(URL_VERSION));
  if (view.dataset.datasetId !== defaults.dataset.datasetId) params.set('dataset', view.dataset.datasetId);
  if (view.dataset.releaseId !== defaults.dataset.releaseId && view.dataset.releaseId) params.set('release', view.dataset.releaseId);
  if (view.featureId) params.set('feature', view.featureId);
  if (view.representation !== defaults.representation) params.set('repr', view.representation);
  if (view.parcellation !== defaults.parcellation) params.set('parcel', view.parcellation);
  if (view.coloring.statistic !== defaults.coloring.statistic) params.set('stat', view.coloring.statistic);
  if (view.coloring.colormap !== defaults.coloring.colormap) params.set('cmap', view.coloring.colormap);
  if (view.coloring.range.mode === 'fixed') params.set('range', `${view.coloring.range.min},${view.coloring.range.max}`);
  if (view.coloring.scale !== defaults.coloring.scale) params.set('scale', view.coloring.scale);

  const cursor = [view.cursor.xUm, view.cursor.yUm, view.cursor.zUm];
  const defaultCursor = [defaults.cursor.xUm, defaults.cursor.yUm, defaults.cursor.zUm];
  if (!sameTriple(cursor, defaultCursor)) params.set('cursor', cursor.join(','));

  const slices = [view.slices.coronal, view.slices.sagittal, view.slices.horizontal];
  const defaultSlices = [defaults.slices.coronal, defaults.slices.sagittal, defaults.slices.horizontal];
  if (!sameTriple(slices, defaultSlices)) params.set('slices', slices.join(','));

  if (view.selection.length) params.set('selected', view.selection.map(encodeURIComponent).join(','));
  return params.toString();
}

export class UrlStateController {
  private stopStore: (() => void) | null = null;
  private applyingPopState = false;

  constructor(
    private readonly store: AppStore,
    private readonly win: Pick<Window, 'location' | 'history' | 'addEventListener' | 'removeEventListener'> = window,
  ) {}

  start(): void {
    const initial = parseViewState(this.win.location.search);
    this.store.dispatch({ type: 'view/hydrate', view: initial });

    this.stopStore = this.store.subscribe((state, action) => {
      if (this.applyingPopState || !isViewAction(action)) return;
      const query = serializeViewState(state.view);
      const url = `${this.win.location.pathname}${query ? `?${query}` : ''}${this.win.location.hash}`;
      this.win.history.replaceState(null, '', url);
    });
    this.win.addEventListener('popstate', this.onPopState);
  }

  stop(): void {
    this.stopStore?.();
    this.stopStore = null;
    this.win.removeEventListener('popstate', this.onPopState);
  }

  private readonly onPopState = (): void => {
    this.applyingPopState = true;
    try {
      this.store.dispatch({ type: 'view/hydrate', view: parseViewState(this.win.location.search) });
    } finally {
      this.applyingPopState = false;
    }
  };
}
