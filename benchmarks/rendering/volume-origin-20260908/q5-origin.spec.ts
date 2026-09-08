import { expect, test } from '../../../web/node_modules/@playwright/test/index.mjs';
import type { Browser, BrowserContext, CDPSession, Page, Response } from '../../../web/node_modules/@playwright/test/index.mjs';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type Axis = 'i0' | 'i1' | 'i2';
type HeaderMap = Record<string, string>;
interface Resource { path: string; bytes: number; sha256: string; media_type: string; codec: { name: string; decoded_bytes: number } }
interface Pack { axis: Axis; first_slice: number; slice_count: number; resource: Resource }
interface FeatureEntry { id: string; descriptor: { resource: Resource } }
interface Manifest {
  schema_version: string;
  dataset_id: string;
  release: { release_id: string; immutable: boolean };
  features: FeatureEntry[];
  provenance: { builder: { commit: string }; recipe: Record<string, unknown> & { transport: { layout: string; pack_depth: number } } };
}
interface FeatureCase {
  id: string;
  packs: Pack[];
  centerPacks: Pack[];
  centerBytes: number;
  decodedFloat32Bytes: number;
}
interface Profile { id: string; latencyMs: number; downloadBytesPerSecond: number }
interface CdpNetworkRow { request_id: string; url: string; status: number; protocol: string; headers: Record<string, unknown>; encoded_transfer_bytes: number | null }

const origin = required('Q5_ORIGIN').replace(/\/$/, '');
const localRoot = path.resolve(required('Q5_LOCAL'));
const output = path.resolve(required('Q5_OUTPUT'));
const mode = process.env.Q5_MODE ?? 'smoke';
if (mode !== 'smoke' && mode !== 'full') throw new Error('Q5_MODE must be smoke or full');
const resumeReport = process.env.Q5_RESUME
  ? JSON.parse(await readFile(path.resolve(process.env.Q5_RESUME), 'utf8')) as { profiles?: Record<string, unknown>[] }
  : null;
