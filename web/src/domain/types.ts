import type { CursorState, SliceAxis, SliceState } from '../core/spatial.js';
export type { CursorState, SliceAxis, SliceState } from '../core/spatial.js';

export const LAUNCH_DATASET_IDS = [
  'ephys_atlas_channels',
  'ephys_atlas_clusters',
  'ephys_atlas_volumes',
  'brainwide_map',
] as const;

export type LaunchDatasetId = (typeof LAUNCH_DATASET_IDS)[number];
export const LOCAL_DATASET_ID = 'local' as const;
export type DatasetId = string;
export type ParcellationId = 'allen' | 'beryl' | 'cosmos';
export type RepresentationKind = 'regional' | 'volume';
export type ColorScale = 'linear' | 'log';
export type ColorMode = 'feature' | 'anatomy';
export type StatisticId = 'mean' | 'median' | 'min' | 'max' | 'count';

export interface DatasetRef {
  datasetId: DatasetId;
  releaseId: string | null;
}

export type ColorRange =
  | { mode: 'auto' }
  | { mode: 'fixed'; min: number; max: number };

export interface ColoringState {
  mode: ColorMode;
  statistic: StatisticId;
  colormap: string;
  range: ColorRange;
  scale: ColorScale;
}

export interface ViewState {
  urlVersion: 3;
  dataset: DatasetRef;
  featureId: string | null;
  representation: RepresentationKind;
  parcellation: ParcellationId;
  selection: readonly string[];
  cursor: CursorState;
  slices: SliceState;
  coloring: ColoringState;
}

export interface RuntimeState {
  catalogStatus: 'idle' | 'loading' | 'ready' | 'error';
  datasetStatus: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
}

export interface AppState {
  view: ViewState;
  runtime: RuntimeState;
}
