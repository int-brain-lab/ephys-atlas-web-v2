import assert from 'node:assert/strict';
import test from 'node:test';
import { initializeAnalytics, trackOnce } from '../../.test-dist/analytics.js';

function browser({ protocol = 'https:', hostname = 'ephys-atlas.iblcore.org', port = '', pathname = '/app', referrer = 'https://outside.example/path?private=1#secret', doNotTrack, umamiDisabled = false } = {}) {
  const listeners = new Map();
  let script;
  const calls = [];
  const umami = {
    track: (payload) => {
      calls.push(payload);
      return Promise.resolve();
    },
  };
  const document = {
    referrer,
    createElement: () => {
      script = {
        dataset: {},
        addEventListener: (name, fn) => listeners.set(name, fn),
      };
      return script;
    },
    head: { append: (node) => { assert.equal(node, script); } },
  };
  const timers = new Map();
  let nextTimer = 1;
  const environment = {
    document,
    location: { protocol, hostname, pathname, origin: `${protocol}//${hostname}${port ? `:${port}` : ''}` },
    navigator: { language: 'en-GB', doNotTrack },
    screen: { width: 1440, height: 900 },
    umami,
    umamiDisabled,
    setTimeout: (fn, delay) => { const id = nextTimer++; timers.set(id, { fn, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  return {
    environment, calls,
    get script() { return script; },
    fire: (event) => listeners.get(event)?.(),
    fireTimer: (delay) => {
      for (const [id, timer] of timers) if (timer.delay === delay) { timers.delete(id); timer.fn(); }
    },
  };
}

test('analytics requires the production origin and respects opt-out settings', () => {
  for (const env of [
    browser({ protocol: 'http:' }),
    browser({ hostname: 'www.ephys-atlas.iblcore.org' }),
    browser({ port: '8443' }),
    browser({ pathname: '/app/private' }),
    browser({ doNotTrack: '1' }),
    browser({ umamiDisabled: true }),
  ]) {
    initializeAnalytics(true, env.environment);
    assert.equal(env.script, undefined);
  }
  const development = browser();
  initializeAnalytics(false, development.environment);
  assert.equal(development.script, undefined);
});

test('manual pageview and deduplicated event use only sanitized fixed properties', async () => {
  const env = browser({ pathname: '/app' });
  initializeAnalytics(true, env.environment);
  assert.equal(env.script.src, 'https://cloud.umami.is/script.js');
  assert.deepEqual(env.script.dataset, {
    websiteId: 'e0c4d44e-c85c-4f15-abbb-32091b6b8a7c',
    autoTrack: 'false', domains: 'ephys-atlas.iblcore.org', excludeSearch: 'true', excludeHash: 'true', doNotTrack: 'true',
  });
  trackOnce('data_loaded');
  trackOnce('data_loaded');
  env.fire('load');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(env.calls, [
    {
      website: 'e0c4d44e-c85c-4f15-abbb-32091b6b8a7c', hostname: 'ephys-atlas.iblcore.org', screen: '1440x900',
      language: 'en-GB', title: 'IBL Ephys Atlas', url: '/app/', referrer: 'https://outside.example',
    },
    {
      website: 'e0c4d44e-c85c-4f15-abbb-32091b6b8a7c', hostname: 'ephys-atlas.iblcore.org', screen: '1440x900',
      language: 'en-GB', title: 'IBL Ephys Atlas', url: '/app/', referrer: 'https://outside.example', name: 'data_loaded',
    },
  ]);
  initializeAnalytics(true, env.environment);
  assert.equal(env.calls.length, 2);
});

test('script failure and load deadline discard queued events', () => {
  const failed = browser();
  initializeAnalytics(true, failed.environment);
  trackOnce('share_copied');
  failed.fire('error');
  failed.fire('load');
  trackOnce('download_started');
  assert.equal(failed.calls.length, 0);

  const expired = browser();
  initializeAnalytics(true, expired.environment);
  expired.fireTimer(10_000);
  expired.fire('load');
  trackOnce('local_imported');
  assert.equal(expired.calls.length, 0);
});

test('queue is bounded and rejected sends do not stop later events', async () => {
  const env = browser();
  env.environment.umami.track = (payload) => {
    env.calls.push(payload);
    if (!payload.name) return Promise.reject(new Error('offline'));
    return Promise.resolve();
  };
  initializeAnalytics(true, env.environment);
  for (const event of ['data_loaded', 'exploration_started', 'comparison_used', 'share_copied', 'download_started', 'local_imported']) trackOnce(event);
  env.fire('load');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(env.calls.map(({ name }) => name ?? 'pageview'), [
    'pageview', 'data_loaded', 'exploration_started', 'comparison_used', 'share_copied', 'download_started', 'local_imported',
  ]);
});

test('referrer rules and initialization snapshot keep routes and private URL parts out', async () => {
  const env = browser({ referrer: 'https://ephys-atlas.iblcore.org/app?private=1#secret' });
  initializeAnalytics(true, env.environment);
  env.environment.location.pathname = '/';
  env.environment.document.referrer = 'https://changed.example/path?secret=yes';
  trackOnce('exploration_started');
  env.fire('load');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(env.calls.map(({ url, referrer }) => ({ url, referrer })), [
    { url: '/app/', referrer: '/app/' },
    { url: '/app/', referrer: '/app/' },
  ]);

  for (const referrer of ['https://ephys-atlas.iblcore.org/private/path?secret=1', 'not a URL', 'javascript:alert(1)']) {
    const separate = browser({ referrer });
    initializeAnalytics(true, separate.environment);
    separate.fire('load');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(separate.calls[0].referrer, referrer.startsWith('https://') ? 'https://ephys-atlas.iblcore.org' : '');
  }
});

test('all six events deduplicate before and after drain; unknown runtime names are ignored', async () => {
  const env = browser({ pathname: '/' });
  initializeAnalytics(true, env.environment);
  const events = ['data_loaded', 'exploration_started', 'comparison_used', 'share_copied', 'download_started', 'local_imported'];
  for (const event of events) {
    trackOnce(event);
    trackOnce(event);
  }
  trackOnce('unexpected_event');
  env.fire('load');
  await new Promise((resolve) => setImmediate(resolve));
  for (const event of events) trackOnce(event);
  trackOnce('unexpected_event');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.calls.length, 7);
  assert.deepEqual(env.calls.map(({ name }) => name ?? 'pageview'), ['pageview', ...events]);
});

test('stalled sends time out, and missing clients or synchronous errors stay harmless', async () => {
  const stalled = browser();
  stalled.environment.umami.track = (payload) => {
    stalled.calls.push(payload);
    return payload.name ? Promise.resolve() : new Promise(() => {});
  };
  initializeAnalytics(true, stalled.environment);
  trackOnce('data_loaded');
  stalled.fire('load');
  await new Promise((resolve) => setImmediate(resolve));
  stalled.fireTimer(5_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(stalled.calls.map(({ name }) => name ?? 'pageview'), ['pageview', 'data_loaded']);

  const missing = browser();
  delete missing.environment.umami;
  initializeAnalytics(true, missing.environment);
  assert.doesNotThrow(() => missing.fire('load'));
  assert.doesNotThrow(() => trackOnce('data_loaded'));
  assert.equal(missing.calls.length, 0);

  const throwing = browser();
  throwing.environment.umami.track = () => { throw new Error('tracker failed'); };
  initializeAnalytics(true, throwing.environment);
  assert.doesNotThrow(() => throwing.fire('load'));
  await new Promise((resolve) => setImmediate(resolve));
  trackOnce('share_copied');
  await new Promise((resolve) => setImmediate(resolve));
});
