import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

test('the current local bundle exposes the production datasets, defaults and project groups', async () => {
  const bundle = JSON.parse(await readFile('../data/development-bundle-v7.json', 'utf8'));
  const site = JSON.parse(await readFile('../data/deployment/initial-site.json', 'utf8'));
  const published = JSON.parse(await readFile(
    `../data/deployment/dependencies/${site.catalog.sha256}.json`, 'utf8',
  ));
  const artifacts = bundle.artifacts.filter((artifact) => artifact.kind === 'release');
  const temporary = await mkdtemp(path.join(tmpdir(), 'atlas-catalog-parity-'));
  try {
    const roots = [];
    for (const artifact of artifacts) {
      const root = path.join(temporary, artifact.identity.dataset_id);
      await mkdir(root);
      // Only the manifest fields used by the development catalog are needed.
      await writeFile(path.join(root, 'manifest.json'), JSON.stringify({
        dataset_id: artifact.identity.dataset_id,
        title: artifact.identity.dataset_id,
        description: 'Test-only catalog manifest',
        release: { immutable: true, release_id: artifact.identity.release_id },
        features: [{ id: 'rms_ap' }],
      }));
      roots.push(root);
    }
    await withEnvironment({
      EPHYS_ATLAS_REAL_RELEASE: roots[0],
      EPHYS_ATLAS_ADDITIONAL_RELEASES: roots.slice(1).join(','),
      EPHYS_ATLAS_REAL_FEATURE: 'rms_ap',
      EPHYS_ATLAS_REMOTE_DATA_ORIGIN: '',
    }, async () => {
      const loaded = await loadConfigFromFile(
        { command: 'serve', mode: 'development' }, path.resolve('vite.config.ts'),
      );
      const plugin = loaded.config.plugins.find((item) => item.name === 'ephys-atlas-real-development-release');
      let middleware;
      plugin.configureServer({ middlewares: { use(handler) { middleware = handler; } } });
      let body;
      await middleware({ url: '/__real-data/catalog.json' }, {
        setHeader() {}, end(value) { body = value; },
      }, () => assert.fail('catalog request must be handled'));
      const local = JSON.parse(body);
      const inventory = (catalog) => catalog.datasets.map((dataset) => [
        dataset.dataset_id, dataset.default_release,
      ]).sort();
      const groups = (catalog) => catalog.projects.map((project) => [
        project.project_id, project.title, project.default_dataset, [...project.dataset_ids].sort(),
      ]).sort();
      assert.deepEqual(inventory(local), inventory(published));
      assert.deepEqual(groups(local), groups(published));
      assert.equal(local.default_project, published.default_project);
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
