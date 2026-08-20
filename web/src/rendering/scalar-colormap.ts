import type { ColoringState } from '../domain/types.js';
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

export function regionalColorMap(feature: RegionalFeaturePayload, coloring: ColoringState): ReadonlyMap<number, string> {
  const values = feature.statistics[coloring.statistic] ?? feature.statistics.mean;
  const range = regionalColorRange(feature, coloring);
  if (!values || !range) return new Map();
  const [min, max] = range;
  const span = max - min;
  const colors = new Map<number, string>();
  for (let index = 0; index < feature.regionIds.length; index += 1) {
    const regionId = Number(feature.regionIds[index]);
    const value = values[index];
    if (!Number.isInteger(regionId) || value === undefined || !Number.isFinite(value)) continue;
    let normalized: number;
    if (coloring.scale === 'log' && min > 0 && value > 0 && max > min) {
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
