import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_APP_STATE } from '../../.test-dist/domain/defaults.js';
import { reduceAppState } from '../../.test-dist/domain/reducer.js';

test('dataset changes clear feature and region selection', () => {
  const populated = {
    ...DEFAULT_APP_STATE,
    view: { ...DEFAULT_APP_STATE.view, featureId: 'x', selection: ['A', 'B'] },
  };
  const next = reduceAppState(populated, {
    type: 'dataset/set',
    dataset: { datasetId: 'brainwide_map', releaseId: 'r1' },
  });
  assert.equal(next.view.featureId, null);
  assert.deepEqual(next.view.selection, []);
  assert.equal(next.view.dataset.datasetId, 'brainwide_map');
});

test('selection toggles are unique and stable-sorted', () => {
  let state = DEFAULT_APP_STATE;
  state = reduceAppState(state, { type: 'selection/toggle', regionId: 'VISp' });
  state = reduceAppState(state, { type: 'selection/toggle', regionId: 'CA1' });
  assert.deepEqual(state.view.selection, ['CA1', 'VISp']);
  state = reduceAppState(state, { type: 'selection/toggle', regionId: 'VISp' });
  assert.deepEqual(state.view.selection, ['CA1']);
});
