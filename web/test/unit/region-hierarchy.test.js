import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
    idx: 0,
    mapped_atlas_ids: { allen: atlasId, beryl: atlasId, cosmos: atlasId },
    mapping_member: mappingMember,
    name: acronym,
    parent_id: parentId,
  };
}

function document(leftRows) {
  const voidRow = row(0, 'void', null, 0);
  const rightRows = leftRows.map((source) => ({
    ...source,
    atlas_id: Math.abs(source.atlas_id),
    parent_id: source.parent_id === null ? null : Math.abs(source.parent_id),
    mapped_atlas_ids: Object.fromEntries(
      Object.entries(source.mapped_atlas_ids).map(([mapping, id]) => [mapping, Math.abs(id)]),
    ),
  }));
  const rows = [voidRow, ...rightRows, ...leftRows].map((source, idx) => ({ ...source, idx }));
  return {
    atlas: 'Allen Mouse CCF 2017',
    format: 'ibl-atlas-regions-v1',
    hemisphere_encoding: 'signed atlas IDs; negative is left',
    reference_space_id: 'allen-ccf-2017',
    schema_version: '1.0',
    provenance: {
      iblatlas_commit: '1'.repeat(40),
      legacy_svg_crosswalk_sha256: '2'.repeat(64),
      legacy_svg_crosswalk_url: 'https://example.test/regions.json',
    },
    mappings: {
      allen: structuredClone(rows),
      beryl: structuredClone(rows),
      cosmos: structuredClone(rows),
    },
  };
}

test('catalog hierarchy follows parent IDs at arbitrary depth and retains ontology identity', () => {
  const rows = [
    row(-30, 'leaf', -20, 2, true, '#abcdef'),
    row(-10, 'root', null, 0, false),
    row(-20, 'branch', -10, 1, false),
  ];
  const catalog = parseAtlasRegionCatalog(document(rows));
  assert.equal(catalog.referenceSpaceId, 'allen-ccf-2017');
  assert.deepEqual(catalog.physical.allen.map((region) => region.atlasId), [0, 30, 10, 20, -30, -10, -20]);
  assert.deepEqual(catalog.left.allen.map((region) => region.atlasId), [0, -30, -10, -20]);
  assert.deepEqual(catalog.logical.allen.map((region) => region.atlasId), [0, 30, 10, 20]);
  const hierarchy = buildRegionHierarchy(catalog.left.allen.filter((region) => region.atlasId < 0));

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
  ])).left.allen;

  const hierarchy = buildGreyMatterHierarchy(regions);
  assert.deepEqual(hierarchy.map(({ region, depth }) => [region.id, region.parentId, depth]), [
    ['-567', null, 0],
    ['-688', '-567', 1],
    ['-343', null, 0],
    ['-512', null, 0],
  ]);
  assert.equal(regions.length, 8);
});

test('catalog rejects missing ontology parents', () => {
  const rows = [row(-10, 'orphan', -999, 1)];
  assert.throws(() => parseAtlasRegionCatalog(document(rows)), /missing parent (999|-999)/);
});

test('catalog rejects physical rows that violate the shared contract', () => {
  const missingVoid = document([row(-10, 'root', null, 0)]);
  for (const mapping of ['allen', 'beryl', 'cosmos']) missingVoid.mappings[mapping].shift();
  assert.throws(() => parseAtlasRegionCatalog(missingVoid), /void row/);

  const badIndex = document([row(-10, 'root', null, 0)]);
  badIndex.mappings.allen[2].idx = badIndex.mappings.allen[1].idx;
  assert.throws(() => parseAtlasRegionCatalog(badIndex), /duplicate index/);

  const badMapping = document([row(-10, 'root', null, 0)]);
  delete badMapping.mappings.allen[2].mapped_atlas_ids.cosmos;
  assert.throws(() => parseAtlasRegionCatalog(badMapping), /unsupported fields/);
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
  assert.match(request.input, /[?&]v=5$/);
  assert.equal(request.init.cache, 'no-cache');
});


test('immutable site atlas metadata is verified before parsing', async () => {
  const body = JSON.stringify(document([row(-10, 'root', null, 0)]));
  const integrity = { bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') };
  let request;
  const catalog = await loadAtlasRegionCatalog('/site/builds/test-only/atlas/allen-ccf-2017/regions.json', async (input, init) => {
    request = { input, init };
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }, integrity);
  assert.equal(request.input, 'http://localhost/site/builds/test-only/atlas/allen-ccf-2017/regions.json');
  assert.equal(request.init.cache, undefined);
  assert.equal(catalog.left.allen[1].acronym, 'root');

  await assert.rejects(
    loadAtlasRegionCatalog('/site/builds/test-only/atlas/allen-ccf-2017/regions.json', async () => new Response(body), { ...integrity, sha256: '0'.repeat(64) }),
    /SHA-256 mismatch/,
  );
});
