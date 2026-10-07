import assert from 'node:assert/strict';
import test from 'node:test';

import { binningCdfKnots, probit, quantileNormalize, quantileScaleSpecs, valueCdfKnots } from '../../.test-dist/application/quantile-scale.js';

test('probit matches standard normal quantiles', () => {
  assert.ok(Math.abs(probit(0.5)) < 1e-9);
  assert.ok(Math.abs(probit(0.975) - 1.959964) < 1e-5);
  assert.ok(Math.abs(probit(0.001) + 3.090232) < 1e-5);
});

test('value CDF knots use mid-ranks and collapse ties', () => {
  assert.deepEqual(valueCdfKnots([3, 1, 1, NaN, 10]), { xs: [1, 3, 10], ps: [0.25, 0.625, 0.875] });
});

test('quantile-uniform equalizes a heavy-tailed sample and clamps outside the knots', () => {
  const { xs, ps } = valueCdfKnots([1, 2, 4, 8, 16, 1000]);
  const spec = { kind: 'quantile-uniform', xs, ys: ps };
  const positions = xs.map((x) => quantileNormalize(x, [1, 1000], spec));
  positions.slice(1).forEach((position, index) => assert.ok(Math.abs(position - positions[index] - 0.2) < 1e-12));
  assert.equal(quantileNormalize(5000, [1, 1000], spec), 1);
  assert.equal(quantileNormalize(Number.NaN, [1, 1000], spec), null);
});

test('binning CDF knots merge full-domain binnings and ignore focused ones', () => {
  const counts = (binCounts) => ({ binCounts, underflowCount: 0, overflowCount: 0 });
  const { xs, ps } = binningCdfKnots([
    { domain: { kind: 'full' }, edges: [0, 5, 10], global: counts([3, 1]) },
    { domain: { kind: 'full' }, edges: [0, 1, 10], global: counts([2, 2]) },
    { domain: { kind: 'focused' }, edges: [2, 3], global: counts([4]) },
  ]);
  assert.deepEqual(xs, [0, 1, 5, 10]);
  assert.deepEqual(ps.map((p) => Math.round(p * 100) / 100), [0, 0.5, 0.75, 1]);
});

test('constant volumes get no quantile specs even though their histogram edges differ', () => {
  const binnings = [{ domain: { kind: 'full' }, edges: [0, 1, 2], global: { binCounts: [0, 5], underflowCount: 0, overflowCount: 0 } }];
  const volume = (min, max) => ({ representation: 'volume', summary: { validStatistics: { min, max } } });
  assert.deepEqual(quantileScaleSpecs(volume(1.5, 1.5), 'mean', binnings), []);
  assert.deepEqual(quantileScaleSpecs(volume(null, null), 'mean', binnings), []);
  assert.equal(quantileScaleSpecs(volume(1, 2), 'mean', binnings).length, 2);
});
