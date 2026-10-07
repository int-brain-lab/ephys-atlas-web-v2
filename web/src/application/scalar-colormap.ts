import type { ColoringState, ColorMappingMode, EffectiveColoringState, PseudoLogStrength } from '../domain/types.js';
import type { FeaturePayload, RegionalFeaturePayload, RegionMetadata, RepresentationDisplay } from '../data/contracts.js';
import {
  clampScalePosition, scaleDenormalize, scaleDomainIsValid, scaleNormalize, type QuantileScaleSpec, type ScaleSpec,
} from '../domain/scale-spec.js';
import { colormapDefinition, paletteCssColor } from './colormap-palettes.js';
import { quantileNormalize } from './quantile-scale.js';

type ScalarRange = readonly [number, number];
const DEFAULT_PSEUDOLOG_STRENGTH: PseudoLogStrength = 0.05;

function colorValueNormalize(
  value: number,
  range: ScalarRange,
  scale: ScaleSpec,
  mapping: ColorMappingMode,
  strength: PseudoLogStrength,
  fullRangeWidth: number,
  quantiles?: QuantileScaleSpec,
): number | null {
  if (mapping === 'match') return scaleNormalize(value, range, scale);
  if (mapping !== 'pseudolog') {
    // A manual range inside one empty CDF interval has zero quantile span: use the distribution axis.
    return (quantiles && quantileNormalize(value, range, quantiles)) ?? scaleNormalize(value, range, scale);
  }
  const transition = fullRangeWidth * strength;
  if (!(Number.isFinite(value) && Number.isFinite(transition) && transition > 0)) return null;
  const lower = Math.asinh(range[0] / transition);
  const upper = Math.asinh(range[1] / transition);
  return upper > lower ? (Math.asinh(value / transition) - lower) / (upper - lower) : null;
}

/**
 * Normalize scalar values for the selected palette. A declared diverging center
 * owns the two palette halves; manual diverging choices without one use the
 * ordinary full-range ramp and do not claim a scientific midpoint.
 */
export function scalarColorNormalize(
  value: number,
  range: ScalarRange,
  scale: ScaleSpec,
  colormap: string,
  divergingCenter?: number,
  mapping: ColorMappingMode = 'match',
  strength: PseudoLogStrength = DEFAULT_PSEUDOLOG_STRENGTH,
  quantiles?: QuantileScaleSpec,
): number | null {
  if (!scaleDomainIsValid(range, mapping === 'match' ? scale : { kind: 'linear' })) return null;
  const normalize = (domain: ScalarRange): number | null => colorValueNormalize(
    value, domain, scale, mapping, strength, range[1] - range[0], quantiles,
  );
  if (colormapDefinition(colormap)?.kind !== 'diverging') return normalize(range);
  if (typeof divergingCenter !== 'number' || !Number.isFinite(divergingCenter)) {
    return normalize(range);
  }
  const center = divergingCenter;
  if (range[1] <= center) {
    const normalized = normalize(range);
    return normalized === null ? null : clampScalePosition(normalized) / 2;
  }
  if (range[0] >= center) {
    const normalized = normalize(range);
    return normalized === null ? null : .5 + clampScalePosition(normalized) / 2;
  }
  if (value <= center) {
    const normalized = normalize([range[0], center]);
    return normalized === null ? null : clampScalePosition(normalized) / 2;
  }
  const normalized = normalize([center, range[1]]);
  return normalized === null ? null : .5 + clampScalePosition(normalized) / 2;
}

