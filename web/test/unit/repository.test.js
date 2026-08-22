import assert from 'node:assert/strict';
import test from 'node:test';
import { DatasetRepository } from '../../.test-dist/data/repository.js';

function source(kind, datasetId) {
  return {
    kind,
    async loadCatalog() {
      return {
        schemaVersion: '1.0',
        datasets: [{ id: datasetId, title: datasetId, defaultRelease: 'r1', releases: [{ id: 'r1', label: 'r1', manifest: 'manifest.json', immutable: true }] }],
      };
    },
    async loadManifest(ref) {
      return {
        schemaVersion: '1.0',
        dataset: { id: ref.datasetId, release: ref.releaseId, title: ref.datasetId },
        parcellations: ['allen'],
        parcellationDescriptors: {},
        features: [],
      };
    },
    async loadFeature() {
      return { schemaVersion: '1.0', featureId: 'x', representation: 'regional', parcellation: 'allen', regionIds: [], statistics: {} };
    },
  };
}

test('repository merges published and local catalogs and routes local refs', async () => {
  const published = source('published', 'ephys_atlas_channels');
  const local = source('local', 'local');
  const repository = new DatasetRepository(published, local);
  const catalog = await repository.loadCatalog();
  assert.deepEqual(catalog.datasets.map((item) => item.id), ['ephys_atlas_channels', 'local']);
  const manifest = await repository.loadManifest({ datasetId: 'local', releaseId: 'r1' });
  assert.equal(manifest.dataset.id, 'local');
});

test('repository propagates cancellation to source prefetch', async () => {
  const published = source('published', 'ephys_atlas_channels');
  const local = source('local', 'local');
  let receivedSignal;
  published.prefetchFeature = async (_ref, _featureId, _representation, _parcellation, signal) => {
    receivedSignal = signal;
  };
  const repository = new DatasetRepository(published, local);
  const controller = new AbortController();

  await repository.prefetchFeature(
    { datasetId: 'ephys_atlas_channels', releaseId: 'r1' },
    'feature_a',
    'regional',
    'allen',
    controller.signal,
  );

  assert.equal(receivedSignal, controller.signal);
});
