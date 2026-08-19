import type { SliceAxis, SliceGuide, SliceIndices, ViewBox } from './types.js';

export interface AxisCalibration {
  axis: SliceAxis;
  indexCount: number;
  stepUm: number;
  originUm: number;
  direction: 1 | -1;
}

interface LegacyGuideProjection {
  sourceAxis: SliceAxis;
  targetAxis: SliceAxis;
  dimension: 'x' | 'y';
  center: number;
  span: number;
  clampMargin?: number;
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

const LEGACY_GUIDE_PROJECTIONS: readonly LegacyGuideProjection[] = [
  { sourceAxis: 'sagittal', targetAxis: 'coronal', dimension: 'x', center: 237, span: 354, clampMargin: 10 },
  { sourceAxis: 'sagittal', targetAxis: 'horizontal', dimension: 'x', center: 237, span: 230, clampMargin: 10 },
  { sourceAxis: 'coronal', targetAxis: 'sagittal', dimension: 'x', center: 236, span: 354, clampMargin: 10 },
  { sourceAxis: 'coronal', targetAxis: 'horizontal', dimension: 'y', center: 174, span: 264, clampMargin: 10 },
  { sourceAxis: 'horizontal', targetAxis: 'coronal', dimension: 'y', center: 174, span: 242 },
  { sourceAxis: 'horizontal', targetAxis: 'sagittal', dimension: 'y', center: 174, span: 210 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function validateIndex(index: number, calibration: AxisCalibration): void {
  if (!Number.isFinite(index) || index < 0 || index > calibration.indexCount - 1) {
    throw new RangeError(`${calibration.axis} index ${index} is outside [0, ${calibration.indexCount - 1}]`);
  }
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

export function volumeIndexToCoordinateUm(axis: SliceAxis, index: number): number {
  return indexToCoordinateUm(index, VOLUME_25UM_CALIBRATION[axis]);
}

export function coordinateUmToVolumeIndex(axis: SliceAxis, coordinateUm: number): number {
  return coordinateUmToIndex(coordinateUm, VOLUME_25UM_CALIBRATION[axis]);
}

export function regionalIndexToVolumeIndex(axis: SliceAxis, regionalIndex: number): number {
  return coordinateUmToVolumeIndex(axis, regionalIndexToCoordinateUm(axis, regionalIndex));
}

export function projectLegacyGuide(sourceAxis: SliceAxis, targetAxis: SliceAxis, sourceIndex: number): SliceGuide {
  const projection = LEGACY_GUIDE_PROJECTIONS.find(
    (candidate) => candidate.sourceAxis === sourceAxis && candidate.targetAxis === targetAxis,
  );
  if (!projection) throw new Error(`No legacy guide projection from ${sourceAxis} to ${targetAxis}`);

  const source = REGIONAL_10UM_CALIBRATION[sourceAxis];
  validateIndex(sourceIndex, source);
  const margin = projection.clampMargin ?? 0;
  const visualIndex = clamp(sourceIndex, margin, source.indexCount - margin);
  const ratio = visualIndex / source.indexCount;

  return {
    sourceAxis,
    targetAxis,
    dimension: projection.dimension,
    position: projection.center + projection.span * (ratio - 0.5),
  };
}

export function linkedGuides(indices: SliceIndices, targetAxis: SliceAxis): readonly SliceGuide[] {
  return (Object.keys(indices) as SliceAxis[])
    .filter((sourceAxis) => sourceAxis !== targetAxis)
    .map((sourceAxis) => projectLegacyGuide(sourceAxis, targetAxis, indices[sourceAxis]));
}
