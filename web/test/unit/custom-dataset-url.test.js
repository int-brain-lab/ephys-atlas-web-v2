import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_VIEW_STATE } from '../../.test-dist/domain/defaults.js';
import { parseViewState, serializeViewState } from '../../.test-dist/url/url-state.js';

test('publisher-defined dataset ids round-trip through shareable URL state', () => {
  const view = {
    ...DEFAULT_VIEW_STATE,
    dataset: { datasetId: 'lab_custom_dataset', releaseId: '2026-08-21' },
  };
  const query = serializeViewState(view);
  const parsed = parseViewState(`?${query}`);
  assert.equal(parsed.dataset.datasetId, 'lab_custom_dataset');
  assert.equal(parsed.dataset.releaseId, '2026-08-21');
});

test('an unresolved publisher-defined dataset is not serialized as an exact selection', () => {
  const view = {
    ...DEFAULT_VIEW_STATE,
    dataset: { datasetId: 'lab_custom_dataset', releaseId: DEFAULT_VIEW_STATE.dataset.releaseId },
  };
  const query = serializeViewState(view);
  const parsed = parseViewState(`?${query}`);
  assert.equal(parsed.dataset.datasetId, DEFAULT_VIEW_STATE.dataset.datasetId);
  assert.equal(parsed.dataset.releaseId, DEFAULT_VIEW_STATE.dataset.releaseId);
});
