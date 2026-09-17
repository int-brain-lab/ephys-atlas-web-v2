import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createVolumeRegionalDistributionLoader,
  loadVolumeRegionalDistribution,
  selectVolumeRegionDistribution,
} from '../../.test-dist/data/volume-regional-loader.js';

function fixture(flat = [0, 1, 2, 0, 0, 0, 0, 1, 1, 0]) {
  const reads = [];
  const descriptor = {
    format: 'raw-binary-array-v1',
    path: 'regional/allen.linear-full.u32.gz',
    mediaType: 'application/octet-stream',
    bytes: 20,
    sha256: '1'.repeat(64),
    codec: { name: 'gzip', decodedBytes: 40, level: 6 },
    dtype: 'uint32',
    shape: [2, 5],
    order: 'C',
    endianness: 'little',
  };
  const reader = {
    resolve(base, relative) { return new URL(relative, base).toString(); },
    async readArray(location, resource, signal) {
      reads.push({ location, resource, signal });
      return flat;
    },
  };
  const global = {
    id: 'linear-full',
    scale: { kind: 'linear' },
    domain: { kind: 'full' },
    edges: [0, 1, 2, 3],
    global: { binCounts: [1, 2, 1], underflowCount: 0, overflowCount: 1 },
    binRule: 'left-closed-right-open-last-closed',
  };
  const summary = {
    distribution: { binnings: [global] },
    regionalDistributions: [{
      parcellationId: 'allen',
      hemisphereEncoding: 'signed-atlas-ids-negative-left',
      assignedValidVoxelCount: 5,
      unassignedValidVoxelCount: 1,
      binnings: [{
        binningId: 'linear-full',
        regionalCounts: descriptor,
        regionalCountLayout: 'underflow-bins-overflow',
      }],
    }],
  };
  return { reader, summary, reads };
}

test('volume regional companion is fetched lazily relative to its summary', async () => {
  const { reader, summary, reads } = fixture();
  assert.equal(reads.length, 0);
  const signal = new AbortController().signal;
  const result = await loadVolumeRegionalDistribution({
    reader,
    featureLocation: 'https://atlas.test/features/example/feature.json',
    summaryPath: 'volume/summary.json',
    summary,
    parcellation: 'allen',
    binningId: 'linear-full',
    signal,
  });
  assert.equal(reads.length, 1);
  assert.equal(
    reads[0].location,
    'https://atlas.test/features/example/volume/regional/allen.linear-full.u32.gz',
  );
  assert.equal(reads[0].signal, signal);
  assert.deepEqual(result.regional, [
    { underflowCount: 0, binCounts: [1, 2, 0], overflowCount: 0 },
    { underflowCount: 0, binCounts: [0, 1, 1], overflowCount: 0 },
  ]);
});

test('feature-scoped regional loader caches completed matrices by parcellation and binning', async () => {
  const { reader, summary, reads } = fixture();
  const load = createVolumeRegionalDistributionLoader({
    reader,
    featureLocation: 'https://atlas.test/features/example/feature.json',
    summaryPath: 'volume/summary.json',
    summary,
  });
  const first = await load('allen', 'linear-full');
  const second = await load('allen', 'linear-full');
  assert.equal(first, second);
  assert.equal(reads.length, 1);
});

test('volume regional companion rejects decoded counts that do not conserve assignment', async () => {
  const { reader, summary } = fixture([0, 1, 2, 0, 0, 0, 0, 1, 0, 0]);
  await assert.rejects(
    loadVolumeRegionalDistribution({
      reader,
      featureLocation: 'https://atlas.test/features/example/feature.json',
      summaryPath: 'volume/summary.json',
      summary,
      parcellation: 'allen',
      binningId: 'linear-full',
    }),
    /does not conserve assigned valid voxels/,
  );
});

test('volume regional selection derives Both by exact left/right row addition', async () => {
  const { reader, summary } = fixture();
  const distribution = await loadVolumeRegionalDistribution({
    reader,
    featureLocation: 'https://atlas.test/features/example/feature.json',
    summaryPath: 'volume/summary.json',
    summary,
    parcellation: 'allen',
    binningId: 'linear-full',
  });
  const regions = [
    { id: '-8', atlasId: -8, index: 0, acronym: 'grey', name: 'Grey matter' },
    { id: '8', atlasId: 8, index: 1, acronym: 'grey', name: 'Grey matter' },
  ];
  assert.deepEqual(selectVolumeRegionDistribution(distribution, regions, 8, 'left'), {
    underflowCount: 0, binCounts: [1, 2, 0], overflowCount: 0,
  });
  assert.deepEqual(selectVolumeRegionDistribution(distribution, regions, -8, 'right'), {
    underflowCount: 0, binCounts: [0, 1, 1], overflowCount: 0,
  });
  assert.deepEqual(selectVolumeRegionDistribution(distribution, regions, 8, 'both'), {
    underflowCount: 0, binCounts: [1, 3, 1], overflowCount: 0,
  });
});
