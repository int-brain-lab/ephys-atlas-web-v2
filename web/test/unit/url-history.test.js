import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_APP_STATE } from '../../.test-dist/domain/defaults.js';
import { createAppStore } from '../../.test-dist/domain/store.js';
import { UrlStateController } from '../../.test-dist/url/url-state.js';

const release = (id) => ({ id, label: id, manifest: `${id}.json`, immutable: true });
const catalog = {
  schemaVersion: '1.0', defaultProject: 'ephys-atlas',
  projects: [{
    id: 'ephys-atlas', title: 'Atlas',
    datasetIds: ['ephys_atlas_channels', 'brainwide_map'],
    defaultDataset: 'ephys_atlas_channels', editions: [{
      id: 'paper', label: 'Paper',
      datasetReleases: new Map([['ephys_atlas_channels', 'r1'], ['brainwide_map', 'paper-2026-09']]),
    }],
  }],
  datasets: [
    { id: 'ephys_atlas_channels', source: 'published', projectId: 'ephys-atlas', title: 'Channels', defaultRelease: 'r1', releases: [release('r1'), release('r2')] },
    { id: 'brainwide_map', source: 'published', projectId: 'ephys-atlas', title: 'BWM', defaultRelease: 'paper-2026-09', releases: [release('paper-2026-09')] },
  ],
};