/** Invert the monotone color normalization to label a colorbar in raw units. */
export function scalarColorValueAtNormalized(
  position: number,
  range: ScalarRange,
  scale: ScaleSpec,
  colormap: string,
  divergingCenter?: number,
  mapping: ColorMappingMode = 'match',
  strength: PseudoLogStrength = DEFAULT_PSEUDOLOG_STRENGTH,
  quantiles?: QuantileScaleSpec,
): number | null {
  const normalize = (value: number) => scalarColorNormalize(value, range, scale, colormap, divergingCenter, mapping, strength, quantiles);
  const first = normalize(range[0]);
  const last = normalize(range[1]);
  if (first === null || last === null) return null;
  if (position <= first) return range[0];
  if (position >= last) return range[1];
  let low = range[0];
  let high = range[1];
  for (let index = 0; index < 48; index += 1) {
    const middle = low + (high - low) / 2;
    if ((normalize(middle) ?? first) < position) low = middle;
    else high = middle;
  }
  return low + (high - low) / 2;
}

/** Build the legend gradient from the exact same normalization as map pixels. */
export function scalarColorGradient(
  colormap: string,
  range: ScalarRange,
  scale: ScaleSpec,
  divergingCenter?: number,
  stops = 9,
  direction = '90deg',
  mapping: ColorMappingMode = 'match',
  strength: PseudoLogStrength = DEFAULT_PSEUDOLOG_STRENGTH,
  quantiles?: QuantileScaleSpec,
): string {
  const count = Math.max(mapping === 'match' ? 2 : 129, Math.floor(stops));
  const firstColor = scalarColorNormalize(range[0], range, scale, colormap, divergingCenter, mapping, strength, quantiles);
  const lastColor = scalarColorNormalize(range[1], range, scale, colormap, divergingCenter, mapping, strength, quantiles);
  const positions = Array.from({ length: count }, (_, index) => index / (count - 1));
  if (colormapDefinition(colormap)?.kind === 'diverging'
    && typeof divergingCenter === 'number' && Number.isFinite(divergingCenter)) {
    const centerPosition = scaleNormalize(divergingCenter, range, scale);
    if (centerPosition !== null && centerPosition > 0 && centerPosition < 1) positions.push(centerPosition);
  }
  if (mapping !== 'match' && firstColor !== null && lastColor !== null) {
    for (let index = 0; index < count; index += 1) {
      const target = firstColor + (lastColor - firstColor) * index / (count - 1);
      const value = scalarColorValueAtNormalized(target, range, scale, colormap, divergingCenter, mapping, strength, quantiles);
      const axisPosition = value === null ? null : scaleNormalize(value, range, scale);
      if (axisPosition !== null) positions.push(clampScalePosition(axisPosition));
    }
  }
  const colors = [...new Set(positions)].sort((left, right) => left - right).map((position) => {
    const value = scaleDenormalize(position, range, scale);
    const normalized = value === null ? null : scalarColorNormalize(value, range, scale, colormap, divergingCenter, mapping, strength, quantiles);
    return `${paletteCssColor(colormap, normalized ?? 0)} ${position * 100}%`;
  });
  return `linear-gradient(${direction}, ${colors.join(', ')})`;
}

/** Standalone colorbar: equal color steps, with raw-value labels supplied separately. */
export function scalarPaletteGradient(
  colormap: string,
  range: ScalarRange,
  scale: ScaleSpec,
  divergingCenter?: number,
  mapping: ColorMappingMode = 'match',
  strength: PseudoLogStrength = DEFAULT_PSEUDOLOG_STRENGTH,
  direction = '0deg',
  quantiles?: QuantileScaleSpec,
): string {
  const first = scalarColorNormalize(range[0], range, scale, colormap, divergingCenter, mapping, strength, quantiles) ?? 0;
  const last = scalarColorNormalize(range[1], range, scale, colormap, divergingCenter, mapping, strength, quantiles) ?? 1;
  const colors = Array.from({ length: 65 }, (_, index) => {
    const fraction = index / 64;
    return `${paletteCssColor(colormap, first + (last - first) * fraction)} ${fraction * 100}%`;
  });
  return `linear-gradient(${direction}, ${colors.join(', ')})`;
}

