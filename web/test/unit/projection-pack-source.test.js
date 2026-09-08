import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { ProjectionPackSource } from '../../.test-dist/rendering/projection-pack-source.js';

const root = path.resolve('public/atlas/projections/ibl-static-registered-v1');
const manifestUrl = 'https://example.test/atlas/projections/ibl-static-registered-v1/manifest.json';

function fakeRuntime() {
  return {
    async loadPack() { return { evictedPackIds: [] }; },
    async get() { return { svg: '<path/>', worldCoordinateUm: 0 }; },
    dispose() {},
  };
}

function fileFetcher(calls, gate) {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const relative = url.pathname.replace('/atlas/projections/ibl-static-registered-v1/', '');
    calls.push(relative);
    if (gate && relative.endsWith('/6.isvg.gz')) {
      await Promise.race([
        gate,
        new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true })),
      ]);
    }
    return new Response(await readFile(path.join(root, relative)));
  };
}

test('progressive prefetch warms every pack from the visible pack outward', async () => {
  const calls = [];
  const source = new ProjectionPackSource({
    manifestUrl,
    fetchImpl: fileFetcher(calls),
    runtime: fakeRuntime(),
  });
  await source.prefetchProgressively('horizontal', 401);
  const packs = calls.filter((entry) => entry.endsWith('.isvg.gz'));
  assert.equal(packs.length, 13);
  assert.equal(packs[0], 'registered/horizontal/6.isvg.gz');
  assert.deepEqual(new Set(packs).size, 13);
  source.dispose();
});

test('repeated progressive warmup does not redownload packs', async () => {
  const calls = [];
  const source = new ProjectionPackSource({
    manifestUrl,
    fetchImpl: fileFetcher(calls),
    runtime: fakeRuntime(),
  });
  await source.prefetchProgressively('horizontal', 401);
  const firstCount = calls.filter((entry) => entry.endsWith('.isvg.gz')).length;
  await source.prefetchProgressively('horizontal', 401);
  assert.equal(calls.filter((entry) => entry.endsWith('.isvg.gz')).length, firstCount);
  source.dispose();
});

test('foreground pack load jumps ahead of queued background packs', async () => {
  const calls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const source = new ProjectionPackSource({
    manifestUrl,
    fetchImpl: fileFetcher(calls, gate),
    runtime: fakeRuntime(),
  });
  const warming = source.prefetchProgressively('horizontal', 401);
  while (!calls.some((entry) => entry === 'registered/horizontal/6.isvg.gz')) await new Promise((resolve) => setImmediate(resolve));
  const foreground = source.loadSlice('horizontal', 793);
  release();
  await foreground;
  const packs = calls.filter((entry) => entry.endsWith('.isvg.gz'));
  assert.equal(packs[1], 'registered/horizontal/12.isvg.gz');
  await warming;
  source.dispose();
});

test('disposing aborts an active background warmup', async () => {
  const calls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const source = new ProjectionPackSource({ manifestUrl, fetchImpl: fileFetcher(calls, gate), runtime: fakeRuntime() });
  const warming = source.prefetchProgressively('horizontal', 401);
  while (!calls.includes('registered/horizontal/6.isvg.gz')) await new Promise((resolve) => setImmediate(resolve));
  source.dispose();
  await assert.rejects(warming, /aborted|disposed/i);
  release();
});
