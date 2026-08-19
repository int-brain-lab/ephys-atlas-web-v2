export const LAUNCH_DATASET_IDS = [
  'ephys_atlas_channels',
  'ephys_atlas_clusters',
  'ephys_atlas_volumes',
  'brainwide_map',
  'local',
] as const;

export type DatasetId = (typeof LAUNCH_DATASET_IDS)[number];
export type PublishedDatasetId = Exclude<DatasetId, 'local'>;
export type ParcellationId = 'allen' | 'beryl' | 'cosmos';
export type RepresentationKind = 'regional' | 'volume';
export type SliceAxis = 'coronal' | 'sagittal' | 'horizontal';
export type ColorScale = 'linear' | 'log';
export type StatisticId = 'mean' | 'median' | 'min' | 'max' | 'count';

export interface DatasetRef {
  datasetId: DatasetId;
  releaseId: string | null;
}

export interface CursorState {
  xUm: number;
  yUm: number;
  zUm: number;
}

export type SliceState = Record<SliceAxis, number>;

export type ColorRange =
  | { mode: 'auto' }
  | { mode: 'fixed'; min: number; max: number };

export interface ColoringState {
  statistic: StatisticId;
  colormap: string;
  range: ColorRange;
  scale: ColorScale;
}

export interface ViewState {
  urlVersion: 1;
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
