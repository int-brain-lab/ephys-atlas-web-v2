import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import test from 'node:test';

import { GeneratedAnatomySliceSource, parseAnatomyPackManifest } from '../../.test-dist/rendering/generated-anatomy-source.js';

const FORWARD_25 = [25, 0, 0, 0, 0, 25, 0, 0, 0, 0, 25, 0, 0, 0, 0, 1];
const INVERSE_25 = [0.04, 0, 0, 0, 0, 0.04, 0, 0, 0, 0, 0.04, 0, 0, 0, 0, 1];
const transforms = {
  coronal: {
    fixed: 'ap', plane: ['ml', 'dv'],
    forward: [0, 25, 0, 0, 25, 0, 0, 0, 0, 0, 25, 0, 0, 0, 0, 1],
    inverse: [0, 0.04, 0, 0, 0.04, 0, 0, 0, 0, 0, 0.04, 0, 0, 0, 0, 1],
  },
  sagittal: {
    fixed: 'ml', plane: ['ap', 'dv'],
    forward: FORWARD_25,
    inverse: INVERSE_25,
  },
  horizontal: {
    fixed: 'dv', plane: ['ml', 'ap'],
    forward: [0, 25, 0, 0, 0, 0, 25, 0, 25, 0, 0, 0, 0, 0, 0, 1],
    inverse: [0, 0, 0.04, 0, 0.04, 0, 0, 0, 0, 0.04, 0, 0, 0, 0, 0, 1],
  },
};

function fixture() {
  const buffers = {};
  const projections = {};
  for (const axis of ['coronal', 'sagittal', 'horizontal']) {
    const path = `packs/${axis}/0000.json.gz`;
    const pack = {
      format: 'anatomy-slice-pack-v1', schema_version: '1.0', anatomy_pack_id: 'fixture-v1',
      projection: axis, pack_depth: 16, pack_index: 0, first_slice_index: 0, slice_count: 1,
      slices: [{
        slice_index: 0, world_coordinate_um: 0,
        paths: [{ atlas_ids: { allen: -10, beryl: -20, cosmos: -30 }, d: 'M0 0L1 0L1 1Z' }],
      }],
    };
    const compressed = gzipSync(JSON.stringify(pack), { mtime: 0 });
    buffers[path] = compressed;
    const transform = transforms[axis];
    projections[axis] = {
      fixed_world_axis: transform.fixed,
      plane_axes: transform.plane,
      slice_count: 1,
      slice_shape: [2, 3],
      view_box: [-0.5, -0.5, 3, 2],
      plane_index_to_world_um: transform.forward,
      world_to_plane_index: transform.inverse,
      pack_sets: {
        16: {
          pack_depth: 16,
          path_template: `packs/${axis}/{pack}.json.gz`,
          packs: [{
            pack_index: 0, first_slice_index: 0, slice_count: 1, path,
            media_type: 'application/json', compression: 'gzip', bytes: compressed.byteLength,
            uncompressed_bytes: Buffer.byteLength(JSON.stringify(pack)),
            sha256: createHash('sha256').update(compressed).digest('hex'),
          }],
        },
      },
    };
  }
  return {
    buffers,
    manifest: {
      format: 'anatomy-pack-v1', schema_version: '1.0', pack_id: 'fixture-v1', immutable: true,
      created_at: '2026-08-20T00:00:00Z',
      source: {
        atlas: 'Allen CCFv3', resolution_um: 25, hemisphere: 'left',
        annotation: { path: 'annotation.nrrd', bytes: 1, sha256: '0'.repeat(64) },
        region_lut: { path: 'lut.npz', bytes: 1, sha256: '1'.repeat(64) },
        region_ids: { domain: 'signed_allen_atlas_id', left_sign: 'negative', background_id: 0 },
      },
      coordinate_system: {
        name: 'Allen CCF', units: 'um', world_axes: ['ml', 'ap', 'dv'],
        voxel_centers: 'integer-indices', voxel_edges: 'half-integer-indices', matrix_order: 'row-major',
      },
      projections,
      provenance: { generator: 'fixture' }, validation: { topology: true },
      synchronization_sentinels: [{
        name: 'origin', world_um: [0, 0, 0],
        projection_indices: { coronal: [0, 0, 0], sagittal: [0, 0, 0], horizontal: [0, 0, 0] },
      }, {
        name: 'origin-copy', world_um: [0, 0, 0],
        projection_indices: { coronal: [0, 0, 0], sagittal: [0, 0, 0], horizontal: [0, 0, 0] },
      }],
    },
  };
}

