import type { SliceAxis } from '../core/spatial.js';
import type { ExactDatasetRef, ParcellationId } from './types.js';

export type ComparisonMode = 'focus' | 'gallery' | 'profile';

export type ComparisonFeatureScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'group'; readonly groupId: string }
  | { readonly kind: 'explicit'; readonly featureIds: readonly string[] };

export type ComparisonTarget =
  | { readonly kind: 'regional'; readonly parcellation: ParcellationId }
  | { readonly kind: 'volume'; readonly referenceSpaceId: string };

export type ComparisonFeatureRepresentation =
  | {
    readonly kind: 'regional';
    readonly parcellation: ParcellationId;
    readonly normalizationIds: readonly string[];
  }
  | {
    readonly kind: 'volume';
    readonly referenceSpaceId: string;
    /** Informational only: grid identity does not establish compatibility. */
    readonly gridId: string;
    readonly normalizationIds: readonly string[];
  };

export interface ComparisonReleaseFeature {
  readonly id: string;
  readonly groupIds: readonly string[];
  readonly representations: readonly ComparisonFeatureRepresentation[];
}

export interface ComparisonRelease {
  readonly dataset: ExactDatasetRef;
  /** Immutable release order is the canonical comparison order. */
  readonly features: readonly ComparisonReleaseFeature[];
}

export interface ComparisonState {
  readonly dataset: ExactDatasetRef;
  readonly scope: ComparisonFeatureScope;
  readonly mode: ComparisonMode;
  readonly orientation: SliceAxis;
  readonly target: ComparisonTarget;
  readonly normalizationId: string;
  readonly activeFeatureId: string | null;
  readonly pinnedFeatureIds: readonly string[];
}

export type ComparisonResolutionStatus = 'ready' | 'empty' | 'incompatible';

export interface ResolvedComparison {
  readonly state: ComparisonState;
  readonly status: ComparisonResolutionStatus;
  /** Canonically ordered identities; a future session decides which are visible work. */
  readonly featureIds: readonly string[];
  readonly incompatibleFeatureIds: readonly string[];
}

export type ComparisonAction =
  | { readonly type: 'scope/set'; readonly scope: ComparisonFeatureScope }
  | { readonly type: 'mode/set'; readonly mode: ComparisonMode }
  | { readonly type: 'orientation/set'; readonly orientation: SliceAxis }
  | { readonly type: 'target/set'; readonly target: ComparisonTarget }
  | { readonly type: 'normalization/set'; readonly normalizationId: string }
  | { readonly type: 'active/set'; readonly featureId: string | null }
  | { readonly type: 'pin/toggle'; readonly featureId: string };

export interface SyntheticZScoreDefinition {
  readonly kind: 'synthetic-zscore';
  readonly id: string;
  readonly label: string;
  readonly mean: number;
  readonly standardDeviation: number;
  readonly zeroVariance: 'missing';
}

function uniqueNonempty(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter(Boolean))];
}

function representationIsCompatible(
  representation: ComparisonFeatureRepresentation,
  target: ComparisonTarget,
  normalizationId: string,
): boolean {
  if (!representation.normalizationIds.includes(normalizationId)) return false;
  if (representation.kind === 'regional' && target.kind === 'regional') {
    return representation.parcellation === target.parcellation;
  }
  if (representation.kind === 'volume' && target.kind === 'volume') {
    return representation.referenceSpaceId === target.referenceSpaceId;
  }
  return false;
}

function featureIsCompatible(
  feature: ComparisonReleaseFeature,
  target: ComparisonTarget,
  normalizationId: string,
): boolean {
  return feature.representations.some((representation) => (
    representationIsCompatible(representation, target, normalizationId)
  ));
}

function scopeCandidates(
  scope: ComparisonFeatureScope,
  release: ComparisonRelease,
): readonly ComparisonReleaseFeature[] {
  if (scope.kind === 'all') return release.features;
  if (scope.kind === 'group') {
    return release.features.filter((feature) => feature.groupIds.includes(scope.groupId));
  }
  const requested = new Set(uniqueNonempty(scope.featureIds));
  return release.features.filter((feature) => requested.has(feature.id));
}

export function reconcileComparison(
  state: ComparisonState,
  release: ComparisonRelease,
): ResolvedComparison {
  const candidates = scopeCandidates(state.scope, release);
  const compatible = candidates.filter((feature) => (
    featureIsCompatible(feature, state.target, state.normalizationId)
  ));
  const compatibleIds = new Set(compatible.map((feature) => feature.id));
  const incompatible = state.scope.kind === 'explicit'
    ? candidates.filter((feature) => !compatibleIds.has(feature.id)).map((feature) => feature.id)
    : [];
  const featureIds = incompatible.length === 0 ? compatible.map((feature) => feature.id) : [];
  const allowed = new Set(featureIds);
  const activeFeatureId = state.activeFeatureId !== null && allowed.has(state.activeFeatureId)
    ? state.activeFeatureId
    : featureIds[0] ?? null;
  const pinnedFeatureIds = uniqueNonempty(state.pinnedFeatureIds).filter((id) => allowed.has(id));
  const scope = state.scope.kind === 'explicit'
    ? { kind: 'explicit' as const, featureIds: candidates.map((feature) => feature.id) }
    : state.scope;

  return {
    state: {
      ...state,
      dataset: release.dataset,
      scope,
      activeFeatureId,
      pinnedFeatureIds,
    },
    status: incompatible.length > 0 ? 'incompatible' : featureIds.length > 0 ? 'ready' : 'empty',
    featureIds,
    incompatibleFeatureIds: incompatible,
  };
}

export function reduceComparisonState(
  state: ComparisonState,
  action: ComparisonAction,
): ComparisonState {
  switch (action.type) {
    case 'scope/set':
      return { ...state, scope: action.scope };
    case 'mode/set':
      return { ...state, mode: action.mode };
    case 'orientation/set':
      return { ...state, orientation: action.orientation };
    case 'target/set':
      return { ...state, target: action.target };
    case 'normalization/set':
      return { ...state, normalizationId: action.normalizationId };
    case 'active/set':
      return { ...state, activeFeatureId: action.featureId };
    case 'pin/toggle': {
      const pinned = new Set(state.pinnedFeatureIds);
      if (pinned.has(action.featureId)) pinned.delete(action.featureId);
      else pinned.add(action.featureId);
      return { ...state, pinnedFeatureIds: [...pinned] };
    }
  }
}

export function applySyntheticZScore(
  value: number | null,
  definition: SyntheticZScoreDefinition,
): number | null {
  if (!Number.isFinite(definition.mean)) throw new Error('synthetic z-score mean must be finite');
  if (!Number.isFinite(definition.standardDeviation) || definition.standardDeviation < 0) {
    throw new Error('synthetic z-score standard deviation must be finite and non-negative');
  }
  if (value === null || !Number.isFinite(value) || definition.standardDeviation === 0) return null;
  return (value - definition.mean) / definition.standardDeviation;
}
