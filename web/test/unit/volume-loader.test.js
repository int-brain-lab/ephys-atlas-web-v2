import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadVolumeFeatureFromResources } from '../../.test-dist/data/volume-loader.js';
import { parseFeatureDescriptor, parseDatasetManifestDocument } from '../../.test-dist/data/validate.js';

const fixture = new URL('../../../fixtures/golden-v1/', import.meta.url);

for (const remote of [false, true]) {
  test(`volume materialization preserves ${remote ? 'HTTP' : 'local'} locations, integrity and cancellation`, async () => {
    const base = remote ? 'https://atlas.test/release/' : 'file:///release/';
    const featureLocation = `${base}features/rms_ap/feature.json`;
    const feature = parseFeatureDescriptor(JSON.parse(await readFile(new URL('features/rms_ap/feature.json', fixture), 'utf8')), 'features/rms_ap/feature.json');
    const document = parseDatasetManifestDocument(JSON.parse(await readFile(new URL('manifest.json', fixture), 'utf8')));
    const reads = [];
    const reader = {
      resolve: (location, relative) => new URL(relative, location).href,
      async readJson(location, signal, resource) {
        signal?.throwIfAborted();
        reads.push({ location, signal, resource });
        return JSON.parse(await readFile(new URL(location.slice(base.length), fixture), 'utf8'));
      },
      async readBytes(location, signal, resource) {
        signal?.throwIfAborted();
        reads.push({ location, signal, resource });
        return new ArrayBuffer(4);
      },
    };
    const signal = new AbortController().signal;
    const options = {
      reader, featureLocation, feature, signal,
      parcellationDescriptors: Object.fromEntries(document.parcellations.map(parcel => [parcel.id, parcel])),
      ...(remote ? { baseUrl: featureLocation } : {}),
    };
    const payload = await loadVolumeFeatureFromResources(options);
    assert.equal(payload.featureId, feature.id);
    assert.equal(payload.baseUrl, remote ? featureLocation : undefined);
    assert.equal(reads.length, 2, 'scalar and regional binary resources remain lazy');
    assert.equal(reads[0].location, `${base}features/rms_ap/volume/resource-index.json`);
    assert.equal(reads[1].location, `${base}features/rms_ap/volume/summary.json`);
    assert.equal(reads[0].resource, feature.representations.volume.resourceIndexResource);
    assert.equal(reads[1].resource, feature.representations.volume.summaryResource);
    assert.ok(reads.every(read => read.signal === signal));
    const resourceSignal = new AbortController().signal;
    const resource = { bytes: 4, sha256: '1'.repeat(64) };
    await payload.loadResource('volume/example.bin', resourceSignal, resource);
    assert.deepEqual(reads.at(-1), { location: `${base}features/rms_ap/volume/example.bin`, signal: resourceSignal, resource });
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(loadVolumeFeatureFromResources({ ...options, signal: aborted.signal }), { name: 'AbortError' });
  });
}
