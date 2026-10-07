import assert from 'node:assert/strict';
import test from 'node:test';
import { DatasetSession } from '../../.test-dist/application/dataset-session.js';
import { DEFAULT_APP_STATE } from '../../.test-dist/domain/defaults.js';
import { createAppStore } from '../../.test-dist/domain/store.js';

function manifest(id = 'custom_dataset') {
  return {
    schemaVersion: '1.0',
    dataset: { id, release: 'r1', title: id, description: '' },
    release: { releaseId: 'r1', immutable: true, createdAt: '2026-08-21T00:00:00Z', paperSnapshot: false },
    provenance: { sources: [], builder: { name: '', version: '', command: '' }, recipe: { id: 'test' }, notes: [] },
    parcellations: ['beryl'],
    parcellationDescriptors: {},
    features: [{
      id: 'feature_a', path: 'feature.json', label: 'A', description: '', unit: null,
      valueSemantics: { quantity: 'a', transform: 'identity', sourcePopulation: 'all', missingValues: 'excluded' },
      statistics: ['mean'],
      representations: { regional: { kind: 'regional', format: 'ephys-atlas-regional-v1', parcellations: { beryl: {} } } },
    }],
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function catalog(projectId) {
  return { schemaVersion: '1.0', projects: [{ id: projectId }], datasets: [] };
}

test('catalog refreshes keep the newest catalog when requests finish out of order', async () => {
  const first = deferred();
  const store = createAppStore(DEFAULT_APP_STATE);
  const repository = {
    loadCatalog() { return first.promise; },
    async loadManifest() { throw new Error('unused'); },
    async loadRegions() { return []; },
    async loadFeature() { throw new Error('unused'); },
    async prefetchFeature() {},
  };
  const session = new DatasetSession(repository, store, () => {});
  const oldRefresh = session.loadCatalog();
  repository.loadCatalog = async () => catalog('new');
  const newCatalog = await session.loadCatalog();
  first.resolve(catalog('old'));
  const oldCatalog = await oldRefresh;

  assert.equal(oldCatalog.projects[0].id, 'old');
  assert.equal(newCatalog.projects[0].id, 'new');
  assert.equal(session.snapshot().catalog, newCatalog);
  assert.equal(store.getState().runtime.catalogStatus, 'ready');
});

test('a stale catalog failure rejects its caller without replacing newer catalog state', async () => {
  const first = deferred();
  const store = createAppStore(DEFAULT_APP_STATE);
  const repository = {
    loadCatalog() { return first.promise; },
    async loadManifest() { throw new Error('unused'); },
    async loadRegions() { return []; },
    async loadFeature() { throw new Error('unused'); },
    async prefetchFeature() {},
  };
  const session = new DatasetSession(repository, store, () => {});
  const staleRefresh = session.loadCatalog();
  repository.loadCatalog = async () => catalog('current');
  const currentCatalog = await session.loadCatalog();
  first.reject(new Error('old request failed'));

  await assert.rejects(staleRefresh, /old request failed/);
  assert.equal(session.snapshot().catalog, currentCatalog);
  assert.equal(store.getState().runtime.catalogStatus, 'ready');
  assert.equal(store.getState().runtime.catalogError, null);
});

test('stopping a session prevents an in-flight catalog load from publishing', async () => {
  const pending = deferred();
  const store = createAppStore(DEFAULT_APP_STATE);
  const repository = {
    loadCatalog() { return pending.promise; },
    async loadManifest() { throw new Error('unused'); },
    async loadRegions() { return []; },
    async loadFeature() { throw new Error('unused'); },
    async prefetchFeature() {},
  };
  let changes = 0;
  const session = new DatasetSession(repository, store, () => { changes += 1; });
  const load = session.loadCatalog();
  const changesWhileLoading = changes;
  session.stop();
  pending.resolve(catalog('stopped'));

  const result = await load;
  assert.equal(result.projects[0].id, 'stopped');
  assert.equal(session.snapshot().catalog, null);
  assert.equal(changes, changesWhileLoading);
  assert.equal(store.getState().runtime.catalogStatus, 'loading');
});

test('dataset sessions reject unresolved releases before repository loading', async () => {
  let loads = 0;
  const repository = {
    async loadCatalog() { throw new Error('unused'); },
    async loadManifest() { loads += 1; throw new Error('must not load'); },
    async loadRegions() { return []; },
    async loadFeature() { throw new Error('unused'); },
    async prefetchFeature() {},
  };
  const session = new DatasetSession(repository, createAppStore(DEFAULT_APP_STATE), () => {});
  await assert.rejects(
    session.loadDataset({ datasetId: 'custom_dataset', releaseId: null }),
    /exact release is required/,
  );
  assert.equal(loads, 0);
});

test('dataset session owns manifest/feature lifecycle outside the UI', async () => {
  const store = createAppStore({ ...DEFAULT_APP_STATE, view: {
    ...DEFAULT_APP_STATE.view,
    dataset: { datasetId: 'custom_dataset', releaseId: 'r1' },
    featureId: null,
  } });
  const feature = { schemaVersion: '1.0', featureId: 'feature_a', representation: 'regional', parcellation: 'beryl', regionIds: [], statistics: {} };
  const repository = {
    async loadCatalog() { return { schemaVersion: '1.0', datasets: [] }; },
    async loadManifest() { return manifest(); },
    async loadRegions() { return []; },
    async loadFeature() { return feature; },
    async prefetchFeature() {},
  };
  let changes = 0;
  const session = new DatasetSession(repository, store, () => { changes += 1; });
  await session.loadDataset(store.getState().view.dataset);
  assert.equal(session.snapshot().manifest.dataset.id, 'custom_dataset');
  assert.equal(session.snapshot().feature, feature);
  assert.equal(store.getState().view.parcellation, 'beryl');
  assert.ok(changes >= 2);
});

test('stale dataset completions cannot replace the active dataset', async () => {
  const store = createAppStore({ ...DEFAULT_APP_STATE });
  const first = deferred();
  const repository = {
    async loadCatalog() { return { schemaVersion: '1.0', datasets: [] }; },
    loadManifest(ref) { return ref.datasetId === 'slow' ? first.promise : Promise.resolve(manifest('fast')); },
    async loadRegions() { return []; },
    async loadFeature(_ref, featureId) {
      return {
        schemaVersion: '1.0', featureId, representation: 'regional',
        parcellation: 'beryl', regionIds: [], statistics: {},
      };
    },
    async prefetchFeature() {},
  };
  const session = new DatasetSession(repository, store, () => {});
  const slow = session.loadDataset({ datasetId: 'slow', releaseId: 'r1' });
  store.dispatch({
    type: 'navigation/release', navigation: { kind: 'custom', projectId: 'test' },
    dataset: { datasetId: 'fast', releaseId: 'r1' },
  });
  await session.loadDataset({ datasetId: 'fast', releaseId: 'r1' });
  first.resolve(manifest('slow'));
  await slow;
  assert.equal(session.snapshot().manifest.dataset.id, 'fast');
});

test('feature switches clear stale data before loading and ignore obsolete completions', async () => {
  const store = createAppStore({ ...DEFAULT_APP_STATE, view: {
    ...DEFAULT_APP_STATE.view,
    dataset: { datasetId: 'custom_dataset', releaseId: 'r1' },
    featureId: 'feature_a',
  } });
  const testManifest = manifest();
  testManifest.features.push({ ...testManifest.features[0], id: 'feature_b' });
  const slowFeatures = [deferred(), deferred(), deferred()];
  let slowFeatureLoads = 0;
  const featureSignals = [];
  const payload = (featureId) => ({
    schemaVersion: '1.0', featureId, representation: 'regional',
    parcellation: 'beryl', regionIds: [], statistics: {},
  });
  const repository = {
    async loadCatalog() { return { schemaVersion: '1.0', datasets: [] }; },
    async loadManifest() { return testManifest; },
    async loadRegions() { return []; },
    loadFeature(_ref, featureId, _representation, _parcellation, signal) {
      featureSignals.push(signal);
      return featureId === 'feature_b'
        ? slowFeatures[slowFeatureLoads++].promise
        : Promise.resolve(payload(featureId));
    },
    async prefetchFeature() {},
  };
  const session = new DatasetSession(repository, store, () => {});
  await session.loadDataset(store.getState().view.dataset);
  assert.equal(session.snapshot().feature.featureId, 'feature_a');

  store.dispatch({ type: 'feature/set', featureId: 'feature_b' });
  const obsoleteLoad = session.loadCurrentFeature();
  assert.equal(session.snapshot().feature, null);

  store.dispatch({ type: 'feature/set', featureId: 'feature_a' });
  await session.loadCurrentFeature();
  assert.equal(featureSignals[1].aborted, true);
  assert.equal(featureSignals[2].aborted, false);
  slowFeatures[0].resolve(payload('feature_b'));
  await obsoleteLoad;

  assert.equal(session.snapshot().feature.featureId, 'feature_a');
  assert.equal(session.snapshot().featureError, null);
  store.dispatch({ type: 'feature/set', featureId: 'feature_b' });
  const datasetObsoleteLoad = session.loadCurrentFeature();
  store.dispatch({ type: 'feature/set', featureId: 'feature_a' });
  await session.loadDataset(store.getState().view.dataset);
  assert.equal(featureSignals[3].aborted, true);
  assert.equal(featureSignals[4].aborted, false);
  slowFeatures[1].resolve(payload('feature_b'));
  await datasetObsoleteLoad;

  store.dispatch({ type: 'feature/set', featureId: 'feature_b' });
  const stoppedLoad = session.loadCurrentFeature();
  session.stop();
  assert.equal(featureSignals[5].aborted, true);
  slowFeatures[2].resolve(payload('feature_b'));
  await stoppedLoad;
  assert.equal(session.snapshot().feature, null);
  assert.equal(session.snapshot().featureError, null);
});

test('starting a feature load aborts active prefetch from the previous feature', async () => {
  const store = createAppStore({ ...DEFAULT_APP_STATE, view: {
    ...DEFAULT_APP_STATE.view,
    dataset: { datasetId: 'custom_dataset', releaseId: 'r1' },
    featureId: 'feature_a',
  } });
  const testManifest = manifest();
  testManifest.features.push({ ...testManifest.features[0], id: 'feature_b' });
  const feature = {
    schemaVersion: '1.0', featureId: 'feature_a', representation: 'regional',
    parcellation: 'beryl', regionIds: [], statistics: {},
  };
  let activeSignal;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const repository = {
    async loadCatalog() { return { schemaVersion: '1.0', datasets: [] }; },
    async loadManifest() { return testManifest; },
    async loadRegions() { return []; },
    async loadFeature() { return feature; },
    async prefetchFeature(_ref, _featureId, _representation, _parcellation, signal) {
      activeSignal = signal;
      markStarted();
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    },
  };
  const session = new DatasetSession(repository, store, () => {});
  await session.loadDataset(store.getState().view.dataset);
  await started;

  await session.loadCurrentFeature();

  assert.equal(activeSignal.aborted, true);
  session.stop();
});

test('feature loading prefetches the next and previous manifest neighbours', async () => {
  const store = createAppStore({ ...DEFAULT_APP_STATE, view: {
    ...DEFAULT_APP_STATE.view,
    dataset: { datasetId: 'custom_dataset', releaseId: 'r1' },
    featureId: 'feature_b',
  } });
  const testManifest = manifest();
  testManifest.features = ['feature_a', 'feature_b', 'feature_c'].map((id) => ({
    ...testManifest.features[0], id,
  }));
  const prefetched = [];
  let resolvePrefetched;
  const bothPrefetched = new Promise((resolve) => { resolvePrefetched = resolve; });
  const repository = {
    async loadCatalog() { return { schemaVersion: '1.0', datasets: [] }; },
    async loadManifest() { return testManifest; },
    async loadRegions() { return []; },
    async loadFeature(_ref, featureId) {
      return {
        schemaVersion: '1.0', featureId, representation: 'regional',
        parcellation: 'beryl', regionIds: [], statistics: {},
      };
    },
    async prefetchFeature(_ref, featureId) {
      prefetched.push(featureId);
      if (prefetched.length === 2) resolvePrefetched();
    },
  };
  const session = new DatasetSession(repository, store, () => {});

  await session.loadDataset(store.getState().view.dataset);
  await bothPrefetched;

  assert.deepEqual(prefetched, ['feature_c', 'feature_a']);
  session.stop();
});

test('feature Retry clears its own failure and ignores obsolete errors', async () => {
  const store = createAppStore({ ...DEFAULT_APP_STATE, view: {
    ...DEFAULT_APP_STATE.view,
    dataset: { datasetId: 'custom_dataset', releaseId: 'r1' },
    featureId: 'feature_a', parcellation: 'beryl',
  } });
  const feature = { schemaVersion: '1.0', featureId: 'feature_a', representation: 'regional', parcellation: 'beryl', regionIds: [], statistics: {} };
  let calls = 0;
  let rejectStale;
  const repository = {
    async loadManifest() { return manifest(); },
    async loadRegions() { return []; },
    async loadFeature() {
      calls += 1;
      if (calls === 1) throw new Error('first attempt unavailable');
      if (calls === 2) return new Promise((_resolve, reject) => { rejectStale = reject; });
      return feature;
    },
    async prefetchFeature() {},
  };
  const session = new DatasetSession(repository, store, () => {});
  await session.loadDataset(store.getState().view.dataset);
  assert.equal(session.snapshot().featureError, 'first attempt unavailable');
  assert.equal(session.snapshot().datasetError, null);
  const stale = session.loadCurrentFeature();
  assert.equal(session.snapshot().featureError, null);
  assert.equal(store.getState().runtime.datasetStatus, 'ready');
  await session.loadCurrentFeature();
  rejectStale(new Error('obsolete failure'));
  await stale;
  assert.equal(session.snapshot().feature, feature);
  assert.equal(session.snapshot().featureError, null);
  assert.equal(store.getState().runtime.datasetStatus, 'ready');
});
