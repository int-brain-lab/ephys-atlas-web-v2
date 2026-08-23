import type {
  ColorRange,
  ColorMode,
  ColorStatisticId,
  ColorScaleSelection,
  CursorState,
  DatasetRef,
  ParcellationId,
  RegionOrder,
  RepresentationKind,
  SecondaryTabId,
  SliceAxis,
  ViewState,
  WorkspaceViewId,
  BrainCameraPose,
} from './types.js';

export type AppAction =
  | ViewAction
  | { type: 'runtime/catalog'; status: 'idle' | 'loading' | 'ready' | 'error'; error?: string | null }
  | { type: 'runtime/dataset'; status: 'idle' | 'loading' | 'ready' | 'error'; error?: string | null };

export type UrlHistoryMode = 'push' | 'replace' | 'none';

type ViewActionPayload =
  | { type: 'view/hydrate'; view: ViewState }
  | { type: 'dataset/set'; dataset: DatasetRef }
  | {
    type: 'context/reconcile';
    featureId: string;
    representation: RepresentationKind;
    parcellation: ParcellationId;
  }
  | { type: 'feature/set'; featureId: string | null; representation?: RepresentationKind }
  | { type: 'parcellation/set'; parcellation: ParcellationId }
  | { type: 'regions/order'; order: RegionOrder }
  | { type: 'selection/toggle'; regionId: string }
  | { type: 'selection/set'; regionIds: readonly string[] }
  | { type: 'selection/clear' }
  | { type: 'cursor/set'; cursor: CursorState }
  | { type: 'slice/set'; axis: SliceAxis; index: number }
  | { type: 'workspace/secondary-tab'; tab: SecondaryTabId }
  | { type: 'workspace/compact-view'; view: WorkspaceViewId }
  | { type: 'workspace/maximized-view'; view: WorkspaceViewId | null }
  | { type: 'layers/volume-opacity'; opacity: number }
  | { type: 'layers/anatomy-outlines'; visible: boolean }
  | { type: 'scene3d/explode'; explode: number }
  | { type: 'scene3d/camera'; camera: BrainCameraPose | null }
  | { type: 'color/statistic'; statistic: ColorStatisticId }
  | { type: 'color/mode'; mode: ColorMode }
  | { type: 'color/colormap'; colormap: string }
  | { type: 'color/range'; range: ColorRange }
  | { type: 'color/scale'; scale: ColorScaleSelection };

export type ViewAction = ViewActionPayload & {
  /** Explicit browser-history intent; refinements replace by default. */
  history?: UrlHistoryMode;
};

export function isViewAction(action: AppAction): action is ViewAction {
  return !action.type.startsWith('runtime/');
}
