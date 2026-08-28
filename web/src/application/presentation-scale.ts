import type {
  DistributionBinning,
  FeaturePayload,
  RepresentationDisplay,
} from '../data/contracts.js';
import type {
  ColoringState,
  ColorScale,
  ColorScaleSelection,
  DistributionDomain,
  DistributionDomainSelection,
} from '../domain/types.js';
import type { ScaleSpec } from '../domain/scale-spec.js';
import { scaleDomainIsValid } from '../domain/scale-spec.js';
import { effectiveScalarColorRange } from './scalar-colormap.js';

export interface ResolvedPresentationScale {
  readonly selection: ColorScaleSelection;
  readonly automaticScale: ColorScale;
  readonly effectiveScale: ColorScale;
  readonly effectiveScaleSpec: ScaleSpec;
  /** Exact analytical binning selected by both value scale and domain. */
  readonly histogram: DistributionBinning | undefined;
  readonly availableScales: readonly ColorScale[];
  readonly unavailableScaleReasons: Readonly<Partial<Record<ColorScale, string>>>;
  readonly distributionSelection: DistributionDomainSelection;
  readonly automaticDistributionDomain: DistributionDomain;
  readonly effectiveDistributionDomain: DistributionDomain;
  readonly availableDistributionDomains: readonly DistributionDomain[];
  readonly unavailableDistributionReasons: Readonly<Partial<Record<DistributionDomain, string>>>;
}

function distributionFor(feature: FeaturePayload | null): readonly DistributionBinning[] {
  if (!feature) return [];
  return feature.representation === 'regional'
    ? feature.distribution?.binnings ?? []
    : feature.summary.distribution?.binnings ?? [];
}

function matchingBinning(
  binnings: readonly DistributionBinning[],
  scale: ColorScale,
  domain: DistributionDomain,
): DistributionBinning | undefined {
  return binnings.find((binning) => binning.scale.kind === scale && binning.domain.kind === domain);
}

function declaredScales(display: RepresentationDisplay | undefined): readonly ScaleSpec[] {
  return display?.scales ?? [{ kind: 'linear' }];
}

function declaredDomains(display: RepresentationDisplay | undefined): readonly DistributionDomain[] {
  return display?.distributionDomains.map(({ kind }) => kind) ?? ['full'];
}

/** Resolve release-owned scale/domain choices without estimating scientific parameters. */
export function resolvePresentationScale(
  feature: FeaturePayload | null,
  coloring: ColoringState,
  display: RepresentationDisplay | undefined,
  distributionSelection: DistributionDomainSelection = 'auto',
): ResolvedPresentationScale {
  const binnings = distributionFor(feature);
  const declared = declaredScales(display);
  const declaredScaleKinds = declared.map(({ kind }) => kind);
  const domains = declaredDomains(display);
  const range = feature ? effectiveScalarColorRange(feature, coloring, display) : null;

  const availableScales = declared.filter((spec) => (
    range !== null
    && scaleDomainIsValid(range, spec)
    && domains.every((domain) => matchingBinning(binnings, spec.kind, domain) !== undefined)
  )).map(({ kind }) => kind);
  const unavailableScaleReasons: Partial<Record<ColorScale, string>> = {};
  for (const scale of ['linear', 'log', 'symlog'] as const) {
    if (availableScales.includes(scale)) continue;
    const spec = declared.find(({ kind }) => kind === scale);
    unavailableScaleReasons[scale] = !spec
      ? `${scale === 'symlog' ? 'Signed-log' : scale === 'log' ? 'Logarithmic' : 'Linear'} scale is not declared by this release.`
      : range === null || !scaleDomainIsValid(range, spec)
        ? scale === 'log'
          ? 'Logarithmic scale requires a strictly positive color range.'
          : 'This scale is unavailable for the current color range.'
        : 'This release has no exact histogram for every declared distribution domain.';
  }

  const preferredScale = display?.preferredScale ?? 'linear';
  const automaticScale = availableScales.includes(preferredScale) ? preferredScale : 'linear';
  const requestedScale = coloring.scale === 'auto' ? automaticScale : coloring.scale;
  const unsupportedExplicitScale = coloring.scale !== 'auto' && !availableScales.includes(coloring.scale);
  let effectiveScale = availableScales.includes(requestedScale) ? requestedScale : 'linear';

  const availableDistributionDomains = domains.filter((domain) => (
    matchingBinning(binnings, effectiveScale, domain) !== undefined
  ));
  const unavailableDistributionReasons: Partial<Record<DistributionDomain, string>> = {};
  for (const domain of ['full', 'focused'] as const) {
    if (availableDistributionDomains.includes(domain)) continue;
    unavailableDistributionReasons[domain] = !domains.includes(domain)
      ? `${domain === 'focused' ? 'Focused' : 'Full'} distribution is not declared by this release.`
      : 'This release has no exact histogram for this scale and distribution domain.';
  }
  const preferredDomain = display?.preferredDistributionDomain ?? 'full';
  const automaticDistributionDomain = availableDistributionDomains.includes(preferredDomain) ? preferredDomain : 'full';
  const requestedDomain = distributionSelection === 'auto' ? automaticDistributionDomain : distributionSelection;
  const unsupportedExplicitDomain = distributionSelection !== 'auto'
    && !availableDistributionDomains.includes(distributionSelection);
  let effectiveDistributionDomain = availableDistributionDomains.includes(requestedDomain) ? requestedDomain : 'full';
  if (unsupportedExplicitScale || unsupportedExplicitDomain) {
    effectiveScale = 'linear';
    effectiveDistributionDomain = 'full';
  }
  const effectiveScaleSpec = declared.find(({ kind }) => kind === effectiveScale) ?? { kind: 'linear' };

  return {
    selection: coloring.scale,
    automaticScale,
    effectiveScale,
    effectiveScaleSpec,
    histogram: matchingBinning(binnings, effectiveScale, effectiveDistributionDomain),
    availableScales,
    unavailableScaleReasons,
    distributionSelection,
    automaticDistributionDomain,
    effectiveDistributionDomain,
    availableDistributionDomains,
    unavailableDistributionReasons,
  };
}
