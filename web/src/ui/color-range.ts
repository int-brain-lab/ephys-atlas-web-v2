import type { FeaturePayload } from '../data/contracts.js';
import type { StatisticId } from '../domain/types.js';

export type NumericRange = readonly [number, number];

function validRange(min: number | null | undefined, max: number | null | undefined): NumericRange | null {
  return min !== null && min !== undefined && max !== null && max !== undefined
    && Number.isFinite(min) && Number.isFinite(max) && max > min
    ? [min, max]
    : null;
}

function finiteExtent(values: readonly number[] | undefined): NumericRange | null {
  if (!values) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return max > min ? [min, max] : [min, min + Math.max(1, Math.abs(min) * .01)];
}

/**
 * Returns the stable data domain behind the range handles. Regional observation
 * statistics share the release histogram domain; count uses its own regional
 * values because an observation-value histogram has different semantics.
 */
export function colorRangeDomain(
  feature: FeaturePayload,
  statistic: StatisticId,
  effectiveRange: NumericRange | null,
): NumericRange | null {
  let domain: NumericRange | null = null;
  if (feature.representation === 'regional') {
    if (statistic !== 'count') {
      const edges = feature.histogram?.edges;
      domain = edges ? validRange(edges[0], edges.at(-1)) : null;
    }
    domain ??= finiteExtent(feature.statistics[statistic] ?? feature.statistics.mean);
  } else {
    domain = validRange(feature.descriptor.valueRange?.[0], feature.descriptor.valueRange?.[1]);
  }
  if (!domain) return effectiveRange;
  if (!effectiveRange) return domain;
  return [Math.min(domain[0], effectiveRange[0]), Math.max(domain[1], effectiveRange[1])];
}

export function rangePosition(value: number, domain: NumericRange): number {
  const span = domain[1] - domain[0];
  if (!(span > 0)) return 0;
  return Math.max(0, Math.min(1, (value - domain[0]) / span));
}

export function rangeSliderStep(domain: NumericRange): number {
  return Math.max(Number.EPSILON, (domain[1] - domain[0]) / 1_000);
}

export function clampRangeHandle(
  bound: 'min' | 'max',
  value: number,
  otherValue: number,
  domain: NumericRange,
  step = rangeSliderStep(domain),
): number {
  if (bound === 'min') return Math.max(domain[0], Math.min(value, otherValue - step));
  return Math.min(domain[1], Math.max(value, otherValue + step));
}

export function translateRangeWindow(range: NumericRange, delta: number, domain: NumericRange): NumericRange {
  const width = range[1] - range[0];
  if (width >= domain[1] - domain[0]) return [domain[0], domain[1]];
  const min = Math.max(domain[0], Math.min(range[0] + delta, domain[1] - width));
  return [min, min + width];
}
