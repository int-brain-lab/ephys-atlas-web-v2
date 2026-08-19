import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estimateRenderer3DSceneBytes,
  validateRenderer3DScene,
  type Renderer3DScene,
} from '../../web/src/rendering/scene3d.js';

test('3D scene contract accepts region meshes and dense point buffers', () => {
  const pointCount = 500_000;
  const scene: Renderer3DScene = {
    meshes: [{
      regionId: 997,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    }],
    points: {
      positions: new Float32Array(pointCount * 3),
      values: new Float32Array(pointCount),
      ids: new Uint32Array(pointCount),
    },
  };
  validateRenderer3DScene(scene);
  const bytes = estimateRenderer3DSceneBytes(scene);
  assert.equal(bytes.pointBytes, 10_000_000);
  assert.equal(bytes.meshBytes, 48);
  assert.equal(bytes.totalBytes, 10_000_048);
});

test('3D scene contract rejects duplicate region ids and invalid indices', () => {
  const triangle = {
    regionId: 1,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  };
  assert.throws(() => validateRenderer3DScene({ meshes: [triangle, triangle] }), /duplicate/);
  assert.throws(() => validateRenderer3DScene({
    meshes: [{ ...triangle, regionId: 2, indices: new Uint32Array([0, 1, 3]) }],
  }), /exceeds/);
});
