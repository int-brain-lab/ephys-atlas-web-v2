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

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail('Timed out waiting for deferred cache admission');
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
    async keys() { return cached ? [new Request('https://example.test/same/path.bin')] : []; },
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
    await waitFor(() => cached !== undefined && puts === 1);
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
    async keys() { return []; },
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

function memoryCache() {
  const entries = new Map();
  let activeInventories = 0;
  let maximumConcurrentInventories = 0;
  const key = (request) => typeof request === 'string' ? request : request.url;
  return {
    entries,
    get maximumConcurrentInventories() { return maximumConcurrentInventories; },
    async match(request) { return entries.get(key(request))?.clone(); },
    async keys() {
      activeInventories += 1;
      maximumConcurrentInventories = Math.max(maximumConcurrentInventories, activeInventories);
      await Promise.resolve();
      activeInventories -= 1;
      return [...entries.keys()].map((url) => new Request(url));
    },
    async delete(request) { return entries.delete(key(request)); },
    async put(request, response) { entries.set(key(request), response.clone()); },
  };
}

test('bounded cache evicts oldest admissions and serializes mutations across fetcher instances', async () => {
  const previousCaches = globalThis.caches;
  const cache = memoryCache();
  globalThis.caches = { async open() { return cache; }, async delete() { cache.entries.clear(); return true; } };
  try {
    const policy = { maxBytes: 4, maxEntries: 2 };
    const first = new ResourceFetcher(async (url) => new Response(new URL(url).pathname.slice(1)), 'shared-bounded', policy);
    const second = new ResourceFetcher(async (url) => new Response(new URL(url).pathname.slice(1)), 'shared-bounded', policy);
    const integrity = async (value) => ({ bytes: value.length, sha256: await sha256(value) });

    await first.fetch('https://example.test/aa', { immutable: true, integrity: await integrity('aa') });
    await waitFor(() => cache.entries.has('https://example.test/aa'));
    await Promise.all([
      first.fetch('https://example.test/bb', { immutable: true, integrity: await integrity('bb') }),
      second.fetch('https://example.test/cc', { immutable: true, integrity: await integrity('cc') }),
    ]);
    await waitFor(() => cache.entries.has('https://example.test/cc'));

    assert.equal(cache.maximumConcurrentInventories, 1);
    assert.deepEqual([...cache.entries.keys()].sort(), ['https://example.test/bb', 'https://example.test/cc']);
  } finally {
    globalThis.caches = previousCaches;
  }
});

test('deferred admission does not delay delivery and has bounded pending work', async () => {
  const previousCaches = globalThis.caches;
  const cache = memoryCache();
  let releasePut;
  const putGate = new Promise((resolve) => { releasePut = resolve; });
  let puts = 0;
  cache.put = async (request, response) => {
    puts += 1;
    await putGate;
    cache.entries.set(typeof request === 'string' ? request : request.url, response.clone());
  };
  globalThis.caches = { async open() { return cache; }, async delete() { return true; } };
  try {
    const policy = { maxBytes: 4, maxEntries: 2 };
    const fetcher = new ResourceFetcher(async (url) => new Response(new URL(url).pathname.slice(1)), 'pending-bounded', policy);
    const integrity = async (value) => ({ bytes: value.length, sha256: await sha256(value) });
    const responses = await Promise.all(['aa', 'bb', 'cc'].map(async (value) => fetcher.fetch(`https://example.test/${value}`, {
      immutable: true,
      integrity: await integrity(value),
    })));
    assert.deepEqual(await Promise.all(responses.map((response) => response.text())), ['aa', 'bb', 'cc']);
    await waitFor(() => puts === 1);
    assert.equal(puts, 1);
    assert.equal(cache.entries.size, 0);
    releasePut();
    await waitFor(() => cache.entries.size === 2);
    assert.equal(puts, 2);
  } finally {
    releasePut?.();
    globalThis.caches = previousCaches;
  }
});

test('oversize verified resources are served without cache admission', async () => {
  const previousCaches = globalThis.caches;
  const cache = memoryCache();
  globalThis.caches = { async open() { return cache; }, async delete() { return true; } };
  try {
    const value = 'verified-network';
    const fetcher = new ResourceFetcher(async () => new Response(value), 'oversize', { maxBytes: 4, maxEntries: 2 });
    const response = await fetcher.fetch('https://example.test/large.bin', {
      immutable: true,
      integrity: { bytes: value.length, sha256: await sha256(value) },
    });
    assert.equal(await response.text(), value);
    assert.equal(cache.entries.size, 0);
  } finally {
    globalThis.caches = previousCaches;
  }
});

test('cache availability and quota failures do not prevent verified network reads', async () => {
  const previousCaches = globalThis.caches;
  const value = 'verified';
  const integrity = { bytes: value.length, sha256: await sha256(value) };
  try {
    globalThis.caches = { async open() { throw new Error('cache unavailable'); }, async delete() { return false; } };
    const unavailable = new ResourceFetcher(async () => new Response(value));
    assert.equal(await (await unavailable.fetch('https://example.test/unavailable', { immutable: true, integrity })).text(), value);

    const cache = memoryCache();
    cache.put = async () => { throw new DOMException('quota exceeded', 'QuotaExceededError'); };
    globalThis.caches = { async open() { return cache; }, async delete() { return true; } };
    const quota = new ResourceFetcher(async () => new Response(value));
    assert.equal(await (await quota.fetch('https://example.test/quota', { immutable: true, integrity })).text(), value);
  } finally {
    globalThis.caches = previousCaches;
  }
});
