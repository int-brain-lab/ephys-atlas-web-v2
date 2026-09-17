import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVolumeDistributionExport } from '../../.test-dist/ui/regional/volume-distribution-export.js';

test('volume distribution export preserves exact bilateral counts, tails, and population', () => {
  const result = buildVolumeDistributionExport({
    datasetId: 'agea', releaseId: 'release', featureId: 'gene', parcellation: 'allen',
    hemisphere: 'both', selectedRegionIds: ['-10'],
    regions: [{ id: '-10', atlasId: -10, index: 0, acronym: 'R', name: 'Region, one' }],
    physicalRegions: [
      { id: '-10', atlasId: -10, index: 0, acronym: 'R', name: 'Region, one' },
      { id: '10', atlasId: 10, index: 1, acronym: 'R', name: 'Region, one' },
    ],
    binning: {
      id: 'linear-full', scale: { kind: 'linear' }, domain: { kind: 'full' }, edges: [0, 1, 2],
      global: { underflowCount: 0, binCounts: [5, 5], overflowCount: 0 },
      regional: [
        { underflowCount: 1, binCounts: [2, 1], overflowCount: 0 },
        { underflowCount: 0, binCounts: [3, 4], overflowCount: 1 },
      ],
    },
  });
  assert.match(result.csv, /"Region, one",both,linear-full,underflow,,,0,1,12/);
  assert.match(result.csv, /both,linear-full,bin,0,0,1,5,12/);
  assert.match(result.csv, /both,linear-full,overflow,,2,,1,12/);
  assert.equal(result.filename, 'agea-release-gene-allen-both-regional-distributions.csv');
});
