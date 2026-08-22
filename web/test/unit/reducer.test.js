import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_APP_STATE } from '../../.test-dist/domain/defaults.js';
import { deriveRegionalSliceIndices } from '../../.test-dist/domain/navigation.js';
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

test('selection toggles are unique and preserve first-selection order', () => {
  let state = DEFAULT_APP_STATE;
  state = reduceAppState(state, { type: 'selection/toggle', regionId: 'VISp' });
  state = reduceAppState(state, { type: 'selection/toggle', regionId: 'CA1' });
  assert.deepEqual(state.view.selection, ['VISp', 'CA1']);
  state = reduceAppState(state, { type: 'selection/toggle', regionId: 'VISp' });
  assert.deepEqual(state.view.selection, ['CA1']);
});

test('setting selection deduplicates without changing categorical color order', () => {
  const state = reduceAppState(DEFAULT_APP_STATE, {
    type: 'selection/set',
    regionIds: ['-68', '-526157192', '-68'],
  });
  assert.deepEqual(state.view.selection, ['-68', '-526157192']);
});

test('atlas anatomy color mode is explicit application state', () => {
  const next = reduceAppState(DEFAULT_APP_STATE, { type: 'color/mode', mode: 'anatomy' });
  assert.equal(next.view.coloring.mode, 'anatomy');
});

test('region ordering is explicit application state', () => {
  const next = reduceAppState(DEFAULT_APP_STATE, { type: 'regions/order', order: 'value-desc' });
  assert.equal(next.view.regionOrder, 'value-desc');
});

test('slice movement updates the canonical world cursor', () => {
  const next = reduceAppState(DEFAULT_APP_STATE, { type: 'slice/set', axis: 'coronal', index: 661 });
  assert.equal(deriveRegionalSliceIndices(next.view.cursor).coronal, 661);
  assert.equal(next.view.cursor.yUm, -1210);
  assert.equal(next.view.cursor.xUm, DEFAULT_APP_STATE.view.cursor.xUm);
  assert.equal(next.view.cursor.zUm, DEFAULT_APP_STATE.view.cursor.zUm);
});

test('world cursor movement snaps once while native indices remain derived', () => {
  const next = reduceAppState(DEFAULT_APP_STATE, {
    type: 'cursor/set',
    cursor: { xUm: -40, yUm: -1211, zUm: -3679 },
  });
  assert.deepEqual(deriveRegionalSliceIndices(next.view.cursor), { coronal: 661, sagittal: 570, horizontal: 401 });
  assert.deepEqual(next.view.cursor, { xUm: -39, yUm: -1210, zUm: -3678 });
});

test('secondary tab, compact view, and maximized view update independently', () => {
  let state = reduceAppState(DEFAULT_APP_STATE, { type: 'workspace/secondary-tab', tab: 'top' });
  state = reduceAppState(state, { type: 'workspace/compact-view', view: 'secondary' });
  state = reduceAppState(state, { type: 'workspace/maximized-view', view: 'sagittal' });
  assert.deepEqual(state.view.workspace, {
    secondaryTab: 'top',
    activeCompactView: 'secondary',
    maximizedView: 'sagittal',
  });
  state = reduceAppState(state, { type: 'workspace/maximized-view', view: null });
  assert.equal(state.view.workspace.secondaryTab, 'top');
  assert.equal(state.view.workspace.activeCompactView, 'secondary');
  assert.equal(state.view.workspace.maximizedView, null);
});
