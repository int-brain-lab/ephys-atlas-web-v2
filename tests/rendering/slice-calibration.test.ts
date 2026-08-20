import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ANATOMY_25UM_CALIBRATION,
  LEGACY_VIEW_BOXES,
  REGIONAL_10UM_CALIBRATION,
  indexToCoordinateUm,
  legacyRegionalIndicesToWorld,
  linkedGuides,
  projectLegacyGuide,
  regionalIndexToCoordinateUm,
  regionalIndexToLegacyIndex,
  regionalIndicesToWorld,
  regionalIndexToVolumeIndex,
  volumeIndexToCoordinateUm,
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
import { regionIdFromClassNames } from '../../web/src/rendering/region-id.js';
import { regionIdFromAtlasAttributes } from '../../web/src/rendering/region-id.js';
import { anatomySliceSvgFragment } from '../../web/src/rendering/generated-anatomy-renderer.js';

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/rendering/linked-slices.fixture.json', import.meta.url), 'utf8'),
);

test('legacy 10 um indices reproduce v1 coordinate labels', () => {
  assert.equal(indexToCoordinateUm(660, REGIONAL_10UM_CALIBRATION.coronal), -1200);
  assert.equal(indexToCoordinateUm(570, REGIONAL_10UM_CALIBRATION.sagittal), -39);
  assert.equal(indexToCoordinateUm(400, REGIONAL_10UM_CALIBRATION.horizontal), -3668);
  assert.deepEqual(legacyRegionalIndicesToWorld(fixture.indices), { ml: -39, ap: -1200, dv: -3668 });
});

test('generated anatomy navigation uses the native 25 um left-hemisphere grid', () => {
  assert.equal(ANATOMY_25UM_CALIBRATION.coronal.indexCount, 528);
  assert.equal(ANATOMY_25UM_CALIBRATION.sagittal.indexCount, 230);
  assert.equal(ANATOMY_25UM_CALIBRATION.horizontal.indexCount, 320);
  assert.equal(regionalIndexToCoordinateUm('coronal', 264), -1200);
  assert.equal(regionalIndexToCoordinateUm('sagittal', 228), -39);
  assert.equal(regionalIndexToCoordinateUm('horizontal', 160), -3668);
});

test('25 um anatomy and volume grids share Allen coordinates', () => {
  assert.equal(volumeIndexToCoordinateUm('coronal', 0), 5400);
  assert.equal(volumeIndexToCoordinateUm('sagittal', 0), -5739);
  assert.equal(volumeIndexToCoordinateUm('horizontal', 0), 332);
  assert.equal(regionalIndexToVolumeIndex('coronal', 264), 264);
  assert.equal(regionalIndexToVolumeIndex('sagittal', 228), 228);
  assert.equal(regionalIndexToVolumeIndex('horizontal', 160), 160);
  assert.equal(regionalIndexToLegacyIndex('coronal', 264), 660);
  assert.equal(regionalIndexToLegacyIndex('sagittal', 228), 570);
  assert.equal(regionalIndexToLegacyIndex('horizontal', 160), 400);
});

test('guide registration maps scientific axis endpoints to projection view boxes', () => {
  assert.deepEqual(projectLegacyGuide('sagittal', 'coronal', 0), {
    sourceAxis: 'sagittal', targetAxis: 'coronal', dimension: 'x', position: 58,
  });
  assert.deepEqual(projectLegacyGuide('sagittal', 'coronal', 1139), {
    sourceAxis: 'sagittal', targetAxis: 'coronal', dimension: 'x', position: 414,
  });
  assert.deepEqual(projectLegacyGuide('coronal', 'sagittal', 0), {
    sourceAxis: 'coronal', targetAxis: 'sagittal', dimension: 'x', position: 56,
  });
  assert.deepEqual(projectLegacyGuide('horizontal', 'coronal', 799), {
    sourceAxis: 'horizontal', targetAxis: 'coronal', dimension: 'y', position: 300,
  });
});

