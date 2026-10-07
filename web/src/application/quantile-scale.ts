import type { DistributionBinning, FeaturePayload } from '../data/contracts.js';
import type { QuantileScaleSpec } from '../domain/scale-spec.js';
import type { ColorStatisticId } from '../domain/types.js';

/**
 * D082 quantile color mappings, derived in the browser.
 *
 * Regional features use the exact empirical CDF of the colored per-region
 * statistic. Volumes only ship binned summaries, so their CDF is the union of
 * exact cumulative fractions at the edges of every full-domain binning.
 * Only color normalization uses these maps; distributions stay unchanged.
 */

/** Clamped piecewise-linear interpolation over non-decreasing `from` knots. */
function interpolate(value: number, from: readonly number[], to: readonly number[]): number {
  const last = from.length - 1;
  if (value <= from[0]!) return to[0]!;
  if (value >= from[last]!) return to[last]!;
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (from[middle]! <= value) low = middle; else high = middle;
  }
  const span = from[high]! - from[low]!;
  return span > 0 ? to[low]! + (value - from[low]!) / span * (to[high]! - to[low]!) : to[low]!;
}

/** Normalize `value` within `range` along the quantile map; null for an empty span. */
export function quantileNormalize(value: number, range: readonly [number, number], spec: QuantileScaleSpec): number | null {
  if (!Number.isFinite(value)) return null;
  const lower = interpolate(range[0], spec.xs, spec.ys);
  const upper = interpolate(range[1], spec.xs, spec.ys);
  return upper > lower ? (interpolate(value, spec.xs, spec.ys) - lower) / (upper - lower) : null;
}

/** Acklam's rational approximation of the standard normal inverse CDF. */
export function probit(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const tail = (q: number): number => (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!)
    / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q
    / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** Mid-rank CDF knots of finite values; ties collapse onto one knot. */
export function valueCdfKnots(values: ArrayLike<number>): { xs: number[]; ps: number[] } {
  const sorted = Array.from(values).filter(Number.isFinite).sort((left, right) => left - right);
  const xs: number[] = [];
  const ps: number[] = [];
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (end < sorted.length && sorted[end] === sorted[start]) end += 1;
    xs.push(sorted[start]!);
    ps.push(((start + end - 1) / 2 + 0.5) / sorted.length);
    start = end;
  }
  return { xs, ps };
}

/** Exact cumulative fractions at the edges of full-domain binnings. */
export function binningCdfKnots(binnings: readonly DistributionBinning[]): { xs: number[]; ps: number[] } {
  const points: [number, number][] = [];
  for (const { edges, global } of binnings.filter(({ domain }) => domain.kind === 'full')) {
    const total = global.underflowCount + global.overflowCount + global.binCounts.reduce((sum, count) => sum + count, 0);
    if (total <= 0) continue;
    let cumulative = global.underflowCount;
    edges.forEach((edge, index) => {
      points.push([edge, cumulative / total]);
      cumulative += global.binCounts[index] ?? 0;
    });
  }
  points.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const unique = points.filter(([x], index) => index === 0 || x !== points[index - 1]![0]);
  const eps = 1e-6;
  return { xs: unique.map(([x]) => x), ps: unique.map(([, p]) => Math.min(1 - eps, Math.max(eps, p))) };
}

const cache = new WeakMap<object, Map<string, readonly QuantileScaleSpec[]>>();

/** Both quantile specs for a feature/statistic, memoized so render keys stay stable. */
export function quantileScaleSpecs(
  feature: FeaturePayload,
  statistic: ColorStatisticId,
  binnings: readonly DistributionBinning[],
): readonly QuantileScaleSpec[] {
  const byStatistic = cache.get(feature) ?? new Map<string, readonly QuantileScaleSpec[]>();
  cache.set(feature, byStatistic);
  const key = feature.representation === 'regional' ? statistic : 'volume';
  const cached = byStatistic.get(key);
  if (cached) return cached;
  const values = feature.representation === 'regional'
    ? feature.statistics[statistic] ?? feature.statistics.mean
    : undefined;
  // Edge-based knots always differ, so constant volumes are detected from the valid-value extrema.
  const { min, max } = feature.representation === 'regional' ? { min: 0, max: 1 } : feature.summary.validStatistics;
  const { xs, ps } = values ? valueCdfKnots(values)
    : min !== null && max !== null && max > min ? binningCdfKnots(binnings) : { xs: [], ps: [] };
  // Extend regional knots to the observation histogram extent, halfway into the
  // unobserved tail mass, so observations beyond the region extrema keep an axis.
  const edges = binnings.filter(({ domain }) => domain.kind === 'full').flatMap(({ edges }) => [edges[0]!, edges.at(-1)!]);
  if (values && xs.length >= 2 && edges.length > 0) {
    if (Math.min(...edges) < xs[0]!) { xs.unshift(Math.min(...edges)); ps.unshift(ps[0]! / 2); }
    if (Math.max(...edges) > xs.at(-1)!) { xs.push(Math.max(...edges)); ps.push((1 + ps.at(-1)!) / 2); }
  }
  const specs: readonly QuantileScaleSpec[] = xs.length < 2 ? [] : [
    { kind: 'quantile-uniform', xs, ys: ps },
    { kind: 'quantile-gaussian', xs, ys: ps.map(probit) },
  ];
  byStatistic.set(key, specs);
  return specs;
}
