import type { SliceAxis, SliceGuide, SliceIndices, ViewBox } from './types.js';
import {
  PROJECTION_PLANE_AXES,
  SLICE_WORLD_AXIS,
  type WorldCoordinateUm,
} from './coordinate-space.js';

export interface AxisCalibration {
  axis: SliceAxis;
  indexCount: number;
  stepUm: number;
  originUm: number;
  direction: 1 | -1;
}

interface LegacyViewAxisRegistration {
  sourceAxis: SliceAxis;
  targetAxis: SliceAxis;
  dimension: 'x' | 'y';
  startPosition: number;
  endPosition: number;
}

export const REGIONAL_10UM_CALIBRATION: Readonly<Record<SliceAxis, AxisCalibration>> = {
  coronal: { axis: 'coronal', indexCount: 1320, stepUm: 10, originUm: 5400, direction: -1 },
  sagittal: { axis: 'sagittal', indexCount: 1140, stepUm: 10, originUm: -5739, direction: 1 },
  horizontal: { axis: 'horizontal', indexCount: 800, stepUm: 10, originUm: 332, direction: -1 },
};

export const VOLUME_25UM_CALIBRATION: Readonly<Record<SliceAxis, AxisCalibration>> = {
  coronal: { axis: 'coronal', indexCount: 528, stepUm: 25, originUm: 5400, direction: -1 },
  sagittal: { axis: 'sagittal', indexCount: 456, stepUm: 25, originUm: -5739, direction: 1 },
  horizontal: { axis: 'horizontal', indexCount: 320, stepUm: 25, originUm: 332, direction: -1 },
};

export const LEGACY_VIEW_BOXES: Readonly<Record<SliceAxis, ViewBox>> = {
  coronal: { x: 58, y: 50, width: 356, height: 250 },
  sagittal: { x: 56, y: 66, width: 358, height: 217 },
  horizontal: { x: 122, y: 42, width: 230, height: 266 },
};

