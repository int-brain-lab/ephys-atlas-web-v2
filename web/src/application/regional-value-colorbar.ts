import type { ColorMappingMode, PseudoLogStrength } from '../domain/types.js';
import type { QuantileScaleSpec, ScaleSpec } from '../domain/scale-spec.js';
import { clampScalePosition } from '../domain/scale-spec.js';
import { scalarColorNormalize, scalarPaletteGradient } from './scalar-colormap.js';
import { paletteCssColor } from './colormap-palettes.js';

export interface RegionalValueColorbar {
  readonly range: readonly [number, number];
  readonly scale: ScaleSpec;
  readonly colormap: string;
  readonly divergingCenter?: number;
  readonly colorMapping: ColorMappingMode;
  readonly pseudoLogStrength: PseudoLogStrength;
  readonly colorQuantiles?: QuantileScaleSpec;
  readonly gradient: string;
}

export function buildRegionalValueColorbar(
  options: Omit<RegionalValueColorbar, 'gradient'>,
): RegionalValueColorbar {
  return {
    ...options,
    gradient: scalarPaletteGradient(options.colormap, options.range, options.scale, options.divergingCenter,
      options.colorMapping, options.pseudoLogStrength, '90deg', options.colorQuantiles),
  };
}

/** Position on the same palette span as the standalone legend, including one-sided diverging ranges. */
export function regionalValueColorbarPosition(value: number, bar: RegionalValueColorbar): number | null {
  if (!Number.isFinite(value)) return null;
  const normalize = (raw: number) => scalarColorNormalize(raw, bar.range, bar.scale, bar.colormap,
    bar.divergingCenter, bar.colorMapping, bar.pseudoLogStrength, bar.colorQuantiles);
  const first = normalize(bar.range[0]);
  const last = normalize(bar.range[1]);
  // Clamp raw values first: a finite zero below a logarithmic range still belongs at its lower edge.
  const normalized = normalize(Math.max(bar.range[0], Math.min(bar.range[1], value)));
  if (first === null || last === null || normalized === null || last <= first) return null;
  return clampScalePosition((normalized - first) / (last - first));
}

/** The tick retains the actual feature color while the background ramp is subdued. */
export function regionalValueColorbarColor(value: number, bar: RegionalValueColorbar): string | null {
  if (!Number.isFinite(value)) return null;
  const clipped = Math.max(bar.range[0], Math.min(bar.range[1], value));
  const normalized = scalarColorNormalize(clipped, bar.range, bar.scale, bar.colormap,
    bar.divergingCenter, bar.colorMapping, bar.pseudoLogStrength, bar.colorQuantiles);
  return normalized === null ? null : paletteCssColor(bar.colormap, normalized);
}
