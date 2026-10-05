import type { EffectiveColoringState } from '../domain/types.js';
import type { VolumeFeaturePayload } from '../data/contracts.js';
import type { VolumeSlice } from './volume.js';
import { scaleDomainIsValid } from '../domain/scale-spec.js';
import { paletteRgb } from '../application/colormap-palettes.js';
import { effectiveScalarColorRange, scalarColorNormalize } from '../application/scalar-colormap.js';
import { volumeValueIsVisible } from './volume-inspection.js';

function finiteRange(values: Float32Array): readonly [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return max > min ? [min, max] : [min, min + 1];
}

export function rgbaForSlice(
  feature: VolumeFeaturePayload,
  slice: VolumeSlice,
  coloring: EffectiveColoringState,
): Uint8ClampedArray {
  const range = effectiveScalarColorRange(feature, coloring) ?? finiteRange(slice.data);
  const rgba = new Uint8ClampedArray(slice.data.length * 4);
  if (!range) return rgba;
  const [min, max] = range;
  if (!scaleDomainIsValid(range, coloring.scale)) return rgba;
  for (let index = 0; index < slice.data.length; index += 1) {
    const value = slice.data[index]!;
    const offset = index * 4;
    if (!volumeValueIsVisible(feature, value, slice.validity?.[index])) continue;
    const normalized = scalarColorNormalize(
      value, [min, max], coloring.scale, coloring.colormap, coloring.divergingCenter,
      coloring.colorMapping, coloring.pseudoLogStrength,
    );
    if (normalized === null) continue;
    const [r, g, b] = paletteRgb(coloring.colormap, normalized);
    rgba[offset] = r;
    rgba[offset + 1] = g;
    rgba[offset + 2] = b;
    rgba[offset + 3] = 255;
  }
  return rgba;
}