// The curated SVGs contain no scientific affine. Their fixed view boxes are the
// registration envelopes: each visible dimension spans the full corresponding
// Allen axis in the same display direction as the v1 anatomical artwork.
// Scientific coordinates are converted before entering this display-only map.
const LEGACY_VIEW_REGISTRATIONS: readonly LegacyViewAxisRegistration[] = [
  { sourceAxis: 'sagittal', targetAxis: 'coronal', dimension: 'x', startPosition: 58, endPosition: 414 },
  { sourceAxis: 'horizontal', targetAxis: 'coronal', dimension: 'y', startPosition: 50, endPosition: 300 },
  { sourceAxis: 'coronal', targetAxis: 'sagittal', dimension: 'x', startPosition: 56, endPosition: 414 },
  { sourceAxis: 'horizontal', targetAxis: 'sagittal', dimension: 'y', startPosition: 66, endPosition: 283 },
  { sourceAxis: 'sagittal', targetAxis: 'horizontal', dimension: 'x', startPosition: 122, endPosition: 352 },
  { sourceAxis: 'coronal', targetAxis: 'horizontal', dimension: 'y', startPosition: 42, endPosition: 308 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function validateIndex(index: number, calibration: AxisCalibration): void {
  if (!Number.isFinite(index) || index < 0 || index > calibration.indexCount - 1) {
    throw new RangeError(`${calibration.axis} index ${index} is outside [0, ${calibration.indexCount - 1}]`);
  }
}

export function maxRegionalSliceIndex(axis: SliceAxis): number {
  return REGIONAL_10UM_CALIBRATION[axis].indexCount - 1;
}

export function indexToCoordinateUm(index: number, calibration: AxisCalibration): number {
  validateIndex(index, calibration);
  return calibration.originUm + calibration.direction * calibration.stepUm * index;
}

export function coordinateUmToIndex(
  coordinateUm: number,
  calibration: AxisCalibration,
  rounding: 'nearest' | 'floor' | 'ceil' = 'nearest',
): number {
  const raw = (coordinateUm - calibration.originUm) / (calibration.direction * calibration.stepUm);
  const rounded = rounding === 'floor' ? Math.floor(raw) : rounding === 'ceil' ? Math.ceil(raw) : Math.round(raw);
  return clamp(rounded, 0, calibration.indexCount - 1);
}

export function regionalIndexToCoordinateUm(axis: SliceAxis, index: number): number {
  return indexToCoordinateUm(index, REGIONAL_10UM_CALIBRATION[axis]);
}

export function formatRegionalCoordinate(axis: SliceAxis, index: number): string {
  const prefix = axis === 'coronal' ? 'AP' : axis === 'sagittal' ? 'ML' : 'DV';
  const mm = regionalIndexToCoordinateUm(axis, index) / 1000;
  const signed = mm > 0 ? `+${mm.toFixed(2)}` : mm.toFixed(2);
  return `${prefix} ${signed} mm`;
}

export function volumeIndexToCoordinateUm(axis: SliceAxis, index: number): number {
  return indexToCoordinateUm(index, VOLUME_25UM_CALIBRATION[axis]);
}

export function coordinateUmToVolumeIndex(axis: SliceAxis, coordinateUm: number): number {
  return coordinateUmToIndex(coordinateUm, VOLUME_25UM_CALIBRATION[axis]);
}

export function regionalIndexToVolumeIndex(axis: SliceAxis, regionalIndex: number): number {
  return coordinateUmToVolumeIndex(axis, regionalIndexToCoordinateUm(axis, regionalIndex));
}

export function regionalIndicesToWorld(indices: SliceIndices): WorldCoordinateUm {
  return {
    ml: regionalIndexToCoordinateUm('sagittal', indices.sagittal),
    ap: regionalIndexToCoordinateUm('coronal', indices.coronal),
    dv: regionalIndexToCoordinateUm('horizontal', indices.horizontal),
  };
}

export function worldToRegionalIndices(world: WorldCoordinateUm): SliceIndices {
  return {
    coronal: coordinateUmToIndex(world.ap, REGIONAL_10UM_CALIBRATION.coronal),
    sagittal: coordinateUmToIndex(world.ml, REGIONAL_10UM_CALIBRATION.sagittal),
    horizontal: coordinateUmToIndex(world.dv, REGIONAL_10UM_CALIBRATION.horizontal),
  };
}

function projectLegacyWorldGuide(
  sourceAxis: SliceAxis,
  targetAxis: SliceAxis,
  world: WorldCoordinateUm,
): SliceGuide {
  const registration = LEGACY_VIEW_REGISTRATIONS.find(
    (candidate) => candidate.sourceAxis === sourceAxis && candidate.targetAxis === targetAxis,
  );
  if (!registration) throw new Error(`No legacy guide projection from ${sourceAxis} to ${targetAxis}`);
  const source = REGIONAL_10UM_CALIBRATION[sourceAxis];
  const worldAxis = SLICE_WORLD_AXIS[sourceAxis];
  const firstCoordinateUm = indexToCoordinateUm(0, source);
  const lastCoordinateUm = indexToCoordinateUm(source.indexCount - 1, source);
  const fraction = (world[worldAxis] - firstCoordinateUm) / (lastCoordinateUm - firstCoordinateUm);
  return {
    sourceAxis,
    targetAxis,
    dimension: registration.dimension,
    position: registration.startPosition + fraction * (registration.endPosition - registration.startPosition),
  };
}

export function projectLegacyGuide(sourceAxis: SliceAxis, targetAxis: SliceAxis, sourceIndex: number): SliceGuide {
  const source = REGIONAL_10UM_CALIBRATION[sourceAxis];
  validateIndex(sourceIndex, source);
  const worldAxis = SLICE_WORLD_AXIS[sourceAxis];
  const world = { ml: 0, ap: 0, dv: 0, [worldAxis]: indexToCoordinateUm(sourceIndex, source) };
  return projectLegacyWorldGuide(sourceAxis, targetAxis, world);
}

export function linkedGuides(indices: SliceIndices, targetAxis: SliceAxis): readonly SliceGuide[] {
  const world = regionalIndicesToWorld(indices);
  return PROJECTION_PLANE_AXES[targetAxis].map((worldAxis) => {
    const sourceAxis = (Object.keys(SLICE_WORLD_AXIS) as SliceAxis[])
      .find((candidate) => SLICE_WORLD_AXIS[candidate] === worldAxis);
    if (!sourceAxis) throw new Error(`No slice axis corresponds to world axis ${worldAxis}`);
    return projectLegacyWorldGuide(sourceAxis, targetAxis, world);
  });
}
