import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALLEN_ATLAS_REGIONS_URL,
  loadAtlasRegionCatalog,
  parseAtlasRegionCatalog,
} from '../../.test-dist/data/atlas-regions.js';
import { buildGreyMatterHierarchy, buildRegionHierarchy } from '../../.test-dist/data/region-hierarchy.js';

function row(atlasId, acronym, parentId, depth, mappingMember = true, colorHex = '#123456') {
  return {
    acronym,
    atlas_id: atlasId,
    color_hex: colorHex,
    depth,
    idx: Math.abs(atlasId),
    mapping_member: mappingMember,
    name: acronym,
    parent_id: parentId,
  };
}

function document(rows) {
  return {
    atlas: 'Allen Mouse CCF 2017',
    format: 'ibl-atlas-regions-v1',
    schema_version: '1.0',
    mappings: { allen: rows, beryl: rows, cosmos: rows },
  };
}

test('catalog hierarchy follows parent IDs at arbitrary depth and retains ontology identity', () => {
  const rows = [
    row(-30, 'leaf', -20, 99, true, '#abcdef'),
    row(-10, 'root', null, 99, false),
    row(-20, 'branch', -10, 99, false),
  ];
  const catalog = parseAtlasRegionCatalog(document(rows));
  const hierarchy = buildRegionHierarchy(catalog.mappings.allen);

  assert.deepEqual(hierarchy.map(({ region, depth, hasChildren }) => [region.id, depth, hasChildren]), [
    ['-10', 0, true],
    ['-20', 1, true],
    ['-30', 2, false],
  ]);
  assert.equal(hierarchy[2].region.colorHex, '#abcdef');
  assert.equal(hierarchy[1].region.mappingMember, false);
});

test('grey-matter projection promotes CH, BS, and CB while retaining the full catalog outside the view', () => {
  const regions = parseAtlasRegionCatalog(document([
    row(-997, 'root', null, 0),
    row(-8, 'grey', -997, 1),
    row(-567, 'CH', -8, 2),
    row(-688, 'CTX', -567, 3),
    row(-343, 'BS', -8, 2),
    row(-512, 'CB', -8, 2),
    row(-1009, 'fiber tracts', -997, 1),
  ])).mappings.allen;

  const hierarchy = buildGreyMatterHierarchy(regions);
  assert.deepEqual(hierarchy.map(({ region, depth }) => [region.id, region.parentId, depth]), [
    ['-567', null, 0],
    ['-688', '-567', 1],
    ['-343', null, 0],
    ['-512', null, 0],
  ]);
  assert.equal(regions.length, 7);
});

test('catalog rejects missing ontology parents', () => {
  const rows = [row(-10, 'orphan', -999, 1)];
  assert.throws(() => parseAtlasRegionCatalog(document(rows)), /missing parent -999/);
});

test('hierarchy rejects cycles even when every parent ID exists', () => {
  const regions = [
    { id: '-1', atlasId: -1, index: 0, acronym: 'A', name: 'A', parentId: '-2' },
    { id: '-2', atlasId: -2, index: 1, acronym: 'B', name: 'B', parentId: '-1' },
  ];
  assert.throws(() => buildRegionHierarchy(regions), /cycle/);
});

test('catalog loading bypasses incompatible cached hierarchy metadata', async () => {
  let request;
  const fetchImpl = async (input, init) => {
    request = { input, init };
    return { ok: true, json: async () => document([row(-10, 'root', null, 0)]) };
  };

  await loadAtlasRegionCatalog(undefined, fetchImpl);

  assert.equal(request.input, ALLEN_ATLAS_REGIONS_URL);
  assert.match(request.input, /[?&]v=3$/);
  assert.equal(request.init.cache, 'no-cache');
});
