import assert from 'node:assert/strict';
import test from 'node:test';
import { PrefetchQueue } from '../../.test-dist/data/prefetch.js';

test('rescheduling cancels queued prefetch work', async () => {
  const queue = new PrefetchQueue(0);
  const calls = [];
  queue.schedule([async () => { calls.push('old'); }]);
  queue.schedule([async () => { calls.push('new'); }]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls, ['new']);
  queue.cancel();
});

test('cancelling aborts active prefetch work', async () => {
  const queue = new PrefetchQueue(0);
  let activeSignal;
  const started = new Promise((resolve) => {
    queue.schedule([async (signal) => {
      activeSignal = signal;
      resolve();
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }]);
  });

  await started;
  assert.equal(activeSignal.aborted, false);
  queue.cancel();
  assert.equal(activeSignal.aborted, true);
});
