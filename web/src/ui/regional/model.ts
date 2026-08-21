import type { RegionMetadata, RegionalFeaturePayload } from '../../data/contracts.js';
import type { StatisticId } from '../../domain/types.js';

export function regionalStatisticValues(
  feature: RegionalFeaturePayload,
  statistic: StatisticId,
): readonly number[] | undefined {
  return feature.statistics[statistic]
    ?? feature.statistics.mean
    ?? Object.values(feature.statistics)[0];
}

export function buildRegionalValueMap(
  feature: RegionalFeaturePayload,
  statistic: StatisticId,
): ReadonlyMap<string, number> {
  const values = regionalStatisticValues(feature, statistic);
  if (!values) return new Map();
  const result = new Map<string, number>();
  feature.regionIds.forEach((id, index) => {
    const value = values[index];
    if (value !== undefined) result.set(id, value);
  });
  return result;
}

export function formatRegionalValue(
  value: number,
  statistic: StatisticId,
  unit: string | null,
): string {
  const body = statistic === 'count'
    ? Math.round(value).toLocaleString('en-US')
    : new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 }).format(value);
  return unit && statistic !== 'count' ? `${body} ${unit}` : body;
}

export function regionMatchesQuery(region: RegionMetadata, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return region.acronym.toLocaleLowerCase().includes(normalized)
    || region.name.toLocaleLowerCase().includes(normalized);
}

export function selectedHistogramCounts(
  feature: RegionalFeaturePayload,
  selected: ReadonlySet<string>,
): readonly number[] {
  const histogram = feature.histogram;
  if (!histogram) return [];
  const counts = new Array<number>(histogram.globalCounts.length).fill(0);
  if (!histogram.regionalCounts || selected.size === 0) return counts;

  const indexById = new Map(feature.regionIds.map((id, index) => [id, index]));
  for (const regionId of selected) {
    const row = indexById.get(regionId);
    const regionCounts = row === undefined ? undefined : histogram.regionalCounts[row];
    if (!regionCounts) continue;
    regionCounts.forEach((count, bin) => {
      counts[bin] = (counts[bin] ?? 0) + count;
    });
  }
  return counts;
}
