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
  /** Numeric domain used by the concrete SVG asset (legacy assets use BrainRegions indices). */
  regionColors?: ReadonlyMap<number, string>;
  selectedRegionIds?: ReadonlySet<number>;
  highlightedRegionId?: number | null;
  highlightedRegionIds?: ReadonlySet<number>;
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

export interface AnatomyRegionPath {
  atlasIds: Readonly<Record<MappingName, number>>;
  d: string;
}

export interface AnatomySlice {
  packFormat: 'anatomy-pack-v1' | 'anatomy-pack-v2';
  axis: SliceAxis;
  sliceIndex: number;
  worldCoordinateUm: number;
  paths: readonly AnatomyRegionPath[];
  viewBox: ViewBox;
}

/** Transport-independent boundary between generated anatomy and its renderer. */
export interface AnatomySliceSource {
  loadSlice(axis: SliceAxis, index: number, signal?: AbortSignal): Promise<AnatomySlice>;
  worldFromSliceIndices(indices: SliceIndices): Promise<import('./coordinate-space.js').WorldCoordinateUm>;
  guidesForWorld(axis: SliceAxis, world: import('./coordinate-space.js').WorldCoordinateUm): Promise<readonly SliceGuide[]>;
  /** Opportunistically warm the immutable packs immediately before and after the requested slice's pack. */
  prefetchAdjacentPacks?(axis: SliceAxis, index: number): void;
}

export interface Renderer3DState {
  regionColors: ReadonlyMap<number, string>;
  selectedRegionIds: ReadonlySet<number>;
  highlightedRegionId: number | null;
}

export interface Renderer3D {
  readonly technology: string;
  mount(host: HTMLElement): Promise<void> | void;
  setScene(scene: import('./scene3d.js').Renderer3DScene): Promise<void> | void;
  setState(state: Renderer3DState): Promise<void> | void;
  resize(width: number, height: number, devicePixelRatio: number): void;
  dispose(): void;
}

export interface VolumeSliceFrame {
  axis: SliceAxis;
  index: number;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface VolumeSliceRenderer {
  render(frame: VolumeSliceFrame): void | Promise<void>;
  dispose(): void;
}
