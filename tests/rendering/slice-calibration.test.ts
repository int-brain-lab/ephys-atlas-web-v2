import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ANATOMY_10UM_CALIBRATION,
  REGIONAL_10UM_CALIBRATION,
  indexToCoordinateUm,
  regionalIndexToCoordinateUm,
  regionalIndicesToWorld,
  worldToRegionalIndices,
} from '../../web/src/rendering/slice-calibration.js';
import {
  applyAffine,
  assertInverseAffines,
  cursorStateToWorld,
  planeToWorld,
  worldToCursorState,
  worldToPlane,
  type Matrix4,
} from '../../web/src/rendering/coordinate-space.js';
import { regionIdFromAtlasAttributes } from '../../web/src/rendering/region-id.js';

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/rendering/linked-slices.fixture.json', import.meta.url), 'utf8'),
);

test('native 10 um indices reproduce the pinned coordinate labels', () => {
  assert.equal(indexToCoordinateUm(660, REGIONAL_10UM_CALIBRATION.coronal), -1200);
  assert.equal(indexToCoordinateUm(570, REGIONAL_10UM_CALIBRATION.sagittal), -39);
  assert.equal(indexToCoordinateUm(400, REGIONAL_10UM_CALIBRATION.horizontal), -3668);
  assert.deepEqual(regionalIndicesToWorld(fixture.indices), { ml: -39, ap: -1200, dv: -3668 });
});

test('projection navigation uses the native 10 um bilateral grid', () => {
  assert.equal(ANATOMY_10UM_CALIBRATION.coronal.indexCount, 1320);
  assert.equal(ANATOMY_10UM_CALIBRATION.sagittal.indexCount, 1140);
  assert.equal(ANATOMY_10UM_CALIBRATION.horizontal.indexCount, 800);
  assert.equal(regionalIndexToCoordinateUm('coronal', 660), -1200);
  assert.equal(regionalIndexToCoordinateUm('sagittal', 570), -39);
  assert.equal(regionalIndexToCoordinateUm('horizontal', 400), -3668);
});

test('all projections share one explicit ML/AP/DV world cursor', () => {
  const indices = { coronal: 660, sagittal: 570, horizontal: 400 };
  const world = regionalIndicesToWorld(indices);
  assert.deepEqual(world, { ml: -39, ap: -1200, dv: -3668 });
  assert.deepEqual(worldToRegionalIndices(world), indices);
  assert.deepEqual(cursorStateToWorld(worldToCursorState(world)), world);
});

test('projection affines round-trip a scientific cursor', () => {
  const indexToWorld: Matrix4 = [
    0, 10, 0, -5739,
    -10, 0, 0, 5400,
    0, 0, -10, 332,
    0, 0, 0, 1,
  ];
  const worldToIndex: Matrix4 = [
    0, -0.1, 0, 540,
    0.1, 0, 0, 573.9,
    0, 0, -0.1, 33.2,
    0, 0, 0, 1,
  ];
  assertInverseAffines(indexToWorld, worldToIndex);
  const plane = { slice: 660, u: 570, v: 400 };
  const world = planeToWorld(indexToWorld, plane);
  assert.deepEqual(world, { ml: -39, ap: -1200, dv: -3668 });
  const roundTrip = worldToPlane(worldToIndex, world);
  assert.ok(Math.abs(roundTrip.slice - plane.slice) < 1e-9);
  assert.ok(Math.abs(roundTrip.u - plane.u) < 1e-9);
  assert.ok(Math.abs(roundTrip.v - plane.v) < 1e-9);
  assert.deepEqual(applyAffine(indexToWorld, [660, 570, 400]), [-39, -1200, -3668]);
});

test('registered projection paths expose direct stable IDs for every parcellation', () => {
  const attributes = new Map([['data-allen-id', '-10'], ['data-beryl-id', '-20'], ['data-cosmos-id', '-30']]);
  assert.equal(regionIdFromAtlasAttributes('allen', (name) => attributes.get(name) ?? null), -10);
  assert.equal(regionIdFromAtlasAttributes('beryl', (name) => attributes.get(name) ?? null), -20);
  assert.equal(regionIdFromAtlasAttributes('cosmos', (name) => attributes.get(name) ?? null), -30);
});
