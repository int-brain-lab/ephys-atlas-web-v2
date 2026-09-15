import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { loadConfigFromFile } from 'vite';

test('remote data origin selects and proxies the deployed catalog', async () => {
  const variable = 'EPHYS_ATLAS_REMOTE_DATA_ORIGIN';
  const previous = process.env[variable];
  process.env[variable] = 'https://atlas.example.test';
  try {
    const loaded = await loadConfigFromFile(
      { command: 'serve', mode: 'development' },
      path.resolve('vite.config.ts'),
    );
    assert.ok(loaded);
    assert.equal(
      loaded.config.define?.['import.meta.env.VITE_DATASET_CATALOG_URL'],
      JSON.stringify('/__remote-data/catalog.json'),
    );
    const proxy = loaded.config.server?.proxy?.['/__remote-data'];
    assert.equal(typeof proxy, 'object');
    assert.equal(proxy.target, 'https://atlas.example.test');
    assert.equal(proxy.changeOrigin, true);
    assert.equal(proxy.rewrite?.('/__remote-data/datasets/example/manifest.json'),
      '/datasets/example/manifest.json');
  } finally {
    if (previous === undefined) delete process.env[variable];
    else process.env[variable] = previous;
  }
});