class FakeWindow {
  constructor(href = 'https://atlas.test/') {
    this.origin = new URL(href).origin;
    this.location = { pathname: '/', search: '', hash: '' };
    this.listeners = new Map();
    this.writes = [];
    this.applyUrl(href);
    this.history = {
      pushState: (state, _unused, url) => this.write('push', state, url),
      replaceState: (state, _unused, url) => this.write('replace', state, url),
    };
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  dispatchPopState(url) {
    this.applyUrl(url);
    this.listeners.get('popstate')?.(new Event('popstate'));
  }

  write(mode, state, url) {
    this.writes.push({ mode, state, url: String(url) });
    this.applyUrl(String(url));
  }

  applyUrl(url) {
    const parsed = new URL(url, this.origin);
    this.location.pathname = parsed.pathname;
    this.location.search = parsed.search;
    this.location.hash = parsed.hash;
  }
}

function setup(href) {
  const store = createAppStore(DEFAULT_APP_STATE);
  const win = new FakeWindow(href);
  const controller = new UrlStateController(store, win);
  controller.start(catalog);
  return { store, win, controller };
}

test('user context commits push while scientific refinements replace', async () => {
  const { store, win, controller } = setup('https://atlas.test/');
  assert.deepEqual(win.writes.map(({ mode }) => mode), ['replace']);
  win.writes.length = 0;

  store.dispatch({ type: 'feature/set', featureId: 'rms_ap', history: 'push' });
  assert.deepEqual(win.writes.map(({ mode }) => mode), ['push']);

  store.dispatch({ type: 'color/mode', mode: 'anatomy' });
  store.dispatch({ type: 'color/mode', mode: 'anatomy' });
  assert.deepEqual(win.writes.map(({ mode }) => mode), ['push', 'replace']);

  store.dispatch({ type: 'slice/set', axis: 'coronal', index: 664 });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(win.writes.map(({ mode }) => mode), ['push', 'replace', 'replace']);
  controller.stop();
});

test('derived dataset normalization replaces the user-created checkpoint', () => {
  const { store, win, controller } = setup('https://atlas.test/');
  win.writes.length = 0;

  store.dispatch({
    type: 'navigation/release',
    navigation: { kind: 'custom', projectId: 'ephys-atlas' },
    dataset: { datasetId: 'brainwide_map', releaseId: 'paper-2026-09' },
    history: 'push',
  });
  store.dispatch({
    type: 'context/reconcile',
    featureId: 'wheel_speed',
    representation: 'regional',
    parcellation: 'beryl',
    history: 'replace',
  });

  assert.deepEqual(win.writes.map(({ mode }) => mode), ['push', 'replace']);
  assert.match(win.location.search, /dataset=brainwide_map/);
  assert.match(win.location.search, /feature=wheel_speed/);
  assert.match(win.location.search, /parcel=beryl/);
  controller.stop();
});

test('a context checkpoint first preserves a pending navigation refinement', () => {
  const { store, win, controller } = setup('https://atlas.test/');
  win.writes.length = 0;

  store.dispatch({ type: 'slice/set', axis: 'coronal', index: 664 });
  store.dispatch({ type: 'feature/set', featureId: 'rms_ap', history: 'push' });

  assert.deepEqual(win.writes.map(({ mode }) => mode), ['replace', 'push']);
  assert.match(win.writes[0].url, /cursor=-239%2C-1240%2C-3668/);
  assert.match(win.writes[1].url, /feature=rms_ap/);
  controller.stop();
});

test('unsupported URLs reset canonically and current popstate hydration does not echo', () => {
  const { store, win, controller } = setup('https://atlas.test/?v=2&slices=264,220,160');
  assert.equal(win.writes.length, 1);
  assert.equal(win.writes[0].mode, 'replace');
  assert.equal(win.location.search, '?v=4&dataset=ephys_atlas_channels&release=r1&project=ephys-atlas&context=custom');

  win.writes.length = 0;
  win.dispatchPopState('/?v=4&parcel=beryl');
  assert.equal(store.getState().view.parcellation, 'beryl');
  assert.equal(win.writes.length, 1);
  assert.equal(win.writes[0].mode, 'replace');
  controller.stop();
});

test('invalid exact popstate requests remain visible without replacing resolved state', () => {
  const { store, win, controller } = setup('https://atlas.test/');
  const before = store.getState().view.dataset;
  win.writes.length = 0;

  win.dispatchPopState('/?v=4&project=ephys-atlas&context=custom&dataset=brainwide_map&release=missing');

  assert.deepEqual(store.getState().view.dataset, before);
  assert.equal(store.getState().runtime.navigationStatus, 'error');
  assert.match(store.getState().runtime.navigationError, /Unknown release missing/);
  assert.match(win.location.search, /release=missing/);
  assert.equal(win.writes.length, 0);
  controller.stop();
});

test('an invalid initial URL can explicitly recover and activate history synchronization', () => {
  const store = createAppStore(DEFAULT_APP_STATE);
  const win = new FakeWindow('https://atlas.test/?v=4&project=ephys-atlas&context=custom&dataset=ephys_atlas_channels&release=missing');
  const controller = new UrlStateController(store, win);

  assert.throws(() => controller.start(catalog), /Unknown release missing/);
  assert.equal(store.getState().runtime.navigationStatus, 'error');
  controller.recover({});
  assert.equal(store.getState().runtime.navigationStatus, 'ready');
  assert.equal(store.getState().view.dataset.releaseId, 'r1');
  assert.deepEqual(win.writes.map(({ mode }) => mode), ['push']);

  store.dispatch({ type: 'feature/set', featureId: 'rms_ap', history: 'push' });
  assert.deepEqual(win.writes.map(({ mode }) => mode), ['push', 'push']);
  controller.stop();
});

test('edition mismatch recovery can return to mapping or retain the exact release as custom', () => {
  const { store, win, controller } = setup('https://atlas.test/');
  win.writes.length = 0;
  win.dispatchPopState('/?v=4&project=ephys-atlas&edition=paper&dataset=ephys_atlas_channels&release=r2');
  assert.equal(store.getState().runtime.navigationStatus, 'error');

  controller.recover({ context: 'edition', projectId: 'ephys-atlas', editionId: 'paper', datasetId: 'ephys_atlas_channels' });
  assert.equal(store.getState().view.navigation.kind, 'edition');
  assert.equal(store.getState().view.dataset.releaseId, 'r1');
  assert.equal(win.writes.at(-1).mode, 'push');

  win.dispatchPopState('/?v=4&project=ephys-atlas&edition=paper&dataset=ephys_atlas_channels&release=r2');
  controller.recover({
    context: 'custom', projectId: 'ephys-atlas', baseEditionId: 'paper',
    datasetId: 'ephys_atlas_channels', releaseId: 'r2',
  });
  assert.deepEqual(store.getState().view.navigation, { kind: 'custom', projectId: 'ephys-atlas', baseEditionId: 'paper' });
  assert.equal(store.getState().view.dataset.releaseId, 'r2');
  win.writes.length = 0;
  store.dispatch({ type: 'feature/set', featureId: 'rms_ap', history: 'push' });
  assert.deepEqual(win.writes.map(({ mode }) => mode), ['push']);
  controller.stop();
});

test('workspace refinements replace history and preserve independent dimensions', () => {
  const { store, win, controller } = setup('https://atlas.test/');
  win.writes.length = 0;
  store.dispatch({ type: 'workspace/secondary-tab', tab: 'swanson' });
  store.dispatch({ type: 'workspace/compact-view', view: 'secondary' });
  store.dispatch({ type: 'workspace/maximized-view', view: 'horizontal' });
  assert.deepEqual(win.writes.map(({ mode }) => mode), ['replace', 'replace', 'replace']);
  assert.match(win.location.search, /secondary=swanson/);
  assert.match(win.location.search, /compact=secondary/);
  assert.match(win.location.search, /max=horizontal/);
  controller.stop();
});

test('camera drags debounce replace-history writes while 3-D context remains independent', async () => {
  const { store, win, controller } = setup('https://atlas.test/');
  win.writes.length = 0;
  store.dispatch({ type: 'workspace/secondary-tab', tab: 'brain-3d' });
  store.dispatch({ type: 'scene3d/camera', camera: { positionUm: [0, -5, 3], targetUm: [0, 0, 0], up: [0, 0, 1] } });
  store.dispatch({ type: 'scene3d/camera', camera: { positionUm: [1, -5, 3], targetUm: [0, 0, 0], up: [0, 0, 1] } });
  assert.deepEqual(win.writes.map(({ mode }) => mode), ['replace']);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(win.writes.map(({ mode }) => mode), ['replace', 'replace']);
  assert.match(win.location.search, /secondary=brain-3d/);
  assert.match(win.location.search, /camera3d=/);
  controller.stop();
});
