import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const artifactRoot = process.env.AGEA_BENCHMARK_DIR;

// Standalone transport experiment. Never mount candidate data as an app release
// or claim that these voxel-index planes establish anatomical registration.
for (const profile of ['local', '10mbps-80ms'] as const) {
test(`full AGEA metadata and whole experiments through existing decoder/cache (${profile})`, async ({ page, browserName }) => {
  test.skip(!artifactRoot, 'set AGEA_BENCHMARK_DIR to tools.agea_benchmark output');
  const root = path.resolve(artifactRoot!);
  const audit = JSON.parse(await readFile(path.join(root, 'audit.json'), 'utf8'));
  const declared = new Map<string, any>([[audit.metadata.path, audit.metadata],
    ...Object.values(audit.samples).map((sample: any): [string, any] => [sample.volume.path, sample.volume])]);
  let networkRequests = 0;
  let networkBytes = 0;
  await page.route('**/__agea_benchmark_host__', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><head><title>AGEA transport benchmark</title></head><body></body></html>',
  }));
  await page.route('**/__agea_benchmark__/**', async route => {
    const relative = new URL(route.request().url()).pathname.split('/__agea_benchmark__/')[1]!;
    if (!declared.has(relative)) return route.fulfill({ status: 404 });
    const body = await readFile(path.join(root, relative));
    networkRequests++;
    networkBytes += body.byteLength;
    if (profile === '10mbps-80ms') {
      // Deterministic transfer-delay model, not a real CDN or packet simulator.
      await new Promise(resolve => setTimeout(resolve, 80 + body.byteLength * 8 / 10_000));
    }
    await route.fulfill({ body, contentType: 'application/gzip', headers: { 'cache-control': 'no-store' } });
  });
  await page.goto('/__agea_benchmark_host__');
  const result = await page.evaluate(async audit => {
    const [{ ResourceFetcher }, { decodeResourceBytes }, { SchemaChunks3dVolumeSource },
      { VolumeSliceLoader }, { CanvasVolumeSliceRenderer }] = await Promise.all([
      import('/src/data/cache.ts'), import('/src/data/validate.ts'),
      import('/src/rendering/chunked-volume-source.ts'), import('/src/rendering/volume.ts'),
      import('/src/rendering/canvas-volume-renderer.ts'),
    ]);
    const cacheName = 'agea-benchmark-only';
    await caches.delete(cacheName);
    let fetches = 0;
    const fetcher = new ResourceFetcher(async (...args: Parameters<typeof fetch>) => {
      fetches++;
      return fetch(...args);
    }, cacheName);
    const descriptor = (r: any) => ({ ...r, codec: { name: 'gzip', decodedBytes: r.decoded_bytes } });
    async function bytes(r: any) {
      return (await fetcher.fetch(`/__agea_benchmark__/${r.path}`,
        { immutable: true, integrity: { bytes: r.bytes, sha256: r.sha256 } })).arrayBuffer();
    }
    const metadataSamples = [];
    let metadata: any;
    let searchIndex: any[] = [];
    for (let trial = 0; trial < 5; trial++) {
      await (await caches.open(cacheName)).delete(`/__agea_benchmark__/${audit.metadata.path}`);
      const start = performance.now();
      const compressed = await bytes(audit.metadata);
      const received = performance.now();
      const raw = await decodeResourceBytes(compressed, descriptor(audit.metadata));
      const decoded = performance.now();
      const text = new TextDecoder().decode(raw);
      const textDecoded = performance.now();
      metadata = JSON.parse(text);
      const parsed = performance.now();
      searchIndex = metadata.features.map((f: any) => ({ feature: f,
        key: `${f.gene} ${f.experiment_id}`.toLowerCase() }));
      const indexed = performance.now();
      metadataSamples.push({ fetchVerifyPersistMs: received - start,
        decompressMs: decoded - received, textDecodeMs: textDecoded - decoded,
        parseMs: parsed - textDecoded, indexMs: indexed - parsed, totalMs: indexed - start });
    }
    if (metadata.production_release !== false || metadata.features.length !== audit.experiments) {
      throw new Error('Unexpected benchmark inventory');
    }
    // Measure the local search/visible-row strategy, not an implemented picker.
    const list = document.createElement('div');
    document.body.replaceChildren(list);
    const searchSamples = [];
    for (const query of ['', 'a', 'slc', 'Slc17a7', '74658173', 'not-a-gene']) {
      const began = performance.now();
      const matches = searchIndex.filter((entry: any) => entry.key.includes(query.toLowerCase()));
      list.replaceChildren(...matches.slice(0, 30).map((entry: any) => {
        const row = document.createElement('button');
        row.textContent = `${entry.feature.gene} (${entry.feature.experiment_id})`;
        return row;
      }));
      list.getBoundingClientRect();
      searchSamples.push({ query, matches: matches.length, rendered_rows: list.childElementCount,
        milliseconds: performance.now() - began });
    }
    const axes = ['coronal', 'sagittal', 'horizontal'] as const;
    const shape = metadata.grid.shape as [number, number, number];
    const centers = [Math.floor(shape[2] / 2), Math.floor(shape[0] / 2), Math.floor(shape[1] / 2)];
    const digest = async (data: Float32Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data.buffer))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
    function sourceFor(sample: any) {
      const resource = descriptor(sample.volume);
      return new VolumeSliceLoader(new SchemaChunks3dVolumeSource({
        schemaVersion: '1.0', featureId: sample.id, representation: 'volume',
        descriptor: { kind: 'volume', format: 'ephys-atlas-volume-v1', layout: 'chunks3d',
          // The decoder needs axis order and spacing only; no world cursor or
          // anatomy renderer is invoked with invented registration.
          grid: { shape, axisOrder: ['ml', 'dv', 'ap'], voxelSizeUm: [200, 200, 200] },
          array: { dtype: 'float16', endianness: 'little', order: 'C' },
          resource: { chunk_shape: shape, chunks: [{ origin: [0, 0, 0],
            decoded: { shape, storageAxes: ['i0', 'i1', 'i2'] }, resource }] } },
        loadResource: () => bytes(sample.volume),
      }), { cacheBytes: 1024 * 1024 });
    }
    const samples = [];
    for (const [name, sample] of Object.entries(audit.samples) as [string, any][]) {
      for (let trial = 0; trial < 5; trial++) {
        await (await caches.open(cacheName)).delete(`/__agea_benchmark__/${sample.volume.path}`);
        const source = sourceFor(sample);
        const beforeFetch = fetches;
        const coldStart = performance.now();
        const slices = await Promise.all(axes.map((axis, i) => source.loadSlice(axis, centers[i]!)));
        const coldMs = performance.now() - coldStart;
        const coldRequests = fetches - beforeFetch;
        const hashes = await Promise.all(slices.map(slice => digest(slice.data)));
        for (let i = 0; i < axes.length; i++) {
          if (hashes[i] !== sample.slice_sha256[axes[i]!]) throw new Error(`Wrong ${axes[i]} plane`);
        }
        const paintStart = performance.now();
        for (const slice of slices) {
          const canvas = document.createElement('canvas');
          const rgba = new Uint8ClampedArray(slice.data.length * 4);
          const max = sample.summary.valid_statistics?.max || 1;
          slice.data.forEach((value, i) => {
            rgba[i * 4] = Math.round(Math.max(0, value) / max * 255);
            rgba[i * 4 + 3] = Number.isFinite(value) && value >= 0 ? 255 : 0;
          });
          new CanvasVolumeSliceRenderer(canvas).render({ ...slice, rgba });
        }
        const paintMs = performance.now() - paintStart;
        const warmStart = performance.now();
        await Promise.all(axes.map(axis => source.loadSlice(axis, 0)));
        const warmMs = performance.now() - warmStart;
        const warmRequests = fetches - beforeFetch - coldRequests;
        const decodedBytes = source.cache.byteLength;
        source.dispose();
        const revisit = sourceFor(sample);
        const revisitStart = performance.now();
        await Promise.all(axes.map((axis, i) => revisit.loadSlice(axis, centers[i]!)));
        const revisitMs = performance.now() - revisitStart;
        const revisitRequests = fetches - beforeFetch - coldRequests - warmRequests;
        revisit.dispose();
        samples.push({ name, trial, coldMs, coldRequests, warmMs, warmRequests,
          revisitMs, revisitRequests, paintMs, decodedBytes });
      }
    }
    const beforeMetadataReload = fetches;
    await bytes(audit.metadata);
    const metadataReloadRequests = fetches - beforeMetadataReload;
    // Deliberately corrupt a cached response and prove clean retry works.
    const first = audit.samples.first.volume;
    const cache = await caches.open(cacheName);
    await cache.put(`/__agea_benchmark__/${first.path}`, new Response(new Uint8Array([0])));
    const beforeRecovery = fetches;
    await bytes(first);
    const recoveryRequests = fetches - beforeRecovery;
    const storageEstimate = await navigator.storage.estimate();
    await caches.delete(cacheName);
    return { userAgent: navigator.userAgent, metadata: { samples: metadataSamples,
      metadataReloadRequests }, searchSamples, samples, recoveryRequests, storageEstimate };
  }, audit);
  expect(result.samples).toHaveLength(20);
  for (const sample of result.samples) {
    expect(sample.coldRequests).toBe(1);
    expect(sample.warmRequests).toBe(0);
    expect(sample.revisitRequests).toBe(0);
    expect(sample.decodedBytes).toBe(58 * 41 * 67 * 4);
  }
  expect(result.metadata.metadataReloadRequests).toBe(0);
  expect(result.recoveryRequests).toBe(1);
  expect(networkRequests).toBe(26);
  expect(networkBytes).toBe(audit.metadata.bytes * 5 + audit.samples.first.volume.bytes
    + Object.values(audit.samples).reduce((sum: number, sample: any) => sum + sample.volume.bytes * 5, 0));
  expect(result.searchSamples[0]!.matches).toBe(audit.experiments);
  expect(result.searchSamples.every(sample => sample.rendered_rows <= 30)).toBe(true);
  const report = { benchmark: 'agea-browser-transport-v1', measuredAt: new Date().toISOString(),
    browserName, profile, platform: `${os.type()} ${os.release()} ${os.arch()}`, node: process.version,
    metadataResource: audit.metadata, networkRequests, networkBytes, ...result,
    limitations: 'Playwright route delivery; constrained profile adds a deterministic 80ms + bytes/10Mbps delay, '
      + 'not a real CDN/network stack. No production metadata validation, '
      + 'complete application startup, anatomical registration, picker interaction or browser RSS measurement.' };
  await writeFile(path.join(root, `browser-${browserName}-${profile}.json`), JSON.stringify(report, null, 2) + '\n');
});
}
