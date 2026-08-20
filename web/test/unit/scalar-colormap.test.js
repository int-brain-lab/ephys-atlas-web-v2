import assert from 'node:assert/strict';
import test from 'node:test';
import {
  atlasRegionColorMap,
  bilateralAtlasRegionColorMap,
  bilateralFeatureColorMap,
  regionalColorMap,
  regionalColorRange,
} from '../../.test-dist/rendering/scalar-colormap.js';

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

test('atlas colors are keyed by scientific atlas ids', () => {
  assert.deepEqual([...atlasRegionColorMap([
    { id: '-10', atlasId: -10, index: 0, acronym: 'SCig', name: 'Region', colorHex: '#ff90ff' },
  ])], [[-10, '#ff90ff']]);
});

test('bilateral anatomy colors both homologues with the official ontology color', () => {
  const regions = [{ id: '-10', atlasId: -10, index: 0, acronym: 'SCig', name: 'Region', colorHex: '#ff90ff' }];
  assert.deepEqual([...bilateralAtlasRegionColorMap(regions)], [[-10, '#ff90ff'], [10, '#ff90ff']]);
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
