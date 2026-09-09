import assert from 'node:assert/strict';
import test from 'node:test';
import { SchemaSlicePackVolumeSource } from '../../.test-dist/rendering/slice-pack-volume-source.js';

function feature(packDepth = 2, sliceCount = 6) {
  const requested = [];
  const packs = Array.from({ length: Math.ceil(sliceCount / packDepth) }, (_, index) => index * packDepth).map((firstSlice) => ({
    axis: 'i0', firstSlice, sliceCount: Math.min(packDepth, sliceCount - firstSlice),
    decoded: { shape: [Math.min(packDepth, sliceCount - firstSlice), 1, 1], storageAxes: ['i0', 'i1', 'i2'] },
    resource: {
      path: `pack-${firstSlice}.bin`, mediaType: 'application/octet-stream', bytes: packDepth * 4,
      sha256: '0'.repeat(64), codec: { name: 'none', decodedBytes: packDepth * 4 },
    },
  }));
  return {
    requested,
    schemaVersion: '1.0', featureId: 'prefetch', representation: 'volume',
    descriptor: {
      kind: 'volume', format: 'ephys-atlas-volume-v1', layout: 'orthogonal_slice_packs',
      grid: { shape: [sliceCount, 1, 1], axisOrder: ['ap', 'ml', 'dv'], coordinateSystem: 'test', referenceSpaceId: 'test', gridId: 'test', voxelSizeUm: [1, 1, 1], originUm: [0, 0, 0], indexToWorldUm: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], voxelEdgeExtentUm: [-.5, sliceCount - .5, -.5, .5, -.5, .5] },
      array: { dtype: 'float32', endianness: 'little', order: 'C', nonfinite: 'preserve' },
      resource: { layout: 'orthogonal_slice_packs', grid_id: 'test', pack_depth: packDepth, packs },
      validity: { kind: 'none' }, valueRange: [0, 1],
    },
    async loadResource(path) { requested.push(path); return new Float32Array(packDepth).buffer; },
  };
}

test('slice-pack prefetch selects the declared next pack in either direction and stops at bounds', async () => {
  const payload = feature(2);
  const source = new SchemaSlicePackVolumeSource(payload);
  await source.prefetchNextPack('coronal', 1, 1);
  await source.prefetchNextPack('coronal', 2, -1);
  await source.prefetchNextPack('coronal', 0, -1);
  assert.deepEqual(payload.requested, ['pack-2.bin', 'pack-0.bin']);
});

test('slice-pack prefetch derives a different declared pack depth', async () => {
  const payload = feature(3);
  const source = new SchemaSlicePackVolumeSource(payload);
  await source.prefetchNextPack('coronal', 1, 1);
  assert.deepEqual(payload.requested, ['pack-3.bin']);
});

test('slice-pack lookahead loads the immediate pack before the remaining directional window', async () => {
  const payload = feature(2, 12);
  const source = new SchemaSlicePackVolumeSource(payload);
  await source.prefetchNextPacks('coronal', 1, 1, 4);
  assert.deepEqual(payload.requested, ['pack-2.bin', 'pack-4.bin', 'pack-6.bin', 'pack-8.bin']);
});
