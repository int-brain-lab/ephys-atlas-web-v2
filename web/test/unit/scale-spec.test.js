import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampScalePosition,
  scaleDenormalize,
  scaleDomainIsValid,
  scaleForward,
  scaleInverse,
  scaleNormalize,
  scaleSpec,
  scaleValueIsValid,
} from '../../.test-dist/domain/scale-spec.js';

test('linear and logarithmic scale specifications share forward, inverse, and normalization math', () => {
  assert.deepEqual(scaleSpec('linear'), { kind: 'linear' });
  assert.deepEqual(scaleSpec('log'), { kind: 'log' });

  assert.equal(scaleForward(12, 'linear'), 12);
  assert.equal(scaleInverse(12, 'linear'), 12);
  assert.equal(scaleNormalize(2.5, [0, 10], 'linear'), .25);
  assert.equal(scaleDenormalize(.25, [0, 10], 'linear'), 2.5);

  assert.ok(Math.abs(scaleForward(10, 'log') - Math.log(10)) < 1e-12);
  assert.ok(Math.abs(scaleInverse(Math.log(10), 'log') - 10) < 1e-12);
  assert.ok(Math.abs(scaleNormalize(10, [1, 1_000], 'log') - 1 / 3) < 1e-12);
  assert.ok(Math.abs(scaleDenormalize(2 / 3, [1, 1_000], 'log') - 100) < 1e-10);
});

test('scale validity remains explicit for invalid log values and domains', () => {
  assert.equal(scaleValueIsValid(0, 'linear'), true);
  assert.equal(scaleValueIsValid(0, 'log'), false);
  assert.equal(scaleDomainIsValid([0, 1], 'linear'), true);
  assert.equal(scaleDomainIsValid([0, 1], 'log'), false);
  assert.equal(scaleDomainIsValid([1, 1], 'log'), false);
  assert.equal(scaleNormalize(0, [1, 10], 'log'), null);
  assert.equal(scaleDenormalize(.5, [0, 10], 'log'), null);
  assert.equal(clampScalePosition(-.25), 0);
  assert.equal(clampScalePosition(1.25), 1);
});
