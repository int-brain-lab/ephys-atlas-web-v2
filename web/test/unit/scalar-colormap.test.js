import assert from 'node:assert/strict';
import test from 'node:test';
import { atlasRegionColorMap, regionalColorMap, regionalColorRange } from '../../.test-dist/rendering/scalar-colormap.js';

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
