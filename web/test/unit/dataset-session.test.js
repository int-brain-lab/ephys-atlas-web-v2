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
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

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
  const slowFeature = deferred();
  const payload = (featureId) => ({
    schemaVersion: '1.0', featureId, representation: 'regional',
    parcellation: 'beryl', regionIds: [], statistics: {},
  });
  const repository = {
    async loadCatalog() { return { schemaVersion: '1.0', datasets: [] }; },
    async loadManifest() { return testManifest; },
    async loadRegions() { return []; },
    loadFeature(_ref, featureId) {
      return featureId === 'feature_b' ? slowFeature.promise : Promise.resolve(payload(featureId));
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
  slowFeature.resolve(payload('feature_b'));
  await obsoleteLoad;

  assert.equal(session.snapshot().feature.featureId, 'feature_a');
  session.stop();
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
