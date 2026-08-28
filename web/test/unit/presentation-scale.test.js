import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePresentationScale } from '../../.test-dist/application/presentation-scale.js';

const coloring = {
  mode: 'feature', statistic: 'mean', colormap: 'viridis', range: { mode: 'auto' }, scale: 'auto',
};

const fullLinear = {
  id: 'linear-full', scale: { kind: 'linear' }, domain: { kind: 'full' }, edges: [-100, 0, 100],
  global: { binCounts: [2, 1], underflowCount: 0, overflowCount: 0 },
  regional: [{ binCounts: [2, 1], underflowCount: 0, overflowCount: 0 }],
  binRule: 'left-closed-right-open-last-closed',
};
const focusedLinear = {
  id: 'linear-focused', scale: { kind: 'linear' }, domain: { kind: 'focused', bounds: [-10, 10] }, edges: [-10, 0, 10],
  global: { binCounts: [1, 1], underflowCount: 1, overflowCount: 1 },
  regional: [{ binCounts: [1, 1], underflowCount: 1, overflowCount: 1 }],
  binRule: 'left-closed-right-open-last-closed',
};
const fullSymlog = { ...fullLinear, id: 'symlog-full', scale: { kind: 'symlog', linearThreshold: 2 } };
const focusedSymlog = { ...focusedLinear, id: 'symlog-focused', scale: { kind: 'symlog', linearThreshold: 2 } };
const fullLog = { ...fullLinear, id: 'log-full', scale: { kind: 'log' }, edges: [1, 10, 100] };
const focusedLog = { ...focusedLinear, id: 'log-focused', scale: { kind: 'log' }, edges: [1, 5, 10] };

const feature = {
  schemaVersion: '1.0', featureId: 'signed', representation: 'regional', parcellation: 'allen', regionIds: ['1'],
  statistics: { mean: [10] }, global: { count: 4, min: -100, max: 100, mean: 10, q05: -80, q95: 80 },
  distribution: { binnings: [fullLinear, focusedLinear, fullSymlog, focusedSymlog] },
};

const display = {
  scales: [{ kind: 'linear' }, { kind: 'symlog', linearThreshold: 2 }],
  preferredScale: 'symlog',
  distributionDomains: [{ kind: 'full' }, { kind: 'focused', bounds: [-10, 10] }],
  preferredDistributionDomain: 'focused',
};

test('release defaults resolve Signed log and Focused while retaining an exact Full compact binning', () => {
  const resolved = resolvePresentationScale(feature, coloring, display, 'auto');
  assert.equal(resolved.effectiveScale, 'symlog');
  assert.deepEqual(resolved.effectiveScaleSpec, { kind: 'symlog', linearThreshold: 2 });
  assert.equal(resolved.effectiveDistributionDomain, 'focused');
  assert.equal(resolved.histogram, focusedSymlog);
  assert.equal(resolved.fullHistogram, fullSymlog);
  assert.deepEqual(resolved.availableScales, ['linear', 'symlog']);
  assert.deepEqual(resolved.availableDistributionDomains, ['full', 'focused']);
});

test('explicit scale and domain resolve independently', () => {
  const resolved = resolvePresentationScale(feature, { ...coloring, scale: 'linear' }, display, 'full');
  assert.equal(resolved.effectiveScale, 'linear');
  assert.equal(resolved.effectiveDistributionDomain, 'full');
  assert.equal(resolved.histogram, fullLinear);
});

test('unsupported explicit choices reconcile safely to Linear and Full without changing range state', () => {
  const fixed = { ...coloring, scale: 'log', range: { mode: 'fixed', min: -5, max: 20 } };
  const resolved = resolvePresentationScale(feature, fixed, display, 'focused');
  assert.equal(resolved.effectiveScale, 'linear');
  assert.equal(resolved.effectiveDistributionDomain, 'full');
  assert.match(resolved.unavailableScaleReasons.log, /not declared/);

  const fullOnly = { ...display, distributionDomains: [{ kind: 'full' }], preferredDistributionDomain: 'full' };
  const domainFallback = resolvePresentationScale(
    { ...feature, distribution: { binnings: [fullLinear, fullSymlog] } },
    coloring,
    fullOnly,
    'focused',
  );
  assert.equal(domainFallback.effectiveScale, 'linear');
  assert.equal(domainFallback.effectiveDistributionDomain, 'full');
});

test('a declared Log choice with a nonpositive manual range resolves to Linear before rendering', () => {
  const logDisplay = {
    ...display,
    scales: [{ kind: 'linear' }, { kind: 'log' }],
    preferredScale: 'log',
  };
  const positiveFeature = {
    ...feature,
    global: { ...feature.global, min: 1, max: 100, q05: 2, q95: 80 },
    distribution: { binnings: [fullLinear, focusedLinear, fullLog, focusedLog] },
  };
  const fixed = { ...coloring, scale: 'log', range: { mode: 'fixed', min: -2, max: 8 } };
  const resolved = resolvePresentationScale(positiveFeature, fixed, logDisplay, 'focused');
  assert.equal(resolved.effectiveScale, 'linear');
  assert.equal(resolved.effectiveDistributionDomain, 'full');
  assert.match(resolved.unavailableScaleReasons.log, /strictly positive/);
  assert.deepEqual(fixed.range, { mode: 'fixed', min: -2, max: 8 });
});

test('volume uses the same declared scales but only global valid-voxel binnings', () => {
  const volume = {
    schemaVersion: '1.0', featureId: 'volume', representation: 'volume', descriptor: {},
    summary: { valueRange: [-100, 100], validVoxelCount: 4, distribution: { binnings: [fullLinear] } },
  };
  const linearOnly = {
    scales: [{ kind: 'linear' }], preferredScale: 'linear',
    distributionDomains: [{ kind: 'full' }], preferredDistributionDomain: 'full',
  };
  const resolved = resolvePresentationScale(volume, { ...coloring, scale: 'symlog' }, linearOnly, 'focused');
  assert.equal(resolved.effectiveScale, 'linear');
  assert.equal(resolved.effectiveDistributionDomain, 'full');
  assert.equal(resolved.histogram, fullLinear);
});

test('empty populations expose no analytical binning without blank-state exceptions', () => {
  const empty = { ...feature, global: { count: 0 }, distribution: undefined };
  const resolved = resolvePresentationScale(empty, coloring, undefined, 'auto');
  assert.equal(resolved.effectiveScale, 'linear');
  assert.equal(resolved.effectiveDistributionDomain, 'full');
  assert.equal(resolved.histogram, undefined);
});
