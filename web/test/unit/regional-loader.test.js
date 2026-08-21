import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRegionalFeatureFromResources, loadRegionsFromResources } from '../../.test-dist/data/regional-loader.js';

class FixtureReader {
  constructor(json, arrays) {
    this.json = json;
    this.arrays = arrays;
  }
  resolve(base, relative) { return new URL(relative, `https://fixture.invalid/${base}`).pathname.slice(1); }
  async readJson(path) {
    if (!this.json.has(path)) throw new Error(`missing json ${path}`);
    return this.json.get(path);
  }
  async readArray(path) {
    if (!this.arrays.has(path)) throw new Error(`missing array ${path}`);
    return this.arrays.get(path);
  }
  async readBytes() { throw new Error('unused'); }
}

const index = { path: 'parcellations/beryl/region_ids.i32', dtype: 'int32', shape: [2], order: 'C', endianness: 'little' };
const parcellation = { id: 'beryl', regionIndex: index, metadata: 'parcellations/beryl/regions.json' };
const valuesDescriptor = { path: 'beryl.values.f32', dtype: 'float32', shape: [2], order: 'C', endianness: 'little' };
const matrixDescriptor = { path: 'beryl.summary.f64', dtype: 'float64', shape: [2, 2], order: 'C', endianness: 'little' };
const feature = {
  id: 'example', path: 'features/example/feature.json', label: 'Example', description: '', unit: null,
  valueSemantics: { quantity: 'example', transform: 'identity', sourcePopulation: 'all', missingValues: 'excluded' },
  statistics: ['mean'],
  representations: { regional: { kind: 'regional', format: 'ephys-atlas-regional-v0.1', parcellations: {
    beryl: { parcellationId: 'beryl', summary: 'mean', values: valuesDescriptor, statistics: 'beryl.statistics.json' },
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
        format: 'ephys-atlas-statistics-v0.1',
        population: 'all rows',
        global: { count: 4, mean: 2.5 },
        regional_summary: { fields: ['mean', 'count'], values: matrixDescriptor },
      }],
    ]),
    new Map([
      ['parcellations/beryl/region_ids.i32', [-1, -2]],
      ['features/example/beryl.values.f32', [1.5, 3.5]],
      ['features/example/beryl.summary.f64', [1.5, 2, 3.5, 2]],
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

test('resource-independent regional loading materializes display statistics once', async () => {
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
  assert.equal(payload.global.mean, 2.5);
});
