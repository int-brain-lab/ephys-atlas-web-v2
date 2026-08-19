import type { AppState, ViewState } from './types.js';

export const DEFAULT_VIEW_STATE: ViewState = {
  urlVersion: 1,
  dataset: {
    datasetId: 'ephys_atlas_channels',
    releaseId: 'fixture-0.1',
  },
  featureId: null,
  representation: 'regional',
  parcellation: 'allen',
  selection: [],
  cursor: { xUm: 0, yUm: 0, zUm: 0 },
  slices: { coronal: 0, sagittal: 0, horizontal: 0 },
  coloring: {
    statistic: 'mean',
    colormap: 'viridis',
    range: { mode: 'auto' },
    scale: 'linear',
  },
};

export const DEFAULT_APP_STATE: AppState = {
  view: DEFAULT_VIEW_STATE,
  runtime: {
    catalogStatus: 'idle',
    datasetStatus: 'idle',
    error: null,
  },
};
