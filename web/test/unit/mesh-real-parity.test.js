import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { decodeMeshLod } from '../../.test-dist/rendering/3d/mesh-pack-codec.js';
import { meshPresentationAtMl } from '../../.test-dist/rendering/3d/mesh-presentation-boundary.js';

const root = process.env.IBL_ATLAS_ASSET_SET_ROOT;
const lockPath = process.env.IBL_ATLAS_ASSET_SET_LOCK;

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function int32LittleEndian(values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setInt32(index * 4, value, true));
  return bytes;
}

test('real D070 mesh matches the shared renderer-neutral presentation fingerprints', { skip: !root || !lockPath }, async () => {
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  const manifestBytes = await readFile(path.join(root, 'mesh-pack', 'manifest.json'));
  assert.equal(manifestBytes.byteLength, lock.mesh_manifest.bytes);
  assert.equal(await sha256(manifestBytes), lock.mesh_manifest.sha256);
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.pack_id, lock.expectations.pack_id);
  assert.equal(manifest.reference_space_id, lock.reference_space_id);
  const lod = manifest.lods.find((candidate) => candidate.id === manifest.default_lod_id);
  assert.ok(lod);
  const encoded = await readFile(path.join(root, 'mesh-pack', lod.resource.path));
  assert.equal(await sha256(encoded), lock.expectations.geometry_sha256);
  const chunks = await decodeMeshLod(new Uint8Array(gunzipSync(encoded)), lod.decoder);

  const vertexPresentations = [];
  const facePresentations = [];
  for (const chunk of chunks) {
    for (const range of chunk.ranges) {
      const left = range.leftPresentationId ?? -1;
      const right = range.rightPresentationId ?? -1;
      for (let vertex = range.vertexStart; vertex < range.vertexStart + range.vertexCount; vertex += 1) {
        vertexPresentations.push(meshPresentationAtMl(chunk.positions[vertex * 3], left, right, manifest.presentation_boundary));
      }
      for (let offset = range.indexStart; offset < range.indexStart + range.indexCount; offset += 3) {
        const ml = (
          chunk.positions[chunk.indices[offset] * 3]
          + chunk.positions[chunk.indices[offset + 1] * 3]
          + chunk.positions[chunk.indices[offset + 2] * 3]
        ) / 3;
        facePresentations.push(meshPresentationAtMl(ml, left, right, manifest.presentation_boundary));
      }
    }
  }

  assert.equal(vertexPresentations.length, lock.expectations.vertices);
  assert.equal(facePresentations.length, lock.expectations.triangles);
  assert.equal(
    await sha256(int32LittleEndian(vertexPresentations)),
    lock.expectations.vertex_presentations_sha256,
  );
  assert.equal(
    await sha256(int32LittleEndian(facePresentations)),
    lock.expectations.face_presentations_sha256,
  );
});
