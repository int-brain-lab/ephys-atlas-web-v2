import type { AppState, ViewState } from './types.js';

export const DEFAULT_VIEW_STATE: ViewState = {
  urlVersion: 4,
  dataset: {
    datasetId: 'ephys_atlas_channels',
    releaseId: null,
  },
  featureId: null,
  representation: 'regional',
  parcellation: 'allen',
  regionOrder: 'anatomy',
  selection: [],
  cursor: { xUm: -239, yUm: -1200, zUm: -3668 },
  workspace: {
    secondaryTab: 'summary',
    activeCompactView: 'coronal',
    maximizedView: null,
  },
  layers: {
    volumeOpacity: 1,
    anatomyOutlines: true,
  },
  coloring: {
    mode: 'feature',
    statistic: 'mean',
    colormap: 'viridis',
    range: { mode: 'auto' },
    scale: 'auto',
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
