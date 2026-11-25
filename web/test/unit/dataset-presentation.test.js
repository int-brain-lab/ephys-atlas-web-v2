import assert from 'node:assert/strict';
import test from 'node:test';

import { presentDatasetTitle, presentProjectTitle } from '../../.test-dist/ui/dataset-presentation.js';

test('historical immutable release titles use concise dataset presentation', () => {
  assert.deepEqual(presentDatasetTitle('IBL Ephys Atlas channel features'), {
    title: 'Channels',
  });
  assert.deepEqual(presentDatasetTitle('IBL Brain-Wide Map legacy website snapshot'), {
    title: 'Brain-Wide Map',
    badge: 'Legacy snapshot',
  });
});

test('current local release titles use descriptive dataset names', () => {
  assert.equal(presentDatasetTitle('IBL Ephys Atlas — Channel Features').title, 'Channels');
  assert.equal(presentDatasetTitle('IBL Ephys Atlas — Cluster Features').title, 'Clusters');
  assert.equal(presentDatasetTitle('IBL Encoding Volumes').title, 'Encoding volumes');
  assert.equal(presentDatasetTitle('Allen Gene Expression Atlas').title, 'AGEA');
});

test('publisher-defined dataset titles pass through unchanged', () => {
  assert.deepEqual(presentDatasetTitle('Smith Lab Regional Coefficients'), {
    title: 'Smith Lab Regional Coefficients',
  });
});

test('the existing AGEA project identity is presented as the Anatomy category', () => {
  assert.equal(presentProjectTitle('agea', 'AGEA'), 'Anatomy');
  assert.equal(presentProjectTitle('agea', 'Anatomy'), 'Anatomy');
  assert.equal(presentProjectTitle('publisher-project', 'AGEA'), 'AGEA');
});

test('ElectRA display branding preserves publisher titles and stable project identity', () => {
  assert.equal(presentProjectTitle('ephys-atlas', 'Ephys Atlas'), 'ElectRA');
  assert.equal(presentProjectTitle('ephys-atlas', 'ElectRA'), 'ElectRA');
  assert.equal(presentProjectTitle('publisher-project', 'Ephys Atlas'), 'Ephys Atlas');
});
