import type { AppAction } from './actions.js';
import type { AppState } from './types.js';
import { cursorStateToWorld, worldToCursorState } from '../core/spatial.js';
import {
  maxRegionalSliceIndex,
  regionalIndexToCoordinateUm,
  regionalIndicesToWorld,
  worldToRegionalIndices,
} from '../core/slice-calibration.js';

function uniqueSelection(regionIds: readonly string[]): readonly string[] {
  // Order is meaningful: it assigns stable categorical colors to selected regions.
  return [...new Set(regionIds.filter(Boolean))];
}

export function reduceAppState(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'view/hydrate':
      return { ...state, view: action.view };
    case 'dataset/set':
      return {
        ...state,
        view: {
          ...state.view,
          dataset: action.dataset,
          featureId: null,
          selection: [],
        },
      };
    case 'feature/set':
      return {
        ...state,
        view: {
          ...state.view,
          featureId: action.featureId,
          representation: action.representation ?? state.view.representation,
        },
      };
    case 'parcellation/set':
      return {
        ...state,
        view: { ...state.view, parcellation: action.parcellation, selection: [] },
      };
    case 'regions/order':
      return { ...state, view: { ...state.view, regionOrder: action.order } };
    case 'selection/toggle': {
      const current = new Set(state.view.selection);
      if (current.has(action.regionId)) current.delete(action.regionId);
      else current.add(action.regionId);
      return {
        ...state,
        view: { ...state.view, selection: uniqueSelection([...current]) },
      };
    }
    case 'selection/set':
      return {
        ...state,
        view: { ...state.view, selection: uniqueSelection(action.regionIds) },
      };
    case 'selection/clear':
      return { ...state, view: { ...state.view, selection: [] } };
    case 'cursor/set': {
      const slices = worldToRegionalIndices(cursorStateToWorld(action.cursor));
      const cursor = worldToCursorState(regionalIndicesToWorld(slices));
      return { ...state, view: { ...state.view, cursor } };
    }
    case 'slice/set': {
      const index = Math.min(maxRegionalSliceIndex(action.axis), Math.max(0, Math.trunc(action.index)));
      const coordinate = regionalIndexToCoordinateUm(action.axis, index);
      const world = cursorStateToWorld(state.view.cursor);
      world[action.axis === 'coronal' ? 'ap' : action.axis === 'sagittal' ? 'ml' : 'dv'] = coordinate;
      return {
        ...state,
        view: {
          ...state.view,
          cursor: worldToCursorState(world),
        },
      };
    }
    case 'workspace/secondary-tab':
      return {
        ...state,
        view: { ...state.view, workspace: { ...state.view.workspace, secondaryTab: action.tab } },
      };
    case 'workspace/compact-view':
      return {
        ...state,
        view: { ...state.view, workspace: { ...state.view.workspace, activeCompactView: action.view } },
      };
    case 'workspace/maximized-view':
      return {
        ...state,
        view: { ...state.view, workspace: { ...state.view.workspace, maximizedView: action.view } },
      };
    case 'layers/volume-opacity': {
      const opacity = Number.isFinite(action.opacity) ? Math.min(1, Math.max(0, action.opacity)) : 1;
      return { ...state, view: { ...state.view, layers: { ...state.view.layers, volumeOpacity: opacity } } };
    }
    case 'layers/anatomy-outlines':
      return {
        ...state,
        view: { ...state.view, layers: { ...state.view.layers, anatomyOutlines: action.visible } },
      };
    case 'color/statistic':
      return { ...state, view: { ...state.view, coloring: { ...state.view.coloring, statistic: action.statistic } } };
    case 'color/mode':
      return { ...state, view: { ...state.view, coloring: { ...state.view.coloring, mode: action.mode } } };
    case 'color/colormap':
      return { ...state, view: { ...state.view, coloring: { ...state.view.coloring, colormap: action.colormap } } };
    case 'color/range':
      return { ...state, view: { ...state.view, coloring: { ...state.view.coloring, range: action.range } } };
    case 'color/scale':
      return { ...state, view: { ...state.view, coloring: { ...state.view.coloring, scale: action.scale } } };
    case 'runtime/catalog':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          catalogStatus: action.status,
          error: action.error ?? (action.status === 'error' ? state.runtime.error : null),
        },
      };
    case 'runtime/dataset':
      return {
        ...state,
        runtime: {
          ...state.runtime,
          datasetStatus: action.status,
          error: action.error ?? (action.status === 'error' ? state.runtime.error : null),
        },
      };
  }
}
