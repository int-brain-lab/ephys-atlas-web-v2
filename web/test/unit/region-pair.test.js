import assert from 'node:assert/strict';
import test from 'node:test';
import { featureGroup, pairPoints, populationMoments } from '../../.test-dist/ui/regional/pair-view.js';
import {
  expandRegionalPayload, histogramQuantile, poolRows, populationSd, regionAggregation, sampleSd,
} from '../../.test-dist/data/region-aggregate.js';
import { buildSelectedComparisonExport } from '../../.test-dist/ui/regional/comparison-export.js';
import { buildRegionTooltipModel } from '../../.test-dist/ui/regional/model.js';

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

/** Release-style summary of raw observations: count, mean and population SD (ddof=0). */
const summarize = (values) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { n: values.length, mean, std: Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) };
};

/** Regional payload whose rows summarize the given observation groups. */
const payloadOf = (groups, featureId = 'f') => {
  const rows = Object.values(groups).map(summarize);
  return { featureId, representation: 'regional', parcellation: 'allen', regionIds: Object.keys(groups),
    statistics: { mean: rows.map((r) => r.mean), std: rows.map((r) => r.std), count: rows.map((r) => r.n) } };
};

test('poolRows matches directly pooled observations given population SDs', () => {
  const cases = [
    [[0, 2], [4, 6, 8]], // reviewer example: combined population SD sqrt(8) ≈ 2.828
    [[1], [2, 2, 9, 4], [7]], // unequal counts and singleton groups
    [[1e8, 1e8 + 1], [1e8 + 2, 1e8 + 3, 1e8 + 4]], // large common offset
  ];
  for (const groups of cases) {
    const rows = groups.map(summarize);
    const pooled = poolRows(rows.map((r) => r.mean), rows.map((r) => r.std), rows.map((r) => r.n), rows.map((_, k) => k));
    const direct = summarize(groups.flat());
    assert.equal(pooled.n, direct.n);
    close(pooled.mean, direct.mean, 1e-7);
    close(populationSd(pooled), direct.std, 1e-7);
    close(sampleSd(pooled), direct.std * Math.sqrt(direct.n / (direct.n - 1)), 1e-7);
  }
  const [a, b] = [summarize([0, 2]), summarize([4, 6, 8])];
  close(populationSd(poolRows([a.mean, b.mean], [a.std, b.std], [2, 3], [0, 1])), Math.sqrt(8));
});

test('parent means do not require SD; missing variance stays unavailable', () => {
  const pooled = poolRows([2], undefined, [3], [0]);
  assert.equal(pooled.n, 3);
  assert.equal(pooled.mean, 2);
  assert.ok(Number.isNaN(populationSd(pooled)));
  const expanded = expandRegionalPayload(
    { featureId: 'f', regionIds: ['c'], statistics: { mean: [2], count: [3] } },
    [{ id: 'p', parentId: null }, { id: 'c', parentId: 'p' }],
  );
  assert.deepEqual(expanded.regionIds, ['c', 'p']);
  assert.equal(expanded.statistics.count[1], 3);
  assert.equal(expanded.statistics.mean[1], 2);
  assert.equal(expanded.statistics.std, undefined);
});

test('pairPoints z-scores both axes against the full population and ranks by |Cohen d|', () => {
  const feature = (featureId, mean) => ({
    featureId, regionIds: ['a', 'b', 'c'],
    statistics: { mean, std: [1, 1, 1], count: [4, 4, 4] },
    global: { count: 12, mean: 0, std: 2 },
  });
  const [first, second] = pairPoints([feature('small', [0, 0.1, 0.2]), feature('large', [-1, 1, 0])], 'a', 'b');
  assert.equal(first.featureId, 'large');
  assert.equal(first.z1, -0.5);
  assert.equal(first.z2, 0.5);
  // pooled within-region sample SD: sqrt((4·1 + 4·1) / 6)
  close(first.d, 2 / Math.sqrt(8 / 6));
  close(first.sem1, Math.sqrt(4 / 3) / 2 / 2);
  close(second.d, 0.1 / Math.sqrt(8 / 6));
});

test('populationMoments falls back to pooling the release rows without global statistics', () => {
  const payload = payloadOf({ a: [0, 2], b: [4, 6, 8] });
  const moments = populationMoments(payload);
  assert.equal(moments.mean, 4);
  close(populationSd(moments), Math.sqrt(8));
  const [point] = pairPoints([payload], 'a', 'b');
  close(point.z1, (1 - 4) / Math.sqrt(8));
  close(point.z2, (6 - 4) / Math.sqrt(8));
});

test('pairPoints defines zero within-region variance explicitly', () => {
  const global = { count: 100, mean: 0, std: 1 };
  const payload = (featureId, groups) => ({ ...payloadOf(groups, featureId), global });
  const points = pairPoints([
    payload('equal', { a: [1, 1], b: [1, 1, 1] }),
    payload('unequal', { a: [1, 1], b: [3, 3, 3] }),
    payload('mixed', { a: [1, 1], b: [2, 3, 4] }),
  ], 'a', 'b');
  const byId = Object.fromEntries(points.map((p) => [p.featureId, p.d]));
  assert.equal(byId.equal, 0);
  assert.ok(Number.isNaN(byId.unequal), 'different constant groups have an undefined standardized effect');
  close(byId.mixed, 2 / Math.sqrt(2 / 3)); // pooled sample SD sqrt((0 + 2) / 3)
  assert.equal(points.at(-1).featureId, 'unequal', 'undefined effects rank after every finite effect');
});

