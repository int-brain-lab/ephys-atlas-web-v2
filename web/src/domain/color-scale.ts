import type { ColoringState, ColorScale, EffectiveColoringState } from './types.js';
import { scaleSpec, type ScaleSpec } from './scale-spec.js';

export function resolveColorScale(
  selection: ColoringState['scale'],
  featureDefault: ColorScale | undefined,
): ColorScale {
  return selection === 'auto' ? featureDefault ?? 'linear' : selection;
}

export function resolveColoringState(
  coloring: ColoringState,
  featureDefault: ColorScale | undefined,
  symlogThreshold?: number,
): EffectiveColoringState {
  return { ...coloring, scale: scaleSpec(resolveColorScale(coloring.scale, featureDefault), symlogThreshold) };
}

export function coloringWithScaleSpec(coloring: ColoringState, spec: ScaleSpec): EffectiveColoringState {
  return { ...coloring, scale: spec };
}
