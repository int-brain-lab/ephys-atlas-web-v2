import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRegionalFeatureFromResources, loadRegionsFromResources } from '../../.test-dist/data/regional-loader.js';

class FixtureReader {
  constructor(json, arrays) {
    this.json = json;
    this.arrays = arrays;
    this.signals = [];
  }
  resolve(base, relative) { return new URL(relative, `https://fixture.invalid/${base}`).pathname.slice(1); }
  async readJson(path, signal) {
    this.signals.push(signal);
    if (!this.json.has(path)) throw new Error(`missing json ${path}`);
    return this.json.get(path);
  }
  async readArray(path, _descriptor, signal) {
    this.signals.push(signal);
    if (!this.arrays.has(path)) throw new Error(`missing array ${path}`);
    return this.arrays.get(path);
  }
  async readBytes() { throw new Error('unused'); }
}

const resource = (path, bytes) => ({
  path, mediaType: 'application/octet-stream', bytes, sha256: '0'.repeat(64),
  codec: { name: 'none', decodedBytes: bytes },
});
const index = { format: 'raw-binary-array-v1', ...resource('parcellations/beryl/region_ids.i32', 8), dtype: 'int32', shape: [2], order: 'C', endianness: 'little' };
const metadataResource = resource('parcellations/beryl/regions.json', 1);
const parcellation = { id: 'beryl', regionIndex: index, metadata: metadataResource.path, metadataResource };
const valuesDescriptor = { format: 'raw-binary-array-v1', ...resource('beryl.values.f32', 8), dtype: 'float32', shape: [2], order: 'C', endianness: 'little' };
const matrixDescriptor = { format: 'raw-binary-array-v1', ...resource('beryl.summary.f64', 64), dtype: 'float64', shape: [2, 4], order: 'C', endianness: 'little' };
const matrixWireDescriptor = {
  format: 'raw-binary-array-v1', dtype: 'float64', shape: [2, 4], order: 'C', endianness: 'little',
  resource: {
    path: 'beryl.summary.f64', media_type: 'application/octet-stream', bytes: 64,
    sha256: '0'.repeat(64), codec: { name: 'none', decoded_bytes: 64 },
  },
};
const distributionWireDescriptor = {
  format: 'raw-binary-array-v1', dtype: 'uint32', shape: [2, 4], order: 'C', endianness: 'little',
  resource: {
    path: 'beryl.distribution.linear-full.u32', media_type: 'application/octet-stream', bytes: 32,
    sha256: '0'.repeat(64), codec: { name: 'none', decoded_bytes: 32 },
  },
};
const statisticsResource = resource('beryl.statistics.json', 1);
const feature = {
  id: 'example', path: 'features/example/feature.json', label: 'Example', description: '', unit: null,
  valueSemantics: { quantity: 'example', transform: 'identity', sourcePopulation: 'all', missingValues: 'excluded' },
  display: {
    regional: {
      scales: [{ kind: 'linear' }], preferredScale: 'linear',
      distributionDomains: [{ kind: 'full' }], preferredDistributionDomain: 'full',
    },
  },
  statistics: ['mean'],
  representations: { regional: { kind: 'regional', format: 'ephys-atlas-regional-v1', parcellations: {
    beryl: { parcellationId: 'beryl', summary: 'mean', values: valuesDescriptor, statistics: 'beryl.statistics.json', statisticsResource },
  } } },
};

function fixtureReader() {
  return new FixtureReader(
    new Map([
      ['parcellations/beryl/regions.json', [
        { index: 0, atlas_id: -1, acronym: 'A', name: 'Alpha' },
        { index: 1, atlas_id: -2, acronym: 'B', name: 'Beta' },
      ]],
      ['features/example/beryl.statistics.json', {
        schema_version: '1.0',
        format: 'ephys-atlas-regional-statistics-v1',
        population: 'all rows',
        global: { count: 4, missing_count: 0, min: 1, max: 4, mean: 2.5, std: 1, median: 2.5 },
        regional_summary: { fields: ['mean', 'count', 'std', 'q25'], values: matrixWireDescriptor },
        distribution: { binnings: [{
          id: 'linear-full', scale: { kind: 'linear' }, domain: { kind: 'full' },
          edges: [1, 2.5, 4], global_counts: [2, 2],
          global_underflow_count: 0, global_overflow_count: 0,
          regional_counts: distributionWireDescriptor,
          regional_count_layout: 'underflow-bins-overflow',
          bin_rule: 'left-closed-right-open-last-closed',
        }] },
      }],
    ]),
    new Map([
      ['parcellations/beryl/region_ids.i32', [-1, -2]],
      ['features/example/beryl.values.f32', [1.5, 3.5]],
      ['features/example/beryl.summary.f64', [1.5, 2, 0.5, 1.25, 3.5, 2, 0.25, 3.25]],
      ['features/example/beryl.distribution.linear-full.u32', [0, 2, 0, 0, 0, 0, 2, 0]],
    ]),
  );
}

test('resource-independent regional loading validates and materializes regions', async () => {
  const regions = await loadRegionsFromResources(fixtureReader(), 'manifest.json', 'beryl', parcellation);
  assert.deepEqual(regions.map(({ id, acronym }) => ({ id, acronym })), [
    { id: '-1', acronym: 'A' },
    { id: '-2', acronym: 'B' },
  ]);
});

test('resource-independent regional loading materializes every supported display statistic once', async () => {
  const payload = await loadRegionalFeatureFromResources({
    reader: fixtureReader(),
    manifestLocation: 'manifest.json',
    featureLocation: 'features/example/feature.json',
    feature,
    parcellation: 'beryl',
    parcellationDescriptor: parcellation,
  });
  assert.deepEqual(payload.regionIds, ['-1', '-2']);
  assert.deepEqual(payload.statistics.mean, [1.5, 3.5]);
  assert.deepEqual(payload.statistics.count, [2, 2]);
  assert.deepEqual(payload.statistics.std, [0.5, 0.25]);
  assert.deepEqual(payload.statistics.q25, [1.25, 3.25]);
  assert.equal(payload.global.mean, 2.5);
});

test('regional feature loading propagates cancellation to every resource read', async () => {
  const reader = fixtureReader();
  const signal = new AbortController().signal;
  await loadRegionalFeatureFromResources({
    reader,
    manifestLocation: 'manifest.json',
    featureLocation: 'features/example/feature.json',
    feature,
    parcellation: 'beryl',
    parcellationDescriptor: parcellation,
    signal,
  });

  assert.equal(reader.signals.length, 5);
  assert.ok(reader.signals.every((received) => received === signal));
});
