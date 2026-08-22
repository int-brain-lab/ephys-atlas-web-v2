import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';

import { ResourceFetcher } from '../../.test-dist/data/cache.js';
import { decodeMeshLod, meshChunksByteLength } from '../../.test-dist/rendering/3d/mesh-pack-codec.js';
import { DecodedMeshLru, MeshPackSource, meshDecodedCacheKey } from '../../.test-dist/rendering/3d/mesh-pack-source.js';
import { MeshPackRuntime } from '../../.test-dist/rendering/3d/mesh-pack-runtime.js';
import { decodeMeshWorkerRequest } from '../../.test-dist/rendering/3d/mesh-pack-worker.js';

const packUrl = new URL('../../../fixtures/mesh-pack-v1/pack/', import.meta.url);
const manifestBytes = await readFile(new URL('manifest.json', packUrl));
const lodBytes = await readFile(new URL('default.eam3.gz', packUrl));
const manifest = JSON.parse(manifestBytes);
const lod = manifest.lods[0];

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function arrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const manifestDescriptor = {
  url: 'https://mesh.test/pack/manifest.json',
  bytes: manifestBytes.byteLength,
  sha256: await sha256(manifestBytes),
};

function fixtureFetcher(onCall = () => {}) {
  return new ResourceFetcher(async (url, init) => {
    onCall(url, init);
    if (url.endsWith('/manifest.json')) return new Response(manifestBytes);
    if (url.endsWith('/default.eam3.gz')) return new Response(lodBytes);
    return new Response('missing', { status: 404 });
  });
}

async function decodedFixture() {
  return decodeMeshLod(new Uint8Array(gunzipSync(lodBytes)), lod.decoder);
}

class FixtureRuntime {
  calls = 0;
  disposed = false;

  async decode(compressed, resource, decoder) {
    this.calls += 1;
    assert.equal(compressed.byteLength, resource.bytes);
    const chunks = await decodeMeshLod(new Uint8Array(gunzipSync(new Uint8Array(compressed))), decoder);
    return { chunks, byteLength: meshChunksByteLength(chunks) };
  }

  dispose() { this.disposed = true; }
}

test('worker-owned decoder consumes the committed bilateral EAM3 fixture', async () => {
  const result = await decodeMeshWorkerRequest({
    id: 1,
    op: 'decode',
    compressed: arrayBuffer(lodBytes),
    resource: lod.resource,
    decoder: lod.decoder,
    maxDecodedBytes: 1024 * 1024,
  });
  assert.deepEqual(result.chunks.map((chunk) => chunk.hemisphere), ['left', 'right']);
  assert.deepEqual(result.chunks.flatMap((chunk) => chunk.ranges.map((range) => range.signedAllenId)), [-315, 315]);
  assert.equal(result.chunks.reduce((sum, chunk) => sum + chunk.indices.length / 3, 0), lod.triangle_count);
  assert.ok(result.byteLength > 0);
});

test('manifest discovery is verified and does not load a LOD prematurely', async () => {
  const urls = [];
  const runtime = new FixtureRuntime();
  const source = new MeshPackSource({ manifest: manifestDescriptor, fetcher: fixtureFetcher((url) => urls.push(url)), runtime });
  const loaded = await source.loadManifest();
  assert.equal(loaded.pack_id, manifest.pack_id);
  assert.deepEqual(urls, [manifestDescriptor.url]);
  assert.equal(runtime.calls, 0);
  source.dispose();
});

test('shared default load performs one transport and decode', async () => {
  const calls = new Map();
  const runtime = new FixtureRuntime();
  const source = new MeshPackSource({
    manifest: manifestDescriptor,
    fetcher: fixtureFetcher((url) => calls.set(url, (calls.get(url) ?? 0) + 1)),
    runtime,
  });
  const [first, second] = await Promise.all([source.loadDefault(), source.loadDefault()]);
  assert.equal(first, second);
  assert.equal(calls.get('https://mesh.test/pack/default.eam3.gz'), 1);
  assert.equal(runtime.calls, 1);
  assert.equal((await source.loadDefault()), first);
  assert.equal(runtime.calls, 1);
  source.dispose();
});

