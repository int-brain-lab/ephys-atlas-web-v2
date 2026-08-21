import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRegionalValueMap,
  histogramDistribution,
  rankRegionsByValue,
  regionMatchesQuery,
  selectedHistogramCounts,
  selectedRegionHistogramDistributions,
} from '../../.test-dist/ui/regional/model.js';

const feature = {
  representation: 'regional',
  featureId: 'rms',
  parcellation: 'allen',
  regionIds: ['1', '2'],
  values: [10, 20],
  statistics: { mean: [10, 20], median: [11, 21] },
  histogram: {
    edges: [0, 1, 2],
    globalCounts: [3, 7],
    regionalCounts: [[1, 2], [2, 5]],
  },
};

test('regional model chooses statistic and indexes values by region', () => {
  assert.deepEqual([...buildRegionalValueMap(feature, 'median')], [['1', 11], ['2', 21]]);
});

test('regional search is case insensitive across acronym and name', () => {
  const region = { id: '1', atlasId: 1, acronym: 'VISp', name: 'Primary visual area' };
  assert.equal(regionMatchesQuery(region, 'visp'), true);
  assert.equal(regionMatchesQuery(region, 'VISUAL'), true);
  assert.equal(regionMatchesQuery(region, 'motor'), false);
});

test('value ranking is global, deterministic, selectable-only, and missing-last', () => {
  const regions = [
    { id: 'parent', atlasId: 10, acronym: 'P', name: 'Parent', mappingMember: false },
    { id: 'missing', atlasId: 11, acronym: 'M', name: 'Missing' },
    { id: 'low', atlasId: 12, acronym: 'L', name: 'Low' },
    { id: 'high-a', atlasId: 13, acronym: 'HA', name: 'High A' },
    { id: 'high-b', atlasId: 14, acronym: 'HB', name: 'High B' },
  ];
  const values = new Map([['low', -2], ['high-a', 5], ['high-b', 5], ['missing', Number.NaN]]);
  assert.deepEqual(rankRegionsByValue(regions, values, 'value-asc').map(({ id }) => id), [
    'low', 'high-a', 'high-b', 'missing',
  ]);
  assert.deepEqual(rankRegionsByValue(regions, values, 'value-desc').map(({ id }) => id), [
    'high-a', 'high-b', 'low', 'missing',
  ]);
});

test('regional histogram selection sums rows deterministically', () => {
  assert.deepEqual(selectedHistogramCounts(feature, new Set(['1', '2'])), [3, 7]);
});

test('histograms normalize by their own population rather than the global peak', () => {
  assert.deepEqual(histogramDistribution([10, 30]), {
    counts: [10, 30],
    probabilities: [0.25, 0.75],
    total: 40,
  });
  assert.deepEqual(histogramDistribution([0, Number.NaN, -1]), {
    counts: [0, Number.NaN, -1],
    probabilities: [0, 0, 0],
    total: 0,
  });
});

test('selected regional distributions retain separate normalized shapes and sample sizes', () => {
  const unequal = {
    ...feature,
    histogram: {
      ...feature.histogram,
      globalCounts: [1000, 1000],
      regionalCounts: [[1, 3], [30, 10]],
    },
  };
  assert.deepEqual(selectedRegionHistogramDistributions(unequal, new Set(['1', '2'])), [
    { regionId: '1', counts: [1, 3], probabilities: [0.25, 0.75], total: 4 },
    { regionId: '2', counts: [30, 10], probabilities: [0.75, 0.25], total: 40 },
  ]);
});
