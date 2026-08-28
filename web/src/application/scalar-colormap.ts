import type { ColoringState, EffectiveColoringState } from '../domain/types.js';
import type { FeaturePayload, RegionalFeaturePayload, RegionMetadata, RepresentationDisplay } from '../data/contracts.js';
import { scaleDomainIsValid, scaleNormalize } from '../domain/scale-spec.js';
import { paletteCssColor } from './colormap-palettes.js';

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
    const normalized = scaleNormalize(value, [min, max], coloring.scale);
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
