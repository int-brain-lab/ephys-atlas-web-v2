import type {
  ComparisonRelease,
  ComparisonReleaseFeature,
  ComparisonTarget,
  SyntheticZScoreDefinition,
} from '../domain/comparison.js';
import { applySyntheticZScore } from '../domain/comparison.js';
import type { ComparisonSpatialPort, ComparisonSpatialRequest } from '../application/comparison-session.js';

export type SyntheticBehavior = 'normal' | 'slow' | 'failed' | 'missing' | 'zero-variance';

export interface SyntheticComparisonFeature extends ComparisonReleaseFeature {
  readonly label: string;
  readonly group: string;
  readonly unit: string;
  readonly behavior: SyntheticBehavior;
  readonly normalization: SyntheticZScoreDefinition;
}

export interface SyntheticComparisonScenario {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly target: ComparisonTarget;
  readonly release: ComparisonRelease;
  readonly features: readonly SyntheticComparisonFeature[];
}

export interface SyntheticPlanePayload {
  readonly featureId: string;
  readonly label: string;
  readonly group: string;
  readonly unit: string;
  readonly nativeValue: number | null;
  readonly zScore: number | null;
  readonly cells: readonly (number | null)[];
  readonly note: string | null;
}

const NORMALIZATION_ID = 'synthetic-comparison-z-v1';

function syntheticFeature(
  index: number,
  kind: 'regional' | 'volume',
  behavior: SyntheticBehavior = 'normal',
  options: { prefix?: string; group?: string; referenceSpaceId?: string; gridId?: string } = {},
): SyntheticComparisonFeature {
  const prefix = options.prefix ?? (kind === 'regional' ? 'Feature' : 'Volume');
  const id = `${prefix.toLowerCase().replaceAll(' ', '-')}-${String(index + 1).padStart(4, '0')}`;
  const standardDeviation = behavior === 'zero-variance' ? 0 : 0.75 + (index % 7) * 0.2;
  return {
    id,
    label: `${prefix} ${String(index + 1).padStart(4, '0')}`,
    group: options.group ?? `Family ${String.fromCharCode(65 + (index % 5))}`,
    groupIds: [options.group ?? `family-${index % 5}`],
    unit: kind === 'regional' ? 'a.u.' : 'µV',
    behavior,
    normalization: {
      kind: 'synthetic-zscore',
      id: NORMALIZATION_ID,
      label: 'Explicit synthetic lab baseline',
      mean: (index % 11) * 0.25,
      standardDeviation,
      zeroVariance: 'missing',
    },
    representations: kind === 'regional' ? [{
      kind: 'regional', parcellation: 'allen', normalizationIds: [NORMALIZATION_ID],
    }] : [{
      kind: 'volume',
      referenceSpaceId: options.referenceSpaceId ?? 'allen-ccf-v3',
      gridId: options.gridId ?? (index % 2 === 0 ? 'synthetic-10um-grid' : 'synthetic-50um-grid'),
      normalizationIds: [NORMALIZATION_ID],
    }],
  };
}

function scenario(
  id: string,
  label: string,
  description: string,
  target: ComparisonTarget,
  features: readonly SyntheticComparisonFeature[],
): SyntheticComparisonScenario {
  return {
    id, label, description, target, features,
    release: {
      dataset: { datasetId: `synthetic_${id}`, releaseId: 'lab-v1' },
      features,
    },
  };
}

const edgeFeatures = [
  syntheticFeature(0, 'volume', 'normal', { prefix: 'Baseline', group: 'Expected' }),
  syntheticFeature(1, 'volume', 'slow', { prefix: 'Slow response', group: 'Latency' }),
  syntheticFeature(2, 'volume', 'failed', { prefix: 'Failed response', group: 'Failure' }),
  syntheticFeature(3, 'volume', 'missing', { prefix: 'Missing sample', group: 'Validity' }),
  syntheticFeature(4, 'volume', 'zero-variance', { prefix: 'Zero variance', group: 'Normalization' }),
  syntheticFeature(5, 'volume', 'normal', { prefix: 'Fine grid', group: 'Compatible grids', gridId: 'synthetic-10um-grid' }),
  syntheticFeature(6, 'volume', 'normal', { prefix: 'Coarse grid', group: 'Compatible grids', gridId: 'synthetic-50um-grid' }),
  syntheticFeature(7, 'volume', 'normal', {
    prefix: 'Other reference space', group: 'Incompatible', referenceSpaceId: 'synthetic-other-space',
  }),
];