const manifestBytes = await readFile(path.join(localRoot, 'manifest.json'));
const manifest = JSON.parse(manifestBytes.toString('utf8')) as Manifest;
const manifestSha256 = sha256(manifestBytes);
const releaseId = manifest.release.release_id;
const prefixPath = `/datasets/ephys_atlas_volumes/benchmarks/${releaseId}/`;
const prefix = `${origin}${prefixPath.slice(0, -1)}`;
const centers: Record<Axis, number> = { i0: 115, i1: 108, i2: 7 };
const expectedRenderIndices = { coronal: '108', sagittal: '115', horizontal: '7' } as const;
const expectedRecipe = {
  reference_space_id: 'allen-ccf-2017', grid_id: 'allen-ccf-2017-50um', resolution_um: 50,
  index_convention: 'integer-centers-half-integer-edges', outside_value: 0,
  missing_values: 'nonfinite', classification_order: ['outside', 'missing', 'valid'],
  index_to_world_um: [50, 0, 0, -5739, 0, -50, 0, 5400, 0, 0, -50, 332, 0, 0, 0, 1],
};
const worstIds = [
  'psd_residual_alpha', 'psd_residual_delta', 'recovery_slope',
  'psd_residual_beta', 'repolarisation_slope', 'psd_residual_theta',
];
const profiles: Profile[] = [
  { id: 'unthrottled', latencyMs: 0, downloadBytesPerSecond: -1 },
  { id: 'broadband-100mbps-20ms', latencyMs: 20, downloadBytesPerSecond: 12_500_000 },
  { id: 'constrained-10mbps-80ms', latencyMs: 80, downloadBytesPerSecond: 1_250_000 },
];
const report: Record<string, unknown> = {
  benchmark: 'w26-depth4-live-cloudfront-q5-v1', mode, measured_at: new Date().toISOString(),
  origin, local_root: localRoot, release_id: releaseId, manifest_bytes: manifestBytes.byteLength,
  manifest_sha256: manifestSha256, builder_commit: manifest.provenance.builder.commit,
  environment: { platform: `${os.type()} ${os.release()} ${os.arch()}`, node: process.version, total_memory_bytes: os.totalmem() },
  smoke: null, profiles: [], correctness: null, errors: [],
  resumed_from: process.env.Q5_RESUME ?? null, gate_failures: [],
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function sha256(value: Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function percentile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)]!;
}
function normalizeCacheControl(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/\s/g, '');
}
function appUrl(featureId: string): string {
  const query = new URLSearchParams({
    v: '4', project: 'q5-benchmark', context: 'custom', dataset: manifest.dataset_id,
    release: releaseId, repr: 'volume', feature: featureId, cursor: '0,0,0',
  });
  return `${origin}/app/?${query}`;
}
function syntheticCatalog(): object {
  return {
    schema_version: '1.0', default_project: 'q5-benchmark',
    projects: [{ project_id: 'q5-benchmark', title: 'Q5 benchmark', dataset_ids: [manifest.dataset_id], default_dataset: manifest.dataset_id, editions: [] }],
    datasets: [{
      dataset_id: manifest.dataset_id, title: 'W26 volume benchmark', default_release: releaseId,
      releases: [{
        release_id: releaseId, label: 'W26 depth-4 candidate', status: 'development',
        manifest: { path: `${prefixPath}manifest.json`.slice(1), media_type: 'application/json', bytes: manifestBytes.byteLength, sha256: manifestSha256, codec: { name: 'none', decoded_bytes: manifestBytes.byteLength } },
      }],
    }],
  };
}
async function loadFeature(id: string): Promise<FeatureCase> {
  const entry = manifest.features.find((item) => item.id === id);
  if (!entry) throw new Error(`manifest lacks ${id}`);
  const featureRoot = path.join(localRoot, path.dirname(entry.descriptor.resource.path));
  const feature = JSON.parse(await readFile(path.join(localRoot, entry.descriptor.resource.path), 'utf8'));
  const volume = feature.representations.volume;
  if (JSON.stringify(volume.grid.shape) !== JSON.stringify([228, 264, 160])
    || volume.grid.reference_space_id !== expectedRecipe.reference_space_id
    || volume.grid.grid_id !== expectedRecipe.grid_id
    || JSON.stringify(volume.grid.index_to_world_um) !== JSON.stringify(expectedRecipe.index_to_world_um)
    || JSON.stringify(volume.array) !== JSON.stringify({ dtype: 'float16', endianness: 'little', order: 'C' })
    || volume.encoding.layout !== 'orthogonal_slice_packs') {
    throw new Error(`${id} does not carry the approved D043 depth-4 geometry/array contract`);
  }
  const indexPath = volume.encoding.resource_index.resource.path as string;
  const index = JSON.parse(await readFile(path.join(featureRoot, indexPath), 'utf8')) as { packs: Pack[] };
  const centerPacks = (Object.keys(centers) as Axis[]).map((axis) => {
    const center = centers[axis];
    const pack = index.packs.find((item) => item.axis === axis && item.first_slice <= center && center < item.first_slice + item.slice_count);
    if (!pack) throw new Error(`${id} lacks center ${axis} pack`);
    return pack;
  });
  return {
    id, packs: index.packs, centerPacks,
    centerBytes: centerPacks.reduce((sum, pack) => sum + pack.resource.bytes, 0),
    decodedFloat32Bytes: centerPacks.reduce((sum, pack) => sum + pack.resource.codec.decoded_bytes * 2, 0),
  };
}
const featureCases = new Map((await Promise.all(manifest.features.map(async ({ id }) => [id, await loadFeature(id)] as const))));

