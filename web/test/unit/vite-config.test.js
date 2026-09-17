import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { loadConfigFromFile } from 'vite';

async function withEnvironment(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('remote data origin selects and proxies the deployed catalog', async () => {
  await withEnvironment({ EPHYS_ATLAS_REMOTE_DATA_ORIGIN: 'https://atlas.example.test' }, async () => {
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
  });
});

test('remote catalog proxy coexists with a configured local release context', async () => {
  await withEnvironment({
    EPHYS_ATLAS_REMOTE_DATA_ORIGIN: 'https://atlas.example.test',
    EPHYS_ATLAS_REAL_RELEASE: path.resolve('../fixtures/golden-v1'),
    EPHYS_ATLAS_REAL_FEATURE: 'rms_ap',
    EPHYS_ATLAS_REAL_REPRESENTATION: 'regional',
  }, async () => {
    const loaded = await loadConfigFromFile(
      { command: 'serve', mode: 'development' },
      path.resolve('vite.config.ts'),
    );
    assert.ok(loaded);
    assert.equal(loaded.config.define?.['import.meta.env.VITE_DATASET_CATALOG_URL'],
      JSON.stringify('/__remote-data/catalog.json'));
    assert.equal(loaded.config.define?.['import.meta.env.VITE_DEFAULT_PROJECT_ID'],
      JSON.stringify('synthetic-development'));
    assert.equal(loaded.config.define?.['import.meta.env.VITE_DEFAULT_DATASET_ID'],
      JSON.stringify('golden_fixture'));
    assert.equal(loaded.config.define?.['import.meta.env.VITE_DEFAULT_REPRESENTATION'],
      JSON.stringify('regional'));
    assert.ok(loaded.config.server?.proxy?.['/__remote-data']);
  });
});
