import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLegacyRegionCrosswalk } from '../../.test-dist/rendering/legacy-region-crosswalk.js';
import { regionIdFromClassNames } from '../../.test-dist/rendering/region-id.js';

// Real entries from the pinned v1 regions.json. In particular, atlas ID 997
// is deliberately not SVG/BrainRegions index 997: its legacy index is 1.
const realisticRegions = {
  beryl: [
    { acronym: 'PN', atlas_id: -607344830, idx: 2152 },
    { acronym: 'root', atlas_id: 997, idx: 1 },
  ],
};

test('legacy SVG class indices crosswalk to stable atlas IDs in both directions', () => {
  const crosswalk = parseLegacyRegionCrosswalk(realisticRegions, 'beryl');
  const svgIndex = regionIdFromClassNames('beryl', ['brain-region', 'beryl_region_1']);

  assert.equal(svgIndex, 1);
  assert.equal(crosswalk.legacyIndexToAtlasId.get(svgIndex), 997);
  assert.equal(crosswalk.atlasIdToLegacyIndex.get(997), 1);
  assert.notEqual(crosswalk.atlasIdToLegacyIndex.get(997), 997);
  assert.equal(crosswalk.atlasIdToLegacyIndex.get(-607344830), 2152);
  assert.equal(crosswalk.legacyIndexToAtlasId.get(2152), -607344830);
});

test('crosswalk rejects a missing parcellation instead of silently mixing ID domains', () => {
  assert.throws(() => parseLegacyRegionCrosswalk(realisticRegions, 'cosmos'), /no cosmos mapping/);
});
