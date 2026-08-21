import assert from 'node:assert/strict';
import test from 'node:test';
import { smoothHistogramPath } from '../../.test-dist/ui/regional/histogram-curve.js';

test('histogram presentation uses a smooth curve anchored at the distribution boundaries', () => {
  const path = smoothHistogramPath([0.25, 0.5, 0.25], 0.5, false);

  assert.match(path, /^M 0 100 C /);
  assert.match(path, / 1000 100$/);
  assert.doesNotMatch(path, /[HV]/);
  assert.doesNotMatch(path, /NaN|Infinity/);
});

test('filled histogram curves close without changing the normalized values', () => {
  const path = smoothHistogramPath([0, 1, 0], 1, true, 300, 80);

  assert.match(path, /^M 0 80 C /);
  assert.match(path, / 300 80 Z$/);
  assert.match(path, / 150 5(?:\D|$)/);
});
