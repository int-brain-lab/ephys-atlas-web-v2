import assert from 'node:assert/strict';
import test from 'node:test';
import {
  regionalPresentationColors,
  resolveRegionalPresentation,
  retainRegionalPresentationWhileMappingLoads,
} from '../../.test-dist/application/regional-presentation.js';

const regions = [
  { id: '-10', atlasId: -10, index: 0, acronym: 'A', name: 'Alpha', colorHex: '#ff90ff' },
  { id: '-20', atlasId: -20, index: 1, acronym: 'B', name: 'Beta', colorHex: '#00ff00' },
];
const feature = {
  schemaVersion: '1.0', featureId: 'fixture', representation: 'regional', parcellation: 'allen',
  regionIds: ['-10', '-20'], statistics: { mean: [1, Number.NaN] }, global: { q05: 0, q95: 2 },
};
const coloring = { mode: 'feature', statistic: 'mean', colormap: 'viridis', range: { mode: 'auto' }, scale: 'linear' };

test('resolver produces bilateral anatomy, visibility, selection, and folded hover for every mapping', () => {
  for (const mapping of ['allen', 'beryl', 'cosmos']) {
    const presentation = resolveRegionalPresentation({
      mapping, feature: null, anatomyRegions: regions,
      coloring: { ...coloring, mode: 'anatomy' }, selectedRegionIds: ['10', '-20', 'bad'], hoveredRegionId: '20',
    });
    assert.equal(presentation.mapping, mapping);
    assert.deepEqual([...presentation.visibleRegionIds], [-10, 10, -20, 20]);
    assert.deepEqual([...presentation.selectedRegionIds], [-10, 10, -20, 20]);
    assert.equal(presentation.highlightedRegionId, -20);
    assert.equal(presentation.anatomyColors.get(-10), '#ff90ff');
    assert.equal(presentation.anatomyColors.get(10), '#ff90ff');
    assert.equal(presentation.featureColors, null);
    assert.equal(presentation.featureSide, null);
  }
});

test('feature semantics color only finite left values and retain right anatomy', () => {
  const presentation = resolveRegionalPresentation({
    mapping: 'allen', feature, anatomyRegions: regions, coloring,
    selectedRegionIds: [], hoveredRegionId: null,
  });
  assert.equal(presentation.featureSide, 'left');
  assert.match(presentation.featureColors.get(-10), /^rgb\(/);
  assert.equal(presentation.featureColors.has(-20), false);
  const colors = regionalPresentationColors(presentation, true);
  assert.match(colors.get(-10), /^rgb\(/);
  assert.equal(colors.has(-20), false);
  assert.equal(colors.get(10), '#ff90ff');
  assert.equal(colors.get(20), '#00ff00');
});

test('mismatched regional payload retains bilateral anatomy colors as a safe fallback', () => {
  const presentation = resolveRegionalPresentation({
    mapping: 'beryl', feature, anatomyRegions: regions, coloring,
    selectedRegionIds: [], hoveredRegionId: null,
  });
  assert.equal(presentation.featureColors, null);
  assert.equal(presentation.featureSide, null);
  assert.deepEqual([...regionalPresentationColors(presentation, true).keys()], [-10, 10, -20, 20]);
});

test('parcellation loading retains the last coherent colors and clears interaction state', () => {
  const previous = resolveRegionalPresentation({
    mapping: 'allen', feature, anatomyRegions: regions, coloring,
    selectedRegionIds: ['-10'], hoveredRegionId: '-20',
  });
  const pending = resolveRegionalPresentation({
    mapping: 'beryl', feature, anatomyRegions: regions, coloring,
    selectedRegionIds: [], hoveredRegionId: null,
  });
  const retained = retainRegionalPresentationWhileMappingLoads(previous, pending, feature);

  assert.equal(retained.mapping, 'allen');
  assert.equal(retained.featureColors, previous.featureColors);
  assert.deepEqual([...retained.selectedRegionIds], []);
  assert.equal(retained.highlightedRegionId, null);

  const berylFeature = { ...feature, parcellation: 'beryl' };
  const ready = resolveRegionalPresentation({
    mapping: 'beryl', feature: berylFeature, anatomyRegions: regions, coloring,
    selectedRegionIds: [], hoveredRegionId: null,
  });
  assert.equal(retainRegionalPresentationWhileMappingLoads(retained, ready, berylFeature), ready);
});

test('volume presentation reserves registered left feature space but static and 3-D can remain anatomy-only', () => {
  const volume = { schemaVersion: '1.0', featureId: 'volume', representation: 'volume', descriptor: {} };
  const presentation = resolveRegionalPresentation({
    mapping: 'cosmos', feature: volume, anatomyRegions: regions, coloring,
    selectedRegionIds: [], hoveredRegionId: null,
  });
  assert.equal(presentation.featureColors, null);
  assert.equal(presentation.featureSide, 'left');
  assert.deepEqual([...regionalPresentationColors(presentation, true).keys()], [10, 20]);
  assert.deepEqual([...regionalPresentationColors(presentation, false).keys()], [-10, 10, -20, 20]);
});