async function installCatalogRoute(page: Page): Promise<{ intercepted: string[] }> {
  const intercepted: string[] = [];
  await page.route(`${origin}/catalog.json`, async (route) => {
    intercepted.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(syntheticCatalog()) });
  });
  return { intercepted };
}
async function newMeasuredPage(browser: Browser, profile: Profile): Promise<{ context: BrowserContext; page: Page; cdp: CDPSession; intercepted: string[]; cdpRows: CdpNetworkRow[] }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const { intercepted } = await installCatalogRoute(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  const cdpRows: CdpNetworkRow[] = []; const byRequestId = new Map<string, CdpNetworkRow>();
  cdp.on('Network.responseReceived', (event) => {
    if (!event.response.url.startsWith(prefix)) return;
    const row = { request_id: event.requestId, url: event.response.url, status: event.response.status, protocol: event.response.protocol, headers: event.response.headers, encoded_transfer_bytes: null };
    cdpRows.push(row); byRequestId.set(event.requestId, row);
  });
  cdp.on('Network.loadingFinished', (event) => {
    const row = byRequestId.get(event.requestId); if (row) row.encoded_transfer_bytes = event.encodedDataLength;
  });
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: profile.latencyMs,
    downloadThroughput: profile.downloadBytesPerSecond, uploadThroughput: profile.downloadBytesPerSecond,
    connectionType: profile.id === 'constrained-10mbps-80ms' ? 'cellular4g' : 'wifi',
  });
  return { context, page, cdp, intercepted, cdpRows };
}
async function waitForRender(page: Page, featureId: string): Promise<void> {
  await expect(page.locator(`[data-volume-feature="${featureId}"]`)).toHaveCount(3, { timeout: 15_000 });
  for (const [view, index] of Object.entries(expectedRenderIndices)) {
    await expect(page.locator(`[data-view="${view}"] .view-frame__renderer`)).toHaveAttribute('data-volume-index', index);
  }
  await expect(page.locator('.projection-viewport[data-mode="composite"]')).toHaveCount(3);
  await expect(page.locator('[role="alert"]:visible')).toHaveCount(0);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function setCursor(page: Page, cursor: string): Promise<void> {
  await page.evaluate((value) => {
    const url = new URL(location.href); url.searchParams.set('cursor', value);
    history.replaceState({}, '', url); dispatchEvent(new PopStateEvent('popstate'));
  }, cursor);
}
async function measureSliderFrame(page: Page, nativeIndex: number, view: string, expectedIndex: string): Promise<number> {
  return page.evaluate(({ value, targetView, targetIndex }) => new Promise<number>((resolve, reject) => {
    const started = performance.now();
    const renderer = document.querySelector<HTMLElement>(`[data-view="${targetView}"] .view-frame__renderer`);
    const slider = document.querySelector<HTMLInputElement>(`input[aria-label="${targetView} slice"]`);
    if (!renderer || !slider) { reject(new Error(`missing ${targetView} renderer or slider`)); return; }
    let settled = false;
    const timeout = window.setTimeout(() => finish(new Error(`renderer ${targetView} did not reach ${targetIndex}`)), 2_000);
    const observer = new MutationObserver(check);
    function finish(error?: Error): void {
      if (settled) return; settled = true; clearTimeout(timeout); observer.disconnect();
      if (error) reject(error); else requestAnimationFrame(() => resolve(performance.now() - started));
    }
    function check(): void { if (renderer!.dataset.volumeIndex === targetIndex) finish(); }
    observer.observe(renderer, { attributes: true, attributeFilter: ['data-volume-index'] });
    slider.value = String(value); slider.dispatchEvent(new Event('input', { bubbles: true })); check();
  }), { value: nativeIndex, targetView: view, targetIndex: expectedIndex });
}
async function selectFeature(page: Page, id: string): Promise<void> {
  await page.evaluate((feature) => {
    const url = new URL(location.href); url.searchParams.set('feature', feature); url.searchParams.set('cursor', '0,0,0');
    history.replaceState({}, '', url); dispatchEvent(new PopStateEvent('popstate'));
  }, id);
  await waitForRender(page, id);
}
function packResponses(page: Page, target: FeatureCase): { responses: Response[]; urls: string[]; dispose: () => void } {
  const responses: Response[] = []; const urls: string[] = [];
  const listener = (response: Response) => {
    const url = response.url();
    if (url.startsWith(`${prefix}/features/${target.id}/`) && url.includes('/volume/packs/')) { responses.push(response); urls.push(url); }
  };
  page.on('response', listener);
  return { responses, urls, dispose: () => page.off('response', listener) };
}
async function memoryMetrics(page: Page, cdp: CDPSession): Promise<Record<string, number | null>> {
  const values = await cdp.send('Performance.getMetrics').catch(() => ({ metrics: [] as { name: string; value: number }[] }));
  const metrics = Object.fromEntries(values.metrics.map((entry) => [entry.name, entry.value]));
  const heap = await page.evaluate(() => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    return memory ? { used: memory.usedJSHeapSize, total: memory.totalJSHeapSize, limit: memory.jsHeapSizeLimit } : null;
  });
  return {
    js_heap_used_bytes: heap?.used ?? metrics.JSHeapUsedSize ?? null,
    js_heap_total_bytes: heap?.total ?? metrics.JSHeapTotalSize ?? null,
    js_heap_limit_bytes: heap?.limit ?? null,
    task_duration_seconds: metrics.TaskDuration ?? null,
    script_duration_seconds: metrics.ScriptDuration ?? null,
    layout_duration_seconds: metrics.LayoutDuration ?? null,
  };
}
async function runTrial(browser: Browser, feature: FeatureCase, profile: Profile): Promise<Record<string, unknown>> {
  const { context, page, cdp, intercepted, cdpRows } = await newMeasuredPage(browser, profile);
  const log = packResponses(page, feature);
  let firstPackAt: number | null = null;
  page.on('request', (request) => { if (request.url().includes(`/features/${feature.id}/volume/packs/`) && firstPackAt === null) firstPackAt = performance.now(); });
  const startupAt = performance.now();
  try {
    await page.goto(appUrl(feature.id), { waitUntil: 'domcontentloaded', timeout: profile.latencyMs >= 80 ? 15_000 : 10_000 });
    await waitForRender(page, feature.id);
    const renderedAt = performance.now();
    const responseRows = await Promise.all(log.responses.map(async (response) => {
      await response.finished(); const timing = response.request().timing();
      return { url: response.url(), status: response.status(), headers: await response.allHeaders(), request_duration_ms: timing.responseEnd };
    }));
    const headers = responseRows.map((row) => row.headers);
    const beforeRevisit = log.urls.length;
    const warmAt = performance.now();
    const warmFrameMs = [
      await measureSliderFrame(page, 545, 'coronal', '109'),
      await measureSliderFrame(page, 540, 'coronal', '108'),
    ];
    const warmMs = performance.now() - warmAt;
    return {
      startup_ms: renderedAt - startupAt, pack_request_to_render_ms: firstPackAt === null ? null : renderedAt - firstPackAt,
      warm_slider_frame_ms: warmFrameMs, warm_slider_node_roundtrip_ms: warmMs,
      cold_pack_requests: beforeRevisit, revisit_pack_requests: log.urls.length - beforeRevisit,
      declared_center_bytes: feature.centerBytes, declared_decoded_float32_bytes: feature.decodedFloat32Bytes,
      pack_urls: log.urls.slice(0, beforeRevisit), responses: responseRows, intercepted,
      cdp_network: cdpRows.filter((row) => row.url.includes(`/features/${feature.id}/volume/packs/`)),
      cloudfront: headers.map((item: HeaderMap) => ({ x_cache: item['x-cache'] ?? null, age: item.age ?? null, pop: item['x-amz-cf-pop'] ?? null, via: item.via ?? null })),
      memory: await memoryMetrics(page, cdp), runner_rss_bytes: process.memoryUsage().rss,
    };
  } finally { log.dispose(); await context.close(); }
}
function assertStrictTrial(feature: FeatureCase, trial: Record<string, unknown>): void {
  expect(trial.cold_pack_requests).toBe(3); expect(trial.revisit_pack_requests).toBe(0);
  expect(trial.declared_center_bytes).toBe(feature.centerBytes); expect(feature.centerBytes).toBeLessThanOrEqual(225_000);
  expect(trial.declared_decoded_float32_bytes).toBe(2_222_592);
  const expected = feature.centerPacks.map((pack) => `${prefix}/features/${feature.id}/${pack.resource.path}`).sort();
  expect([...(trial.pack_urls as string[])].sort()).toEqual(expected);
  const byUrl = new Map((trial.responses as { url: string; status: number; headers: HeaderMap }[]).map((row) => [row.url, row]));
  for (const pack of feature.centerPacks) {
    const url = `${prefix}/features/${feature.id}/${pack.resource.path}`; const row = byUrl.get(url)!;
    expect(row, url).toBeDefined(); expect(row.status, url).toBe(200);
    expect(Number(row.headers['content-length']), url).toBe(pack.resource.bytes);
    expect(normalizeCacheControl(row.headers['cache-control']), url).toBe('public,max-age=31536000,immutable');
    expect(row.headers['content-type'], url).toContain('application/octet-stream');
    expect(row.headers['content-encoding'], url).toBeUndefined();
  }
  expect(trial.intercepted).toEqual([`${origin}/catalog.json`]);
}
async function writeReport(): Promise<void> { await writeFile(output, `${JSON.stringify(report, null, 2)}\n`); }

