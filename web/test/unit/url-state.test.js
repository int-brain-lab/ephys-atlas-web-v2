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
    selection: ['CA1', 'VISp'],
    cursor: { xUm: -5539, yUm: 5300, zUm: 32 },
    slices: { coronal: 10, sagittal: 20, horizontal: 30 },
    coloring: {
      mode: 'anatomy',
      statistic: 'median',
      colormap: 'magma',
      range: { mode: 'fixed', min: -2, max: 4 },
      scale: 'linear',
    },
  };
  const query = serializeViewState(view);
  assert.match(query, /v=3/);
  assert.match(query, /dataset=brainwide_map/);
  assert.match(query, /feature=wheel_speed/);
  assert.match(query, /colors=anatomy/);
  assert.deepEqual(parseViewState(`?${query}`), view);
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
  assert.equal(serializeViewState(developmentDefaults, developmentDefaults), 'v=3&feature=rms_ap.denoised');
  const explicit = parseViewState('?v=3&release=other&feature=polarity.raw', developmentDefaults);
  assert.equal(explicit.dataset.releaseId, 'other');
  assert.equal(explicit.featureId, 'polarity.raw');
});

test('malformed fixed range is ignored', () => {
  const parsed = parseViewState('?v=3&range=3,2');
  assert.deepEqual(parsed.coloring.range, DEFAULT_VIEW_STATE.coloring.range);
});

test('a hand-edited dataset without release defers to that dataset default release', () => {
  const parsed = parseViewState('?v=3&dataset=brainwide_map');
  assert.equal(parsed.dataset.datasetId, 'brainwide_map');
  assert.equal(parsed.dataset.releaseId, null);
});

test('v1 slice links preserve their world coordinates on the native 10 um anatomy grid', () => {
  const parsed = parseViewState('?v=1&slices=660,570,400');
  assert.equal(parsed.urlVersion, 3);
  assert.deepEqual(parsed.slices, { coronal: 660, sagittal: 570, horizontal: 400 });
  assert.deepEqual(parsed.cursor, { xUm: -39, yUm: -1200, zUm: -3668 });
});

test('v2 slice links migrate from the 25 um grid through world coordinates', () => {
  const parsed = parseViewState('?v=2&slices=264,228,160');
  assert.equal(parsed.urlVersion, 3);
  assert.deepEqual(parsed.slices, { coronal: 660, sagittal: 570, horizontal: 400 });
  assert.deepEqual(parsed.cursor, { xUm: -39, yUm: -1200, zUm: -3668 });
});

test('v3 cursor coordinates choose and snap to the nearest atlas planes', () => {
  const parsed = parseViewState('?v=3&cursor=-40,-1211,-3679&slices=1,2,3');
  assert.deepEqual(parsed.cursor, { xUm: -39, yUm: -1210, zUm: -3678 });
  assert.deepEqual(parsed.slices, { coronal: 661, sagittal: 570, horizontal: 401 });
});
