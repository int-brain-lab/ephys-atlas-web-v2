import type { FeaturePayload, RegionalHistogram } from '../data/contracts.js';
import type { ColoringState, ColorScale, ColorScaleSelection } from '../domain/types.js';
import { resolveColorScale } from '../domain/color-scale.js';
import { regionalColorRange } from './scalar-colormap.js';

export interface ResolvedPresentationScale {
  readonly selection: ColorScaleSelection;
  readonly automaticScale: ColorScale;
  readonly effectiveScale: ColorScale;
  readonly histogram: RegionalHistogram | undefined;
  readonly logAvailable: boolean;
  readonly logUnavailableReason: string | null;
}

function positiveRange(range: readonly [number, number] | null): boolean {
  return range !== null && Number.isFinite(range[0]) && Number.isFinite(range[1])
    && range[0] > 0 && range[1] > range[0];
}

/** Resolve one presentation scale for coloring, distributions, and range geometry. */
export function resolvePresentationScale(
  feature: FeaturePayload | null,
  coloring: ColoringState,
  featureDefault: ColorScale | undefined,
): ResolvedPresentationScale {
  const requestedAutomaticScale = featureDefault ?? 'linear';
  let histogram: RegionalHistogram | undefined;
  let logHistogram: RegionalHistogram | undefined;
  let positiveDomain = false;
  let missingHistogram = false;

  if (feature?.representation === 'regional') {
    histogram = feature.histogram;
    logHistogram = feature.histogramVariants?.log;
    positiveDomain = positiveRange(regionalColorRange(feature, coloring));
    missingHistogram = logHistogram === undefined;
  } else if (feature?.representation === 'volume') {
    const range = feature.descriptor.valueRange;
    positiveDomain = range?.[0] !== null && range?.[1] !== null
      ? positiveRange(range as readonly [number, number])
      : false;
  }

  const logAvailable = feature !== null && positiveDomain && !missingHistogram;
  const automaticScale = requestedAutomaticScale === 'log' && logAvailable ? 'log' : 'linear';
  const requestedScale = resolveColorScale(coloring.scale, automaticScale);
  const effectiveScale = requestedScale === 'log' && logAvailable ? 'log' : 'linear';
  const logUnavailableReason = logAvailable
    ? null
    : missingHistogram
      ? 'Logarithmic scale is unavailable because this release has no exact strictly-positive log histogram.'
      : 'Logarithmic scale requires a strictly positive value range.';

  return {
    selection: coloring.scale,
    automaticScale,
    effectiveScale,
    histogram: effectiveScale === 'log' ? logHistogram : histogram,
    logAvailable,
    logUnavailableReason,
  };
}
