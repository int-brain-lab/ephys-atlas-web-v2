import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeBinaryArray, parseFeaturePayload } from '../../.test-dist/data/validate.js';

test('regional payload validation rejects statistic arrays with wrong length', () => {
  assert.throws(() => parseFeaturePayload({
    schemaVersion: '0.1',
    featureId: 'x',
    representation: 'regional',
    parcellation: 'allen',
    regionIds: ['10', '20'],
    statistics: { mean: [1] },
  }), /length must match regionIds/);
});

test('binary decoder follows declared little-endian dtype', () => {
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  view.setInt32(0, 10, true);
  view.setInt32(4, 20, true);
  assert.deepEqual(decodeBinaryArray(bytes, {
    path: 'ids.i32', dtype: 'int32', shape: [2], order: 'C', endianness: 'little',
  }), [10, 20]);
});