test.afterEach(async ({}, testInfo) => {
  if (testInfo.error) (report.errors as unknown[]).push({ test: testInfo.title, message: testInfo.error.message });
  await writeReport();
});

test('smoke: exact identity, first live render, headers, range, and negative route', async ({ browser }) => {
  expect(manifest.schema_version).toBe('1.0'); expect(manifest.dataset_id).toBe('ephys_atlas_volumes');
  expect(manifest.release.immutable).toBe(true); expect(manifest.features).toHaveLength(41);
  expect(manifest.provenance.recipe.transport).toEqual({ layout: 'orthogonal_slice_packs', pack_depth: 4 });
  for (const [key, value] of Object.entries(expectedRecipe)) expect(manifest.provenance.recipe[key]).toEqual(value);
  const feature = featureCases.get('psd_residual_alpha')!;
  expect(feature.centerPacks.map((pack) => pack.axis).sort()).toEqual(['i0', 'i1', 'i2']);
  expect(feature.centerBytes).toBeLessThanOrEqual(225_000); expect(feature.decodedFloat32Bytes).toBe(2_222_592);
  const publicCatalogBefore = Buffer.from(await (await fetch(`${origin}/catalog.json`, { cache: 'no-store' })).arrayBuffer());
  const trial = await runTrial(browser, feature, profiles[0]!);
  report.smoke = { feature: feature.id, trial, public_catalog_sha256_before: sha256(publicCatalogBefore) };
  await writeReport();
  assertStrictTrial(feature, trial);
  expect(trial.startup_ms).toBeLessThanOrEqual(10_000);
  expect((trial.warm_slider_frame_ms as number[]).every((value) => value <= 100)).toBe(true);
  for (const row of trial.responses as { status: number; headers: HeaderMap; url: string }[]) {
    expect(row.status, row.url).toBe(200);
    expect(normalizeCacheControl(row.headers['cache-control']), row.url).toBe('public,max-age=31536000,immutable');
    expect(row.headers['content-type'], row.url).toContain('application/octet-stream');
    expect(row.headers['content-encoding'], row.url).toBeUndefined();
  }

  const liveManifest = await fetch(`${prefix}/manifest.json`); expect(liveManifest.status).toBe(200);
  const liveManifestBytes = Buffer.from(await liveManifest.arrayBuffer());
  expect(liveManifestBytes.byteLength).toBe(manifestBytes.byteLength); expect(sha256(liveManifestBytes)).toBe(manifestSha256);
  expect(normalizeCacheControl(liveManifest.headers.get('cache-control') ?? undefined)).toBe('public,max-age=31536000,immutable');
  const rangePack = feature.centerPacks[0]!;
  const range = await fetch(`${prefix}/features/${feature.id}/${rangePack.resource.path}`, { headers: { Range: 'bytes=0-1023' } });
  const rangeBytes = Buffer.from(await range.arrayBuffer());
  expect(range.status).toBe(206); expect(rangeBytes.byteLength).toBe(1024);
  expect(range.headers.get('content-range')).toBe(`bytes 0-1023/${rangePack.resource.bytes}`);
  expect(range.headers.get('content-encoding')).toBeNull();
  expect(rangeBytes.equals((await readFile(path.join(localRoot, 'features', feature.id, rangePack.resource.path))).subarray(0, 1024))).toBe(true);
  const missing = await fetch(`${prefix}/does-not-exist.json`);
  expect([403, 404]).toContain(missing.status); expect(missing.headers.get('content-type') ?? '').not.toContain('text/html');
  const publicCatalogAfter = Buffer.from(await (await fetch(`${origin}/catalog.json`, { cache: 'no-store' })).arrayBuffer());
  expect(sha256(publicCatalogAfter)).toBe(sha256(publicCatalogBefore));
  report.smoke = { feature: feature.id, trial, public_catalog_sha256_before: sha256(publicCatalogBefore), public_catalog_sha256_after: sha256(publicCatalogAfter), manifest_headers: Object.fromEntries(liveManifest.headers), range_headers: Object.fromEntries(range.headers), missing: { status: missing.status, headers: Object.fromEntries(missing.headers) } };
});

