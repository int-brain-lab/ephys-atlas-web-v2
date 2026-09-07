import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  alignmentFeature,
  alignmentGrid,
  coarseBoundaryPath,
  sourceVoxel,
} from '../../.test-dist/labs/agea-alignment-model.js';
import { SchemaChunks3dVolumeSource } from '../../.test-dist/rendering/chunked-volume-source.js';
import { inspectVolumePlanePoint } from '../../.test-dist/rendering/volume-inspection.js';
import { registeredVolumeCanvasPlacement } from '../../.test-dist/rendering/retained-projection-viewport.js';
import { VolumeValiditySliceSource } from '../../.test-dist/rendering/volume-validity-source.js';
import { VolumeSliceLoader } from '../../.test-dist/rendering/volume.js';

const AFFINE = [
  200, 0, 0, -5739,
  0, 0, -200, 5400,
  0, -200, 0, 332,
  0, 0, 0, 1,
];
const SHAPE = [58, 41, 67];
const REFERENCE = 'allen-ccf-2017';

function manifest(overrides = {}) {
  return { shape: SHAPE, axis_order: ['ML', 'DV', 'AP'], index_to_world_um: AFFINE, ...overrides };
}

function nativeRegistrations() {
  const pack = JSON.parse(readFileSync('public/atlas/projections/ibl-static-registered-v1/manifest.json', 'utf8'));
  assert.equal(pack.reference_space_id, REFERENCE);
  return Object.fromEntries(pack.projections.filter(p => p.kind === 'registered-slice-stack').map(p => [p.id, {
    axis: p.id,
    referenceSpaceId: p.reference_space_id,
    viewBox: { x: p.view_box[0], y: p.view_box[1], width: p.view_box[2], height: p.view_box[3] },
    planeIndexToWorldUm: p.plane_index_to_world_um,
    worldToPlaneIndex: p.world_to_plane_index,
  }]));
}

test('AGEA candidate grid preserves the declared source affine against pinned native anatomy', () => {
  const grid = alignmentGrid(manifest(), REFERENCE);
  assert.deepEqual(grid.shape, SHAPE);
  assert.deepEqual(grid.axisOrder, ['ml', 'dv', 'ap']);
  assert.deepEqual(grid.indexToWorldUm, AFFINE);
  assert.deepEqual(grid.worldToIndex, [
    0.005, 0, 0, 28.695,
    0, 0, -0.005, 1.66,
    0, -0.005, 0, 27,
    0, 0, 0, 1,
  ]);
  assert.deepEqual(grid.voxelSizeUm, [200, 200, 200]);
  assert.deepEqual(grid.voxelEdgeExtentUm, [-5839, 5761, -7900, 5500, -7768, 432]);

  const registrations = nativeRegistrations();
  for (const axis of ['coronal', 'sagittal', 'horizontal']) {
    assert.equal(registrations[axis].referenceSpaceId, grid.referenceSpaceId);
  }
  // One AGEA voxel spans exactly twenty native 10 um projection coordinates.
  assert.equal(200 * registrations.coronal.worldToPlaneIndex[4], 20);
  assert.equal(-200 * registrations.coronal.worldToPlaneIndex[10], 20);
  assert.equal(-200 * registrations.sagittal.worldToPlaneIndex[5], -20);
  assert.equal(200 * registrations.horizontal.worldToPlaneIndex[4], 20);
});

test('source voxel mapping uses integer centres and lower-inclusive upper-exclusive half-voxel edges', () => {
  const grid = alignmentGrid(manifest(), REFERENCE);
  const origin = sourceVoxel(grid, { ml: -5739, ap: 5400, dv: 332 });
  assert.deepEqual(origin.index, [0, 0, 0]);
  origin.fractional.forEach(value => assert.ok(Math.abs(value) < 1e-12));
  assert.deepEqual(sourceVoxel(grid, { ml: 5661, ap: -7800, dv: -7668 }).index, [57, 40, 66]);
  assert.deepEqual(sourceVoxel(grid, { ml: -5839, ap: 5500, dv: 432 }).index, [0, 0, 0]);
  assert.equal(sourceVoxel(grid, { ml: 5761, ap: 0, dv: 0 }).index, null);
  assert.equal(sourceVoxel(grid, { ml: 0, ap: -7900, dv: 0 }).index, null);
  assert.equal(sourceVoxel(grid, { ml: 0, ap: 0, dv: -7768 }).index, null);
  assert.deepEqual(sourceVoxel(grid, { ml: -5639, ap: 5300, dv: 232 }).index, [1, 1, 1]);

  for (const index of [[0, 0, 0], [57, 40, 66], [12.25, 20.5, 30.75]]) {
    const world = { ml: 200 * index[0] - 5739, ap: 5400 - 200 * index[2], dv: 332 - 200 * index[1] };
    const result = sourceVoxel(grid, world);
    index.forEach((value, dimension) => assert.ok(Math.abs(result.fractional[dimension] - value) < 1e-12));
  }
});

