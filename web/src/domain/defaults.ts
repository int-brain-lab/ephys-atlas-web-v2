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
    secondaryTab: 'top',
    activeCompactView: 'coronal',
    maximizedView: null,
  },
  layers: {
    volumeOpacity: 1,
    anatomyOutlines: true,
  },
  scene3d: {
    explode: 0,
    camera: {
      positionUm: [-12242.494, 12260.928, 10198.21],
      targetUm: [-51.719, -1307.504, -3519.915],
      up: [0.11, -0.091, 0.99],
    },
  },
  coloring: {
    mode: 'feature',
    statistic: 'mean',
    colormap: 'auto',
    range: { mode: 'auto' },
    scale: 'auto',
  },
  distribution: {
    domain: 'auto',
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
