import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SchemaChunks3dVolumeSource,
  locateVolumePlane,
} from '../../.test-dist/rendering/chunked-volume-source.js';

function feature(overrides = {}) {
  const values = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
  const encoded = {
    path: 'chunks/0.0.0.f32', mediaType: 'application/octet-stream', bytes: values.byteLength,
    sha256: '0'.repeat(64), codec: { name: 'none', decodedBytes: values.byteLength },
  };
  return {
    schemaVersion: '1.0',
    featureId: 'x',
    representation: 'volume',
    descriptor: {
      kind: 'volume',
      format: 'ephys-atlas-volume-v1',
      layout: 'chunks3d',
      grid: {
        shape: [2, 2, 2],
        axisOrder: ['ap', 'ml', 'dv'],
        coordinateSystem: 'test AP/ML/DV micrometres',
        referenceSpaceId: 'test', gridId: 'test-grid',
        voxelSizeUm: [25, 25, 25],
        originUm: [0, 0, 0],
        indexToWorldUm: [0, 25, 0, 0, 25, 0, 0, 0, 0, 0, 25, 0, 0, 0, 0, 1],
        worldToIndex: [0, 0.04, 0, 0, 0.04, 0, 0, 0, 0, 0, 0.04, 0, 0, 0, 0, 1],
        voxelEdgeExtentUm: [-12.5, 37.5, -12.5, 37.5, -12.5, 37.5],
      },
      array: { dtype: 'float32', endianness: 'little', order: 'C', nonfinite: 'preserve' },
      resource: {
        layout: 'chunks3d', grid_id: 'test-grid', chunk_shape: [2, 2, 2],
        chunks: [{ origin: [0, 0, 0], decoded: { shape: [2, 2, 2], storageAxes: ['i0', 'i1', 'i2'] }, resource: encoded }],
      },
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

test('chunks3d adapter transposes grid and explicit storage-axis permutations', async () => {
  const raw = new Float32Array([0, 3, 1, 4, 2, 5]); // stored ap=3, ml=2, dv=1
  const payload = feature({
    descriptor: {
      grid: {
        shape: [2, 3, 1],
        axisOrder: ['ml', 'ap', 'dv'],
        coordinateSystem: 'test',
        referenceSpaceId: 'test', gridId: 'test-grid',
        voxelSizeUm: [25, 25, 25],
        originUm: [0, 0, 0],
        indexToWorldUm: [0, 25, 0, 0, 25, 0, 0, 0, 0, 0, 25, 0, 0, 0, 0, 1],
        worldToIndex: [0, 0.04, 0, 0, 0.04, 0, 0, 0, 0, 0, 0.04, 0, 0, 0, 0, 1],
        voxelEdgeExtentUm: [-12.5, 62.5, -12.5, 37.5, -12.5, 12.5],
      },
      resource: {
        layout: 'chunks3d', grid_id: 'test-grid', chunk_shape: [2, 3, 1],
        chunks: [{
          origin: [0, 0, 0], decoded: { shape: [3, 2, 1], storageAxes: ['i1', 'i0', 'i2'] },
          resource: { path: 'chunks/0.0.0.f32', mediaType: 'application/octet-stream', bytes: raw.byteLength, sha256: '0'.repeat(64), codec: { name: 'none', decodedBytes: raw.byteLength } },
        }],
      },
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

test('world coordinates map through volume world_to_index without edge clamping', () => {
  const payload = feature({
    descriptor: {
      grid: {
        shape: [8, 6, 4],
        axisOrder: ['ap', 'ml', 'dv'],
        coordinateSystem: 'test',
        referenceSpaceId: 'test', gridId: 'test-grid',
        voxelSizeUm: [25, 25, 25],
        originUm: [0, 0, 0],
        indexToWorldUm: [0, 25, 0, 0, 25, 0, 0, 0, 0, 0, 25, 0, 0, 0, 0, 1],
        worldToIndex: [0, 0.04, 0, 0, 0.04, 0, 0, 0, 0, 0, 0.04, 0, 0, 0, 0, 1],
        voxelEdgeExtentUm: [-12.5, 137.5, -12.5, 187.5, -12.5, 87.5],
      },
    },
  });
  assert.deepEqual(locateVolumePlane(payload, 'coronal', { ml: 0, ap: 50, dv: 0 }), {
    status: 'in-grid', index: 2, fractionalIndex: 2, rawDimension: 0,
  });
  assert.equal(locateVolumePlane(payload, 'sagittal', { ml: 0, ap: 0, dv: 0 }).index, 0);
  assert.equal(locateVolumePlane(payload, 'horizontal', { ml: 0, ap: 0, dv: 0 }).index, 0);
  assert.equal(locateVolumePlane(payload, 'coronal', { ml: 0, ap: -13, dv: 0 }).status, 'out-of-grid');
});
