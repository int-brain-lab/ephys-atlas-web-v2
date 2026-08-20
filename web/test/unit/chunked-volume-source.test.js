import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SchemaChunks3dVolumeSource,
  regionalSliceToVolumeIndex,
} from '../../.test-dist/rendering/chunked-volume-source.js';

function feature(overrides = {}) {
  const values = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
  return {
    schemaVersion: '0.1',
    featureId: 'x',
    representation: 'volume',
    descriptor: {
      kind: 'volume',
      format: 'ephys-atlas-chunked-volume-v0.1',
      layout: 'chunks3d',
      grid: {
        shape: [2, 2, 2],
        axisOrder: ['ap', 'ml', 'dv'],
        coordinateSystem: 'test AP/ML/DV micrometres',
        voxelSizeUm: [25, 25, 25],
        originUm: [0, 0, 0],
        indexToWorldUm: [25, 0, 0, 0, 0, 25, 0, 0, 0, 0, 25, 0, 0, 0, 0, 1],
      },
      array: { dtype: 'float32', endianness: 'little', order: 'C', nonfinite: 'preserve' },
      resource: { shape: [2, 2, 2], codec: { name: 'none' }, path_template: 'chunks/{i0}.{i1}.{i2}.f32' },
      valueRange: [0, 7],
      ...overrides.descriptor,
    },
    async loadResource(path) {
      assert.equal(path, 'chunks/0.0.0.f32');
      return values.buffer.slice(0);
    },
    ...overrides.feature,
  };
}

test('chunks3d adapter decodes a schema volume chunk', async () => {
  const source = new SchemaChunks3dVolumeSource(feature());
  assert.deepEqual(source.metadata.shape, { coronal: 2, sagittal: 2, horizontal: 2 });
  const chunk = await source.loadChunk({ coronal: 0, sagittal: 0, horizontal: 0 });
  assert.deepEqual(chunk.shape, { coronal: 2, sagittal: 2, horizontal: 2 });
  assert.deepEqual([...chunk.data], [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('chunks3d adapter transposes a non-canonical array axis order', async () => {
  const raw = new Float32Array([0, 1, 2, 3, 4, 5]); // ml=2, ap=3, dv=1
  const payload = feature({
    descriptor: {
      grid: {
        shape: [2, 3, 1],
        axisOrder: ['ml', 'ap', 'dv'],
        coordinateSystem: 'test',
        voxelSizeUm: [25, 25, 25],
        originUm: [0, 0, 0],
        indexToWorldUm: [0, 25, 0, 0, 25, 0, 0, 0, 0, 0, 25, 0, 0, 0, 0, 1],
      },
      resource: { shape: [2, 3, 1], codec: { name: 'none' }, path_template: 'chunks/{i0}.{i1}.{i2}.f32' },
    },
    feature: {
      async loadResource(path) {
        assert.equal(path, 'chunks/0.0.0.f32');
        return raw.buffer.slice(0);
      },
    },
  });
  const source = new SchemaChunks3dVolumeSource(payload);
  assert.deepEqual(source.metadata.shape, { coronal: 3, sagittal: 2, horizontal: 1 });
  const chunk = await source.loadChunk({ coronal: 0, sagittal: 0, horizontal: 0 });
  // output C-order is AP/coronal, ML/sagittal, DV/horizontal
  assert.deepEqual([...chunk.data], [0, 3, 1, 4, 2, 5]);
});

test('regional slice coordinates map through volume index_to_world transform', () => {
  const payload = feature({
    descriptor: {
      grid: {
        shape: [8, 6, 4],
        axisOrder: ['ap', 'ml', 'dv'],
        coordinateSystem: 'test',
        voxelSizeUm: [25, 25, 25],
        originUm: [0, 0, 0],
        indexToWorldUm: [25, 0, 0, 0, 0, 25, 0, 0, 0, 0, 25, 0, 0, 0, 0, 1],
      },
    },
  });
  assert.equal(regionalSliceToVolumeIndex(payload, 'coronal', 216), 0);
  assert.equal(regionalSliceToVolumeIndex(payload, 'coronal', 214), 2);
  assert.equal(regionalSliceToVolumeIndex(payload, 'sagittal', 229), 0);
  assert.equal(regionalSliceToVolumeIndex(payload, 'horizontal', 13), 0);
});
