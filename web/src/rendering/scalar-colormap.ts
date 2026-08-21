import type { ColoringState, EffectiveColoringState } from '../domain/types.js';
import type { RegionalFeaturePayload } from '../data/contracts.js';
import type { RegionMetadata } from '../data/contracts.js';

const PALETTES: Record<string, readonly [number, number, number][]> = {
  viridis: [
    [68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37],
  ],
  magma: [
    [0, 0, 4], [81, 18, 124], [183, 55, 121], [252, 137, 97], [252, 253, 191],
  ],
};

function interpolateChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function paletteColor(name: string, t: number): string {
  const palette = PALETTES[name] ?? PALETTES.viridis;
  if (!palette) return 'rgb(128 128 128)';
  const normalized = Math.max(0, Math.min(1, t));
  const scaled = normalized * (palette.length - 1);
  const lowerIndex = Math.floor(scaled);
  const upperIndex = Math.min(palette.length - 1, lowerIndex + 1);
  const local = scaled - lowerIndex;
  const lower = palette[lowerIndex] ?? palette[0] ?? [128, 128, 128];
  const upper = palette[upperIndex] ?? lower;
  return `rgb(${interpolateChannel(lower[0], upper[0], local)} ${interpolateChannel(lower[1], upper[1], local)} ${interpolateChannel(lower[2], upper[2], local)})`;
}

export function regionalColorRange(feature: RegionalFeaturePayload, coloring: ColoringState): readonly [number, number] | null {
  if (coloring.range.mode === 'fixed') {
    if (Number.isFinite(coloring.range.min) && Number.isFinite(coloring.range.max) && coloring.range.max > coloring.range.min) {
      return [coloring.range.min, coloring.range.max];
    }
    return null;
  }
  const global = feature.global;
  if (coloring.statistic !== 'count' && global?.q05 !== undefined && global.q95 !== undefined && global.q95 > global.q05) {
    return [global.q05, global.q95];
  }
  const values = feature.statistics[coloring.statistic] ?? feature.statistics.mean;
  if (!values) return null;
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  return max > min ? [min, max] : [min, min + 1];
}

export function regionalColorMap(feature: RegionalFeaturePayload, coloring: EffectiveColoringState): ReadonlyMap<number, string> {
  const values = feature.statistics[coloring.statistic] ?? feature.statistics.mean;
  const range = regionalColorRange(feature, coloring);
  if (!values || !range) return new Map();
  const [min, max] = range;
  if (coloring.scale === 'log' && !(min > 0 && max > min)) return new Map();
  const span = max - min;
  const colors = new Map<number, string>();
  for (let index = 0; index < feature.regionIds.length; index += 1) {
    const regionId = Number(feature.regionIds[index]);
    const value = values[index];
    if (!Number.isInteger(regionId) || value === undefined || !Number.isFinite(value)) continue;
    let normalized: number;
    if (coloring.scale === 'log') {
      if (value <= 0) continue;
      normalized = (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min));
    } else {
      normalized = (value - min) / span;
    }
    colors.set(regionId, paletteColor(coloring.colormap, normalized));
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

/** Feature colors on folded-left IDs, with right anatomy retained as reference. */
export function bilateralFeatureColorMap(
  feature: RegionalFeaturePayload,
  coloring: EffectiveColoringState,
  regions: readonly RegionMetadata[],
): ReadonlyMap<number, string> {
  const colors = new Map<number, string>();
  for (const [atlasId, color] of bilateralAtlasRegionColorMap(regions)) {
    if (atlasId > 0) colors.set(atlasId, color);
  }
  for (const [atlasId, color] of regionalColorMap(feature, coloring)) {
    if (atlasId !== 0) colors.set(-Math.abs(atlasId), color);
  }
  return colors;
}
