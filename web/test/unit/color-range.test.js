import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampRangeHandle,
  colorRangeDomain,
  rangePosition,
  rangeSliderStep,
  translateRangeWindow,
} from '../../.test-dist/ui/color-range.js';

const regional = {
  schemaVersion: '0.1',
  featureId: 'feature',
  representation: 'regional',
  parcellation: 'allen',
  regionIds: ['1', '2', '3'],
  statistics: { mean: [2, 4, 6], count: [10, 40, 20] },
  histogram: { edges: [0, 2, 4, 8], globalCounts: [1, 3, 1] },
};

test('regional range domain uses observation histogram edges except for counts', () => {
  assert.deepEqual(colorRangeDomain(regional, 'mean', [1, 7]), [0, 8]);
  assert.deepEqual(colorRangeDomain(regional, 'count', [12, 35]), [10, 40]);
});

test('range window translation preserves width and clamps at domain edges', () => {
  assert.deepEqual(translateRangeWindow([2, 6], 3, [0, 10]), [5, 9]);
  assert.deepEqual(translateRangeWindow([2, 6], 8, [0, 10]), [6, 10]);
  assert.deepEqual(translateRangeWindow([2, 6], -8, [0, 10]), [0, 4]);
});

test('manual bounds outside the declared data extent remain reachable', () => {
  assert.deepEqual(colorRangeDomain(regional, 'mean', [-2, 12]), [-2, 12]);
});

test('range handle math positions, steps, and prevents crossing', () => {
  const domain = [0, 10];
  assert.equal(rangePosition(2.5, domain), .25);
  assert.equal(rangePosition(20, domain), 1);
  assert.equal(rangeSliderStep(domain), .01);
  assert.equal(clampRangeHandle('min', 9, 8, domain), 7.99);
  assert.equal(clampRangeHandle('max', 1, 2, domain), 2.01);
});
