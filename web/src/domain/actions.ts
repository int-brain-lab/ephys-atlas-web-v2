import type {
  ColorRange,
  ColorMode,
  ColorScale,
  CursorState,
  DatasetRef,
  ParcellationId,
  RegionOrder,
  RepresentationKind,
  SliceAxis,
  StatisticId,
  ViewState,
} from './types.js';

export type AppAction =
  | { type: 'view/hydrate'; view: ViewState }
  | { type: 'dataset/set'; dataset: DatasetRef }
  | { type: 'feature/set'; featureId: string | null; representation?: RepresentationKind }
  | { type: 'parcellation/set'; parcellation: ParcellationId }
  | { type: 'regions/order'; order: RegionOrder }
  | { type: 'selection/toggle'; regionId: string }
  | { type: 'selection/set'; regionIds: readonly string[] }
  | { type: 'selection/clear' }
  | { type: 'cursor/set'; cursor: CursorState }
  | { type: 'slice/set'; axis: SliceAxis; index: number }
  | { type: 'color/statistic'; statistic: StatisticId }
  | { type: 'color/mode'; mode: ColorMode }
  | { type: 'color/colormap'; colormap: string }
  | { type: 'color/range'; range: ColorRange }
  | { type: 'color/scale'; scale: ColorScale }
  | { type: 'runtime/catalog'; status: 'idle' | 'loading' | 'ready' | 'error'; error?: string | null }
  | { type: 'runtime/dataset'; status: 'idle' | 'loading' | 'ready' | 'error'; error?: string | null };

export function isViewAction(action: AppAction): boolean {
  return !action.type.startsWith('runtime/');
}
