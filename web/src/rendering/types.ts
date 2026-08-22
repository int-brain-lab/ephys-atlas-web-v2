import type { SliceAxis, SliceGuide, ViewBox } from '../core/spatial.js';
import type { ProjectionId } from '../domain/types.js';
export { SLICE_AXES } from '../core/spatial.js';
export type { GuideDimension, SliceAxis, SliceGuide, SliceIndices, ViewBox } from '../core/spatial.js';

export type MappingName = 'allen' | 'beryl' | 'cosmos';

export interface RegionalSliceFrame {
  axis: ProjectionId;
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
  axis: ProjectionId;
  regionId: number;
  type: 'hover' | 'inspect' | 'leave' | 'select';
  originalEvent: PointerEvent;
}

export interface RegionalSliceRenderer {
  render(frame: RegionalSliceFrame): void | Promise<void>;
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
