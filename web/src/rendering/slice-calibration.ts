import type { SliceAxis, SliceState } from '../domain/types.js';

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SliceGuide {
  sourceAxis: SliceAxis;
  targetAxis: SliceAxis;
  dimension: 'x' | 'y';
  position: number;
}

interface AxisCalibration {
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

// Copied from work/rendering's tested legacy display/scientific calibration.
export const REGIONAL_10UM_CALIBRATION: Readonly<Record<SliceAxis, AxisCalibration>> = {
  coronal: { indexCount: 1320, stepUm: 10, originUm: 5400, direction: -1 },
  sagittal: { indexCount: 1140, stepUm: 10, originUm: -5739, direction: 1 },
  horizontal: { indexCount: 800, stepUm: 10, originUm: 332, direction: -1 },
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

export function maxRegionalSliceIndex(axis: SliceAxis): number {
  return REGIONAL_10UM_CALIBRATION[axis].indexCount - 1;
}

export function regionalIndexToCoordinateUm(axis: SliceAxis, index: number): number {
  const calibration = REGIONAL_10UM_CALIBRATION[axis];
  const safeIndex = clamp(Math.round(index), 0, calibration.indexCount - 1);
  return calibration.originUm + calibration.direction * calibration.stepUm * safeIndex;
}

export function formatRegionalCoordinate(axis: SliceAxis, index: number): string {
  const prefix = axis === 'coronal' ? 'AP' : axis === 'sagittal' ? 'ML' : 'DV';
  const mm = regionalIndexToCoordinateUm(axis, index) / 1000;
  const signed = mm > 0 ? `+${mm.toFixed(2)}` : mm.toFixed(2);
  return `${prefix} ${signed} mm`;
}

export function linkedGuides(indices: SliceState, targetAxis: SliceAxis): readonly SliceGuide[] {
  return (Object.keys(indices) as SliceAxis[])
    .filter((sourceAxis) => sourceAxis !== targetAxis)
    .map((sourceAxis) => {
      const projection = LEGACY_GUIDE_PROJECTIONS.find(
        (candidate) => candidate.sourceAxis === sourceAxis && candidate.targetAxis === targetAxis,
      );
      if (!projection) throw new Error(`No legacy guide projection from ${sourceAxis} to ${targetAxis}`);
      const source = REGIONAL_10UM_CALIBRATION[sourceAxis];
      const margin = projection.clampMargin ?? 0;
      const visualIndex = clamp(Math.round(indices[sourceAxis]), margin, source.indexCount - margin);
      const ratio = visualIndex / source.indexCount;
      return {
        sourceAxis,
        targetAxis,
        dimension: projection.dimension,
        position: projection.center + projection.span * (ratio - 0.5),
      };
    });
}