test('expandRegionalPayload appends exact parent rows and summed histograms', () => {
  // children c1 = {0, 2}, c2 = {4, 6, 8}: pooled n=5, mean 4, population SD sqrt(8)
  const counts = (binCounts) => ({ binCounts, underflowCount: 0, overflowCount: 0 });
  const payload = {
    featureId: 'f', regionIds: ['c1', 'c2', 'x'],
    statistics: { mean: [1, 6, 0], std: [1, Math.sqrt(8 / 3), 1], count: [2, 3, 4], min: [0, 4, -1], median: [1, 6, 0] },
    distribution: { binnings: [{ scale: { kind: 'linear' }, domain: { kind: 'full' }, edges: [0, 5, 10],
      regional: [counts([2, 0]), counts([1, 2]), counts([4, 0])] }] },
  };
  const regions = [{ id: 'p', parentId: null }, { id: 'c1', parentId: 'p' }, { id: 'c2', parentId: 'p' },
    { id: 'x', parentId: null }, { id: 'empty', parentId: null }];
  const expanded = expandRegionalPayload(payload, regions);
  assert.deepEqual(expanded.regionIds, ['c1', 'c2', 'x', 'p']);
  assert.equal(expanded.statistics.count[3], 5);
  assert.equal(expanded.statistics.mean[3], 4);
  close(expanded.statistics.std[3], Math.sqrt(8));
  assert.equal(expanded.statistics.min[3], 0);
  assert.deepEqual(expanded.distribution.binnings[0].regional[3].binCounts, [3, 2]);
  assert.equal(expanded.statistics.median[3], histogramQuantile([0, 5, 10], counts([3, 2]), 0.5));
  const [point] = pairPoints([expanded], 'p', 'x', [payload]);
  close(point.d, (0 - 4) / Math.sqrt((5 * 8 + 4 * 1) / 7));
});

test('a parent row becomes the union of itself and its descendants; its own channels stay as <id>:own', () => {
  // parent p owns {10}, child c owns {0, 2}: union {0, 2, 10}, n=3, mean 4
  const payload = { featureId: 'f', regionIds: ['p', 'c'], statistics: { mean: [10, 1], std: [0, 1], count: [1, 2] } };
  const expanded = expandRegionalPayload(payload, [{ id: 'p', parentId: null }, { id: 'c', parentId: 'p' }]);
  assert.deepEqual(expanded.regionIds, ['p', 'c', 'p:own']);
  assert.equal(expanded.statistics.count[0], 3);
  assert.equal(expanded.statistics.mean[0], 4);
  close(expanded.statistics.std[0], Math.sqrt(56 / 3));
  assert.equal(expanded.statistics.mean[1], 1);
  assert.equal(expanded.statistics.mean[2], 10);
  assert.equal(expanded.statistics.count[2], 1);
  assert.equal(regionAggregation(expanded, 'p'), 'descendants_union');
  assert.equal(regionAggregation(expanded, 'p:own'), 'own_channels');
  assert.equal(regionAggregation(expanded, 'c'), 'release');
});

test('inspection and CSV describe the same selected parent population as the panel', () => {
  const regions = [
    { id: '-1', atlasId: -1, index: 0, acronym: 'P', name: 'Parent', parentId: null },
    { id: '-2', atlasId: -2, index: 1, acronym: 'C', name: 'Child', parentId: '-1' },
  ];
  const payload = { featureId: 'f', representation: 'regional', parcellation: 'allen', regionIds: ['-1', '-2'],
    statistics: { mean: [10, 1], std: [0, 1], count: [1, 2] } };
  const expanded = expandRegionalPayload(payload, regions);
  const inspect = (regionId) => buildRegionTooltipModel({ regionId, physicalRegionId: -1, projectionId: 'coronal',
    sliceIndex: null, parcellation: 'allen', clientX: 0, clientY: 0 }, regions, expanded, undefined,
  { mode: 'feature', statistic: 'mean' });
  assert.equal(inspect('-1').valueText, '4');
  assert.match(inspect('-1').meta, /n=3 · incl\. subregions/);
  assert.equal(inspect('-1:own').acronym, 'P');
  assert.match(inspect('-1:own').meta, /n=1 · own channels only/);

  const { csv } = buildSelectedComparisonExport({ datasetId: 'd', releaseId: 'r', feature: expanded, regions,
    selectedRegionIds: ['-1', '-1:own'], statistic: 'mean' });
  const [header, parent, own] = csv.trim().split('\n').map((line) => line.split(','));
  const col = (row, name) => row[header.indexOf(name)];
  assert.equal(col(parent, 'mean'), '4');
  assert.equal(col(parent, 'observation_count'), '3');
  assert.match(col(parent, 'aggregation'), /^descendants_union; quantiles approximated/);
  assert.equal(col(own, 'mean'), '10');
  assert.equal(col(own, 'acronym'), 'P');
  assert.equal(col(own, 'aggregation'), 'own_channels');
});

test('featureGroup classifies only channel-feature datasets and recognizes variants', () => {
  assert.equal(featureGroup('ephys_atlas_channels', 'rms_ap'), 'ap');
  assert.equal(featureGroup('ephys_atlas_channels', 'rms_ap.raw'), 'ap');
  assert.equal(featureGroup('ephys_atlas_channels', 'rms_ap.denoised'), 'ap');
  assert.equal(featureGroup('ephys_atlas_channels', 'psd_gamma_csd'), 'lfp');
  assert.equal(featureGroup('ephys_atlas_volumes', 'spike_width_secs'), 'waveform');
  assert.equal(featureGroup('ephys_atlas_channels', 'something_new'), 'other');
  assert.equal(featureGroup('ephys_atlas_clusters', 'firing_rate'), null);
  assert.equal(featureGroup('ephys_atlas_clusters', 'spike_count'), null);
  assert.equal(featureGroup('agea', 'Gad1'), null);
});