test('full: six worst features, ten trials, three profiles', async ({ browser }) => {
  test.skip(mode !== 'full', 'set Q5_MODE=full after smoke passes');
  const rows: Record<string, unknown>[] = [...(resumeReport?.profiles ?? [])];
  const gateFailures: string[] = [];
  for (const profile of profiles) {
    for (const id of worstIds) {
      const feature = featureCases.get(id)!;
      const existing = rows.find((row) => row.profile === profile.id && row.feature_id === id);
      const trials: Record<string, unknown>[] = existing
        ? existing.trials as Record<string, unknown>[]
        : [];
      if (!existing) for (let index = 0; index < 10; index += 1) trials.push(await runTrial(browser, feature, profile));
      const startup = trials.map((item) => item.startup_ms as number);
      const packToRender = trials.map((item) => item.pack_request_to_render_ms as number);
      const warmFrames = trials.flatMap((item) => item.warm_slider_frame_ms as number[]);
      const warmRoundtrip = trials.map((item) => item.warm_slider_node_roundtrip_ms as number);
      const startupBudget = profile.latencyMs >= 80 ? 15_000 : 10_000;
      if (!existing) rows.push({ profile: profile.id, feature_id: id, trials, startup_ms_p50: percentile(startup, 0.5), startup_ms_p95: percentile(startup, 0.95), pack_request_to_render_ms_p50: percentile(packToRender, 0.5), pack_request_to_render_ms_p95: percentile(packToRender, 0.95), warm_slider_frame_ms_p50: percentile(warmFrames, 0.5), warm_slider_frame_ms_p95: percentile(warmFrames, 0.95), warm_slider_node_roundtrip_ms_p50: percentile(warmRoundtrip, 0.5), warm_slider_node_roundtrip_ms_p95: percentile(warmRoundtrip, 0.95) });
      report.profiles = rows; await writeReport();
      for (let index = 0; index < trials.length; index += 1) {
        try { assertStrictTrial(feature, trials[index]!); }
        catch (error) { gateFailures.push(`${profile.id}/${id}/trial-${index + 1}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      if (percentile(startup, 0.95) > startupBudget) gateFailures.push(`${profile.id}/${id}: startup p95 ${percentile(startup, 0.95)} > ${startupBudget}`);
      if (percentile(warmFrames, 0.95) > 100) gateFailures.push(`${profile.id}/${id}: warm frame p95 ${percentile(warmFrames, 0.95)} > 100`);
    }
  }
  report.gate_failures = gateFailures; await writeReport();
  expect(gateFailures).toEqual([]);
});

test('full: all features and one exact pack-boundary request', async ({ browser }) => {
  test.skip(mode !== 'full', 'set Q5_MODE=full after smoke passes');
  const { context, page, intercepted } = await newMeasuredPage(browser, profiles[0]!);
  const packUrls: string[] = [];
  page.on('request', (request) => { if (request.url().startsWith(prefix) && request.url().includes('/volume/packs/')) packUrls.push(request.url()); });
  try {
    await page.goto(appUrl(manifest.features[0]!.id), { waitUntil: 'domcontentloaded', timeout: 10_000 });
    await waitForRender(page, manifest.features[0]!.id);
    for (const { id } of manifest.features) await selectFeature(page, id);
    await selectFeature(page, 'psd_residual_alpha');
    const beforeInside = packUrls.length; await measureSliderFrame(page, 545, 'coronal', '109');
    expect(packUrls.length).toBe(beforeInside);
    const modes: string[] = [];
    page.on('console', () => undefined);
    await page.evaluate(() => {
      const state = window as Window & { __q5Modes?: string[]; __q5Observers?: MutationObserver[] };
      state.__q5Modes = []; state.__q5Observers = [...document.querySelectorAll<HTMLElement>('.projection-viewport')].map((node) => {
        const observer = new MutationObserver(() => state.__q5Modes!.push(node.dataset.mode ?? ''));
        observer.observe(node, { attributes: true, attributeFilter: ['data-mode'] }); return observer;
      });
    });
    const beforeBoundary = packUrls.length; await measureSliderFrame(page, 560, 'coronal', '112');
    await expect.poll(() => packUrls.length).toBe(beforeBoundary + 1);
    modes.push(...await page.evaluate(() => (window as Window & { __q5Modes?: string[] }).__q5Modes ?? []));
    expect(modes).not.toContain('regional');
    report.correctness = { features_rendered: manifest.features.length, inside_pack_requests: 0, boundary_requests: 1, modes, intercepted, final_memory: await memoryMetrics(page, await context.newCDPSession(page)), runner_rss_bytes: process.memoryUsage().rss };
  } finally { await context.close(); }
});
