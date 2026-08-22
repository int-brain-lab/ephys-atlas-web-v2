import type {
  FeatureDescriptor,
  FeaturePayload,
  RegionMetadata,
  RegionalFeaturePayload,
} from '../../data/contracts.js';
import type { ColoringState, RegionOrder, StatisticId } from '../../domain/types.js';
import type { RegionInspection } from '../../rendering/projection-viewport.js';

const SELECTION_COLORS = ['#55a7f7', '#ef6f61', '#73c991', '#c38cf5', '#f2b84b', '#4dc6c6', '#f08cc2', '#a5b95c'] as const;

export function selectionColor(index: number): string {
  return SELECTION_COLORS[index % SELECTION_COLORS.length] ?? SELECTION_COLORS[0];
}

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

export function rankRegionsByValue(
  regions: readonly RegionMetadata[],
  values: ReadonlyMap<string, number>,
  order: Exclude<RegionOrder, 'anatomy'>,
): readonly RegionMetadata[] {
  const anatomyIndex = new Map(regions.map((region, index) => [region.id, index]));
  return regions
    .filter((region) => region.mappingMember !== false)
    .map((region) => ({ region, value: values.get(region.id) }))
    .sort((left, right) => {
      const leftFinite = left.value !== undefined && Number.isFinite(left.value);
      const rightFinite = right.value !== undefined && Number.isFinite(right.value);
      if (leftFinite !== rightFinite) return leftFinite ? -1 : 1;
      if (leftFinite && rightFinite && left.value !== right.value) {
        return order === 'value-asc' ? left.value! - right.value! : right.value! - left.value!;
      }
      return (anatomyIndex.get(left.region.id) ?? 0) - (anatomyIndex.get(right.region.id) ?? 0);
    })
    .map(({ region }) => region);
}

export interface RegionTooltipModel {
  acronym: string;
  name: string;
  valueLabel?: string;
  valueText?: string;
  meta: string;
}

export function buildRegionTooltipModel(
  inspection: RegionInspection,
  regions: readonly RegionMetadata[],
  feature: FeaturePayload | null,
  descriptor: FeatureDescriptor | undefined,
  coloring: ColoringState,
): RegionTooltipModel | null {
  const region = regions.find(({ id }) => id === inspection.regionId);
  if (!region) return null;

  const meta = [inspection.physicalRegionId < 0 ? 'Left hemisphere' : 'Right hemisphere'];
  if (inspection.physicalRegionId > 0 && coloring.mode === 'feature') meta.push('anatomy reference');
  let valueLabel: string | undefined;
  let valueText: string | undefined;

  if (feature?.representation === 'regional' && feature.parcellation === inspection.parcellation) {
    const row = feature.regionIds.indexOf(inspection.regionId);
    const values = regionalStatisticValues(feature, coloring.statistic);
    const value = row < 0 ? undefined : values?.[row];
    valueLabel = coloring.statistic.length
      ? `${coloring.statistic[0]?.toUpperCase() ?? ''}${coloring.statistic.slice(1)}`
      : coloring.statistic;
    valueText = value !== undefined && Number.isFinite(value)
      ? formatRegionalValue(value, coloring.statistic, descriptor?.unit ?? null)
      : 'Value unavailable';
    const count = row < 0 ? undefined : feature.statistics.count?.[row];
    if (count !== undefined && Number.isFinite(count)) {
      meta.push(`n=${Math.round(count).toLocaleString('en-US')}`);
    }
  }

  return {
    acronym: region.acronym,
    name: region.name.replace(/\s+\(left\)$/i, ''),
    ...(valueLabel ? { valueLabel } : {}),
    ...(valueText ? { valueText } : {}),
    meta: meta.join(' · '),
  };
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

export interface HistogramDistribution {
  counts: readonly number[];
  probabilities: readonly number[];
  total: number;
}

export interface RegionalHistogramDistribution extends HistogramDistribution {
  regionId: string;
}

export function histogramDistribution(counts: readonly number[]): HistogramDistribution {
  const total = counts.reduce((sum, count) => (
    Number.isFinite(count) && count > 0 ? sum + count : sum
  ), 0);
  return {
    counts,
    probabilities: counts.map((count) => (
      total > 0 && Number.isFinite(count) && count > 0 ? count / total : 0
    )),
    total,
  };
}

export function selectedRegionHistogramDistributions(
  feature: RegionalFeaturePayload,
  selected: ReadonlySet<string>,
): readonly RegionalHistogramDistribution[] {
  const histogram = feature.histogram;
  if (!histogram?.regionalCounts) return [];
  const indexById = new Map(feature.regionIds.map((id, index) => [id, index]));
  const result: RegionalHistogramDistribution[] = [];
  for (const regionId of selected) {
    const row = indexById.get(regionId);
    const counts = row === undefined ? undefined : histogram.regionalCounts[row];
    if (!counts) continue;
    result.push({ regionId, ...histogramDistribution(counts) });
  }
  return result;
}
