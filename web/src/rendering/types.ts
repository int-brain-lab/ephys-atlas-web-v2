export const SLICE_AXES = ['coronal', 'sagittal', 'horizontal'] as const;

export type SliceAxis = (typeof SLICE_AXES)[number];
export type MappingName = 'allen' | 'beryl' | 'cosmos';
export type GuideDimension = 'x' | 'y';

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SliceIndices {
  coronal: number;
  sagittal: number;
  horizontal: number;
}

export interface SliceGuide {
  sourceAxis: SliceAxis;
  targetAxis: SliceAxis;
  dimension: GuideDimension;
  position: number;
}

export interface RegionalSliceFrame {
  axis: SliceAxis;
  index: number;
  mapping: MappingName;
  svgFragment: string;
  viewBox: ViewBox;
  guides: readonly SliceGuide[];
  regionColors?: ReadonlyMap<number, string>;
  selectedRegionIds?: ReadonlySet<number>;
  highlightedRegionId?: number | null;
}

export interface SliceRegionPointerEvent {
  axis: SliceAxis;
  regionId: number;
  type: 'hover' | 'leave' | 'select';
  originalEvent: PointerEvent;
}

export interface RegionalSliceRenderer {
  render(frame: RegionalSliceFrame): void | Promise<void>;
  dispose(): void;
}

export interface SvgSliceAssetSource {
  loadSlice(axis: SliceAxis, index: number, signal?: AbortSignal): Promise<string>;
}

export interface Renderer3DState {
  regionColors: ReadonlyMap<number, string>;
  selectedRegionIds: ReadonlySet<number>;
  highlightedRegionId: number | null;
}

export interface Renderer3D {
  readonly technology: string;
  mount(host: HTMLElement): Promise<void> | void;
  setState(state: Renderer3DState): Promise<void> | void;
  resize(width: number, height: number, devicePixelRatio: number): void;
  dispose(): void;
}