export const SYNTHETIC_COMPARISON_SCENARIOS: readonly SyntheticComparisonScenario[] = [
  scenario(
    'regional-5', '5 regional features', 'Small Focus comparison on one Allen parcellation.',
    { kind: 'regional', parcellation: 'allen' },
    Array.from({ length: 5 }, (_, index) => syntheticFeature(index, 'regional')),
  ),
  scenario(
    'volume-40', '40 volume features', 'Gallery scale with compatible 10 µm and 50 µm grids.',
    { kind: 'volume', referenceSpaceId: 'allen-ccf-v3' },
    Array.from({ length: 40 }, (_, index) => syntheticFeature(index, 'volume')),
  ),
  scenario(
    'synthetic-100', '100 synthetic features', 'A larger mixed-family discovery task.',
    { kind: 'regional', parcellation: 'allen' },
    Array.from({ length: 100 }, (_, index) => syntheticFeature(index, 'regional', 'normal', { prefix: 'Synthetic signal' })),
  ),
  scenario(
    'agea-4345', '4,345 AGEA-like features', 'Gene-scale scope used only to test bounded UI work.',
    { kind: 'regional', parcellation: 'allen' },
    Array.from({ length: 4_345 }, (_, index) => syntheticFeature(index, 'regional', 'normal', { prefix: 'Gene' })),
  ),
  scenario(
    'edge-cases', 'Failure and compatibility states',
    'Slow, failed, missing, zero-variance, and compatible-different-grid cases.',
    { kind: 'volume', referenceSpaceId: 'allen-ccf-v3' }, edgeFeatures,
  ),
];

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = window.setTimeout(resolve, delayMs);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

export class SyntheticComparisonPort implements ComparisonSpatialPort<SyntheticPlanePayload> {
  private readonly features = new Map<string, SyntheticComparisonFeature>();
  private readonly featureIndices = new Map<string, number>();

  useScenario(scenarioValue: SyntheticComparisonScenario): void {
    this.features.clear();
    this.featureIndices.clear();
    for (const [index, feature] of scenarioValue.features.entries()) {
      this.features.set(feature.id, feature);
      this.featureIndices.set(feature.id, index);
    }
  }

  async loadSpatialPlane(request: ComparisonSpatialRequest, signal: AbortSignal): Promise<SyntheticPlanePayload> {
    const feature = this.features.get(request.featureId);
    if (!feature) throw new Error(`Unknown synthetic feature ${request.featureId}`);
    const index = this.featureIndices.get(feature.id) ?? 0;
    await abortableDelay(feature.behavior === 'slow' ? 350 : 18 + (index % 4) * 7, signal);
    if (feature.behavior === 'failed') throw new Error('Synthetic request failure');

    const phase = index * 0.71
      + request.cursor.xUm * 0.0007
      + request.cursor.yUm * 0.0003
      + request.cursor.zUm * 0.0005;
    const nativeValue = feature.behavior === 'missing' ? null : feature.normalization.mean + Math.sin(phase) * 2.4;
    const zScore = applySyntheticZScore(nativeValue, feature.normalization);
    const cells = Array.from({ length: 24 }, (_, cell) => (
      feature.behavior === 'missing' && cell % 3 === 0
        ? null
        : Math.max(-3, Math.min(3, Math.sin(phase + cell * 0.47) * 2.7))
    ));
    const note = feature.behavior === 'missing' ? 'Missing at the shared cursor'
      : feature.behavior === 'zero-variance' ? 'Zero variance → unavailable'
        : null;
    return {
      featureId: feature.id,
      label: feature.label,
      group: feature.group,
      unit: feature.unit,
      nativeValue,
      zScore,
      cells,
      note,
    };
  }
}

export const SYNTHETIC_NORMALIZATION_ID = NORMALIZATION_ID;
