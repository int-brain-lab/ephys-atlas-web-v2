import type { DistributionCounts, RegionalFeaturePayload, RegionMetadata } from './contracts.js';

/** Count, mean and centered second moment (M2 = Σ(x − mean)²) of a population. */
export interface Moments {
  n: number;
  mean: number;
  m2: number;
}

/**
 * Exact moments of the union of region rows.
 *
 * `std` is the release's population SD (ddof=0), so each row contributes
 * M2 = n·SD². Rows are merged with Chan et al.'s pairwise update, which avoids
 * subtracting large raw second moments. The mean needs only counts and means;
 * M2 is NaN when a contributing row with more than one observation lacks a SD.
 */
export function poolRows(
  mean: readonly number[],
  std: readonly number[] | undefined,
  count: readonly number[],
  rows: readonly number[],
): Moments {
  let [n, mu, m2] = [0, NaN, 0];
  for (const row of rows) {
    const [m, c, s] = [mean[row]!, count[row]!, std?.[row]];
    if (!(c > 0) || !Number.isFinite(m)) continue;
    const rowM2 = c === 1 ? 0 : s !== undefined && Number.isFinite(s) ? c * s * s : NaN;
    const total = n + c;
    const delta = n === 0 ? 0 : m - mu;
    mu = n === 0 ? m : mu + (delta * c) / total;
    m2 += rowM2 + (delta * delta * n * c) / total;
    n = total;
  }
  return { n, mean: mu, m2 };
}

/** Population SD (ddof=0), the release convention. */
export const populationSd = ({ n, m2 }: Moments): number => (n > 0 ? Math.sqrt(m2 / n) : NaN);

/** Sample SD (ddof=1), for standard errors and effect sizes. */
export const sampleSd = ({ n, m2 }: Moments): number => (n > 1 ? Math.sqrt(m2 / (n - 1)) : NaN);

function sumCounts(counts: readonly DistributionCounts[], rows: readonly number[]): DistributionCounts {
  const binCounts = new Array<number>(counts[0]?.binCounts.length ?? 0).fill(0);
  let [underflowCount, overflowCount] = [0, 0];
  for (const row of rows) {
    counts[row]!.binCounts.forEach((value, bin) => { binCounts[bin]! += value; });
    underflowCount += counts[row]!.underflowCount;
    overflowCount += counts[row]!.overflowCount;
  }
  return { binCounts, underflowCount, overflowCount };
}

/** Approximate quantile from a histogram, interpolating linearly within the bin. */
export function histogramQuantile(edges: readonly number[], counts: DistributionCounts, q: number): number {
  const total = counts.underflowCount + counts.overflowCount + counts.binCounts.reduce((a, b) => a + b, 0);
  if (total === 0) return NaN;
  let remaining = q * total - counts.underflowCount;
  if (remaining <= 0) return edges[0]!;
  for (let bin = 0; bin < counts.binCounts.length; bin += 1) {
    const c = counts.binCounts[bin]!;
    if (remaining <= c) return edges[bin]! + (c > 0 ? remaining / c : 0) * (edges[bin + 1]! - edges[bin]!);
    remaining -= c;
  }
  return edges[edges.length - 1]!;
}

const QUANTILES: Record<string, number> = { median: 0.5, q05: 0.05, q25: 0.25, q75: 0.75, q95: 0.95 };

/** Selection-id suffix for a parent's own channels, excluding its descendants. */
export const OWN_SUFFIX = ':own';

/** Region ids whose statistics were aggregated on the fly, per expanded payload. */
export const aggregatedIds = new WeakMap<RegionalFeaturePayload, ReadonlySet<string>>();

const childrenCache = new WeakMap<readonly RegionMetadata[], Map<string, string[]>>();

/** Region ids plus all their hierarchy descendants. */
export function withDescendants(regions: readonly RegionMetadata[], ids: readonly string[]): string[] {
  let children = childrenCache.get(regions);
  if (!children) {
    children = new Map();
    for (const { id, parentId } of regions) {
      if (parentId != null) children.set(parentId, [...children.get(parentId) ?? [], id]);
    }
    childrenCache.set(regions, children);
  }
  const visit = (id: string): string[] => (id.endsWith(OWN_SUFFIX)
    ? [id.slice(0, -OWN_SUFFIX.length)] : [id, ...(children.get(id) ?? []).flatMap(visit)]);
  return [...new Set(ids.flatMap(visit))];
}

