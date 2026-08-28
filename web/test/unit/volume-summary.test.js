import assert from 'node:assert/strict';
import test from 'node:test';

import { parseVolumeSummary } from '../../.test-dist/data/validation/volume-v1.js';

const descriptor = { grid: { gridId: 'grid', shape: [2, 2, 2] } };

function summary() {
  return {
    schema_version: '1.0',
    format: 'ephys-atlas-volume-summary-v1',
    grid_id: 'grid',
    grid_shape: [2, 2, 2],
    total_voxel_count: 8,
    valid_voxel_count: 6,
    outside_voxel_count: 1,
    missing_voxel_count: 1,
    valid_statistics: {
      min: -4,
      max: 20,
      mean: 5,
      std: 7,
      q05: -2,
      q25: 0,
      median: 3,
      q75: 8,
      q95: 15,
    },
    distribution: {
      binnings: [{
        id: 'linear-full',
        scale: { kind: 'linear' },
        domain: { kind: 'full' },
        edges: [-4, 0, 8, 20],
        global_counts: [1, 3, 2],
        global_underflow_count: 0,
        global_overflow_count: 0,
        bin_rule: 'left-closed-right-open-last-closed',
      }],
    },
  };
}

test('volume summary parser retains valid-only statistics, counts, and exact linear distribution', () => {
  const parsed = parseVolumeSummary(summary(), descriptor);
  assert.deepEqual(parsed, {
    totalVoxelCount: 8,
    validVoxelCount: 6,
    outsideVoxelCount: 1,
    missingVoxelCount: 1,
    validStatistics: {
      min: -4,
      max: 20,
      mean: 5,
      std: 7,
      median: 3,
      q05: -2,
      q25: 0,
      q75: 8,
      q95: 15,
    },
    valueRange: [-2, 15],
    distribution: {
      binnings: [{
        id: 'linear-full',
        scale: { kind: 'linear' },
        domain: { kind: 'full' },
        edges: [-4, 0, 8, 20],
        global: { binCounts: [1, 3, 2], underflowCount: 0, overflowCount: 0 },
        binRule: 'left-closed-right-open-last-closed',
      }],
    },
  });
});

test('volume summary parser rejects a distribution that does not conserve valid voxels', () => {
  const invalid = summary();
  invalid.distribution.binnings[0].global_counts = [1, 2, 2];
  assert.throws(() => parseVolumeSummary(invalid, descriptor), /does not conserve the population/);
});

test('volume summary full distribution encloses both declared extrema', () => {
  const invalidMinimum = summary();
  invalidMinimum.distribution.binnings[0].edges[0] = -3;
  assert.throws(() => parseVolumeSummary(invalidMinimum, descriptor), /population minimum/);
  const invalidMaximum = summary();
  invalidMaximum.distribution.binnings[0].edges[3] = 19;
  assert.throws(() => parseVolumeSummary(invalidMaximum, descriptor), /population maximum/);
});

test('volume summary omits distributions when there are no valid voxels', () => {
  const empty = summary();
  empty.valid_voxel_count = 0;
  empty.outside_voxel_count = 7;
  empty.valid_statistics = Object.fromEntries(Object.keys(empty.valid_statistics).map((key) => [key, null]));
  delete empty.distribution;
  const parsed = parseVolumeSummary(empty, descriptor);
  assert.equal(parsed.distribution, undefined);
  assert.deepEqual(parsed.valueRange, [null, null]);
});
