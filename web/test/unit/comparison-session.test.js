import assert from 'node:assert/strict';
import test from 'node:test';
import { ComparisonSession } from '../../.test-dist/application/comparison-session.js';

const context = (overrides = {}) => ({
  dataset: { datasetId: 'synthetic_comparison', releaseId: 'r1' },
  target: { kind: 'regional', parcellation: 'allen' },
  normalizationId: 'synthetic-z-v1',
  orientation: 'coronal',
  cursor: { xUm: -239, yUm: -1200, zUm: -3668 },
  ...overrides,
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function until(predicate) {
  for (let attempts = 0; attempts < 100; attempts += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('condition was not reached');
}

test('visible spatial work is deduplicated, ordered, and concurrency bounded', async () => {
  let active = 0;
  let maximumActive = 0;
  const pending = new Map();
  const calls = [];
  const port = {
    loadSpatialPlane(request) {
      calls.push(request.featureId);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const work = deferred();
      pending.set(request.featureId, work);
      return work.promise.finally(() => { active -= 1; });
    },
  };
  const session = new ComparisonSession(port, () => {}, 2);
  session.setVisible(context(), ['a', 'b', 'a', 'c', 'd']);

  assert.deepEqual(calls, ['a', 'b']);
  pending.get('a').resolve({ id: 'a' });
  await until(() => calls.includes('c'));
  pending.get('b').resolve({ id: 'b' });
  await until(() => calls.includes('d'));
  pending.get('c').resolve({ id: 'c' });
  pending.get('d').resolve({ id: 'd' });
  await until(() => session.snapshot().status === 'ready');

  assert.equal(maximumActive, 2);
  assert.deepEqual(calls, ['a', 'b', 'c', 'd']);
  assert.deepEqual(session.snapshot().items.map(({ featureId, status }) => [featureId, status]), [
    ['a', 'ready'], ['b', 'ready'], ['c', 'ready'], ['d', 'ready'],
  ]);
});

test('a 4,345-feature scope admits only the supplied visible window', async () => {
  const fullScope = Array.from({ length: 4_345 }, (_, index) => `gene-${index}`);
  const calls = [];
  const session = new ComparisonSession({
    async loadSpatialPlane(request) {
      calls.push(request.featureId);
      return { id: request.featureId };
    },
  }, () => {}, 4);
  const visible = fullScope.slice(2_000, 2_012);
  session.setVisible(context(), visible);
  await until(() => session.snapshot().status === 'ready');

  assert.deepEqual(calls, visible);
  assert.equal(session.snapshot().items.length, 12);
});

test('new coordinate work aborts old requests and rejects stale commits atomically', async () => {
  const first = deferred();
  const signals = [];
  const requests = [];
  const session = new ComparisonSession({
    loadSpatialPlane(request, signal) {
      requests.push(request);
      signals.push(signal);
      return request.cursor.xUm === 1 ? first.promise : Promise.resolve({ coordinate: request.cursor.xUm });
    },
  }, () => {}, 1);

  session.setVisible(context({ cursor: { xUm: 1, yUm: 2, zUm: 3 } }), ['slow']);
  session.setVisible(context({ cursor: { xUm: 10, yUm: 20, zUm: 30 } }), ['fast']);
  assert.equal(signals[0].aborted, true);
  first.resolve({ coordinate: 1 });
  await until(() => session.snapshot().status === 'ready');

  const snapshot = session.snapshot();
  assert.deepEqual(snapshot.context.cursor, { xUm: 10, yUm: 20, zUm: 30 });
  assert.deepEqual(snapshot.items, [{ featureId: 'fast', status: 'ready', payload: { coordinate: 10 } }]);
  assert.deepEqual(requests.map(({ featureId }) => featureId), ['slow', 'fast']);
});

test('one feature failure is isolated and queued peers continue', async () => {
  const session = new ComparisonSession({
    async loadSpatialPlane(request) {
      if (request.featureId === 'bad') throw new Error('synthetic plane failed');
      return { id: request.featureId };
    },
  }, () => {}, 1);
  session.setVisible(context(), ['good-a', 'bad', 'good-b']);
  await until(() => session.snapshot().status === 'ready');

  assert.deepEqual(session.snapshot().items, [
    { featureId: 'good-a', status: 'ready', payload: { id: 'good-a' } },
    { featureId: 'bad', status: 'error', error: 'synthetic plane failed' },
    { featureId: 'good-b', status: 'ready', payload: { id: 'good-b' } },
  ]);
});

test('dispose aborts work, clears ownership, and suppresses late callbacks', async () => {
  const work = deferred();
  let signal;
  let changes = 0;
  const session = new ComparisonSession({
    loadSpatialPlane(_request, requestSignal) {
      signal = requestSignal;
      return work.promise;
    },
  }, () => { changes += 1; }, 1);
  session.setVisible(context(), ['slow']);
  session.dispose();
  const changesAtDispose = changes;
  assert.equal(signal.aborted, true);
  assert.deepEqual(session.snapshot(), { status: 'disposed', context: null, items: [] });

  work.resolve({ id: 'slow' });
  await Promise.resolve();
  assert.equal(changes, changesAtDispose);
  assert.throws(() => session.setVisible(context(), ['again']), /disposed/);
});

test('change callbacks may dispose the session before a queued request starts', () => {
  let calls = 0;
  let session;
  session = new ComparisonSession({
    async loadSpatialPlane() { calls += 1; return { ok: true }; },
  }, () => {
    if (session.snapshot().items.some(({ status }) => status === 'loading')) session.dispose();
  }, 1);

  session.setVisible(context(), ['never-started']);
  assert.equal(calls, 0);
  assert.equal(session.snapshot().status, 'disposed');
});

test('session rejects invalid concurrency and preserves exact request identity', async () => {
  assert.throws(() => new ComparisonSession({}, () => {}, 0), /positive safe integer/);
  let request;
  const session = new ComparisonSession({
    async loadSpatialPlane(value) { request = value; return { ok: true }; },
  }, () => {});
  session.setVisible(context({
    dataset: { datasetId: 'synthetic_comparison', releaseId: 'immutable-r2' },
    target: { kind: 'volume', referenceSpaceId: 'allen-ccf-v3' },
    normalizationId: 'synthetic-volume-z-v2',
    orientation: 'horizontal',
  }), ['feature-a']);
  await until(() => session.snapshot().status === 'ready');

  assert.deepEqual(request, {
    dataset: { datasetId: 'synthetic_comparison', releaseId: 'immutable-r2' },
    target: { kind: 'volume', referenceSpaceId: 'allen-ccf-v3' },
    normalizationId: 'synthetic-volume-z-v2',
    orientation: 'horizontal',
    cursor: { xUm: -239, yUm: -1200, zUm: -3668 },
    featureId: 'feature-a',
  });
});
