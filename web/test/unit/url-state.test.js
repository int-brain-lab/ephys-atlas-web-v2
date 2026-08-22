import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_VIEW_STATE } from '../../.test-dist/domain/defaults.js';
import { parseViewState, serializeViewState } from '../../.test-dist/url/url-state.js';

test('URL state round-trips common shareable state', () => {
  const view = {
    ...DEFAULT_VIEW_STATE,
    dataset: { datasetId: 'brainwide_map', releaseId: 'paper-2026-09' },
    featureId: 'wheel_speed',
    parcellation: 'beryl',
    regionOrder: 'value-desc',
    selection: ['CA1', 'VISp'],
    cursor: { xUm: -5539, yUm: 5300, zUm: 32 },
    workspace: { secondaryTab: 'swanson', activeCompactView: 'secondary', maximizedView: 'coronal' },
    layers: { volumeOpacity: 0.35, anatomyOutlines: false },
    coloring: {
      mode: 'anatomy',
      statistic: 'median',
      colormap: 'magma',
      range: { mode: 'fixed', min: -2, max: 4 },
      scale: 'linear',
    },
  };
  const query = serializeViewState(view);
  assert.match(query, /v=4/);
  assert.match(query, /dataset=brainwide_map/);
  assert.match(query, /feature=wheel_speed/);
  assert.match(query, /colors=anatomy/);
  assert.match(query, /order=value-desc/);
  assert.match(query, /opacity=0.35/);
  assert.match(query, /outlines=0/);
  assert.deepEqual(parseViewState(`?${query}`), view);
});

test('volume layer controls use safe defaults and reject malformed opacity', () => {
  assert.deepEqual(parseViewState('?v=4').layers, { volumeOpacity: 1, anatomyOutlines: true });
  assert.deepEqual(parseViewState('?v=4&opacity=0.4&outlines=0').layers, {
    volumeOpacity: 0.4,
    anatomyOutlines: false,
  });
  assert.equal(parseViewState('?v=4&opacity=2').layers.volumeOpacity, 1);
  assert.equal(parseViewState('?v=4&opacity=wat').layers.volumeOpacity, 1);
});

test('URL state preserves selected-region order for stable identity colors', () => {
  const parsed = parseViewState('?v=4&selected=-68,-526157192,-68');
  assert.deepEqual(parsed.selection, ['-68', '-526157192']);
  assert.equal(serializeViewState(parsed).includes('selected=-68%2C-526157192'), true);
});

test('color scale defaults are automatic while explicit overrides round-trip', () => {
  assert.equal(parseViewState('?v=4').coloring.scale, 'auto');
  for (const scale of ['linear', 'log']) {
    const parsed = parseViewState(`?v=4&scale=${scale}`);
    assert.equal(parsed.coloring.scale, scale);
    assert.match(serializeViewState(parsed), new RegExp(`scale=${scale}`));
  }
});

test('unknown URL version falls back to defaults', () => {
  assert.deepEqual(parseViewState('?v=999&dataset=local&feature=nope'), DEFAULT_VIEW_STATE);
});

test('development defaults initialize parsing while explicit shared state overrides them', () => {
  const developmentDefaults = {
    ...DEFAULT_VIEW_STATE,
    dataset: { datasetId: 'ephys_atlas_channels', releaseId: '2026_W32' },
    featureId: 'rms_ap.denoised',
  };
  assert.deepEqual(parseViewState('', developmentDefaults), developmentDefaults);
  assert.equal(serializeViewState(developmentDefaults, developmentDefaults), 'v=4');
  const explicit = parseViewState('?v=4&release=other&feature=polarity.raw', developmentDefaults);
  assert.equal(explicit.dataset.releaseId, 'other');
  assert.equal(explicit.featureId, 'polarity.raw');
});

test('malformed fixed range is ignored', () => {
  const parsed = parseViewState('?v=4&range=3,2');
  assert.deepEqual(parsed.coloring.range, DEFAULT_VIEW_STATE.coloring.range);
});

test('unsupported count coloring falls back to feature magnitude', () => {
  const parsed = parseViewState('?v=4&stat=count');
  assert.equal(parsed.coloring.statistic, DEFAULT_VIEW_STATE.coloring.statistic);
  assert.equal(serializeViewState(parsed).includes('stat=count'), false);
});

test('a hand-edited dataset without release defers to that dataset default release', () => {
  const parsed = parseViewState('?v=4&dataset=brainwide_map');
  assert.equal(parsed.dataset.datasetId, 'brainwide_map');
  assert.equal(parsed.dataset.releaseId, null);
});

test('unsupported historical URLs reset without partially consuming stale fields', () => {
  assert.deepEqual(parseViewState('?v=1&slices=660,570,400&parcel=beryl'), DEFAULT_VIEW_STATE);
  assert.deepEqual(parseViewState('?v=2&slices=264,228,160&feature=stale'), DEFAULT_VIEW_STATE);
  assert.deepEqual(parseViewState('?v=3&cursor=-40,-1211,-3679'), DEFAULT_VIEW_STATE);
});

test('v4 cursor coordinates choose and snap to the nearest atlas planes', () => {
  const parsed = parseViewState('?v=4&cursor=-40,-1211,-3679');
  assert.deepEqual(parsed.cursor, { xUm: -39, yUm: -1210, zUm: -3678 });
});

test('workspace dimensions round-trip independently and reject unknown identifiers', () => {
  const parsed = parseViewState('?v=4&secondary=top&compact=secondary&max=sagittal');
  assert.deepEqual(parsed.workspace, {
    secondaryTab: 'top',
    activeCompactView: 'secondary',
    maximizedView: 'sagittal',
  });
  assert.match(serializeViewState(parsed), /secondary=top/);
  const invalid = parseViewState('?v=4&secondary=other&compact=top&max=summary');
  assert.deepEqual(invalid.workspace, DEFAULT_VIEW_STATE.workspace);
});
