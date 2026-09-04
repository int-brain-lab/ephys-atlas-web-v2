import assert from 'node:assert/strict';
import test from 'node:test';

import { presentDatasetTitle } from '../../.test-dist/ui/dataset-presentation.js';

test('historical immutable release titles use concise dataset presentation', () => {
  assert.deepEqual(presentDatasetTitle('IBL Ephys Atlas channel features'), {
    title: 'Ephys Atlas channels',
  });
  assert.deepEqual(presentDatasetTitle('IBL Brain-Wide Map legacy website snapshot'), {
    title: 'Brain-Wide Map',
    badge: 'Legacy snapshot',
  });
});

test('current local release titles keep the dataset family prominent', () => {
  assert.equal(presentDatasetTitle('IBL Ephys Atlas — Channel Features').title, 'Ephys Atlas channels');
  assert.equal(presentDatasetTitle('IBL Ephys Atlas — Cluster Features').title, 'Ephys Atlas clusters');
  assert.equal(presentDatasetTitle('IBL Encoding Volumes').title, 'Ephys Atlas encoding volumes');
});

test('publisher-defined dataset titles pass through unchanged', () => {
  assert.deepEqual(presentDatasetTitle('Smith Lab Regional Coefficients'), {
    title: 'Smith Lab Regional Coefficients',
  });
});
