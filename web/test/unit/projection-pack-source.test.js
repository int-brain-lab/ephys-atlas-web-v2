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

function fileFetcher(calls, gate, gatedPack = 6) {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const relative = url.pathname.replace('/atlas/projections/ibl-static-registered-v1/', '');
    calls.push(relative);
    if (gate && relative.endsWith(`/${gatedPack}.isvg.gz`)) {
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

test('directional prefetch decodes the next whole pack before the visible pack boundary', async () => {
  const calls = [];
  const source = new ProjectionPackSource({
    manifestUrl,
    fetchImpl: fileFetcher(calls),
    runtime: fakeRuntime(),
  });
  await source.loadSlice('horizontal', 401);
  calls.length = 0;
  await source.prefetchNeighbor('horizontal', 409, 1);
  assert.deepEqual(calls.filter((entry) => entry.endsWith('.isvg.gz')), [
    'registered/horizontal/7.isvg.gz',
  ]);
  source.dispose();
});

test('directional prefetch preempts an active opposite-side background fetch', async () => {
  const calls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const source = new ProjectionPackSource({
    manifestUrl,
    fetchImpl: fileFetcher(calls, gate, 5),
    runtime: fakeRuntime(),
  });
  await source.loadSlice('horizontal', 401);
  calls.length = 0;
  const warming = source.prefetchProgressively('horizontal', 401);
  while (!calls.includes('registered/horizontal/5.isvg.gz')) await new Promise((resolve) => setImmediate(resolve));
  await source.prefetchNeighbor('horizontal', 409, 1);
  assert.deepEqual(calls.filter((entry) => entry.endsWith('.isvg.gz')), [
    'registered/horizontal/5.isvg.gz',
    'registered/horizontal/7.isvg.gz',
  ]);
  release();
  await warming;
  assert.equal(new Set(calls.filter((entry) => entry.endsWith('.isvg.gz'))).size, 12);
  source.dispose();
});

test('a failed directional prefetch leaves the pack retryable by foreground navigation', async () => {
  const calls = [];
  const read = fileFetcher(calls);
  let failNextPack = true;
  const source = new ProjectionPackSource({
    manifestUrl,
    fetchImpl: async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (failNextPack && url.pathname.endsWith('/7.isvg.gz')) {
        failNextPack = false;
        calls.push('registered/horizontal/7.isvg.gz');
        return new Response('temporarily unavailable', { status: 503 });
      }
      return read(input, init);
    },
    runtime: fakeRuntime(),
  });
  await source.loadSlice('horizontal', 401);
  await assert.rejects(source.prefetchNeighbor('horizontal', 409, 1), /HTTP 503/);
  await source.loadSlice('horizontal', 449);
  assert.equal(calls.filter((entry) => entry === 'registered/horizontal/7.isvg.gz').length, 2);
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
