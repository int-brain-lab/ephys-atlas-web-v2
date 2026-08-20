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
    cursor: { xUm: 120, yUm: -30, zUm: 900 },
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
  assert.match(query, /v=1/);
  assert.match(query, /dataset=brainwide_map/);
  assert.match(query, /feature=wheel_speed/);
  assert.match(query, /colors=anatomy/);
  assert.deepEqual(parseViewState(`?${query}`), view);
});

test('unknown URL version falls back to defaults', () => {
  assert.deepEqual(parseViewState('?v=999&dataset=local&feature=nope'), DEFAULT_VIEW_STATE);
});

test('malformed fixed range is ignored', () => {
  const parsed = parseViewState('?v=1&range=3,2');
  assert.deepEqual(parsed.coloring.range, DEFAULT_VIEW_STATE.coloring.range);
});

test('a hand-edited dataset without release defers to that dataset default release', () => {
  const parsed = parseViewState('?v=1&dataset=brainwide_map');
  assert.equal(parsed.dataset.datasetId, 'brainwide_map');
  assert.equal(parsed.dataset.releaseId, null);
});
