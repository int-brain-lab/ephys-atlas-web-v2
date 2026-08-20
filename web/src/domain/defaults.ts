import type { AppState, ViewState } from './types.js';

export const DEFAULT_VIEW_STATE: ViewState = {
  urlVersion: 1,
  dataset: {
    datasetId: 'ephys_atlas_channels',
    releaseId: 'golden-v0.1',
  },
  featureId: null,
  representation: 'regional',
  parcellation: 'allen',
  selection: [],
  cursor: { xUm: 0, yUm: 0, zUm: 0 },
  slices: { coronal: 660, sagittal: 550, horizontal: 400 },
  coloring: {
    mode: 'feature',
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
