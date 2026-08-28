import assert from 'node:assert/strict';
import test from 'node:test';
import {
  materializeDistributionBinning,
  parseRegionMetadata,
  parseRegionalStatisticsResource,
} from '../../.test-dist/data/regional-data.js';

test('region metadata preserves atlas ids and display labels', () => {
  const regions = parseRegionMetadata([
    { index: 1, atlas_id: 20, acronym: 'R2', name: 'Region 2' },
    { index: 0, atlas_id: 10, acronym: 'R1', name: 'Region 1', depth: 1 },
  ]);
  assert.deepEqual(regions.map((region) => region.id), ['10', '20']);
  assert.equal(regions[0].acronym, 'R1');
  assert.equal(regions[0].depth, 1);
});

test('statistics parser retains global and exact distribution resources', () => {
  const resource = parseRegionalStatisticsResource({
    schema_version: '1.0',
    format: 'ephys-atlas-regional-statistics-v1',
    population: 'fixture observations',
    global: { count: 6, missing_count: 1, min: 0.1, max: 3, mean: 1.5, std: 1, median: 1.5, q05: 0.1, q95: 2.9 },
    regional_summary: {
      fields: ['mean', 'count'],
      values: {
        format: 'raw-binary-array-v1', dtype: 'float64', shape: [2, 2], order: 'C', endianness: 'little',
        resource: { path: 'summary.f64', media_type: 'application/octet-stream', bytes: 32, sha256: '0'.repeat(64), codec: { name: 'none', decoded_bytes: 32 } },
      },
    },
    distribution: {
      binnings: [{
        id: 'linear-full',
        scale: { kind: 'linear' },
        domain: { kind: 'full' },
        edges: [0.1, 1, 10],
        global_counts: [2, 4],
        global_underflow_count: 0,
        global_overflow_count: 0,
        regional_counts: {
          format: 'raw-binary-array-v1', dtype: 'uint32', shape: [2, 4], order: 'C', endianness: 'little',
          resource: { path: 'hist.u32', media_type: 'application/octet-stream', bytes: 32, sha256: '0'.repeat(64), codec: { name: 'none', decoded_bytes: 32 } },
        },
        regional_count_layout: 'underflow-bins-overflow',
        bin_rule: 'left-closed-right-open-last-closed',
      }, {
        id: 'log-full',
        scale: { kind: 'log' },
        domain: { kind: 'full' },
        edges: [0.1, 1, 10],
        global_counts: [3, 3],
        global_underflow_count: 0,
        global_overflow_count: 0,
        regional_counts: {
          format: 'raw-binary-array-v1', dtype: 'uint32', shape: [2, 4], order: 'C', endianness: 'little',
          resource: { path: 'hist.log.u32', media_type: 'application/octet-stream', bytes: 32, sha256: '1'.repeat(64), codec: { name: 'none', decoded_bytes: 32 } },
        },
        regional_count_layout: 'underflow-bins-overflow',
        bin_rule: 'left-closed-right-open-last-closed',
      }],
    },
  });
  assert.equal(resource.population, 'fixture observations');
  assert.equal(resource.global.count, 6);
  assert.deepEqual(resource.distribution.binnings[0].global.binCounts, [2, 4]);
  assert.deepEqual(resource.distribution.binnings[1].edges, [0.1, 1, 10]);
  const binning = materializeDistributionBinning(
    resource.distribution.binnings[0],
    [0, 1, 2, 0, 0, 1, 2, 0],
    2,
  );
  assert.deepEqual(binning.regional, [
    { underflowCount: 0, binCounts: [1, 2], overflowCount: 0 },
    { underflowCount: 0, binCounts: [1, 2], overflowCount: 0 },
  ]);
  assert.equal(binning.scale.kind, 'linear');
});

function emptyStatistics() {
  return {
    schema_version: '1.0',
    format: 'ephys-atlas-regional-statistics-v1',
    population: 'empty fixture',
    global: {
      count: 0, missing_count: 0, min: null, max: null, mean: null, std: null, median: null,
    },
    regional_summary: {
      fields: ['count'],
      values: {
        format: 'raw-binary-array-v1', dtype: 'float64', shape: [1, 1], order: 'C', endianness: 'little',
        resource: { path: 'summary.f64', media_type: 'application/octet-stream', bytes: 8, sha256: '0'.repeat(64), codec: { name: 'none', decoded_bytes: 8 } },
      },
    },
  };
}

test('regional global descriptive statistics follow population nullability exactly', () => {
  assert.doesNotThrow(() => parseRegionalStatisticsResource(emptyStatistics()));
  const emptyWithValue = emptyStatistics();
  emptyWithValue.global.min = 0;
  assert.throws(() => parseRegionalStatisticsResource(emptyWithValue), /empty statistics require null/);

  const nonemptyWithNull = emptyStatistics();
  nonemptyWithNull.global.count = 1;
  nonemptyWithNull.global.min = null;
  nonemptyWithNull.global.max = 1;
  nonemptyWithNull.global.mean = 1;
  nonemptyWithNull.global.std = 0;
  nonemptyWithNull.global.median = 1;
  assert.throws(() => parseRegionalStatisticsResource(nonemptyWithNull), /nonempty statistics require finite/);
});

test('empty regional populations must omit distribution data', () => {
  const invalid = emptyStatistics();
  invalid.distribution = { binnings: [] };
  assert.throws(() => parseRegionalStatisticsResource(invalid), /empty statistics must omit/);
});
