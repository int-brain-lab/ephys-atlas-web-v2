import assert from 'node:assert/strict';
import test from 'node:test';

import { presentDatasetTitle } from '../../.test-dist/ui/dataset-presentation.js';

test('historical immutable release titles use concise dataset presentation', () => {
  assert.deepEqual(presentDatasetTitle('IBL Ephys Atlas channel features'), {
    title: 'IBL Ephys Atlas — Channel Features',
  });
  assert.deepEqual(presentDatasetTitle('IBL Brain-Wide Map legacy website snapshot'), {
    title: 'IBL Brain-Wide Map',
    badge: 'Legacy snapshot',
  });
});

test('publisher-defined dataset titles pass through unchanged', () => {
  assert.deepEqual(presentDatasetTitle('Smith Lab Regional Coefficients'), {
    title: 'Smith Lab Regional Coefficients',
  });
});