function validRange(range: readonly [number | null, number | null] | undefined): readonly [number, number] | null {
  const minimum = range?.[0];
  const maximum = range?.[1];
  return minimum !== null && minimum !== undefined && Number.isFinite(minimum)
    && maximum !== null && maximum !== undefined && Number.isFinite(maximum)
    && maximum > minimum
    ? [minimum, maximum]
    : null;
}

/** Resolve the one feature-global color range shared by every presentation surface. */
export function effectiveScalarColorRange(
  feature: FeaturePayload,
  coloring: Pick<ColoringState, 'range' | 'statistic'>,
  display?: RepresentationDisplay,
): readonly [number, number] | null {
  if (coloring.range.mode === 'fixed') {
    return validRange([coloring.range.min, coloring.range.max]);
  }
  const releaseRange = validRange(display?.range);
  if (releaseRange) return releaseRange;
  if (feature.representation === 'volume') return validRange(feature.summary.valueRange);
  const robustRange = validRange([feature.global?.q05 ?? null, feature.global?.q95 ?? null]);
  if (robustRange) return robustRange;
  const values = feature.statistics[coloring.statistic] ?? feature.statistics.mean;
  if (!values) return null;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return null;
  return maximum > minimum ? [minimum, maximum] : [minimum, minimum + 1];
}

export function regionalColorMap(feature: RegionalFeaturePayload, coloring: EffectiveColoringState): ReadonlyMap<number, string> {
  const values = feature.statistics[coloring.statistic] ?? feature.statistics.mean;
  const range = effectiveScalarColorRange(feature, coloring);
  if (!values || !range) return new Map();
  const [min, max] = range;
  if (!scaleDomainIsValid(range, coloring.scale)) return new Map();
  const colors = new Map<number, string>();
  for (let index = 0; index < feature.regionIds.length; index += 1) {
    const regionId = Number(feature.regionIds[index]);
    const value = values[index];
    if (!Number.isInteger(regionId) || value === undefined || !Number.isFinite(value)) continue;
    const normalized = scalarColorNormalize(
      value, [min, max], coloring.scale, coloring.colormap, coloring.divergingCenter,
      coloring.colorMapping, coloring.pseudoLogStrength, coloring.colorQuantiles,
    );
    if (normalized === null) continue;
    colors.set(regionId, paletteCssColor(coloring.colormap, normalized));
  }
  return colors;
}

export function atlasRegionColorMap(regions: readonly RegionMetadata[]): ReadonlyMap<number, string> {
  return new Map(regions.flatMap((region) => region.colorHex ? [[region.atlasId, region.colorHex] as const] : []));
}

/**
 * Preserve chromatic Allen colors, but tone down achromatic near-white entries
 * (notably root and fiber tracts) for the dark anatomical canvas.
 */
export function darkThemeAtlasColor(colorHex: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colorHex);
  if (!match) return colorHex;
  const channels = match.slice(1).map((value) => Number.parseInt(value ?? '0', 16));
  const minimum = Math.min(...channels);
  const maximum = Math.max(...channels);
  if (minimum < 192 || maximum - minimum > 16) return colorHex;
  const darkNeutral = [40, 61, 76];
  return `#${channels.map((channel, index) => Math.round(channel * .35 + (darkNeutral[index] ?? 0) * .65)
    .toString(16).padStart(2, '0')).join('')}`;
}

/** Dark-theme atlas presentation colors expanded onto both signed hemispheres. */
export function bilateralAtlasRegionColorMap(regions: readonly RegionMetadata[]): ReadonlyMap<number, string> {
  const colors = new Map<number, string>();
  for (const region of regions) {
    if (!region.colorHex || region.atlasId === 0) continue;
    const leftId = -Math.abs(region.atlasId);
    const color = darkThemeAtlasColor(region.colorHex);
    colors.set(leftId, color);
    colors.set(Math.abs(leftId), color);
  }
  return colors;
}
