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

test('atlas anatomy color mode is explicit application state', () => {
  const next = reduceAppState(DEFAULT_APP_STATE, { type: 'color/mode', mode: 'anatomy' });
  assert.equal(next.view.coloring.mode, 'anatomy');
});

test('slice movement updates the canonical world cursor', () => {
  const next = reduceAppState(DEFAULT_APP_STATE, { type: 'slice/set', axis: 'coronal', index: 661 });
  assert.equal(next.view.slices.coronal, 661);
  assert.equal(next.view.cursor.yUm, -1210);
  assert.equal(next.view.cursor.xUm, DEFAULT_APP_STATE.view.cursor.xUm);
  assert.equal(next.view.cursor.zUm, DEFAULT_APP_STATE.view.cursor.zUm);
});

test('world cursor movement selects the nearest native anatomy slices', () => {
  const next = reduceAppState(DEFAULT_APP_STATE, {
    type: 'cursor/set',
    cursor: { xUm: -40, yUm: -1211, zUm: -3679 },
  });
  assert.deepEqual(next.view.slices, { coronal: 661, sagittal: 570, horizontal: 401 });
  assert.deepEqual(next.view.cursor, { xUm: -39, yUm: -1210, zUm: -3678 });
});
