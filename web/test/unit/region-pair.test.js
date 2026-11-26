import assert from 'node:assert/strict';
import test from 'node:test';
import { pairPoints } from '../../.test-dist/ui/regional/pair-view.js';

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

test('pairPoints pools a parent region exactly from its children', () => {
  // children c1 = {0, 2}, c2 = {4, 6, 8}: pooled n=5, mean 4, sample SD sqrt(10)
  const feature = {
    featureId: 'f', regionIds: ['c1', 'c2', 'x'],
    statistics: { mean: [1, 6, 0], std: [Math.SQRT2, 2, 1], count: [2, 3, 4] },
  };
  const members = (id) => (id === 'p' ? ['p', 'c1', 'c2'] : [id]);
  const [point] = pairPoints([feature], 'p', 'x', members);
  const pooled = Math.sqrt((4 * 10 + 3 * 1) / 7);
  assert.ok(Math.abs(point.d - (0 - 4) / pooled) < 1e-12);
});
