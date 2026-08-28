import type { FeaturePayload } from '../data/contracts.js';
import type { DistributionBinning } from '../data/contracts.js';
import type { StatisticId } from '../domain/types.js';
import type { ScaleSpec } from '../domain/scale-spec.js';
import {
  clampScalePosition,
  scaleDenormalize,
  scaleNormalize,
} from '../domain/scale-spec.js';

export type NumericRange = readonly [number, number];

export type RangeLabelSide = 'left' | 'right';

export interface RangeLabelPlacement {
  min: { left: number; side: RangeLabelSide };
  max: { left: number; side: RangeLabelSide };
  stacked: boolean;
}

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
  histogram?: DistributionBinning,
): NumericRange | null {
  let domain: NumericRange | null = null;
  let exactHistogramDomain = false;
  if (feature.representation === 'regional') {
    if (statistic !== 'count') {
      const edges = histogram?.edges;
      domain = edges ? validRange(edges[0], edges.at(-1)) : null;
      exactHistogramDomain = domain !== null;
    }
    domain ??= finiteExtent(feature.statistics[statistic] ?? feature.statistics.mean);
  } else {
    const edges = histogram?.edges;
    domain = edges ? validRange(edges[0], edges.at(-1)) : null;
    exactHistogramDomain = domain !== null;
    domain ??= validRange(feature.summary.valueRange?.[0], feature.summary.valueRange?.[1]);
  }
  if (!domain) return effectiveRange;
  if (exactHistogramDomain) return domain;
  if (!effectiveRange) return domain;
  return [Math.min(domain[0], effectiveRange[0]), Math.max(domain[1], effectiveRange[1])];
}

export function rangePosition(value: number, domain: NumericRange, scale: ScaleSpec = { kind: 'linear' }): number {
  const normalized = scaleNormalize(value, domain, scale);
  return normalized === null ? 0 : clampScalePosition(normalized);
}

export function rangeValueAtPosition(position: number, domain: NumericRange, scale: ScaleSpec = { kind: 'linear' }): number {
  return scaleDenormalize(clampScalePosition(position), domain, scale) ?? domain[0];
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
  scale: ScaleSpec = { kind: 'linear' },
): number {
  if (scale.kind === 'linear') {
    if (bound === 'min') return Math.max(domain[0], Math.min(value, otherValue - step));
    return Math.min(domain[1], Math.max(value, otherValue + step));
  }
  const separation = 1 / 1_000;
  const position = rangePosition(value, domain, scale);
  const otherPosition = rangePosition(otherValue, domain, scale);
  return rangeValueAtPosition(
    bound === 'min'
      ? Math.max(0, Math.min(position, otherPosition - separation))
      : Math.min(1, Math.max(position, otherPosition + separation)),
    domain,
    scale,
  );
}

export function translateRangeWindow(range: NumericRange, delta: number, domain: NumericRange): NumericRange {
  const width = range[1] - range[0];
  if (width >= domain[1] - domain[0]) return [domain[0], domain[1]];
  const min = Math.max(domain[0], Math.min(range[0] + delta, domain[1] - width));
  return [min, min + width];
}

/** Translate a range in rendered coordinates, preserving additive or multiplicative width. */
export function translateRangeWindowByPosition(
  range: NumericRange,
  delta: number,
  domain: NumericRange,
  scale: ScaleSpec,
): NumericRange {
  const low = rangePosition(range[0], domain, scale);
  const high = rangePosition(range[1], domain, scale);
  const width = high - low;
  if (width >= 1) return [domain[0], domain[1]];
  const nextLow = Math.max(0, Math.min(low + delta, 1 - width));
  return [
    rangeValueAtPosition(nextLow, domain, scale),
    rangeValueAtPosition(nextLow + width, domain, scale),
  ];
}

/** Places bound labels beside their handles while keeping them inside the track. */
export function placeRangeLabels(
  trackWidth: number,
  handlePositions: NumericRange,
  labelWidths: NumericRange,
  handleGap = 7,
  labelGap = 4,
): RangeLabelPlacement {
  const sides: readonly RangeLabelSide[] = ['left', 'right'];
  const rawLeft = (handle: number, width: number, side: RangeLabelSide): number => (
    side === 'left' ? handle - handleGap - width : handle + handleGap
  );
  const overflow = (left: number, width: number): number => (
    Math.max(0, -left) + Math.max(0, left + width - trackWidth)
  );
  const separationShortfall = (minLeft: number, maxLeft: number): number => {
    const minRight = minLeft + labelWidths[0];
    const maxRight = maxLeft + labelWidths[1];
    const separation = minRight <= maxLeft
      ? maxLeft - minRight
      : maxRight <= minLeft ? minLeft - maxRight : -Math.min(minRight, maxRight) + Math.max(minLeft, maxLeft);
    return Math.max(0, labelGap - separation);
  };

  let best: { minSide: RangeLabelSide; maxSide: RangeLabelSide; minLeft: number; maxLeft: number; score: number } | null = null;
  for (const minSide of sides) {
    for (const maxSide of sides) {
      const minLeft = rawLeft(handlePositions[0], labelWidths[0], minSide);
      const maxLeft = rawLeft(handlePositions[1], labelWidths[1], maxSide);
      const preferencePenalty = Number(minSide !== 'left') + Number(maxSide !== 'right');
      const score = (overflow(minLeft, labelWidths[0]) + overflow(maxLeft, labelWidths[1])) * 1_000_000
        + separationShortfall(minLeft, maxLeft) * 1_000
        + preferencePenalty;
      if (!best || score < best.score) best = { minSide, maxSide, minLeft, maxLeft, score };
    }
  }

  const selected = best!;
  const clampLeft = (left: number, width: number): number => Math.max(0, Math.min(trackWidth - width, left));
  const minLeft = clampLeft(selected.minLeft, labelWidths[0]);
  const maxLeft = clampLeft(selected.maxLeft, labelWidths[1]);
  return {
    min: { left: minLeft, side: selected.minSide },
    max: { left: maxLeft, side: selected.maxSide },
    stacked: separationShortfall(minLeft, maxLeft) > 0,
  };
}
