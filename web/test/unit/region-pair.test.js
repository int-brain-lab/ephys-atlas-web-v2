import assert from 'node:assert/strict';
import test from 'node:test';
import { pairPoints } from '../../.test-dist/ui/regional/pair-view.js';
import { expandRegionalPayload, histogramQuantile } from '../../.test-dist/data/region-aggregate.js';

test('pairPoints z-scores across regions and ranks by |Cohen d|', () => {
  const feature = (featureId, mean) => ({
    featureId, regionIds: ['a', 'b', 'c'],
    statistics: { mean, std: [1, 1, 1], count: [4, 4, 4] },
  });
  const [first, second] = pairPoints([feature('small', [0, 0.1, 0.2]), feature('large', [-1, 1, 0])], 'a', 'b');
  assert.equal(first.featureId, 'large');
  assert.equal(first.z1, -1);
  assert.equal(first.z2, 1);
  assert.equal(first.d, 2);
  assert.equal(first.sem1, 0.5);
  assert.ok(Math.abs(second.d - 0.1) < 1e-12);
});

test('expandRegionalPayload appends exact parent rows and summed histograms', () => {
  // children c1 = {0, 2}, c2 = {4, 6, 8}: pooled n=5, mean 4, sample SD sqrt(10)
  const counts = (binCounts) => ({ binCounts, underflowCount: 0, overflowCount: 0 });
  const payload = {
    featureId: 'f', regionIds: ['c1', 'c2', 'x'],
    statistics: { mean: [1, 6, 0], std: [Math.SQRT2, 2, 1], count: [2, 3, 4], min: [0, 4, -1], median: [1, 6, 0] },
    distribution: { binnings: [{ scale: { kind: 'linear' }, domain: { kind: 'full' }, edges: [0, 5, 10],
      regional: [counts([2, 0]), counts([1, 2]), counts([4, 0])] }] },
  };
  const regions = [{ id: 'p', parentId: null }, { id: 'c1', parentId: 'p' }, { id: 'c2', parentId: 'p' },
    { id: 'x', parentId: null }, { id: 'empty', parentId: null }];
  const expanded = expandRegionalPayload(payload, regions);
  assert.deepEqual(expanded.regionIds, ['c1', 'c2', 'x', 'p']);
  assert.equal(expanded.statistics.count[3], 5);
  assert.equal(expanded.statistics.mean[3], 4);
  assert.ok(Math.abs(expanded.statistics.std[3] - Math.sqrt(10)) < 1e-12);
  assert.equal(expanded.statistics.min[3], 0);
  assert.deepEqual(expanded.distribution.binnings[0].regional[3].binCounts, [3, 2]);
  assert.equal(expanded.statistics.median[3], histogramQuantile([0, 5, 10], counts([3, 2]), 0.5));
  const [point] = pairPoints([expanded], 'p', 'x', 3);
  assert.ok(Math.abs(point.d - (0 - 4) / Math.sqrt((4 * 10 + 3 * 1) / 7)) < 1e-12);
});

test('expandRegionalPayload replaces a parent row with the union of itself and its descendants', () => {
  // parent p owns {10}, child c owns {0, 2}: union {0, 2, 10}, n=3, mean 4
  const payload = { featureId: 'f', regionIds: ['p', 'c'],
    statistics: { mean: [10, 1], std: [0, Math.SQRT2], count: [1, 2] } };
  const expanded = expandRegionalPayload(payload, [{ id: 'p', parentId: null }, { id: 'c', parentId: 'p' }]);
  assert.deepEqual(expanded.regionIds, ['p', 'c']);
  assert.equal(expanded.statistics.count[0], 3);
  assert.equal(expanded.statistics.mean[0], 4);
  assert.ok(Math.abs(expanded.statistics.std[0] - Math.sqrt(28)) < 1e-12);
  assert.equal(expanded.statistics.mean[1], 1);
});
