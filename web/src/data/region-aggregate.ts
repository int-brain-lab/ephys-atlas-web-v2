import type { DistributionCounts, RegionalFeaturePayload, RegionMetadata } from './contracts.js';

/** Exact pooled count/mean/SD of region rows (sums of n, n·mean, (n-1)·sd² + n·mean²). */
export function poolRows(mean: readonly number[], std: readonly number[], count: readonly number[], rows: readonly number[]) {
  let [n, sx, sxx] = [0, 0, 0];
  for (const row of rows) {
    const [m, s, c] = [mean[row]!, std[row]!, count[row]!];
    if (!(c > 0) || !Number.isFinite(m)) continue;
    n += c;
    sx += c * m;
    sxx += (c - 1) * (c > 1 && Number.isFinite(s) ? s * s : 0) + c * m * m;
  }
  const m = n > 0 ? sx / n : NaN;
  return { n, m, s: n > 1 ? Math.sqrt(Math.max(0, (sxx - n * m * m) / (n - 1))) : NaN };
}

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

/**
 * Prototype: append on-the-fly rows for hierarchy regions that have no release row,
 * aggregated from all their descendants that do. count, missing_count, min, max,
 * mean, std and regional histograms are exact; median and quantiles are approximated
 * from the summed histogram. Release rows are never modified.
 */
export function expandRegionalPayload(
  payload: RegionalFeaturePayload,
  regions: readonly RegionMetadata[],
): RegionalFeaturePayload {
  const index = new Map(payload.regionIds.map((id, row) => [id, row]));
  const children = new Map<string, string[]>();
  for (const { id, parentId } of regions) {
    if (parentId != null) children.set(parentId, [...children.get(parentId) ?? [], id]);
  }
  const rowsOf = (id: string): number[] => [
    ...(index.has(id) ? [index.get(id)!] : []), ...(children.get(id) ?? []).flatMap(rowsOf)];
  const added = regions.filter(({ id }) => !index.has(id))
    .map(({ id }) => ({ id, rows: rowsOf(id) })).filter(({ rows }) => rows.length > 0);
  if (added.length === 0) return payload;

  const binnings = payload.distribution?.binnings ?? [];
  const reference = binnings.find((b) => b.regional && b.scale.kind === 'linear' && b.domain.kind === 'full')
    ?? binnings.find((b) => b.regional);
  const histograms = added.map(({ rows }) => reference && sumCounts(reference.regional!, rows));
  const { mean, std, count } = payload.statistics;
  const pooled = added.map(({ rows }) => (mean && std && count ? poolRows(mean, std, count, rows) : null));
  const finite = (values: readonly number[], rows: readonly number[]) => rows.map((r) => values[r]!).filter(Number.isFinite);

  const statistics: RegionalFeaturePayload['statistics'] = {};
  for (const [key, values] of Object.entries(payload.statistics) as [keyof typeof statistics, readonly number[]][]) {
    statistics[key] = [...values, ...added.map(({ rows }, k) => {
      if (key === 'count' || key === 'missing_count') return rows.reduce((sum, r) => sum + (values[r] ?? 0), 0);
      if (key === 'min') return Math.min(...finite(values, rows));
      if (key === 'max') return Math.max(...finite(values, rows));
      if (key === 'mean') return pooled[k]?.m ?? NaN;
      if (key === 'std') return pooled[k]?.s ?? NaN;
      const hist = histograms[k];
      return hist && key in QUANTILES ? histogramQuantile(reference!.edges, hist, QUANTILES[key]!) : NaN;
    })];
  }
  return {
    ...payload,
    regionIds: [...payload.regionIds, ...added.map(({ id }) => id)],
    statistics,
    ...(payload.distribution ? { distribution: { binnings: binnings.map((binning) => (binning.regional
      ? { ...binning, regional: [...binning.regional, ...added.map(({ rows }) => sumCounts(binning.regional!, rows))] }
      : binning)) } } : {}),
  };
}
