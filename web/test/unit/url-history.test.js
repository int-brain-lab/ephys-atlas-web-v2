import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_APP_STATE } from '../../.test-dist/domain/defaults.js';
import { createAppStore } from '../../.test-dist/domain/store.js';
import { UrlStateController } from '../../.test-dist/url/url-state.js';

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
  controller.start();
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
    type: 'dataset/set',
    dataset: { datasetId: 'brainwide_map', releaseId: 'paper-2026-09' },
    history: 'push',
  });
  store.dispatch({
    type: 'feature/set',
    featureId: 'wheel_speed',
    representation: 'regional',
    history: 'replace',
  });

  assert.deepEqual(win.writes.map(({ mode }) => mode), ['push', 'replace']);
  assert.match(win.location.search, /dataset=brainwide_map/);
  assert.match(win.location.search, /feature=wheel_speed/);
  controller.stop();
});

test('a context checkpoint first preserves a pending navigation refinement', () => {
  const { store, win, controller } = setup('https://atlas.test/');
  win.writes.length = 0;

  store.dispatch({ type: 'slice/set', axis: 'coronal', index: 664 });
  store.dispatch({ type: 'feature/set', featureId: 'rms_ap', history: 'push' });

  assert.deepEqual(win.writes.map(({ mode }) => mode), ['replace', 'push']);
  assert.match(win.writes[0].url, /slices=664%2C550%2C400/);
  assert.match(win.writes[1].url, /feature=rms_ap/);
  controller.stop();
});

test('legacy URLs canonicalize by replacement and popstate hydration does not echo', () => {
  const { store, win, controller } = setup('https://atlas.test/?v=2&slices=264,220,160');
  assert.equal(win.writes.length, 1);
  assert.equal(win.writes[0].mode, 'replace');
  assert.match(win.location.search, /v=3/);

  win.writes.length = 0;
  win.dispatchPopState('/?v=3&parcel=beryl');
  assert.equal(store.getState().view.parcellation, 'beryl');
  assert.equal(win.writes.length, 0);
  controller.stop();
});
