import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { RegionNavigationSource, decodeRegionAnchors } from '../../.test-dist/rendering/region-navigation-source.js';

const manifest = JSON.parse(await readFile('src/assets/navigation/manifest.json'));
const packBytes = await readFile('public/atlas/projections/ibl-static-registered-v1/manifest.json');
const pack = JSON.parse(packBytes);
const packHash = createHash('sha256').update(packBytes).digest('hex');
const resources = { allen: 'https://example.test/allen.bin', beryl: 'https://example.test/beryl.bin', cosmos: 'https://example.test/cosmos.bin' };
const root = 'src/assets/navigation/';

test('production companion resolves anchors against the exact deployment projection snapshot', async () => {
  const config = JSON.parse(await readFile('../data/deployment/initial-site.json'));
  const raw = await readFile(`../data/deployment/dependencies/${config.projection.sha256}.json`);
  const productionManifest = JSON.parse(await readFile(root + 'production/manifest.json'));
  const source = new RegionNavigationSource({ manifest: productionManifest, resources }, async input =>
    new Response(await readFile(root + 'production/' + new URL(input).pathname.slice(1))));
  assert.deepEqual(await source.locate('-68', 'allen', JSON.parse(raw), config.projection.sha256, new AbortController().signal),
    { coronal: 193, sagittal: 468, horizontal: 273 });
  await assert.rejects(source.locate('-68', 'allen', pack, packHash, new AbortController().signal), /unavailable/);
});

function fixture() {
  const calls = [];
  const source = new RegionNavigationSource({ manifest, resources }, async input => {
    const name = new URL(input).pathname.slice(1);
    calls.push(name);
    return new Response(await readFile(root + name));
  });
  return { source, calls };
}

test('HATA centers inside native anatomy, independent of starting cursor; rows are lazy and cached per mapping', async () => {
  const { source, calls } = fixture();
  assert.equal(calls.length, 0);
  const left = await source.locate('-589508447', 'beryl', pack, packHash, new AbortController().signal);
  assert.deepEqual(left, { coronal: 879, sagittal: 305, horizontal: 588 });
  const right = await source.locate('589508447', 'beryl', pack, packHash, new AbortController().signal);
  assert.ok(right.sagittal > 573);
  assert.deepEqual(calls, ['beryl.bin']);
});

test('exact manifest hash, reference frame, grid shape and affine are required before reading rows', async () => {
  const { source, calls } = fixture();
  for (const altered of [
    { ...pack, reference_space_id: 'other' },
    { ...pack, projections: pack.projections.map(p => p.id === 'coronal' ? { ...p, slice_shape: [50, 50] } : p) },
    { ...pack, projections: pack.projections.map(p => p.id === 'coronal' ? { ...p, plane_index_to_world_um: Array(16).fill(0) } : p) },
  ]) await assert.rejects(source.locate('-68', 'allen', altered, packHash, new AbortController().signal), /unavailable|incompatible/);
  await assert.rejects(source.locate('-68', 'allen', pack, '0'.repeat(64), new AbortController().signal), /unavailable/);
  assert.equal(calls.length, 0);
});

test('binary corruption and invalid rows are rejected; unavailable anchors return null', async () => {
  const raw = await readFile(root + 'allen.bin');
  const copy = () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  let bytes = copy();
  new DataView(bytes).setInt32(0, 0, true);
  assert.throws(() => decodeRegionAnchors(bytes, manifest, 'allen'), /nonzero/);
  bytes = copy();
  new DataView(bytes).setInt32(4, -2, true);
  assert.throws(() => decodeRegionAnchors(bytes, manifest, 'allen'), /outside/);
  const source = new RegionNavigationSource({ manifest, resources }, async () => new Response(new Uint8Array(raw.length)));
  await assert.rejects(source.locate('-68', 'allen', pack, packHash, new AbortController().signal), /SHA-256/);
  const { source: valid } = fixture();
  assert.equal(await valid.locate('-999999', 'allen', pack, packHash, new AbortController().signal), null);
});

test('cancelled callers ignore late reads without cancelling another selection; failed loads can retry', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const source = new RegionNavigationSource({ manifest, resources }, async () => {
    await gate;
    return new Response(await readFile(root + 'beryl.bin'));
  });
  const cancelled = new AbortController();
  const pending = source.locate('-589508447', 'beryl', pack, packHash, cancelled.signal);
  const active = source.locate('-589508447', 'beryl', pack, packHash, new AbortController().signal);
  cancelled.abort(); release();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(await active, { coronal: 879, sagittal: 305, horizontal: 588 });
  let failed = true;
  const retry = new RegionNavigationSource({ manifest, resources }, async () => {
    if (failed) { failed = false; throw new Error('offline'); }
    return new Response(await readFile(root + 'beryl.bin'));
  });
  await assert.rejects(retry.locate('-589508447', 'beryl', pack, packHash, new AbortController().signal), /offline/);
  assert.ok(await retry.locate('-589508447', 'beryl', pack, packHash, new AbortController().signal));
});
