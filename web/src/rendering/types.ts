import type { SliceAxis, SliceGuide, SliceIndices, ViewBox } from '../core/spatial.js';
export { SLICE_AXES } from '../core/spatial.js';
export type { GuideDimension, SliceAxis, SliceGuide, SliceIndices, ViewBox } from '../core/spatial.js';

export type MappingName = 'allen' | 'beryl' | 'cosmos';

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
  packFormat: 'anatomy-pack-v1' | 'anatomy-pack-v2' | 'anatomy-pack-v3';
  axis: SliceAxis;
  sliceIndex: number;
  worldCoordinateUm: number;
  paths: readonly AnatomyRegionPath[];
  svgFragment?: string;
  viewBox: ViewBox;
}

export interface AnatomySliceSource {
  loadSlice(axis: SliceAxis, index: number, signal?: AbortSignal): Promise<AnatomySlice>;
  worldFromSliceIndices(indices: SliceIndices): Promise<import('../core/spatial.js').WorldCoordinateUm>;
  guidesForWorld(axis: SliceAxis, world: import('../core/spatial.js').WorldCoordinateUm): Promise<readonly SliceGuide[]>;
  prefetchNextPack?(axis: SliceAxis, index: number, direction: -1 | 1): void;
  getDisplaySliceIndices?(): Promise<Readonly<Record<SliceAxis, readonly number[]>> | null>;
  dispose?(): void;
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
