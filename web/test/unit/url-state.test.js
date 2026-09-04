import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_VIEW_STATE } from '../../.test-dist/domain/defaults.js';
import {
  parseNavigationRequest,
  parseViewState,
  serializeNavigationRequest,
  serializeViewState,
} from '../../.test-dist/url/url-state.js';
import { resolveDatasetNavigation } from '../../.test-dist/application/dataset-navigation.js';

const navigationCatalog = {
  schemaVersion: '1.0', defaultProject: 'atlas',
  projects: [{ id: 'atlas', title: 'Atlas', datasetIds: ['d'], defaultDataset: 'd', defaultEdition: 'paper', editions: [
    { id: 'paper', label: 'Paper', datasetReleases: new Map([['d', 'r1']]) },
  ] }],
  datasets: [{ id: 'd', source: 'published', projectId: 'atlas', title: 'D', defaultRelease: 'r2', releases: [
    { id: 'r1', label: 'R1', manifest: 'r1.json', immutable: true },
    { id: 'r2', label: 'R2', manifest: 'r2.json', immutable: true },
  ] }],
};

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
  for (const scale of ['linear', 'log', 'symlog']) {
    const parsed = parseViewState(`?v=4&scale=${scale}`);
    assert.equal(parsed.coloring.scale, scale);
    assert.match(serializeViewState(parsed), new RegExp(`scale=${scale}`));
  }
});

test('distribution domain defaults are automatic while explicit choices round-trip', () => {
  assert.equal(parseViewState('?v=4').distribution.domain, 'auto');
  for (const domain of ['full', 'focused']) {
    const parsed = parseViewState(`?v=4&dist=${domain}`);
    assert.equal(parsed.distribution.domain, domain);
    assert.match(serializeViewState(parsed), new RegExp(`dist=${domain}`));
  }
  assert.equal(parseViewState('?v=4&dist=unknown').distribution.domain, 'auto');
});

test('colormap defaults to Auto, preserves registered explicit palettes, and canonicalizes unknown values', () => {
  assert.equal(parseViewState('?v=4').coloring.colormap, 'auto');
  const explicit = parseViewState('?v=4&cmap=cividis');
  assert.equal(explicit.coloring.colormap, 'cividis');
  assert.match(serializeViewState(explicit), /cmap=cividis/);
  const unknown = parseViewState('?v=4&cmap=not-a-palette');
  assert.equal(unknown.coloring.colormap, 'auto');
  assert.equal(serializeViewState(unknown).includes('cmap='), false);
});

