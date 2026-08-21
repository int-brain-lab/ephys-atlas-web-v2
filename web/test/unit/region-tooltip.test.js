import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRegionTooltipModel } from '../../.test-dist/ui/regional/model.js';

const feature = {
  schemaVersion: '0.1',
  featureId: 'rms',
  representation: 'regional',
  parcellation: 'allen',
  regionIds: ['-382'],
  statistics: { mean: [-89.5098], count: [15324] },
};
const descriptor = { unit: 'dB rel. V**2/Hz' };
const coloring = {
  mode: 'feature', statistic: 'mean', colormap: 'viridis', range: { mode: 'auto' }, scale: 'linear',
};
const regions = [{ id: '-382', atlasId: -382, index: 0, acronym: 'CA1', name: 'Field CA1 (left)' }];

test('region tooltip reports the active value, population count, and physical hemisphere', () => {
  const base = { regionId: '-382', axis: 'coronal', sliceIndex: 1, parcellation: 'allen', clientX: 10, clientY: 20 };
  assert.deepEqual(buildRegionTooltipModel(
    { ...base, physicalRegionId: -382 }, regions, feature, descriptor, coloring,
  ), {
    acronym: 'CA1',
    name: 'Field CA1',
    valueLabel: 'Mean',
    valueText: '-89.51 dB rel. V**2/Hz',
    meta: 'Left hemisphere · n=15,324',
  });
  assert.equal(buildRegionTooltipModel(
    { ...base, physicalRegionId: 382 }, regions, feature, descriptor, coloring,
  )?.meta, 'Right hemisphere · anatomy reference · n=15,324');
});

test('region tooltip makes missing values explicit', () => {
  const inspection = {
    regionId: '-382', physicalRegionId: -382, axis: 'coronal', sliceIndex: 1,
    parcellation: 'allen', clientX: 10, clientY: 20,
  };
  const missing = { ...feature, statistics: { mean: [Number.NaN], count: [0] } };
  assert.equal(buildRegionTooltipModel(inspection, regions, missing, descriptor, coloring)?.valueText, 'Value unavailable');
});
