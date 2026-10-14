/** Record the owner's open atlas tab. Node 22; no additional dependencies.
 * node benchmarks/rendering/live-region-interaction.mjs [output.json]
 * Enable chrome://inspect/#remote-debugging, allow Chrome's connection prompt,
 * reproduce interactions, then press Enter in this terminal to stop.
 */
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const output = path.resolve(process.argv[2] ?? 'artifacts/interaction-perf/live-streamed.json');
await mkdir(path.dirname(output), { recursive: true });
const journal = `${output}.ndjson`;
await writeFile(journal, '');
const portFile = process.env.ATLAS_CHROME_PORT_FILE
  ?? path.join(os.homedir(), '.config/google-chrome/DevToolsActivePort');
const [port, browserPath] = (await readFile(portFile, 'utf8')).trim().split('\n');
const socket = new WebSocket(`ws://127.0.0.1:${port}${browserPath}`);
let nextId = 0;
const pending = new Map();
const records = [];
let writes = Promise.resolve();
let sessionId;
let scriptId;
const send = (method, params = {}, session) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
});
const record = value => {
  records.push(value);
  writes = writes.then(() => appendFile(journal, `${JSON.stringify(value)}\n`));
};
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const task = pending.get(message.id);
    if (task) {
      pending.delete(message.id);
      message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result);
    }
  } else if (message.method === 'Runtime.bindingCalled' && message.sessionId === sessionId
    && message.params.name === '__atlasPerfEmit') {
    try { record(JSON.parse(message.params.payload)); } catch { /* Ignore unrelated/malformed binding calls. */ }
  }
});
socket.addEventListener('close', () => {
  for (const task of pending.values()) task.reject(new Error('Chrome disconnected; streamed records remain in the .ndjson journal'));
  pending.clear();
});
console.log('Waiting for Chrome approval. Keep this terminal open.');
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', () => reject(new Error('Chrome connection failed or approval timed out; rerun the recorder')), { once: true });
});
try {
  const { targetInfos } = await send('Target.getTargets');
  const candidates = targetInfos.filter(target => target.type === 'page' && target.title === 'IBL Ephys Atlas'
    && new URL(target.url).pathname.includes('/app'));
  if (candidates.length !== 1) throw new Error(`Expected one atlas tab, found ${candidates.length}; leave one atlas tab open`);
  const target = candidates[0];
  ({ sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
  const pageSend = (method, params = {}) => send(method, params, sessionId);
  await pageSend('Page.enable');
  await pageSend('Runtime.enable');
  await pageSend('Runtime.addBinding', { name: '__atlasPerfEmit' });
  const origin = new URL(target.url).origin;
  const source = `(() => {
    if (location.origin !== ${JSON.stringify(origin)} || !location.pathname.includes('/app') || window.__atlasPerfStop) return;
    const doc = performance.timeOrigin;
    const startedAt = performance.now();
    const emit = value => window.__atlasPerfEmit(JSON.stringify({ document: doc, ...value }));
    const abort = new AbortController();
    const observers = [];
    const samples = new WeakMap();
    let eventId = 0, active = true;
    emit({ kind: 'document', startedAt, url: location.href, userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, visibility: document.visibilityState });
    for (const type of ['pointermove', 'pointerdown', 'pointerup', 'click']) {
      document.addEventListener(type, event => {
        const path = event.target.closest?.('path[data-allen-id]');
        if (!path) return;
        const sample = { id: ++eventId, type, region: path.getAttribute('data-allen-id'), start: performance.now(),
          inputTimestamp: event.timeStamp, trusted: event.isTrusted };
        samples.set(event, sample);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (active) emit({ kind: 'frame', id: sample.id, twoRafMs: performance.now() - sample.start });
        }));
      }, { capture: true, signal: abort.signal });
      document.addEventListener(type, event => {
        const sample = samples.get(event);
        if (sample) emit({ kind: 'handler', ...sample, handlerMs: performance.now() - sample.start });
      }, { signal: abort.signal });
    }
    for (const type of ['event', 'longtask']) {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (entry.startTime < startedAt) continue;
          if (type === 'longtask') emit({ kind: 'longtask', start: entry.startTime, durationMs: entry.duration });
          else if (entry.interactionId) emit({ kind: 'event-timing', name: entry.name, start: entry.startTime,
            durationMs: entry.duration, inputDelayMs: entry.processingStart - entry.startTime,
            processingMs: entry.processingEnd - entry.processingStart,
            presentationMs: entry.startTime + entry.duration - entry.processingEnd, interactionId: entry.interactionId });
        }
      });
      observer.observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 16 } : {}) });
      observers.push(observer);
    }
    window.__atlasPerfStop = () => { active = false; abort.abort(); observers.forEach(observer => observer.disconnect()); delete window.__atlasPerfStop; };
  })()`;
  ({ identifier: scriptId } = await pageSend('Page.addScriptToEvaluateOnNewDocument', { source }));
  const setup = await pageSend('Runtime.evaluate', { expression: source });
  if (setup.exceptionDetails) throw new Error(`Unable to install recorder: ${setup.exceptionDetails.text}`);
  console.log(`Recording ${target.url}. Switch to the atlas, reproduce clicks/hover, then press Enter here.`);
  await new Promise(resolve => { process.stdin.resume(); process.stdin.once('data', resolve); });
  await pageSend('Runtime.evaluate', { expression: 'window.__atlasPerfStop?.()' });
  await pageSend('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId });
  scriptId = null;
  await pageSend('Runtime.removeBinding', { name: '__atlasPerfEmit' });
  await writes;
  const interactions = new Map();
  for (const entry of records.filter(entry => entry.kind === 'event-timing')) {
    const key = `${entry.document}/${entry.interactionId}`;
    const previous = interactions.get(key);
    if (!previous || entry.durationMs > previous.durationMs) interactions.set(key, entry);
  }
  await writeFile(output, `${JSON.stringify({
    metric: 'Event Timing durations are browser-quantized; two rAF callbacks are only a frame proxy. Entries preceding the current document recording are excluded. No CPU profiler overhead.',
    records, interactions: [...interactions.values()],
  }, null, 2)}\n`);
  console.log(`Saved ${records.length} records, ${interactions.size} interactions to ${output}`);
} finally {
  if (socket.readyState === WebSocket.OPEN) {
    if (sessionId) {
      await send('Runtime.evaluate', { expression: 'window.__atlasPerfStop?.()' }, sessionId).catch(() => {});
      if (scriptId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId }, sessionId).catch(() => {});
      await send('Runtime.removeBinding', { name: '__atlasPerfEmit' }, sessionId).catch(() => {});
      await send('Target.detachFromTarget', { sessionId }).catch(() => {});
    }
    socket.close();
  }
  await writes;
  process.stdin.pause();
}
