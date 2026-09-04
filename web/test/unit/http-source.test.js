import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpDatasetSource } from '../../.test-dist/data/http-source.js';

test('published HTTP loading never substitutes a catalog default for a null release', async () => {
  const catalog = {
    schema_version: '1.0',
    default_project: 'p',
    projects: [{
      project_id: 'p', title: 'Project', dataset_ids: ['d'], default_dataset: 'd', editions: [],
    }],
    datasets: [{
      dataset_id: 'd', title: 'Dataset', default_release: 'r1',
      releases: [{
        release_id: 'r1', label: 'Release one',
        manifest: {
          path: './d/r1/manifest.json', media_type: 'application/json', bytes: 1,
          sha256: '0'.repeat(64), codec: { name: 'none', decoded_bytes: 1 },
        },
      }],
    }],
  };
  let fetches = 0;
  const fetcher = {
    async fetch() {
      fetches += 1;
      return new Response(JSON.stringify(catalog), { status: 200 });
    },
  };
  const source = new HttpDatasetSource('https://atlas.test/catalog.json', fetcher);

  await assert.rejects(
    source.loadManifest({ datasetId: 'd', releaseId: null }),
    /exact release is required/,
  );
  assert.equal(fetches, 1);
});
