import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDatasetCatalog } from '../../.test-dist/data/validate.js';

test('browser accepts the static catalog emitted by publishing service', () => {
  const catalog = parseDatasetCatalog({
    schemaVersion: '0.1',
    datasets: [
      {
        id: 'ephys_atlas_channels',
        title: 'Ephys Atlas channels',
        description: 'Channel summaries',
        releases: [
          {
            id: '2026_W12',
            label: '2026_W12',
            manifest: './datasets/ephys_atlas_channels/releases/2026_W12/manifest.json',
            immutable: true,
          },
        ],
        defaultRelease: '2026_W12',
      },
    ],
  });

  assert.equal(catalog.schemaVersion, '0.1');
  assert.equal(catalog.datasets[0].id, 'ephys_atlas_channels');
  assert.equal(catalog.datasets[0].defaultRelease, '2026_W12');
  assert.equal(
    catalog.datasets[0].releases[0].manifest,
    './datasets/ephys_atlas_channels/releases/2026_W12/manifest.json',
  );
});
