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
    type: 'navigation/release',
    navigation: { kind: 'custom', projectId: 'atlas' },
    dataset: { datasetId: 'brainwide_map', releaseId: 'r1' },
  });
  assert.equal(next.view.featureId, null);
  assert.deepEqual(next.view.selection, []);
  assert.equal(next.view.dataset.datasetId, 'brainwide_map');
});

test('derived context reconciliation atomically selects a supported parcellation', () => {
  const populated = {
    ...DEFAULT_APP_STATE,
    view: { ...DEFAULT_APP_STATE.view, selection: ['-362'] },
  };
  const next = reduceAppState(populated, {
    type: 'context/reconcile',
    featureId: 'choice_decoding_significant',
    representation: 'regional',
    parcellation: 'beryl',
  });
  assert.equal(next.view.featureId, 'choice_decoding_significant');
  assert.equal(next.view.representation, 'regional');
  assert.equal(next.view.parcellation, 'beryl');
  assert.deepEqual(next.view.selection, []);
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

test('unsupported scalar presentation reconciles atomically to Linear and Full while preserving range', () => {
  const state = {
    ...DEFAULT_APP_STATE,
    view: {
      ...DEFAULT_APP_STATE.view,
      coloring: { ...DEFAULT_APP_STATE.view.coloring, scale: 'symlog', range: { mode: 'fixed', min: -2, max: 8 } },
      distribution: { domain: 'focused' },
    },
  };
  const next = reduceAppState(state, { type: 'presentation/reconcile', scale: 'linear', domain: 'full' });
  assert.equal(next.view.coloring.scale, 'linear');
  assert.equal(next.view.distribution.domain, 'full');
  assert.deepEqual(next.view.coloring.range, { mode: 'fixed', min: -2, max: 8 });
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

test('volume layer presentation clamps opacity and preserves outline visibility independently', () => {
  let state = reduceAppState(DEFAULT_APP_STATE, { type: 'layers/volume-opacity', opacity: 2 });
  state = reduceAppState(state, { type: 'layers/anatomy-outlines', visible: false });
  assert.deepEqual(state.view.layers, { volumeOpacity: 1, anatomyOutlines: false });
  state = reduceAppState(state, { type: 'layers/volume-opacity', opacity: 0.35 });
  assert.deepEqual(state.view.layers, { volumeOpacity: 0.35, anatomyOutlines: false });
});

test('3-D state clamps explode and rejects invalid camera poses as a whole', () => {
  let state = reduceAppState(DEFAULT_APP_STATE, { type: 'scene3d/explode', explode: 1.4 });
  assert.equal(state.view.scene3d.explode, 1);
  state = reduceAppState(state, {
    type: 'scene3d/camera',
    camera: { positionUm: [1.23456, -5, 3], targetUm: [0, 0, 0], up: [0, 0, 2] },
  });
  assert.deepEqual(state.view.scene3d.camera, {
    positionUm: [1.235, -5, 3], targetUm: [0, 0, 0], up: [0, 0, 1],
  });
  const accepted = state;
  state = reduceAppState(state, {
    type: 'scene3d/camera',
    camera: { positionUm: [0, 0, 0], targetUm: [0, 0, 0], up: [0, 0, 1] },
  });
  assert.equal(state, accepted);
  state = reduceAppState(state, { type: 'scene3d/camera', camera: null });
  assert.equal(state.view.scene3d.camera, null);
});
