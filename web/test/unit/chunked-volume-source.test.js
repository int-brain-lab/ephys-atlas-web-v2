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

function permutations(values) {
  if (values.length <= 1) return [values];
  return values.flatMap((first) => permutations(values.filter((value) => value !== first))
    .map((rest) => [first, ...rest]));
}

function encodeValues(values, dtype) {
  if (dtype === 'float32') return new Float32Array(values).buffer;
  const encoded = new Uint16Array(values.length);
  values.forEach((value, index) => {
    if (value === 0) {
      encoded[index] = 0;
      return;
    }
    const exponent = Math.floor(Math.log2(value));
    encoded[index] = ((exponent + 15) << 10) | Math.round((value / (2 ** exponent) - 1) * 1024);
  });
  return encoded.buffer;
}

test('chunks3d adapter preserves all grid/storage permutations for float16 and float32', async (t) => {
  const anatomicalAxes = ['ap', 'ml', 'dv'];
  const rawAxes = ['i0', 'i1', 'i2'];
  const anatomicalShape = { ap: 2, ml: 3, dv: 4 };
  const expected = [];
  for (let ap = 0; ap < anatomicalShape.ap; ap += 1) {
    for (let ml = 0; ml < anatomicalShape.ml; ml += 1) {
      for (let dv = 0; dv < anatomicalShape.dv; dv += 1) expected.push(ap * 100 + ml * 10 + dv);
    }
  }
  for (const axisOrder of permutations(anatomicalAxes)) {
    const rawShape = axisOrder.map((axis) => anatomicalShape[axis]);
    for (const storageAxes of permutations(rawAxes)) {
      const decodedShape = storageAxes.map((axis) => rawShape[Number(axis[1])]);
      const stored = [];
      for (let a = 0; a < decodedShape[0]; a += 1) {
        for (let b = 0; b < decodedShape[1]; b += 1) {
          for (let c = 0; c < decodedShape[2]; c += 1) {
            const storageIndex = [a, b, c];
            const rawIndex = [0, 0, 0];
            storageAxes.forEach((axis, dimension) => { rawIndex[Number(axis[1])] = storageIndex[dimension]; });
            const coordinate = Object.fromEntries(axisOrder.map((axis, dimension) => [axis, rawIndex[dimension]]));
            stored.push(coordinate.ap * 100 + coordinate.ml * 10 + coordinate.dv);
          }
        }
      }
      for (const dtype of ['float16', 'float32']) {
        await t.test(`${axisOrder.join('')}/${storageAxes.join('')}/${dtype}`, async () => {
          const buffer = encodeValues(stored, dtype);
          const resource = {
            path: 'chunks/permutation.bin', mediaType: 'application/octet-stream', bytes: buffer.byteLength,
            sha256: '0'.repeat(64), codec: { name: 'none', decodedBytes: buffer.byteLength },
          };
          const payload = feature({
            descriptor: {
              grid: {
                shape: rawShape, axisOrder, coordinateSystem: 'test', referenceSpaceId: 'test', gridId: 'test-grid',
                voxelSizeUm: [25, 25, 25], originUm: [0, 0, 0],
                indexToWorldUm: [0, 25, 0, 0, 25, 0, 0, 0, 0, 0, 25, 0, 0, 0, 0, 1],
                worldToIndex: [0, 0.04, 0, 0, 0.04, 0, 0, 0, 0, 0, 0.04, 0, 0, 0, 0, 1],
                voxelEdgeExtentUm: [-12.5, 37.5, -12.5, 62.5, -12.5, 87.5],
              },
              array: { dtype, endianness: 'little', order: 'C', nonfinite: 'preserve' },
              resource: {
                layout: 'chunks3d', grid_id: 'test-grid', chunk_shape: rawShape,
                chunks: [{ origin: [0, 0, 0], decoded: { shape: decodedShape, storageAxes }, resource }],
              },
            },
            feature: { async loadResource() { return buffer.slice(0); } },
          });
          const chunk = await new SchemaChunks3dVolumeSource(payload)
            .loadChunk({ coronal: 0, sagittal: 0, horizontal: 0 });
          assert.deepEqual([...chunk.data], expected);
        });
      }
    }
  }
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
