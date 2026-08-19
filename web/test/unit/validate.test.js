import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFeaturePayload } from '../../.test-dist/data/validate.js';

test('regional payload validation rejects statistic arrays with wrong length', () => {
  assert.throws(() => parseFeaturePayload({
    schemaVersion: '0.1-provisional',
    featureId: 'x',
    representation: 'regional',
    parcellation: 'allen',
    regionIds: ['A', 'B'],
    statistics: { mean: [1] },
  }), /length must match regionIds/);
});
