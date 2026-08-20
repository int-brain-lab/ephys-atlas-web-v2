import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
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
      provenance: {
        iblatlas: { repository: 'int-brain-lab/iblatlas', commit: '52083ad' },
        generator: { repository: 'fixture', commit: '0123456', dirty: false },
        shapely_version: '2.1.1', geos_version: '3.13.1',
        simplification: {
          algorithm: 'GEOS coverage_simplify', tolerance_um: 12.5,
          boundary_sampling_interval_voxels: 0.25, boundary_error_bound_um: 3.125,
        },
      },
      validation: {
        topology_valid: true, coverage_valid: true, uncovered_voxels: 0, multiply_covered_voxels: 0,
        adjacency_mismatches: 0, invalid_geometries: 0, missing_atlas_ids: [], source_slices: 3, emitted_slices: 3,
        boundary_error_um: { worst_slice_median: 0, worst_slice_p95: 0, max_upper_bound: 0 },
        accepted_max_boundary_error_um: 12.5, minimum_eligible_region_iou: 1,
        accepted_minimum_region_iou: 0.98, coordinate_tolerance_um: 1e-6, sentinel_max_error_um: 0,
      },
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

function bilateralFixture() {
  const result = fixture();
  result.manifest.format = 'anatomy-pack-v2';
  result.manifest.schema_version = '2.0';
  result.manifest.pack_id = 'fixture-v2';
  result.manifest.source.resolution_um = 10;
  result.manifest.source.hemisphere = 'bilateral';
  result.manifest.source.region_ids.right_sign = 'positive';
  result.manifest.provenance.simplification.algorithm = 'exact collinear vertex removal';
  result.manifest.provenance.simplification.tolerance_um = 0;
  result.manifest.provenance.simplification.boundary_error_bound_um = 0;
  Object.assign(result.manifest.validation, {
    background_topology_valid: true,
    internal_background_components_before: 1,
    internal_background_components_after: 1,
  });
  for (const axis of ['coronal', 'sagittal', 'horizontal']) {
    const projection = result.manifest.projections[axis];
    projection.plane_index_to_world_um = projection.plane_index_to_world_um.map((value, index) => index % 4 === 3 ? value : value * 0.4);
    projection.world_to_plane_index = projection.world_to_plane_index.map((value, index) => index % 4 === 3 ? value : value * 2.5);
    const descriptor = projection.pack_sets[16].packs[0];
    const payload = JSON.parse(gunzipSync(result.buffers[descriptor.path]).toString());
    payload.format = 'anatomy-slice-pack-v2';
    payload.schema_version = '2.0';
    payload.anatomy_pack_id = 'fixture-v2';
    for (const slice of payload.slices) {
      for (const path of slice.paths) path.fill_rule = 'evenodd';
      slice.paths.push({
        atlas_ids: { allen: 10, beryl: 20, cosmos: 30 },
        fill_rule: 'evenodd', d: 'M1 0L2 0L2 1Z',
      });
    }
    const encoded = JSON.stringify(payload);
    const compressed = gzipSync(encoded, { mtime: 0 });
    result.buffers[descriptor.path] = compressed;
    descriptor.bytes = compressed.byteLength;
    descriptor.uncompressed_bytes = Buffer.byteLength(encoded);
    descriptor.sha256 = createHash('sha256').update(compressed).digest('hex');
  }
  return result;
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

test('generated anatomy source consumes bilateral v2 packs with signed hemisphere IDs', async () => {
  const { manifest, buffers } = bilateralFixture();
  const source = new GeneratedAnatomySliceSource({
    manifestUrl: 'https://example.test/anatomy/manifest.json',
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) return new Response(JSON.stringify(manifest), { status: 200 });
      const body = buffers[url.split('/anatomy/')[1]];
      return body ? new Response(body, { status: 200 }) : new Response('missing', { status: 404 });
    },
  });
  const slice = await source.loadSlice('coronal', 0);
  assert.deepEqual(slice.paths.map((path) => path.atlasIds), [
    { allen: -10, beryl: -20, cosmos: -30 },
    { allen: 10, beryl: 20, cosmos: 30 },
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

test('localhost anatomy bypasses stale development caches', async () => {
  const { manifest } = fixture();
  let cacheMode = null;
  const source = new GeneratedAnatomySliceSource({
    manifestUrl: 'http://127.0.0.1:5173/anatomy/manifest.json',
    fetchImpl: async (_input, init) => {
      cacheMode = init?.cache ?? null;
      return new Response(JSON.stringify(manifest), { status: 200 });
    },
  });
  await source.loadManifest();
  assert.equal(cacheMode, 'no-store');
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

test('browser parser consumes the canonical bilateral anatomy-pack-v2 fixture', () => {
  const fixtureManifest = JSON.parse(readFileSync(
    new URL('../../../fixtures/anatomy/anatomy-pack-v2/manifest.json', import.meta.url),
    'utf8',
  ));
  const parsed = parseAnatomyPackManifest(fixtureManifest);
  assert.equal(parsed.format, 'anatomy-pack-v2');
  assert.equal(parsed.packId, 'synthetic-bilateral-10um-v2');
  assert.deepEqual(parsed.synchronizationSentinels[0].worldUm, [-360, 140, 20]);
});
