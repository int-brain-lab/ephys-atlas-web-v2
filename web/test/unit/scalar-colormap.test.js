import assert from 'node:assert/strict';
import test from 'node:test';
import {
  atlasRegionColorMap,
  bilateralAtlasRegionColorMap,
  darkThemeAtlasColor,
  effectiveScalarColorRange,
  regionalColorMap,
} from '../../.test-dist/application/scalar-colormap.js';
import { resolveColoringState } from '../../.test-dist/domain/color-scale.js';
import {
  COLORMAPS,
  paletteCssColor,
  paletteCssGradient,
  paletteRgb,
} from '../../.test-dist/application/colormap-palettes.js';

const feature = {
  schemaVersion: '1.0',
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
  assert.deepEqual(effectiveScalarColorRange(feature, coloring), [0.25, 1.75]);
});

test('release-declared automatic range takes precedence without becoming manual state', () => {
  const display = {
    range: [0.5, 1.5], scales: [{ kind: 'linear' }], preferredScale: 'linear',
    distributionDomains: [{ kind: 'full' }], preferredDistributionDomain: 'full',
  };
  assert.deepEqual(effectiveScalarColorRange(feature, coloring, display), [0.5, 1.5]);
  assert.deepEqual(coloring.range, { mode: 'auto' });
});

test('one color-range resolver shares manual, release, and robust precedence across representations', () => {
  const display = {
    range: [0.5, 1.5], scales: [{ kind: 'linear' }], preferredScale: 'linear',
    distributionDomains: [{ kind: 'full' }], preferredDistributionDomain: 'full',
  };
  const manual = { ...coloring, range: { mode: 'fixed', min: -2, max: 8 } };
  assert.deepEqual(effectiveScalarColorRange(feature, manual, display), [-2, 8]);
  const volume = {
    schemaVersion: '1.0', featureId: 'volume', representation: 'volume', descriptor: {},
    summary: { valueRange: [10, 20], validVoxelCount: 2 },
  };
  assert.deepEqual(effectiveScalarColorRange(volume, coloring, display), [0.5, 1.5]);
  assert.deepEqual(effectiveScalarColorRange(volume, coloring), [10, 20]);
});

test('regional colors are keyed by numeric atlas ids', () => {
  const colors = regionalColorMap(feature, coloring);
  assert.equal(colors.size, 3);
  assert.match(colors.get(10), /^rgb\(/);
  assert.notEqual(colors.get(10), colors.get(30));
});

test('shared colormap registry exposes official sequential lookup tables', () => {
  assert.deepEqual(COLORMAPS.map(({ id }) => id), ['viridis', 'cividis', 'magma']);
  assert.deepEqual(paletteRgb('cividis', 0), [0, 34, 78]);
  assert.deepEqual(paletteRgb('cividis', 1), [254, 232, 56]);
  assert.equal(paletteCssColor('unknown', 0), 'rgb(68 1 84)');
  assert.match(paletteCssGradient('cividis'), /^linear-gradient\(90deg, rgb\(0 34 78\).+rgb\(254 232 56\)\)$/);
});

test('Cividis colors regional values through the shared lookup table', () => {
  const colors = regionalColorMap(feature, {
    ...coloring,
    colormap: 'cividis',
    range: { mode: 'fixed', min: 0, max: 2 },
  });
  assert.equal(colors.get(10), 'rgb(0 34 78)');
  assert.equal(colors.get(30), 'rgb(254 232 56)');
});

test('automatic color scale resolves from the feature display default', () => {
  assert.deepEqual(resolveColoringState({ ...coloring, scale: 'auto' }, 'log').scale, { kind: 'log' });
  assert.deepEqual(resolveColoringState({ ...coloring, scale: 'auto' }, undefined).scale, { kind: 'linear' });
  assert.deepEqual(resolveColoringState({ ...coloring, scale: 'linear' }, 'log').scale, { kind: 'linear' });
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
