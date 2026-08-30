import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceFetcher } from '../../.test-dist/data/cache.js';

test('an aborted prefetch does not poison a foreground request for the same resource', async () => {
  let calls = 0;
  const fetcher = new ResourceFetcher(async (_url, init) => {
    calls += 1;
    if (init?.signal) {
      await new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
    }
    return new Response('foreground');
  });
  const controller = new AbortController();
  const prefetch = fetcher.fetch('https://example.test/feature.bin', { signal: controller.signal });

  controller.abort();
  await assert.rejects(prefetch, { name: 'AbortError' });
  const foreground = await fetcher.fetch('https://example.test/feature.bin');

  assert.equal(await foreground.text(), 'foreground');
  assert.equal(calls, 2);
});

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

test('in-flight identity includes declared bytes so inconsistent integrity cannot bypass validation', async () => {
  const previousCaches = globalThis.caches;
  delete globalThis.caches;
  try {
    const expected = 'verified';
    const digest = await sha256(expected);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let calls = 0;
    const fetcher = new ResourceFetcher(async () => {
      calls += 1;
      await gate;
      return new Response(expected);
    });

    const valid = fetcher.fetch('https://example.test/resource.bin', {
      integrity: { bytes: expected.length, sha256: digest },
    });
    const inconsistent = fetcher.fetch('https://example.test/resource.bin', {
      integrity: { bytes: expected.length + 1, sha256: digest },
    });
    const inconsistentRejection = assert.rejects(inconsistent, /byte length/);
    release();

    assert.equal(await (await valid).text(), expected);
    await inconsistentRejection;
    assert.equal(calls, 3);
  } finally {
    globalThis.caches = previousCaches;
  }
});

test('a corrupt persistent hit is evicted and replaced only after a verified retry', async () => {
  const previousCaches = globalThis.caches;
  let cached = new Response('old-wrong-bytes');
  let deletes = 0;
  let puts = 0;
  const cache = {
    async match() { return cached?.clone(); },
    async delete() { deletes += 1; cached = undefined; return true; },
    async put(_url, response) { puts += 1; cached = response.clone(); },
  };
  globalThis.caches = { async open() { return cache; }, async delete() { return true; } };
  try {
    const expected = 'release-two';
    let networkCalls = 0;
    let networkCacheMode;
    const fetcher = new ResourceFetcher(async (_url, init) => {
      networkCalls += 1;
      networkCacheMode = init?.cache;
      return new Response(expected);
    });
    const response = await fetcher.fetch('https://example.test/same/path.bin', {
      immutable: true,
      integrity: { bytes: expected.length, sha256: await sha256(expected) },
    });
    assert.equal(await response.text(), expected);
    assert.equal(await cached.text(), expected);
    assert.equal(deletes, 1);
    assert.equal(puts, 1);
    assert.equal(networkCalls, 1);
    assert.equal(networkCacheMode, 'reload');
  } finally {
    globalThis.caches = previousCaches;
  }
});

test('an invalid HTTP cache response receives one cache-bypassing retry', async () => {
  const previousCaches = globalThis.caches;
  delete globalThis.caches;
  try {
    const expected = 'current-release';
    const cacheModes = [];
    const fetcher = new ResourceFetcher(async (_url, init) => {
      cacheModes.push(init?.cache);
      return new Response(init?.cache === 'reload' ? expected : 'stale-release');
    });
    const response = await fetcher.fetch('https://example.test/reused/path.bin', {
      immutable: true,
      integrity: { bytes: expected.length, sha256: await sha256(expected) },
    });

    assert.equal(await response.text(), expected);
    assert.deepEqual(cacheModes, [undefined, 'reload']);
  } finally {
    globalThis.caches = previousCaches;
  }
});

test('an integrity failure never enters the persistent cache', async () => {
  const previousCaches = globalThis.caches;
  let puts = 0;
  const cache = {
    async match() { return undefined; },
    async delete() { return true; },
    async put() { puts += 1; },
  };
  globalThis.caches = { async open() { return cache; }, async delete() { return true; } };
  try {
    const fetcher = new ResourceFetcher(async () => new Response('corrupt'));
    await assert.rejects(fetcher.fetch('https://example.test/resource.bin', {
      immutable: true,
      integrity: { bytes: 7, sha256: await sha256('correct') },
    }), /SHA-256 mismatch/);
    assert.equal(puts, 0);
  } finally {
    globalThis.caches = previousCaches;
  }
});
