import type { SliceAxis, SliceIndices, WorldCoordinateUm } from './spatial.js';

export interface AxisCalibration {
  axis: SliceAxis;
  indexCount: number;
  stepUm: number;
  originUm: number;
  direction: 1 | -1;
}

export const REGIONAL_10UM_CALIBRATION: Readonly<Record<SliceAxis, AxisCalibration>> = {
  coronal: { axis: 'coronal', indexCount: 1320, stepUm: 10, originUm: 5400, direction: -1 },
  sagittal: { axis: 'sagittal', indexCount: 1140, stepUm: 10, originUm: -5739, direction: 1 },
  horizontal: { axis: 'horizontal', indexCount: 800, stepUm: 10, originUm: 332, direction: -1 },
};

export const ANATOMY_10UM_CALIBRATION = REGIONAL_10UM_CALIBRATION;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function validateIndex(index: number, calibration: AxisCalibration): void {
  if (!Number.isFinite(index) || index < 0 || index > calibration.indexCount - 1) {
    throw new RangeError(`${calibration.axis} index ${index} is outside [0, ${calibration.indexCount - 1}]`);
  }
}

export function maxRegionalSliceIndex(axis: SliceAxis): number {
  return ANATOMY_10UM_CALIBRATION[axis].indexCount - 1;
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
  return indexToCoordinateUm(index, ANATOMY_10UM_CALIBRATION[axis]);
}

export function formatRegionalCoordinate(axis: SliceAxis, index: number): string {
  const prefix = axis === 'coronal' ? 'AP' : axis === 'sagittal' ? 'ML' : 'DV';
  const mm = regionalIndexToCoordinateUm(axis, index) / 1000;
  const signed = mm > 0 ? `+${mm.toFixed(2)}` : mm.toFixed(2);
  return `${prefix} ${signed} mm`;
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
    coronal: coordinateUmToIndex(world.ap, ANATOMY_10UM_CALIBRATION.coronal),
    sagittal: coordinateUmToIndex(world.ml, ANATOMY_10UM_CALIBRATION.sagittal),
    horizontal: coordinateUmToIndex(world.dv, ANATOMY_10UM_CALIBRATION.horizontal),
  };
}
