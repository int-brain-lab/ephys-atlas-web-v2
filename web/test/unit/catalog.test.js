import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDatasetCatalog } from '../../.test-dist/data/validate.js';

test('browser accepts the static catalog emitted by publishing service', () => {
  const catalog = parseDatasetCatalog({
    schema_version: '1.0',
    datasets: [
      {
        dataset_id: 'ephys_atlas_channels',
        title: 'Ephys Atlas channels',
        description: 'Channel summaries',
        releases: [
          {
            release_id: '2026_W12',
            manifest: {
              path: './datasets/ephys_atlas_channels/releases/2026_W12/manifest.json',
              media_type: 'application/json',
              bytes: 10,
              sha256: '0'.repeat(64),
              codec: { name: 'none', decoded_bytes: 10 },
            },
          },
        ],
        default_release: '2026_W12',
      },
    ],
  });

  assert.equal(catalog.schemaVersion, '1.0');
  assert.equal(catalog.datasets[0].id, 'ephys_atlas_channels');
  assert.equal(catalog.datasets[0].defaultRelease, '2026_W12');
  assert.equal(
    catalog.datasets[0].releases[0].manifest,
    './datasets/ephys_atlas_channels/releases/2026_W12/manifest.json',
  );
});

test('catalog rejects duplicate dataset and release identities', () => {
  const release = {
    release_id: '2026_W12',
    manifest: {
      path: './datasets/channels/releases/2026_W12/manifest.json',
      media_type: 'application/json', bytes: 10, sha256: '0'.repeat(64),
      codec: { name: 'none', decoded_bytes: 10 },
    },
  };
  const dataset = {
    dataset_id: 'channels',
    title: 'Channels',
    releases: [release],
    default_release: release.release_id,
  };

  assert.throws(
    () => parseDatasetCatalog({ schema_version: '1.0', datasets: [dataset, dataset] }),
    /dataset ids must not contain duplicates/,
  );
  assert.throws(
    () => parseDatasetCatalog({
      schema_version: '1.0',
      datasets: [{ ...dataset, releases: [release, release] }],
    }),
    /release ids must not contain duplicates/,
  );
});
