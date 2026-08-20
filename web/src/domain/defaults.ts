import type { AppState, ViewState } from './types.js';

export const DEFAULT_VIEW_STATE: ViewState = {
  urlVersion: 2,
  dataset: {
    datasetId: 'ephys_atlas_channels',
    releaseId: 'golden-v0.3',
  },
  featureId: null,
  representation: 'regional',
  parcellation: 'allen',
  selection: [],
  cursor: { xUm: -239, yUm: -1200, zUm: -3668 },
  slices: { coronal: 264, sagittal: 220, horizontal: 160 },
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
