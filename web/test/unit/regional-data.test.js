import assert from 'node:assert/strict';
import test from 'node:test';
import {
  materializeRegionalHistogram,
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

test('statistics parser retains global and histogram resources', () => {
  const resource = parseRegionalStatisticsResource({
    schema_version: '1.0',
    format: 'ephys-atlas-regional-statistics-v1',
    population: 'fixture observations',
    global: { count: 6, missing_count: 1, min: 0, max: 3, mean: 1.5, std: 1, median: 1.5, q05: 0.1, q95: 2.9 },
    regional_summary: {
      fields: ['mean', 'count'],
      values: {
        format: 'raw-binary-array-v1', dtype: 'float64', shape: [2, 2], order: 'C', endianness: 'little',
        resource: { path: 'summary.f64', media_type: 'application/octet-stream', bytes: 32, sha256: '0'.repeat(64), codec: { name: 'none', decoded_bytes: 32 } },
      },
    },
    histogram: {
      axis_scale: 'linear',
      default_axis_scale: 'log',
      edges: [0, 1, 2],
      global_counts: [2, 4],
      regional_counts: {
        format: 'raw-binary-array-v1', dtype: 'uint32', shape: [2, 2], order: 'C', endianness: 'little',
        resource: { path: 'hist.u32', media_type: 'application/octet-stream', bytes: 16, sha256: '0'.repeat(64), codec: { name: 'none', decoded_bytes: 16 } },
      },
      bin_rule: 'left-closed-right-open-last-closed',
      variants: {
        log: {
          edges: [0.1, 1, 10],
          global_counts: [3, 3],
          regional_counts: {
            format: 'raw-binary-array-v1', dtype: 'uint32', shape: [2, 2], order: 'C', endianness: 'little',
            resource: { path: 'hist.log.u32', media_type: 'application/octet-stream', bytes: 16, sha256: '1'.repeat(64), codec: { name: 'none', decoded_bytes: 16 } },
          },
          bin_rule: 'left-closed-right-open-last-closed',
        },
      },
    },
  });
  assert.equal(resource.population, 'fixture observations');
  assert.equal(resource.global.count, 6);
  assert.deepEqual(resource.histogram.globalCounts, [2, 4]);
  assert.equal(resource.histogram.defaultAxisScale, 'log');
  assert.deepEqual(resource.histogram.variants.log.edges, [0.1, 1, 10]);
  const histogram = materializeRegionalHistogram(resource.histogram, [1, 2, 1, 2], 2);
  assert.deepEqual(histogram.regionalCounts, [[1, 2], [1, 2]]);
  assert.equal(histogram.axisScale, 'linear');
});
