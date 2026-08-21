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