test('generated anatomy source validates, verifies, decodes, and caches immutable gzip packs', async () => {
  const { manifest, buffers } = fixture();
  const requests = new Map();
  const fetchImpl = async (input) => {
    const url = String(input);
    requests.set(url, (requests.get(url) ?? 0) + 1);
    if (url.endsWith('/manifest.json')) return new Response(JSON.stringify(manifest), { status: 200 });
    const path = url.split('/anatomy/')[1];
    const body = buffers[path];
    return body ? new Response(body, { status: 200 }) : new Response('missing', { status: 404 });
  };
  const source = new GeneratedAnatomySliceSource({ manifestUrl: 'https://example.test/anatomy/manifest.json', fetchImpl });
  const first = await source.loadSlice('coronal', 0);
  const second = await source.loadSlice('coronal', 0);
  assert.deepEqual(first.paths, [{ atlasIds: { allen: -10, beryl: -20, cosmos: -30 }, d: 'M0 0L1 0L1 1Z' }]);
  assert.deepEqual(first.viewBox, { x: -0.5, y: -0.5, width: 3, height: 2 });
  assert.deepEqual(second, first);
  assert.equal(requests.get('https://example.test/anatomy/packs/coronal/0000.json.gz'), 1);
  assert.deepEqual(await source.worldFromSliceIndices({ coronal: 0, sagittal: 0, horizontal: 0 }), { ml: 0, ap: 0, dv: 0 });
  assert.deepEqual(await source.guidesForWorld('coronal', { ml: 25, ap: 0, dv: 50 }), [
    { sourceAxis: 'sagittal', targetAxis: 'coronal', dimension: 'x', position: 1 },
    { sourceAxis: 'horizontal', targetAxis: 'coronal', dimension: 'y', position: 2 },
  ]);
});

test('generated anatomy source fails closed on a pack SHA mismatch', async () => {
  const { manifest, buffers } = fixture();
  manifest.projections.coronal.pack_sets[16].packs[0].sha256 = 'f'.repeat(64);
  const source = new GeneratedAnatomySliceSource({
    manifestUrl: 'https://example.test/anatomy/manifest.json',
    fetchImpl: async (input) => String(input).endsWith('/manifest.json')
      ? new Response(JSON.stringify(manifest), { status: 200 })
      : new Response(buffers['packs/coronal/0000.json.gz'], { status: 200 }),
  });
  await assert.rejects(source.loadSlice('coronal', 0), /SHA-256 mismatch/);
});

test('anatomy manifest rejects ambiguous coordinate and ID conventions', () => {
  const { manifest } = fixture();
  manifest.coordinate_system.world_axes = ['ap', 'ml', 'dv'];
  assert.throws(() => parseAnatomyPackManifest(manifest), /world_axes/);
});

test('browser parser consumes the canonical anatomy-pack-v1 fixture', () => {
  const fixtureManifest = JSON.parse(readFileSync(
    new URL('../../../fixtures/anatomy/anatomy-pack-v1/manifest.json', import.meta.url),
    'utf8',
  ));
  const parsed = parseAnatomyPackManifest(fixtureManifest);
  assert.equal(parsed.packId, 'synthetic-left-25um-v1');
  assert.deepEqual(parsed.synchronizationSentinels[0].worldUm, [-300, 50, -100]);
});
