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
    format: 'ephys-atlas-statistics-v0.1',
    population: 'fixture observations',
    global: { count: 6, missing_count: 1, mean: 1.5, q05: 0.1, q95: 2.9 },
    regional_summary: {
      fields: ['mean', 'count'],
      values: { path: 'summary.f64', dtype: 'float64', shape: [2, 2], order: 'C', endianness: 'little' },
    },
    histogram: {
      edges: [0, 1, 2],
      global_counts: [2, 4],
      regional_counts: { path: 'hist.u32', dtype: 'uint32', shape: [2, 2], order: 'C', endianness: 'little' },
      bin_rule: 'test-rule',
    },
  });
  assert.equal(resource.population, 'fixture observations');
  assert.equal(resource.global.count, 6);
  assert.deepEqual(resource.histogram.globalCounts, [2, 4]);
  const histogram = materializeRegionalHistogram(resource.histogram, [1, 2, 1, 2], 2);
  assert.deepEqual(histogram.regionalCounts, [[1, 2], [1, 2]]);
});
