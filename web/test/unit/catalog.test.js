import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDatasetCatalog } from '../../.test-dist/data/validate.js';

function release(id = '2026_W12') {
  return {
    release_id: id,
    label: `Development ${id}`,
    status: 'development',
    manifest: {
      path: `./datasets/channels/releases/${id}/manifest.json`,
      media_type: 'application/json', bytes: 10, sha256: '0'.repeat(64),
      codec: { name: 'none', decoded_bytes: 10 },
    },
  };
}

function catalogDocument() {
  return {
    schema_version: '1.0',
    default_project: 'ephys-atlas',
    projects: [{
      project_id: 'ephys-atlas', title: 'Ephys Atlas', dataset_ids: ['channels'],
      default_dataset: 'channels', default_edition: 'synthetic-edition',
      editions: [{
        edition_id: 'synthetic-edition', label: 'Synthetic edition',
        dataset_releases: [{ dataset_id: 'channels', release_id: '2026_W12' }],
      }],
    }],
    datasets: [{
      dataset_id: 'channels', title: 'Ephys Atlas channels', description: 'Channel summaries',
      releases: [release()], default_release: '2026_W12',
    }],
  };
}

test('browser accepts the curator-owned project and edition catalog', () => {
  const catalog = parseDatasetCatalog(catalogDocument());

  assert.equal(catalog.schemaVersion, '1.0');
  assert.equal(catalog.defaultProject, 'ephys-atlas');
  assert.equal(catalog.projects[0].defaultEdition, 'synthetic-edition');
  assert.equal(catalog.projects[0].editions[0].datasetReleases.get('channels'), '2026_W12');
  assert.equal(catalog.datasets[0].source, 'published');
  assert.equal(catalog.datasets[0].projectId, 'ephys-atlas');
  assert.equal(catalog.datasets[0].defaultRelease, '2026_W12');
  assert.equal(catalog.datasets[0].releases[0].label, 'Development 2026_W12');
  assert.equal(catalog.datasets[0].releases[0].status, 'development');
  assert.equal(catalog.datasets[0].releases[0].manifest, './datasets/channels/releases/2026_W12/manifest.json');
});

test('catalog rejects duplicate dataset and release identities', () => {
  const document = catalogDocument();
  assert.throws(
    () => parseDatasetCatalog({ ...document, datasets: [document.datasets[0], document.datasets[0]] }),
    /dataset ids must not contain duplicates/,
  );
  assert.throws(
    () => parseDatasetCatalog({ ...document, datasets: [{ ...document.datasets[0], releases: [release(), release()] }] }),
    /release ids must not contain duplicates/,
  );
});

test('catalog rejects invalid project membership, defaults, and edition mappings', () => {
  const document = catalogDocument();
  assert.throws(() => parseDatasetCatalog({ ...document, default_project: 'missing' }), /default_project is missing/);
  assert.throws(() => parseDatasetCatalog({ ...document, projects: [] }), /must not be empty/);
  assert.throws(
    () => parseDatasetCatalog({ ...document, projects: [{ ...document.projects[0], default_dataset: 'missing' }] }),
    /default_dataset is outside/,
  );
  assert.throws(
    () => parseDatasetCatalog({
      ...document,
      projects: [{
        ...document.projects[0],
        editions: [{
          ...document.projects[0].editions[0],
          dataset_releases: [{ dataset_id: 'channels', release_id: 'missing' }],
        }],
      }],
    }),
    /unknown release/,
  );
});

test('catalog rejects reserved local identity and release presentation ambiguity', () => {
  const document = catalogDocument();
  assert.throws(
    () => parseDatasetCatalog({
      ...document,
      projects: [{
        ...document.projects[0], dataset_ids: ['local'], default_dataset: 'local',
        editions: [], default_edition: undefined,
      }],
      datasets: [{ ...document.datasets[0], dataset_id: 'local' }],
    }),
    /reserved/,
  );
  assert.throws(
    () => parseDatasetCatalog({
      ...document,
      datasets: [{ ...document.datasets[0], releases: [{ ...release(), label: '2026_W12' }] }],
    }),
    /label must differ/,
  );
});