test('obsolete independent histogram scale is ignored and removed canonically', () => {
  const parsed = parseViewState('?v=4&histScale=log&scale=linear');
  assert.equal(parsed.coloring.scale, 'linear');
  assert.equal(serializeViewState(parsed).includes('histScale'), false);
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
  assert.equal(
    serializeViewState(developmentDefaults, developmentDefaults),
    'v=4&dataset=ephys_atlas_channels&release=2026_W32&project=ephys-atlas&context=custom',
  );
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

test('standard-deviation coloring round-trips through URL v4', () => {
  const parsed = parseViewState('?v=4&stat=std');
  assert.equal(parsed.coloring.statistic, 'std');
  assert.match(serializeViewState(parsed), /stat=std/);
  assert.deepEqual(parseViewState(`?${serializeViewState(parsed)}`), parsed);
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
  const parsed = parseViewState('?v=4&secondary=swanson&compact=secondary&max=sagittal');
  assert.deepEqual(parsed.workspace, {
    secondaryTab: 'swanson',
    activeCompactView: 'secondary',
    maximizedView: 'sagittal',
  });
  assert.match(serializeViewState(parsed), /secondary=swanson/);
  const invalid = parseViewState('?v=4&secondary=other&compact=top&max=summary');
  assert.deepEqual(invalid.workspace, DEFAULT_VIEW_STATE.workspace);
});

test('optional 3-D context, explode, and validated camera pose round-trip in URL v4', () => {
  const parsed = parseViewState('?v=4&secondary=brain-3d&explode3d=0.375&camera3d=1.23456,-5,3,0,0,0,0,0,2');
  assert.equal(parsed.workspace.secondaryTab, 'brain-3d');
  assert.equal(parsed.scene3d.explode, 0.375);
  assert.deepEqual(parsed.scene3d.camera, {
    positionUm: [1.235, -5, 3], targetUm: [0, 0, 0], up: [0, 0, 1],
  });
  const query = serializeViewState(parsed);
  assert.match(query, /secondary=brain-3d/);
  assert.match(query, /explode3d=0.375/);
  assert.match(query, /camera3d=1.235%2C-5%2C3%2C0%2C0%2C0%2C0%2C0%2C1/);
  assert.deepEqual(parseViewState(`?${query}`), parsed);
});

test('malformed, degenerate, and unbounded 3-D cameras fall back as a whole', () => {
  for (const camera of [
    '1,2,3',
    '1,2,3,0,0,0,0,0,wat',
    '0,0,0,0,0,0,0,0,1',
    '0,-5,3,0,0,0,0,-5,3',
    '10000001,0,0,0,0,0,0,0,1',
  ]) assert.deepEqual(parseViewState(`?v=4&camera3d=${camera}`).scene3d.camera, DEFAULT_VIEW_STATE.scene3d.camera);
  assert.equal(parseViewState('?v=4&explode3d=2').scene3d.explode, 0);
});

test('default workspace opens Top and uses the approved 3-D camera pose without URL noise', () => {
  const parsed = parseViewState('?v=4');
  assert.equal(parsed.workspace.secondaryTab, 'top');
  assert.deepEqual(parsed.scene3d.camera, {
    positionUm: [-12242.494, 12260.928, 10198.21],
    targetUm: [-51.719, -1307.504, -3519.915],
    up: [0.11, -0.091, 0.99],
  });
  assert.equal(serializeViewState(parsed), 'v=4');
});

test('navigation requests preserve explicit context and old exact links are custom', () => {
  assert.deepEqual(parseNavigationRequest('?v=4&dataset=d&release=r2'), {
    context: 'custom', datasetId: 'd', releaseId: 'r2',
  });
  assert.deepEqual(parseNavigationRequest('?v=4&project=atlas&edition=paper&dataset=d'), {
    context: 'edition', projectId: 'atlas', editionId: 'paper', datasetId: 'd',
  });
  assert.deepEqual(parseNavigationRequest('?v=4&context=custom&project=atlas&base_edition=paper&dataset=d&release=r2'), {
    context: 'custom', projectId: 'atlas', baseEditionId: 'paper', datasetId: 'd', releaseId: 'r2',
  });
  assert.deepEqual(parseNavigationRequest('?v=4&context=local&dataset=local&release=imported'), {
    context: 'local', datasetId: 'local', releaseId: 'imported',
  });
  assert.deepEqual(parseNavigationRequest('?v=4&context=local&project=atlas&edition=paper&dataset=local'), {
    context: 'local', projectId: 'atlas', editionId: 'paper', datasetId: 'local',
  });
});

test('resolved navigation serializes exact public edition/custom and local identities', () => {
  const edition = resolveDatasetNavigation(navigationCatalog, 'd', undefined, { kind: 'edition', projectId: 'atlas', editionId: 'paper' });
  assert.equal(serializeNavigationRequest(edition), 'v=4&dataset=d&release=r1&project=atlas&edition=paper');
  const custom = resolveDatasetNavigation(navigationCatalog, 'd', 'r2', { kind: 'custom', projectId: 'atlas', baseEditionId: 'paper' });
  assert.equal(serializeNavigationRequest(custom), 'v=4&dataset=d&release=r2&project=atlas&context=custom&base_edition=paper');
  const local = { context: { kind: 'local' }, dataset: { id: 'local' }, releaseId: 'r1' };
  assert.equal(serializeNavigationRequest(local), 'v=4&dataset=local&release=r1&context=local');
});
