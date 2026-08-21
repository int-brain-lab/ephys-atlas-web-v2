import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRegionalValueMap,
  regionMatchesQuery,
  selectedHistogramCounts,
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

test('regional histogram selection sums rows deterministically', () => {
  assert.deepEqual(selectedHistogramCounts(feature, new Set(['1', '2'])), [3, 7]);
});
