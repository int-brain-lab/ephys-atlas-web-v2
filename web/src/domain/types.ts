import type { CursorState, SliceAxis, SliceState } from '../core/spatial.js';
import type { ScaleSpec } from './scale-spec.js';
export type { CursorState, SliceAxis, SliceState } from '../core/spatial.js';

export const LAUNCH_DATASET_IDS = [
  'ephys_atlas_channels',
  'ephys_atlas_clusters',
  'ephys_atlas_volumes',
  'brainwide_map',
] as const;

export type LaunchDatasetId = (typeof LAUNCH_DATASET_IDS)[number];
export const LOCAL_DATASET_ID = 'local' as const;
export type DatasetId = string;
export type ParcellationId = 'allen' | 'beryl' | 'cosmos';
export type RepresentationKind = 'regional' | 'volume';
export type ColorScale = 'linear' | 'log' | 'symlog';
export type ColorScaleSelection = 'auto' | ColorScale;
export type DistributionDomain = 'full' | 'focused';
export type DistributionDomainSelection = 'auto' | DistributionDomain;
export type ColorMode = 'feature' | 'anatomy';
export type ColormapId = 'viridis' | 'cividis' | 'magma' | 'plasma' | 'inferno' | 'Blues' | 'YlOrRd' | 'coolwarm';
export type ColormapSelection = 'auto' | ColormapId;
export type StatisticId = 'mean' | 'median' | 'std' | 'min' | 'max' | 'count';
export type ColorStatisticId = Exclude<StatisticId, 'count'>;
export type RegionOrder = 'anatomy' | 'value-asc' | 'value-desc';
export type OrthogonalProjectionId = SliceAxis;
export type StaticProjectionId = 'top' | 'swanson';
export type ProjectionId = OrthogonalProjectionId | StaticProjectionId;
export type SecondaryTabId = 'summary' | StaticProjectionId | 'brain-3d';
export type WorkspaceViewId = OrthogonalProjectionId | 'secondary';

export interface WorkspaceState {
  secondaryTab: SecondaryTabId;
  activeCompactView: WorkspaceViewId;
  maximizedView: WorkspaceViewId | null;
}

export interface VolumeLayerState {
  volumeOpacity: number;
  anatomyOutlines: boolean;
}

export interface BrainCameraPose {
  readonly positionUm: readonly [number, number, number];
  readonly targetUm: readonly [number, number, number];
  readonly up: readonly [number, number, number];
}

export interface Scene3DViewState {
  readonly explode: number;
  readonly camera: BrainCameraPose | null;
}

export interface DatasetRef {
  datasetId: DatasetId;
  releaseId: string | null;
}

/** A catalog-resolved immutable dataset selection safe to pass to data loaders. */
export interface ExactDatasetRef extends DatasetRef {
  releaseId: string;
}

export type DatasetNavigationContext =
  | { readonly kind: 'edition'; readonly projectId: string; readonly editionId: string }
  | { readonly kind: 'custom'; readonly projectId: string; readonly baseEditionId?: string }
  | { readonly kind: 'local' };

export interface DatasetNavigationRequest {
  readonly context?: DatasetNavigationContext['kind'];
  readonly projectId?: string;
  readonly editionId?: string;
  readonly baseEditionId?: string;
  readonly datasetId?: string;
  readonly releaseId?: string;
}

export type ColorRange =
  | { mode: 'auto' }
  | { mode: 'fixed'; min: number; max: number };

export interface ColoringState {
  mode: ColorMode;
  statistic: ColorStatisticId;
  colormap: ColormapSelection;
  range: ColorRange;
  scale: ColorScaleSelection;
}

export interface DistributionState {
  domain: DistributionDomainSelection;
}

export type EffectiveColoringState = Omit<ColoringState, 'scale'> & {
  scale: ScaleSpec;
  divergingCenter?: number;
};

export interface ViewState {
  urlVersion: 4;
  navigation: DatasetNavigationContext;
  dataset: DatasetRef;
  featureId: string | null;
  representation: RepresentationKind;
  parcellation: ParcellationId;
  regionOrder: RegionOrder;
  selection: readonly string[];
  cursor: CursorState;
  workspace: WorkspaceState;
  layers: VolumeLayerState;
  scene3d: Scene3DViewState;
  coloring: ColoringState;
  distribution: DistributionState;
}

export interface RuntimeState {
  catalogStatus: 'idle' | 'loading' | 'ready' | 'error';
  navigationStatus: 'idle' | 'ready' | 'error';
  datasetStatus: 'idle' | 'loading' | 'ready' | 'error';
  catalogError: string | null;
  navigationError: string | null;
  datasetError: string | null;
  /** Compatibility summary for the current shell; domain-specific fields are authoritative. */
  error: string | null;
}

export interface AppState {
  view: ViewState;
  runtime: RuntimeState;
}
