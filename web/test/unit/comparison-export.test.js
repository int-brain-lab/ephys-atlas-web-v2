import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSelectedComparisonExport } from '../../.test-dist/ui/regional/comparison-export.js';

test('selected comparison export preserves context, summaries, raw bins, and normalized probabilities', () => {
  const result = buildSelectedComparisonExport({
    datasetId: 'channels',
    releaseId: 'release-1',
    feature: {
      representation: 'regional',
      featureId: 'rms',
      parcellation: 'allen',
      regionIds: ['-1', '-2'],
      population: 'inside rows',
      statistics: {
        count: [4, 40], missing_count: [1, 0], min: [0, 0], max: [2, 2],
        mean: [1.5, 0.5], std: [0.5, 0.25], median: [1.75, 0.4],
        q05: [0.1, 0.1], q25: [1, 0.25], q75: [2, 0.75], q95: [2, 1],
      },
      distribution: { binnings: [] },
    },
    descriptor: { id: 'rms', path: 'feature.json', label: 'RMS', description: '', unit: 'uV', valueSemantics: {
      quantity: 'rms', transform: 'identity', sourcePopulation: 'inside', missingValues: 'excluded',
    }, representations: {}, statistics: [] },
    regions: [
      { id: '-1', atlasId: -1, index: 0, acronym: 'A', name: 'Alpha, region' },
      { id: '-2', atlasId: -2, index: 1, acronym: 'B', name: 'Beta' },
    ],
    selectedRegionIds: ['-1'],
    statistic: 'median',
    binning: {
      id: 'symlog-focused', scale: { kind: 'symlog', linearThreshold: 0.5 },
      domain: { kind: 'focused', bounds: [0, 2] }, edges: [0, 1, 2],
      global: { binCounts: [31, 13], underflowCount: 2, overflowCount: 1 },
      regional: [
        { binCounts: [1, 3], underflowCount: 1, overflowCount: 1 },
        { binCounts: [30, 10], underflowCount: 0, overflowCount: 0 },
      ],
      binRule: 'left-closed-right-open-last-closed',
    },
  });

  assert.equal(result.filename, 'channels-release-1-rms-allen-selected-comparison.csv');
  const lines = result.csv.trim().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /dataset_id,release_id,feature_id/);
  assert.match(lines[1], /channels,release-1,rms,regional,allen,median,uV,inside rows,symlog,focused,0\.5,0,2,-1,A,"Alpha, region"/);
  assert.match(lines[1], /,0,1,1,0\.16666666666666666,6,1,0\.16666666666666666,1,0\.16666666666666666$/);
  assert.match(lines[2], /,1,2,3,0\.5,6,1,0\.16666666666666666,1,0\.16666666666666666$/);
  assert.doesNotMatch(result.csv, /,-2,/);
});
