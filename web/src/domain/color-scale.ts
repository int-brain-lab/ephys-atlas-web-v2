import type { ColoringState, ColorScale, EffectiveColoringState } from './types.js';

export function resolveColorScale(
  selection: ColoringState['scale'],
  featureDefault: ColorScale | undefined,
): ColorScale {
  return selection === 'auto' ? featureDefault ?? 'linear' : selection;
}

export function resolveColoringState(
  coloring: ColoringState,
  featureDefault: ColorScale | undefined,
): EffectiveColoringState {
  return { ...coloring, scale: resolveColorScale(coloring.scale, featureDefault) };
}
