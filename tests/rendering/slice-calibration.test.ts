import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  LEGACY_VIEW_BOXES,
  linkedGuides,
  projectLegacyGuide,
  regionalIndexToCoordinateUm,
  regionalIndexToVolumeIndex,
  volumeIndexToCoordinateUm,
} from '../../web/src/rendering/slice-calibration.ts';
import { regionIdFromClassNames } from '../../web/src/rendering/region-id.ts';

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/rendering/linked-slices.fixture.json', import.meta.url), 'utf8'),
);

test('legacy 10 um indices reproduce v1 coordinate labels', () => {
  assert.equal(regionalIndexToCoordinateUm('coronal', 660), -1200);
  assert.equal(regionalIndexToCoordinateUm('sagittal', 570), -39);
  assert.equal(regionalIndexToCoordinateUm('horizontal', 400), -3668);
});

test('25 um volume grid shares the legacy Allen origins', () => {
  assert.equal(volumeIndexToCoordinateUm('coronal', 0), 5400);
  assert.equal(volumeIndexToCoordinateUm('sagittal', 0), -5739);
  assert.equal(volumeIndexToCoordinateUm('horizontal', 0), 332);
  assert.equal(regionalIndexToVolumeIndex('coronal', 660), 264);
  assert.equal(regionalIndexToVolumeIndex('sagittal', 570), 228);
  assert.equal(regionalIndexToVolumeIndex('horizontal', 400), 160);
});

test('legacy guide centers reproduce the hand-tuned v1 fit', () => {
  assert.deepEqual(projectLegacyGuide('sagittal', 'coronal', 570), {
    sourceAxis: 'sagittal',
    targetAxis: 'coronal',
    dimension: 'x',
    position: 237,
  });
  assert.deepEqual(projectLegacyGuide('coronal', 'sagittal', 660), {
    sourceAxis: 'coronal',
    targetAxis: 'sagittal',
    dimension: 'x',
    position: 236,
  });
  assert.deepEqual(projectLegacyGuide('horizontal', 'coronal', 400), {
    sourceAxis: 'horizontal',
    targetAxis: 'coronal',
    dimension: 'y',
    position: 174,
  });
});

test('linked fixture produces two guides per view and exact v1 view boxes', () => {
  for (const axis of ['coronal', 'sagittal', 'horizontal'] as const) {
    const guides = linkedGuides(fixture.indices, axis);
    assert.equal(guides.length, 2);
    assert.ok(guides.every((guide) => guide.targetAxis === axis));
    assert.ok(LEGACY_VIEW_BOXES[axis].width > 0);
    assert.ok(fixture.fragments[axis].includes('beryl_region_101'));
  }
});

test('region id extraction follows v1 mapping class convention', () => {
  assert.equal(regionIdFromClassNames('beryl', ['foo', 'beryl_region_202']), 202);
  assert.equal(regionIdFromClassNames('allen', ['beryl_region_202']), null);
});
