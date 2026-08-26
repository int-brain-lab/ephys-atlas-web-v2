import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePresentationScale } from '../../.test-dist/application/presentation-scale.js';

const coloring = {
  mode: 'feature', statistic: 'mean', colormap: 'viridis', range: { mode: 'auto' }, scale: 'auto',
};

const feature = {
  schemaVersion: '1.0',
  featureId: 'positive',
  representation: 'regional',
  parcellation: 'allen',
  regionIds: ['1'],
  statistics: { mean: [10] },
  global: { count: 3, min: 1, max: 100, mean: 10, q05: 2, q95: 80 },
  histogram: { axisScale: 'linear', edges: [1, 50, 100], globalCounts: [2, 1] },
  histogramVariants: {
    log: { axisScale: 'log', edges: [1, 10, 100], globalCounts: [1, 2] },
  },
};

test('one resolved scale selects coloring and the matching exact histogram', () => {
  const automatic = resolvePresentationScale(feature, coloring, 'linear');
  assert.equal(automatic.effectiveScale, 'linear');
  assert.equal(automatic.histogram, feature.histogram);
  assert.equal(automatic.logAvailable, true);

  const logarithmic = resolvePresentationScale(feature, { ...coloring, scale: 'log' }, 'linear');
  assert.equal(logarithmic.effectiveScale, 'log');
  assert.equal(logarithmic.histogram, feature.histogramVariants.log);
});

test('release automatic range participates in log capability resolution', () => {
  const withSignedRobustRange = {
    ...feature,
    global: { ...feature.global, q05: -1, q95: 80 },
  };
  const resolved = resolvePresentationScale(withSignedRobustRange, coloring, 'log', [3.73, 17.8]);
  assert.equal(resolved.effectiveScale, 'log');
  assert.equal(resolved.logAvailable, true);
});

test('invalid log selection fails safely to linear without dropping the range', () => {
  const fixed = { ...coloring, scale: 'log', range: { mode: 'fixed', min: -1, max: 20 } };
  const resolved = resolvePresentationScale(feature, fixed, 'log');
  assert.equal(resolved.effectiveScale, 'linear');
  assert.equal(resolved.logAvailable, false);
  assert.match(resolved.logUnavailableReason, /strictly positive/);
});

test('regional log requires an exact log histogram', () => {
  const withoutLog = { ...feature, histogramVariants: undefined };
  const resolved = resolvePresentationScale(withoutLog, { ...coloring, scale: 'log' }, 'log');
  assert.equal(resolved.effectiveScale, 'linear');
  assert.match(resolved.logUnavailableReason, /no exact/);
});
