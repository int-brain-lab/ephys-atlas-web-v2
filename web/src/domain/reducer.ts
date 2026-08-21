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
      return { ...state, view: { ...state.view, cursor, slices } };
    }
    case 'slice/set': {
      const index = Math.min(maxRegionalSliceIndex(action.axis), Math.max(0, Math.trunc(action.index)));
      const slices = { ...state.view.slices, [action.axis]: index };
      const coordinate = regionalIndexToCoordinateUm(action.axis, index);
      const world = cursorStateToWorld(state.view.cursor);
      world[action.axis === 'coronal' ? 'ap' : action.axis === 'sagittal' ? 'ml' : 'dv'] = coordinate;
      return {
        ...state,
        view: {
          ...state.view,
          cursor: worldToCursorState(world),
          slices,
        },
      };
    }
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
