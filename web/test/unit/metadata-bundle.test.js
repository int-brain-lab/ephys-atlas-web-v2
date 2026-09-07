import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { HttpDatasetSource } from '../../.test-dist/data/http-source.js';
import { ResourceFetcher } from '../../.test-dist/data/cache.js';
import { validateLocalDatasetFiles } from '../../.test-dist/data/validation/local-dataset.js';
import { parseMetadataBundle, parseMetadataBundleResource } from '../../.test-dist/data/validation/metadata-bundle.js';

const root = new URL('../../../fixtures/golden-v1/', import.meta.url);
function resource(path, bytes, codec = 'none', decodedBytes = bytes.length) {
  return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    media_type: 'application/json', codec: { name: codec, decoded_bytes: decodedBytes } };
}
function fixture(change = () => {}) {
  const files = new Map();
  function visit(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) visit(new URL(path + '/', root), path + '/');
      else files.set(path, readFileSync(new URL(path, root)));
    }
  }
  visit(root);
  const bundle = { schema_version: '1.0', format: 'ephys-atlas-metadata-bundle-v1',
    resources: [...files].filter(([path]) => path.endsWith('.json') && path !== 'manifest.json')
      .map(([path, bytes]) => ({ path, text: bytes.toString('utf8') })) };
  change(bundle);
  const decoded = Buffer.from(JSON.stringify(bundle)); const compressed = gzipSync(decoded);
  files.set('metadata-bundle.json.gz', compressed);
  const manifest = JSON.parse(files.get('manifest.json'));
  manifest.metadata_bundle = resource('metadata-bundle.json.gz', compressed, 'gzip', decoded.length);
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
  return { files, manifest };
}
function sourceFor(files, manifest) {
  const requested = [];
  const catalog = { schema_version: '1.0', default_project: 'test',
    projects: [{ project_id: 'test', title: 'Synthetic test', dataset_ids: ['golden_fixture'], default_dataset: 'golden_fixture', editions: [] }],
    datasets: [{ dataset_id: 'golden_fixture', title: 'Synthetic fixture', default_release: manifest.release.release_id,
      releases: [{ release_id: manifest.release.release_id, label: 'Test', manifest: resource('manifest.json', files.get('manifest.json')) }] }] };
  const fetcher = new ResourceFetcher(async url => {
    requested.push(new URL(url).pathname);
    if (url.endsWith('/catalog.json')) return new Response(JSON.stringify(catalog));
    const bytes = files.get(new URL(url).pathname.slice(1));
    return new Response(bytes ?? 'missing', { status: bytes ? 200 : 404 });
  });
  return { source: new HttpDatasetSource('https://bundle.test/catalog.json', fetcher), requested,
    ref: { datasetId: 'golden_fixture', releaseId: manifest.release.release_id } };
}

test('bundled HTTP metadata replaces descriptor/index/summary request fanout', async () => {
  const { files, manifest } = fixture(); const { source, ref, requested } = sourceFor(files, manifest);
  const loaded = await source.loadManifest(ref);
  assert.equal(loaded.features.length, manifest.features.length);
  const volume = await source.loadFeature(ref, loaded.features[0].id, 'volume');
  assert.equal(volume.representation, 'volume');
  await source.loadRegions(ref, 'allen');
  const jsonRequests = requested.filter(path => path.endsWith('.json') || path.endsWith('.json.gz'));
  assert.deepEqual(jsonRequests, ['/catalog.json', '/manifest.json', '/metadata-bundle.json.gz']);
  assert.equal(requested.some(path => /volume\/chunks/.test(path)), false);
});

test('local validation preserves full offline graph with an exact-byte metadata bundle', async () => {
  const { files } = fixture();
  const blobs = new Map([...files].map(([path, bytes]) => [path, new Blob([bytes])]));
  const validated = await validateLocalDatasetFiles(blobs);
  assert.ok(validated.declaredPaths.includes('metadata-bundle.json.gz'));
  blobs.delete('features/rms_ap/feature.json');
  await assert.rejects(validateLocalDatasetFiles(blobs), /missing/);
});

test('bundle text must match declared individual bytes in both HTTP and import', async () => {
  const { files, manifest } = fixture(bundle => { bundle.resources[0].text += ' '; });
  const { source, ref } = sourceFor(files, manifest);
  await assert.rejects(source.loadManifest(ref), /Bundled resource byte length mismatch/);
  await assert.rejects(validateLocalDatasetFiles(new Map([...files].map(([p, b]) => [p, new Blob([b])]))), /Bundled resource byte length mismatch/);
});

test('bundle rejects undeclared entries, duplicate paths and invalid bounded descriptors', async () => {
  const { files, manifest } = fixture(bundle => bundle.resources.push({ path: 'undeclared.json', text: '{}' }));
  const { source, ref } = sourceFor(files, manifest);
  await assert.rejects(source.loadManifest(ref), /Undeclared metadata bundle JSON/);
  assert.throws(() => parseMetadataBundle({ schema_version: '1.0', format: 'ephys-atlas-metadata-bundle-v1',
    resources: [{ path: 'a.json', text: '{}' }, { path: 'a.json', text: '{}' }] }), /duplicate/);
  assert.throws(() => parseMetadataBundleResource(resource('b.gz', Buffer.from('{}'))), /bounded gzip/);
  const oversized = resource('b.gz', Buffer.from('{}'), 'gzip', 64 * 1024 * 1024 + 1);
  assert.throws(() => parseMetadataBundleResource(oversized), /bounded gzip/);
});