test('all linked guides stay inside the registered target view box', () => {
  const endpointSets = [
    { coronal: 0, sagittal: 0, horizontal: 0 },
    { coronal: 527, sagittal: 229, horizontal: 319 },
  ];
  for (const indices of endpointSets) {
    for (const targetAxis of ['coronal', 'sagittal', 'horizontal'] as const) {
      const viewBox = LEGACY_VIEW_BOXES[targetAxis];
      for (const guide of linkedGuides(indices, targetAxis)) {
        const [minimum, maximum] = guide.dimension === 'x'
          ? [viewBox.x, viewBox.x + viewBox.width]
          : [viewBox.y, viewBox.y + viewBox.height];
        assert.ok(guide.position >= minimum && guide.position <= maximum);
      }
    }
  }
});

test('linked fixture produces two guides per view and exact v1 view boxes', () => {
  const indices = { coronal: 264, sagittal: 228, horizontal: 160 };
  for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
    const guides = linkedGuides(indices, axis);
    assert.equal(guides.length, 2);
    assert.ok(guides.every((guide) => guide.targetAxis === axis));
    assert.ok(LEGACY_VIEW_BOXES[axis].width > 0);
    assert.ok(fixture.fragments[axis].includes('beryl_region_101'));
  }
});

test('all projections share one explicit ML/AP/DV world cursor', () => {
  const indices = { coronal: 264, sagittal: 228, horizontal: 160 };
  const world = regionalIndicesToWorld(indices);
  assert.deepEqual(world, { ml: -39, ap: -1200, dv: -3668 });
  assert.deepEqual(worldToRegionalIndices(world), indices);
  assert.deepEqual(cursorStateToWorld(worldToCursorState(world)), world);
});

test('projection affines round-trip a scientific cursor', () => {
  const indexToWorld: Matrix4 = [
    0, 25, 0, -5739,
    -25, 0, 0, 5400,
    0, 0, -25, 332,
    0, 0, 0, 1,
  ];
  const worldToIndex: Matrix4 = [
    0, -0.04, 0, 216,
    0.04, 0, 0, 229.56,
    0, 0, -0.04, 13.28,
    0, 0, 0, 1,
  ];
  assertInverseAffines(indexToWorld, worldToIndex);
  const plane = { slice: 264, u: 228, v: 160 };
  const world = planeToWorld(indexToWorld, plane);
  assert.deepEqual(world, { ml: -39, ap: -1200, dv: -3668 });
  const roundTrip = worldToPlane(worldToIndex, world);
  assert.ok(Math.abs(roundTrip.slice - plane.slice) < 1e-9);
  assert.ok(Math.abs(roundTrip.u - plane.u) < 1e-9);
  assert.ok(Math.abs(roundTrip.v - plane.v) < 1e-9);
  assert.deepEqual(applyAffine(indexToWorld, [264, 228, 160]), [-39, -1200, -3668]);
});

test('region id extraction follows v1 mapping class convention', () => {
  assert.equal(regionIdFromClassNames('beryl', ['foo', 'beryl_region_202']), 202);
  assert.equal(regionIdFromClassNames('allen', ['beryl_region_202']), null);
});

test('generated anatomy exposes direct stable IDs for every parcellation', () => {
  const attributes = new Map([['data-allen-id', '-10'], ['data-beryl-id', '-20'], ['data-cosmos-id', '-30']]);
  assert.equal(regionIdFromAtlasAttributes('allen', (name) => attributes.get(name) ?? null), -10);
  assert.equal(regionIdFromAtlasAttributes('beryl', (name) => attributes.get(name) ?? null), -20);
  assert.equal(regionIdFromAtlasAttributes('cosmos', (name) => attributes.get(name) ?? null), -30);
  const fragment = anatomySliceSvgFragment({
    axis: 'coronal', sliceIndex: 0, worldCoordinateUm: 0,
    viewBox: { x: -0.5, y: -0.5, width: 2, height: 2 },
    paths: [{ atlasIds: { allen: -10, beryl: -20, cosmos: -30 }, d: 'M0 0L1 0Z' }],
  });
  assert.match(fragment, /data-allen-id="-10"/);
  assert.match(fragment, /data-beryl-id="-20"/);
  assert.match(fragment, /data-cosmos-id="-30"/);
  assert.match(fragment, /fill-rule="evenodd"/);
});
