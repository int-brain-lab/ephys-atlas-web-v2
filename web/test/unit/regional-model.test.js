import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRegionalValueMap,
  histogramDistribution,
  rankRegionsByValue,
  regionMatchesQuery,
  selectedHistogramCounts,
  selectedRegionHistogramDistributions,
  regionalStatisticExtent,
  regionalStatisticPosition,
} from '../../.test-dist/ui/regional/model.js';

const feature = {
  representation: 'regional',
  featureId: 'rms',
  parcellation: 'allen',
  regionIds: ['1', '2'],
  values: [10, 20],
  statistics: { mean: [10, 20], median: [11, 21], std: [1, 2] },
  distribution: { binnings: [{
    id: 'linear-full', scale: { kind: 'linear' }, domain: { kind: 'full' }, edges: [0, 1, 2],
    global: { binCounts: [3, 7], underflowCount: 0, overflowCount: 0 },
    regional: [
      { binCounts: [1, 2], underflowCount: 0, overflowCount: 0 },
      { binCounts: [2, 5], underflowCount: 0, overflowCount: 0 },
    ],
    binRule: 'left-closed-right-open-last-closed',
  }] },
};

test('regional model chooses statistic and indexes values by region', () => {
  assert.deepEqual([...buildRegionalValueMap(feature, 'median')], [['1', 11], ['2', 21]]);
  assert.deepEqual([...buildRegionalValueMap(feature, 'std')], [['1', 1], ['2', 2]]);
});

test('regional statistic extent and dot position use finite active-parcellation values', () => {
  const extent = regionalStatisticExtent(new Map([
    ['negative', -4], ['positive', 6], ['missing', Number.NaN], ['infinite', Infinity],
  ]));
  assert.deepEqual(extent, [-4, 6]);
  assert.equal(regionalStatisticPosition(-4, extent), 0);
  assert.equal(regionalStatisticPosition(1, extent), 0.5);
  assert.equal(regionalStatisticPosition(6, extent), 1);
  assert.equal(regionalStatisticPosition(Number.NaN, extent), null);
  assert.equal(regionalStatisticPosition(12, extent), 1);
});

test('regional statistic dots center for degenerate and empty domains', () => {
  assert.equal(regionalStatisticPosition(3, [3, 3]), 0.5);
  assert.equal(regionalStatisticExtent(new Map([['missing', Number.NaN]])), null);
  assert.equal(regionalStatisticPosition(3, null), null);
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
    underflowCount: 0, overflowCount: 0, underflowProbability: 0, overflowProbability: 0,
  });
  assert.deepEqual(histogramDistribution([0, Number.NaN, -1]), {
    counts: [0, Number.NaN, -1],
    probabilities: [0, 0, 0],
    total: 0,
    underflowCount: 0, overflowCount: 0, underflowProbability: 0, overflowProbability: 0,
  });
  assert.deepEqual(histogramDistribution({ binCounts: [1, 2], underflowCount: 3, overflowCount: 4 }), {
    counts: [1, 2], probabilities: [0.1, 0.2], total: 10,
    underflowCount: 3, overflowCount: 4, underflowProbability: 0.3, overflowProbability: 0.4,
  });
});

test('selected regional distributions retain separate normalized shapes and sample sizes', () => {
  const unequal = {
    ...feature,
    distribution: { binnings: [{ ...feature.distribution.binnings[0],
      global: { binCounts: [1000, 1000], underflowCount: 0, overflowCount: 0 },
      regional: [
        { binCounts: [1, 3], underflowCount: 0, overflowCount: 0 },
        { binCounts: [30, 10], underflowCount: 0, overflowCount: 0 },
      ],
    }] },
  };
  assert.deepEqual(selectedRegionHistogramDistributions(unequal, new Set(['1', '2'])), [
    { regionId: '1', counts: [1, 3], probabilities: [0.25, 0.75], total: 4, underflowCount: 0, overflowCount: 0, underflowProbability: 0, overflowProbability: 0 },
    { regionId: '2', counts: [30, 10], probabilities: [0.75, 0.25], total: 40, underflowCount: 0, overflowCount: 0, underflowProbability: 0, overflowProbability: 0 },
  ]);
});