test('one consumer cancellation does not poison a shared LOD load', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let decodeCalls = 0;
  const chunks = await decodedFixture();
  const runtime = {
    async decode(_compressed, _resource, _decoder, _budget, signal) {
      decodeCalls += 1;
      await Promise.race([
        gate,
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
      ]);
      return { chunks, byteLength: meshChunksByteLength(chunks) };
    },
    dispose() {},
  };
  const source = new MeshPackSource({ manifest: manifestDescriptor, fetcher: fixtureFetcher(), runtime });
  const controller = new AbortController();
  const cancelled = source.loadDefault(controller.signal);
  const retained = source.loadDefault();
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  release();
  assert.equal((await retained).id, 'default');
  assert.equal(decodeCalls, 1);
  source.dispose();
});

test('verified fetch evicts a corrupt persistent mesh hit and refetches clean bytes', async () => {
  const previousCaches = globalThis.caches;
  const cacheEntries = new Map([['https://mesh.test/pack/default.eam3.gz', new Response('corrupt')]]);
  let deletes = 0;
  let networkLodCalls = 0;
  globalThis.caches = {
    async open() {
      return {
        async match(url) { return cacheEntries.get(url)?.clone(); },
        async delete(url) { deletes += 1; return cacheEntries.delete(url); },
        async put(url, response) { cacheEntries.set(url, response.clone()); },
      };
    },
    async delete() { return true; },
  };
  try {
    const fetcher = new ResourceFetcher(async (url) => {
      if (url.endsWith('/manifest.json')) return new Response(manifestBytes);
      networkLodCalls += 1;
      return new Response(lodBytes);
    });
    const source = new MeshPackSource({ manifest: manifestDescriptor, fetcher, runtime: new FixtureRuntime() });
    await source.loadDefault();
    assert.equal(deletes, 1);
    assert.equal(networkLodCalls, 1);
    assert.equal((await cacheEntries.get('https://mesh.test/pack/default.eam3.gz').arrayBuffer()).byteLength, lodBytes.byteLength);
    source.dispose();
  } finally {
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
});

test('decoded identity isolates SHA and decoder contracts but not relative paths', () => {
  const sameBytesElsewhere = structuredClone(lod);
  sameBytesElsewhere.resource.path = 'another/default.eam3.gz';
  assert.equal(meshDecodedCacheKey(sameBytesElsewhere), meshDecodedCacheKey(lod));
  const otherSha = structuredClone(lod);
  otherSha.resource.sha256 = 'f'.repeat(64);
  assert.notEqual(meshDecodedCacheKey(otherSha), meshDecodedCacheKey(lod));
  const otherDecoder = structuredClone(lod);
  otherDecoder.decoder.container_version = 2;
  assert.notEqual(meshDecodedCacheKey(otherDecoder), meshDecodedCacheKey(lod));
});

test('transport identity keeps equal hashes at different manifest URLs isolated', async () => {
  let calls = 0;
  const fetcher = new ResourceFetcher(async () => { calls += 1; return new Response(manifestBytes); });
  const first = new MeshPackSource({ manifest: manifestDescriptor, fetcher, runtime: new FixtureRuntime() });
  const second = new MeshPackSource({ manifest: { ...manifestDescriptor, url: 'https://other.test/manifest.json' }, fetcher, runtime: new FixtureRuntime() });
  await Promise.all([first.loadManifest(), second.loadManifest()]);
  assert.equal(calls, 2);
  first.dispose();
  second.dispose();
});

test('invalid manifest and missing LOD fail closed without generated geometry', async () => {
  const invalidBytes = new TextEncoder().encode(JSON.stringify({ ...manifest, format: 'atlas-mesh-pack-v1-lab' }));
  const invalidSource = new MeshPackSource({
    manifest: { url: manifestDescriptor.url, bytes: invalidBytes.byteLength, sha256: await sha256(invalidBytes) },
    fetcher: new ResourceFetcher(async () => new Response(invalidBytes)),
    runtime: new FixtureRuntime(),
  });
  await assert.rejects(invalidSource.loadManifest(), /format/);
  invalidSource.dispose();

  const source = new MeshPackSource({
    manifest: manifestDescriptor,
    fetcher: new ResourceFetcher(async (url) => url.endsWith('/manifest.json') ? new Response(manifestBytes) : new Response('missing', { status: 404 })),
    runtime: new FixtureRuntime(),
  });
  await assert.rejects(source.loadDefault(), /HTTP 404/);
  source.dispose();
});

test('decoded LRU evicts by bytes and source disposal clears work', async () => {
  const cache = new DecodedMeshLru(10);
  cache.set('first', { id: 'first', chunks: [], byteLength: 6 });
  cache.set('second', { id: 'second', chunks: [], byteLength: 6 });
  assert.equal(cache.get('first'), undefined);
  assert.equal(cache.size, 1);
  assert.equal(cache.byteLength, 6);
  assert.throws(() => cache.set('large', { id: 'large', chunks: [], byteLength: 11 }), /exceeds/);
  const runtime = new FixtureRuntime();
  const source = new MeshPackSource({ manifest: manifestDescriptor, fetcher: fixtureFetcher(), runtime });
  source.dispose();
  assert.equal(runtime.disposed, true);
  await assert.rejects(source.loadManifest(), /disposed/);
});

test('decoder fails closed on malformed container, ranges, codec, and decoded size', async () => {
  const decoded = new Uint8Array(gunzipSync(lodBytes));
  const badMagic = decoded.slice();
  badMagic[0] = 0;
  await assert.rejects(decodeMeshLod(badMagic, lod.decoder), /magic/);
  const badVersion = decoded.slice();
  new DataView(badVersion.buffer).setUint32(4, 2, true);
  await assert.rejects(decodeMeshLod(badVersion, lod.decoder), /version/);
  const badRange = decoded.slice();
  const headerLength = new DataView(badRange.buffer).getUint32(8, true);
  const header = new TextDecoder().decode(badRange.subarray(12, 12 + headerLength));
  const changed = header.replace('"index_count":18', '"index_count":99');
  assert.notEqual(changed, header);
  badRange.set(new TextEncoder().encode(changed), 12);
  await assert.rejects(decodeMeshLod(badRange, lod.decoder), /out of bounds/);
  await assert.rejects(decodeMeshWorkerRequest({
    id: 2, op: 'decode', compressed: arrayBuffer(lodBytes),
    resource: { ...lod.resource, codec: { ...lod.resource.codec, name: 'none' } },
    decoder: lod.decoder, maxDecodedBytes: 1024 * 1024,
  }), /explicit gzip/);
  await assert.rejects(decodeMeshWorkerRequest({
    id: 3, op: 'decode', compressed: arrayBuffer(lodBytes),
    resource: { ...lod.resource, codec: { ...lod.resource.codec, decoded_bytes: lod.resource.codec.decoded_bytes + 1 } },
    decoder: lod.decoder, maxDecodedBytes: 1024 * 1024,
  }), /decoded length/);
});

test('meshopt decoder fails closed on incomplete block metadata', async () => {
  const header = new TextEncoder().encode(JSON.stringify({
    encoding: 'meshopt-quantized-v1',
    chunks: [
      { hemisphere: 'left', ranges: [], vertex_count: 3, index_count: 3 },
      { hemisphere: 'right', ranges: [], vertex_count: 3, index_count: 3 },
    ],
  }));
  const payloadOffset = Math.ceil((12 + header.length) / 4) * 4;
  const bytes = new Uint8Array(payloadOffset);
  bytes.set(new TextEncoder().encode('EAM3'));
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 1, true);
  view.setUint32(8, header.length, true);
  bytes.set(header, 12);
  await assert.rejects(decodeMeshLod(bytes, {
    container: 'EAM3', container_version: 1, encoding: 'meshopt-quantized-v1', position_bits: 14, normal_bits: 8,
  }), /incomplete/);
});

test('runtime forwards cancellation and disposal to its worker boundary', async () => {
  const messages = [];
  const worker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(message) { messages.push(message); },
    terminateCalls: 0,
    terminate() { this.terminateCalls += 1; },
  };
  const runtime = new MeshPackRuntime(worker);
  const controller = new AbortController();
  const pending = runtime.decode(arrayBuffer(lodBytes), lod.resource, lod.decoder, 1024 * 1024, controller.signal);
  const decodeId = messages[0].id;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(messages.at(-1), { id: decodeId, op: 'cancel' });

  const retained = runtime.decode(arrayBuffer(lodBytes), lod.resource, lod.decoder, 1024 * 1024);
  const retainedId = messages.at(-1).id;
  runtime.dispose();
  await assert.rejects(retained, /disposed/);
  assert.equal(worker.terminateCalls, 1);
  worker.onmessage?.({ data: { id: retainedId, ok: false, error: 'late' } });
});
