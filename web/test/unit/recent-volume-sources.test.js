import assert from 'node:assert/strict';
import test from 'node:test';
import { RecentVolumeSources } from '../../.test-dist/rendering/recent-volume-sources.js';

function feature(id, overrides = {}) {
  return {
    featureId: id, baseUrl: 'https://example.test/release/feature.json',
    descriptor: { grid: { shape: [2, 2, 2] }, validity: { kind: 'all-valid' },
      resource: { sha256: 'a' }, ...overrides },
  };
}

function setup(bytes = 96, count = 8) {
  const created = [];
  const cache = new RecentVolumeSources(bytes, (feature, reservedBytes) => {
    const source = { disposed: false, dispose() { this.disposed = true; } };
    created.push({ feature, reservedBytes, source });
    return source;
  }, count);
  return { cache, created };
}

test('recent sources reuse equivalent payloads but not changed hashes or decoding contracts', () => {
  const { cache } = setup(1024);
  const original = cache.get(feature('a'));
  cache.get(feature('b'));
  assert.equal(cache.get(feature('a')), original);
  assert.notEqual(cache.get(feature('a', { resource: { sha256: 'b' } })), original);
  assert.notEqual(cache.get(feature('a', { grid: { shape: [2, 2, 2], axisOrder: ['dv', 'ml', 'ap'] } })), original);
  assert.notEqual(cache.get({ ...feature('a'), baseUrl: 'https://example.test/another/feature.json' }), original);
  cache.dispose();
  assert.equal(original.disposed, true);
});

test('LRU evicts by shared decoded reservations including masks, and by entry count', () => {
  const { cache, created } = setup();
  const a = cache.get(feature('a'));
  const b = cache.get(feature('b'));
  cache.get(feature('a'));
  cache.get(feature('c', { validity: { kind: 'mask', mask: { resource: { codec: { decodedBytes: 8 } } } } }));
  assert.equal(b.disposed, true);
  assert.equal(a.disposed, false);
  assert.deepEqual(created.map(row => row.reservedBytes), [32, 32, 40]);
  const large = cache.get(feature('large', { grid: { shape: [100, 100, 100] } }));
  assert.equal(a.disposed, true);
  assert.equal(created.at(-1).reservedBytes, 96);
  cache.dispose();
  assert.equal(large.disposed, true);
  const limited = setup(1024, 2);
  const first = limited.cache.get(feature('first'));
  limited.cache.get(feature('second'));
  limited.cache.get(feature('third'));
  assert.equal(first.disposed, true);
});

test('failed source construction is not cached', () => {
  let attempts = 0;
  const cache = new RecentVolumeSources(96, () => { attempts++; throw new Error('bad source'); });
  assert.throws(() => cache.get(feature('a')), /bad source/);
  assert.throws(() => cache.get(feature('a')), /bad source/);
  assert.equal(attempts, 2);
});

test('payloads without a transport identity never inherit another local selector loader', () => {
  const { cache } = setup();
  const originalPayload = { ...feature('local'), baseUrl: undefined };
  const reimportedPayload = { ...feature('local'), baseUrl: undefined };
  const original = cache.get(originalPayload);
  assert.equal(cache.get(originalPayload), original);
  assert.notEqual(cache.get(reimportedPayload), original);
});