test('alignment grid rejects malformed matrices and non-permuted source axes', () => {
  assert.throws(() => alignmentGrid(manifest({ index_to_world_um: AFFINE.slice(0, 15) }), REFERENCE), /Invalid source affine/);
  assert.throws(() => alignmentGrid(manifest({ index_to_world_um: AFFINE.with(3, NaN) }), REFERENCE), /Invalid source affine/);
  assert.throws(() => alignmentGrid(manifest({ index_to_world_um: AFFINE.with(12, 1) }), REFERENCE), /Invalid source affine/);
  assert.throws(() => alignmentGrid(manifest({ index_to_world_um: AFFINE.with(1, 10) }), REFERENCE), /signed axis permutation/);
  const duplicateAxis = [...AFFINE]; duplicateAxis[0] = 0; duplicateAxis[1] = 200;
  assert.throws(() => alignmentGrid(manifest({ index_to_world_um: duplicateAxis }), REFERENCE), /signed axis permutation/);
});

test('AGEA planes occupy exact half-voxel extents in all native projections', async () => {
  const grid = alignmentGrid(manifest(), REFERENCE);
  const feature = await alignmentFeature(new Float32Array(SHAPE.reduce((a, b) => a * b)), grid, 'placement', true);
  const registrations = nativeRegistrations();
  const source = new VolumeSliceLoader(new SchemaChunks3dVolumeSource(feature));
  const expected = {
    coronal: { x: -10, y: -10, width: 1160, height: 820, flipX: false, flipY: false },
    sagittal: { x: -11, y: -10, width: 1340, height: 820, flipX: true, flipY: false },
    horizontal: { x: -10, y: -10, width: 1160, height: 1340, flipX: false, flipY: false },
  };
  for (const axis of ['coronal', 'sagittal', 'horizontal']) {
    const slice = await source.loadSlice(axis, 1);
    const placement = registeredVolumeCanvasPlacement(feature, slice, registrations[axis]);
    for (const field of ['x', 'y', 'width', 'height']) {
      assert.ok(Math.abs(placement[field] - expected[axis][field]) < 1e-10, `${axis} ${field}`);
    }
    assert.equal(placement.flipX, expected[axis].flipX);
    assert.equal(placement.flipY, expected[axis].flipY);
    assert.deepEqual(placement.viewBox, registrations[axis].viewBox);
  }
});

test('coarse boundary path preserves unequal labels on an exact 2 by 2 plane', () => {
  // Coronal fixes AP (raw dimension 2), leaving ML across and DV down.
  const labels = new Int32Array([1, 1, 2, 2]);
  assert.equal(coarseBoundaryPath(labels, [2, 2, 1], 'coronal', 0),
    'M0,0v1M0,0h1M1,0v1M1,0h1M2,0v1M0,1v1M0,2h1M1,1v1M2,1v1M1,2h1');
});

test('alignment features preserve measured zero and mask only missing expression', async () => {
  const shape = [2, 2, 2];
  const grid = alignmentGrid(manifest({ shape }), REFERENCE);
  const values = Float32Array.from([0, -1, 2, 3, 4, 5, 6, 7]);
  const feature = await alignmentFeature(values, grid, 'dynamic-expression', true);
  assert.deepEqual(feature.descriptor.grid.shape, shape);
  assert.equal(feature.summary.validVoxelCount, 7);
  assert.equal(feature.summary.missingVoxelCount, 1);
  assert.deepEqual(feature.summary.valueRange, [0, 7]);

  const scalar = new VolumeSliceLoader(new SchemaChunks3dVolumeSource(feature));
  const source = new VolumeValiditySliceSource(feature, scalar);
  const slice = await source.loadSlice('coronal', 0);
  assert.deepEqual([...slice.data], [0, 4, 2, 6]);
  assert.deepEqual([...slice.validity], [0, 0, 0, 0]);

  const registration = nativeRegistrations().coronal;
  const zero = inspectVolumePlanePoint(feature, slice, registration, { u: 0, v: 0 });
  assert.equal(zero.status, 'valid');
  assert.equal(zero.value, 0);
  const missingSlice = await source.loadSlice('coronal', 1);
  assert.deepEqual([...missingSlice.data], [-1, 5, 3, 7]);
  assert.deepEqual([...missingSlice.validity], [2, 0, 0, 0]);
  const missingWorld = { ml: -5739, ap: 5200, dv: 332 };
  const missing = inspectVolumePlanePoint(feature, missingSlice, registration, {
    u: registration.worldToPlaneIndex[4] * missingWorld.ml + registration.worldToPlaneIndex[5] * missingWorld.ap + registration.worldToPlaneIndex[6] * missingWorld.dv + registration.worldToPlaneIndex[7],
    v: registration.worldToPlaneIndex[8] * missingWorld.ml + registration.worldToPlaneIndex[9] * missingWorld.ap + registration.worldToPlaneIndex[10] * missingWorld.dv + registration.worldToPlaneIndex[11],
  });
  assert.equal(missing.status, 'missing');
  assert.equal('value' in missing, false);

  await assert.rejects(alignmentFeature(new Float32Array(7), grid, 'wrong-shape', true), /shape mismatch/);
  await assert.rejects(alignmentFeature(Float32Array.from([0, -2, 0, 0, 0, 0, 0, 0]), grid, 'negative', true), /Unexpected negative/);
});
