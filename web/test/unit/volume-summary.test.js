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
    histogram: {
      edges: [-4, 0, 8, 20],
      counts: [1, 3, 2],
      bin_rule: 'left-closed-right-open-last-closed',
    },
  };
}

test('volume summary parser retains valid-only statistics, counts, and exact linear histogram', () => {
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
    histogram: {
      axisScale: 'linear',
      edges: [-4, 0, 8, 20],
      globalCounts: [1, 3, 2],
      binRule: 'left-closed-right-open-last-closed',
    },
  });
});

test('volume summary parser rejects a histogram that does not conserve valid voxels', () => {
  const invalid = summary();
  invalid.histogram.counts = [1, 2, 2];
  assert.throws(() => parseVolumeSummary(invalid, descriptor), /conserve the valid voxel population/);
});