/**
 * Prototype: aggregate every hierarchy region over itself and all descendants with
 * data. Parents without a release row are appended; release rows that also have
 * descendants (channels labelled at a coarse level, e.g. CB) are replaced by the
 * union. count, missing_count, min, max, mean, std and regional histograms are
 * exact; median and quantiles are approximated from the summed histogram.
 */
export function expandRegionalPayload(
  payload: RegionalFeaturePayload,
  regions: readonly RegionMetadata[],
): RegionalFeaturePayload {
  const index = new Map(payload.regionIds.map((id, row) => [id, row]));
  const targets = regions.map(({ id }) => ({ id, rows: withDescendants(regions, [id]).flatMap((m) => index.get(m) ?? []) }))
    .filter(({ id, rows }) => rows.length > (index.has(id) ? 1 : 0));
  if (targets.length === 0) return payload;
  const added = targets.filter(({ id }) => !index.has(id));
  // Keep each replaced release row available as `<id>:own` (the parent's own channels).
  const own = targets.filter(({ id }) => index.has(id)).map(({ id }) => index.get(id)!);
  const binnings = payload.distribution?.binnings ?? [];
  const reference = binnings.find((b) => b.regional && b.scale.kind === 'linear' && b.domain.kind === 'full')
    ?? binnings.find((b) => b.regional);
  const histograms = targets.map(({ rows }) => reference && sumCounts(reference.regional!, rows));
  const { mean, std, count } = payload.statistics;
  const pooled = targets.map(({ rows }) => (mean && count ? poolRows(mean, std, count, rows) : null));
  const extreme = (pick: (...values: number[]) => number, values: readonly number[], rows: readonly number[]) => {
    const finite = rows.map((r) => values[r]!).filter(Number.isFinite);
    return finite.length ? pick(...finite) : NaN;
  };

  // Replace rows that exist, append the rest (in target order).
  const merge = <T>(values: readonly T[], aggregated: readonly T[]): T[] => {
    const result = [...values];
    targets.forEach(({ id }, k) => { if (index.has(id)) result[index.get(id)!] = aggregated[k]!; });
    return [...result, ...targets.flatMap(({ id }, k) => (index.has(id) ? [] : [aggregated[k]!])),
      ...own.map((row) => values[row]!)];
  };
  const statistics: RegionalFeaturePayload['statistics'] = {};
  for (const [key, values] of Object.entries(payload.statistics) as [keyof typeof statistics, readonly number[]][]) {
    const aggregated = targets.map(({ rows }, k) => {
      if (key === 'count' || key === 'missing_count') return rows.reduce((sum, r) => sum + (values[r] ?? 0), 0);
      if (key === 'min') return extreme(Math.min, values, rows);
      if (key === 'max') return extreme(Math.max, values, rows);
      if (key === 'mean') return pooled[k]?.mean ?? NaN;
      if (key === 'std') return pooled[k] ? populationSd(pooled[k]) : NaN;
      const hist = histograms[k];
      return hist && key in QUANTILES ? histogramQuantile(reference!.edges, hist, QUANTILES[key]!) : NaN;
    });
    statistics[key] = merge(values, aggregated);
  }
  const expanded: RegionalFeaturePayload = {
    ...payload,
    regionIds: [...payload.regionIds, ...added.map(({ id }) => id), ...own.map((row) => `${payload.regionIds[row]}${OWN_SUFFIX}`)],
    statistics,
    ...(payload.distribution ? { distribution: { binnings: binnings.map((binning) => (binning.regional
      ? { ...binning, regional: merge(binning.regional, targets.map(({ rows }) => sumCounts(binning.regional!, rows))) }
      : binning)) } } : {}),
  };
  aggregatedIds.set(expanded, new Set(targets.map(({ id }) => id)));
  return expanded;
}

/** How a selected row's statistics were obtained, for labels and exports. */
export function regionAggregation(
  payload: RegionalFeaturePayload,
  id: string,
): 'release' | 'own_channels' | 'descendants_union' {
  if (id.endsWith(OWN_SUFFIX)) return 'own_channels';
  return aggregatedIds.get(payload)?.has(id) ? 'descendants_union' : 'release';
}
