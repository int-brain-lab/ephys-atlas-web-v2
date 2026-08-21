import assert from 'node:assert/strict';
import test from 'node:test';
import {
  atlasRegionColorMap,
  bilateralAtlasRegionColorMap,
  bilateralFeatureColorMap,
  darkThemeAtlasColor,
  regionalColorMap,
  regionalColorRange,
} from '../../.test-dist/rendering/scalar-colormap.js';
import { resolveColoringState } from '../../.test-dist/domain/color-scale.js';

const feature = {
  schemaVersion: '0.1',
  featureId: 'x',
  representation: 'regional',
  parcellation: 'allen',
  regionIds: ['10', '20', '30'],
  statistics: { mean: [0, 1, 2] },
  global: { q05: 0.25, q95: 1.75 },
};

const coloring = {
  statistic: 'mean',
  colormap: 'viridis',
  range: { mode: 'auto' },
  scale: 'linear',
};

test('auto regional color range prefers global robust quantiles', () => {
  assert.deepEqual(regionalColorRange(feature, coloring), [0.25, 1.75]);
});

test('regional colors are keyed by numeric atlas ids', () => {
  const colors = regionalColorMap(feature, coloring);
  assert.equal(colors.size, 3);
  assert.match(colors.get(10), /^rgb\(/);
  assert.notEqual(colors.get(10), colors.get(30));
});

test('automatic color scale resolves from the feature display default', () => {
  assert.equal(resolveColoringState({ ...coloring, scale: 'auto' }, 'log').scale, 'log');
  assert.equal(resolveColoringState({ ...coloring, scale: 'auto' }, undefined).scale, 'linear');
  assert.equal(resolveColoringState({ ...coloring, scale: 'linear' }, 'log').scale, 'linear');
});

test('log color mapping rejects an invalid domain and omits non-positive values', () => {
  const invalidRange = { ...coloring, range: { mode: 'fixed', min: 0, max: 2 }, scale: 'log' };
  assert.equal(regionalColorMap(feature, invalidRange).size, 0);
  const positiveRange = { ...coloring, range: { mode: 'fixed', min: 0.5, max: 2 }, scale: 'log' };
  const colors = regionalColorMap(feature, positiveRange);
  assert.equal(colors.has(10), false);
  assert.equal(colors.has(20), true);
  assert.equal(colors.has(30), true);
});

test('atlas colors are keyed by scientific atlas ids', () => {
  assert.deepEqual([...atlasRegionColorMap([
    { id: '-10', atlasId: -10, index: 0, acronym: 'SCig', name: 'Region', colorHex: '#ff90ff' },
  ])], [[-10, '#ff90ff']]);
});

test('bilateral anatomy colors both homologues with the official ontology color', () => {
  const regions = [{ id: '-10', atlasId: -10, index: 0, acronym: 'SCig', name: 'Region', colorHex: '#ff90ff' }];
  assert.deepEqual([...bilateralAtlasRegionColorMap(regions)], [[-10, '#ff90ff'], [10, '#ff90ff']]);
});

test('dark anatomy presentation tones down only near-white neutral atlas colors', () => {
  assert.equal(darkThemeAtlasColor('#ffffff'), '#73818b');
  assert.equal(darkThemeAtlasColor('#cccccc'), '#616f79');
  assert.equal(darkThemeAtlasColor('#ff90ff'), '#ff90ff');
  assert.equal(darkThemeAtlasColor('#fffdbc'), '#fffdbc');
  const regions = [{ id: '-1009', atlasId: -1009, index: 0, acronym: 'fiber tracts', name: 'fiber tracts', colorHex: '#cccccc' }];
  assert.deepEqual([...bilateralAtlasRegionColorMap(regions)], [[-1009, '#616f79'], [1009, '#616f79']]);
});

test('bilateral feature mode keeps feature color left and ontology reference right', () => {
  const foldedFeature = { ...feature, regionIds: ['-10', '-20', '-30'] };
  const regions = [
    { id: '-10', atlasId: -10, index: 0, acronym: 'R1', name: 'Region 1', colorHex: '#ff90ff' },
    { id: '-20', atlasId: -20, index: 1, acronym: 'R2', name: 'Region 2', colorHex: '#00ff00' },
  ];
  const colors = bilateralFeatureColorMap(foldedFeature, coloring, regions);
  assert.match(colors.get(-10), /^rgb\(/);
  assert.equal(colors.get(10), '#ff90ff');
  assert.equal(colors.get(20), '#00ff00');
  assert.notEqual(colors.get(-10), colors.get(10));
});
