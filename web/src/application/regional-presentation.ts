import type { FeaturePayload, RegionMetadata } from '../data/contracts.js';
import type { EffectiveColoringState, ParcellationId } from '../domain/types.js';
import { bilateralAtlasRegionColorMap, regionalColorMap } from './scalar-colormap.js';

export interface RegionalPresentation {
  readonly mapping: ParcellationId;
  readonly anatomyColors: ReadonlyMap<number, string>;
  readonly featureColors: ReadonlyMap<number, string> | null;
  readonly visibleRegionIds: ReadonlySet<number>;
  readonly selectedRegionIds: ReadonlySet<number>;
  readonly highlightedRegionId: number | null;
  readonly featureSide: 'left' | null;
}

export interface RegionalPresentationInput {
  readonly mapping: ParcellationId;
  readonly feature: FeaturePayload | null;
  readonly anatomyRegions: readonly RegionMetadata[];
  readonly coloring: EffectiveColoringState;
  readonly selectedRegionIds: readonly string[];
  readonly hoveredRegionId: string | null;
}

function foldedId(value: string | number): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id !== 0 ? -Math.abs(id) : null;
}

/** Expand a logical folded region identity onto both physical hemispheres. */
export function regionalPresentationIds(ids: Iterable<string | number>): ReadonlySet<number> {
  const result = new Set<number>();
  for (const value of ids) {
    const id = foldedId(value);
    if (id === null) continue;
    result.add(id);
    result.add(Math.abs(id));
  }
  return result;
}

/** Resolve data and view state once into renderer-neutral regional semantics. */
export function resolveRegionalPresentation(input: RegionalPresentationInput): RegionalPresentation {
  const anatomyColors = bilateralAtlasRegionColorMap(input.anatomyRegions);
  const visibleRegionIds = regionalPresentationIds(input.anatomyRegions.map((region) => region.atlasId));
  const selectedRegionIds = regionalPresentationIds(input.selectedRegionIds);
  const highlightedRegionId = input.hoveredRegionId === null ? null : foldedId(input.hoveredRegionId);
  const hasCompatibleRegionalFeature = input.feature?.representation === 'regional'
    && input.feature.parcellation === input.mapping;
  const usesFeatureSide = input.coloring.mode === 'feature'
    && (input.feature?.representation === 'volume' || hasCompatibleRegionalFeature);
  let featureColors: ReadonlyMap<number, string> | null = null;
  if (input.coloring.mode === 'feature' && hasCompatibleRegionalFeature) {
    featureColors = new Map([...regionalColorMap(input.feature, input.coloring)]
      .filter(([id]) => id !== 0)
      .map(([id, color]) => [-Math.abs(id), color]));
  }
  return {
    mapping: input.mapping,
    anatomyColors,
    featureColors,
    visibleRegionIds,
    selectedRegionIds,
    highlightedRegionId,
    featureSide: usesFeatureSide ? 'left' : null,
  };
}

/**
 * Keep a coherent mapping/color pair while a newly selected parcellation is
 * loading. Interaction state is cleared until that new mapping is ready.
 */
export function retainRegionalPresentationWhileMappingLoads(
  previous: RegionalPresentation | null,
  next: RegionalPresentation,
  feature: FeaturePayload | null,
): RegionalPresentation {
  if (
    previous === null
    || feature?.representation !== 'regional'
    || feature.parcellation !== previous.mapping
    || feature.parcellation === next.mapping
  ) return next;

  return {
    ...previous,
    selectedRegionIds: new Set(),
    highlightedRegionId: null,
  };
}

/** Apply shared semantics to a layer that may or may not show feature data. */
export function regionalPresentationColors(
  presentation: RegionalPresentation,
  supportsFeature: boolean,
): ReadonlyMap<number, string> {
  const colors = new Map(presentation.anatomyColors);
  if (!supportsFeature) return colors;
  if (presentation.featureSide === 'left') {
    for (const id of colors.keys()) if (id < 0) colors.delete(id);
  }
  for (const [id, color] of presentation.featureColors ?? []) colors.set(id, color);
  return colors;
}

function mapEqual(left: ReadonlyMap<number, string> | null, right: ReadonlyMap<number, string> | null): boolean {
  if (left === right) return true;
  if (left === null || right === null || left.size !== right.size) return false;
  for (const [key, value] of left) if (right.get(key) !== value) return false;
  return true;
}

function setEqual(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
  return left === right || (left.size === right.size && [...left].every((value) => right.has(value)));
}

export function regionalPresentationsEqual(left: RegionalPresentation, right: RegionalPresentation): boolean {
  return left === right || (
    left.mapping === right.mapping
    && left.highlightedRegionId === right.highlightedRegionId
    && left.featureSide === right.featureSide
    && mapEqual(left.anatomyColors, right.anatomyColors)
    && mapEqual(left.featureColors, right.featureColors)
    && setEqual(left.visibleRegionIds, right.visibleRegionIds)
    && setEqual(left.selectedRegionIds, right.selectedRegionIds)
  );
}
