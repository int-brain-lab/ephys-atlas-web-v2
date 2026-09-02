import type { ColoringState, EffectiveColoringState } from '../domain/types.js';
import type { FeaturePayload, RegionalFeaturePayload, RegionMetadata, RepresentationDisplay } from '../data/contracts.js';
import { clampScalePosition, scaleDenormalize, scaleDomainIsValid, scaleNormalize, type ScaleSpec } from '../domain/scale-spec.js';
import { colormapDefinition, paletteCssColor } from './colormap-palettes.js';

type ScalarRange = readonly [number, number];

/**
 * Normalize scalar values for the selected palette. Diverging palettes only
 * receive a release-declared center; their two sides are independently mapped
 * into the matching palette halves.
 */
export function scalarColorNormalize(
  value: number,
  range: ScalarRange,
  scale: ScaleSpec,
  colormap: string,
  divergingCenter?: number,
): number | null {
  if (!scaleDomainIsValid(range, scale)) return null;
  if (colormapDefinition(colormap)?.kind !== 'diverging') return scaleNormalize(value, range, scale);
  if (typeof divergingCenter !== 'number' || !Number.isFinite(divergingCenter)) return null;
  const center = divergingCenter;
  if (range[1] <= center) {
    const normalized = scaleNormalize(value, range, scale);
    return normalized === null ? null : clampScalePosition(normalized) / 2;
  }
  if (range[0] >= center) {
    const normalized = scaleNormalize(value, range, scale);
    return normalized === null ? null : .5 + clampScalePosition(normalized) / 2;
  }
  if (value <= center) {
    const normalized = scaleNormalize(value, [range[0], center], scale);
    return normalized === null ? null : clampScalePosition(normalized) / 2;
  }
  const normalized = scaleNormalize(value, [center, range[1]], scale);
  return normalized === null ? null : .5 + clampScalePosition(normalized) / 2;
}

/** Build the legend gradient from the exact same normalization as map pixels. */
export function scalarColorGradient(
  colormap: string,
  range: ScalarRange,
  scale: ScaleSpec,
  divergingCenter?: number,
  stops = 9,
): string {
  const count = Math.max(2, Math.floor(stops));
  const positions = Array.from({ length: count }, (_, index) => index / (count - 1));
  if (colormapDefinition(colormap)?.kind === 'diverging'
    && typeof divergingCenter === 'number' && Number.isFinite(divergingCenter)) {
    const centerPosition = scaleNormalize(divergingCenter, range, scale);
    if (centerPosition !== null && centerPosition > 0 && centerPosition < 1) positions.push(centerPosition);
  }
  const colors = [...new Set(positions)].sort((left, right) => left - right).map((position) => {
    const value = scaleDenormalize(position, range, scale);
    const normalized = value === null ? null : scalarColorNormalize(value, range, scale, colormap, divergingCenter);
    return `${paletteCssColor(colormap, normalized ?? 0)} ${position * 100}%`;
  });
  return `linear-gradient(90deg, ${colors.join(', ')})`;
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
