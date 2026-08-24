import * as THREE from 'three';
import '../src/styles.css';
import './styles.css';
import { ResourceFetcher } from '../src/data/cache.js';
import type { MeshPackV1 } from '../src/data/schema-v1.js';
import {
  RetainedBrainScene3DViewportFactory,
  type BrainScene3DViewport,
  type RegionalPresentation,
} from '../src/rendering/3d/brain-scene-viewport.js';
import { MeshPackSource, type LoadedMeshLod } from '../src/rendering/3d/mesh-pack-source.js';
import { StableArcballControls } from '../src/rendering/3d/stable-arcball-controls.js';

interface ReviewConfig {
  pack_id: string;
  builder_commit: string;
  manifest: { url: string; bytes: number; sha256: string };
  overrides: { manifest_url: string; base_url: string };
  reviewed_signed_allen_ids: number[];
  metrics_url: string;
  summary_url: string;
}

const config = await fetchJson<ReviewConfig>('/__mesh-review/review/review-config.json');
const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Review root is missing');
async function main(): Promise<void> {
  root.innerHTML = `<main class="review-shell">
  <header><div><p>Local candidate · publication not approved</p><h1>3-D mesh production review</h1><small>${config.pack_id} · ${config.builder_commit}</small></div><strong id="status" role="status">Loading verified geometry…</strong></header>
  <section class="controls" aria-label="Review controls">
    <label>Signed Allen region <select id="region"></select></label>
    <label>Mapping <select id="mapping"><option>allen</option><option>beryl</option><option>cosmos</option></select></label>
    <label>Viewport width <select id="width"><option>320</option><option selected>480</option><option>800</option></select></label>
    <label>Explode <input id="explode" type="range" min="0" max="1" step="0.01" value="0"><output id="explode-value">0.00</output></label>
    <button id="reset" type="button">Reset cameras</button>
    <a href="${config.metrics_url}" target="_blank">Metrics JSON</a>
    <a href="${config.summary_url}" target="_blank">Sign-off record</a>
  </section>
  <section class="comparison" id="comparison" data-width="480">
    <article><h2>Canonical source/reference</h2><div id="reference" class="scene"></div><p>Exact unsmoothed 10 µm LUT voxel-edge surface.</p></article>
    <article><h2>Compact candidate</h2><div id="compact" class="scene"></div><p id="compact-state">Loading…</p></article>
    <article><h2>High candidate</h2><div id="high" class="scene"></div><p id="high-state">Loading…</p></article>
  </section>
  <section class="evidence"><h2>Live invariants</h2><pre id="diagnostics"></pre><p>Drag rotates, wheel zooms, and click selects. Review both explode endpoints and all 320/480/800 widths.</p></section>
</main>`;

const regionSelect = required<HTMLSelectElement>('#region');
for (const signedId of config.reviewed_signed_allen_ids) regionSelect.add(new Option(String(signedId), String(signedId)));
const compactSource = new SelectedLodSource(config, 'compact');
const highSource = new SelectedLodSource(config, 'high');
const compactFactory = new RetainedBrainScene3DViewportFactory(compactSource);
const highFactory = new RetainedBrainScene3DViewportFactory(highSource);
const compact = compactFactory.create(required('#compact'));
const high = highFactory.create(required('#high'));
const reference = new CanonicalReference(required('#reference'), config);
const manifest = await compactSource.loadManifest();
let mapping: RegionalPresentation['mapping'] = 'allen';
let signedId = Number(regionSelect.value);
let explode = 0;

const presentation = (): RegionalPresentation => {
  const region = manifest.regions.find((candidate) => candidate.signed_allen_id === signedId);
  if (!region) throw new Error(`Signed Allen ${signedId} is absent`);
  const mappedId = region.mappings[mapping];
  const visible = mappedId == null ? new Set<number>() : new Set([mappedId]);
  return {
    mapping,
    anatomyColors: new Map(mappedId == null ? [] : [[mappedId, signedId < 0 ? '#48a9dc' : '#ef8d45']]),
    featureColors: null,
    visibleRegionIds: visible,
    selectedRegionIds: visible,
    highlightedRegionId: null,
    featureSide: null,
  };
};
function updatePresentation(): void {
  const value = presentation();
  compact.setPresentation(value);
  high.setPresentation(value);
  compact.setViewState({ explode, camera: null });
  high.setViewState({ explode, camera: null });
  compact.focusRegion(signedId);
  high.focusRegion(signedId);
  updateDiagnostics();
}
compactFactory.setInteractionSink({ error: fail });
highFactory.setInteractionSink({ error: fail });
compact.activate();
high.activate();
updatePresentation();
await reference.show(signedId);

const ready = new MutationObserver(() => {
  const compactHost = required('#compact');
  const highHost = required('#high');
  required('#compact-state').textContent = compactHost.dataset.scene3dState === 'ready' ? `Ready · ${compactHost.dataset.lod}` : compactHost.dataset.scene3dState ?? 'loading';
  required('#high-state').textContent = highHost.dataset.scene3dState === 'ready' ? `Ready · ${highHost.dataset.lod}` : highHost.dataset.scene3dState ?? 'loading';
  if (compactHost.dataset.scene3dState === 'ready' && highHost.dataset.scene3dState === 'ready') required('#status').textContent = 'Verified compact, high, and source loaded';
  updateDiagnostics();
});
ready.observe(required('#comparison'), { attributes: true, subtree: true });

regionSelect.onchange = async () => { signedId = Number(regionSelect.value); updatePresentation(); await reference.show(signedId); };
required<HTMLSelectElement>('#mapping').onchange = (event) => { mapping = (event.currentTarget as HTMLSelectElement).value as RegionalPresentation['mapping']; updatePresentation(); };
required<HTMLSelectElement>('#width').onchange = (event) => { required('#comparison').dataset.width = (event.currentTarget as HTMLSelectElement).value; };
required<HTMLInputElement>('#explode').oninput = (event) => {
  explode = Number((event.currentTarget as HTMLInputElement).value);
  required('#explode-value').textContent = explode.toFixed(2);
  updatePresentation();
};
required('#reset').onclick = () => {
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>('.scene canvas')) canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  reference.reset();
};
addEventListener('beforeunload', () => { ready.disconnect(); compactFactory.destroy(); highFactory.destroy(); reference.destroy(); }, { once: true });

function updateDiagnostics(): void {
  const geometryRequests = performance.getEntriesByType('resource').filter((entry) => /\/pack\/(compact|high)\.eam3\.gz$/.test(entry.name)).length;
  required('#diagnostics').textContent = JSON.stringify({
    signed_allen_id: signedId,
    mapping,
    explode,
    geometry_requests: geometryRequests,
    compact_uploads: required('#compact').dataset.geometryUploads ?? '0',
    high_uploads: required('#high').dataset.geometryUploads ?? '0',
  }, null, 2);
  root.dataset.geometryRequests = String(geometryRequests);
}
function fail(error: Error): void { required('#status').textContent = `Review failed: ${error.message}`; }
}

class SelectedLodSource {
  private readonly source: MeshPackSource;
  constructor(private readonly review: ReviewConfig, private readonly lod: 'compact' | 'high') {
    this.source = new MeshPackSource({
      manifest: { ...review.manifest, url: new URL(review.manifest.url, location.href).toString() },
      fetcher: new ResourceFetcher(),
    });
  }
  loadManifest(signal?: AbortSignal): Promise<MeshPackV1> { return this.source.loadManifest(signal); }
  loadDefault(signal?: AbortSignal): Promise<LoadedMeshLod> { return this.lod === 'compact' ? this.source.loadDefault(signal) : this.requiredUpgrade(signal); }
  loadUpgrade(): Promise<null> { return Promise.resolve(null); }
  dispose(): void { this.source.dispose(); }
  private async requiredUpgrade(signal?: AbortSignal): Promise<LoadedMeshLod> {
    const value = await this.source.loadUpgrade(signal);
    if (!value) throw new Error('High review LOD is absent');
    return value;
  }
}

class CanonicalReference {
  private readonly canvas = document.createElement('canvas');
  private readonly renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 1, 100_000);
  private readonly controls = new StableArcballControls(this.camera, this.canvas, () => this.render());
  private readonly observer: ResizeObserver;
  private mesh: THREE.Mesh | null = null;
  private overrideManifest: Promise<{ surfaces: Array<{ signed_allen_id: number; positions: { path: string }; indices: { path: string } }> }>;
  constructor(private readonly host: HTMLElement, private readonly review: ReviewConfig) {
    host.append(this.canvas);
    this.scene.background = new THREE.Color('#09141e');
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#78909c', 2.5));
    this.camera.up.set(0, 0, 1);
    this.overrideManifest = fetchJson(review.overrides.manifest_url);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
  }
  async show(identifier: number): Promise<void> {
    const surface = (await this.overrideManifest).surfaces.find((candidate) => candidate.signed_allen_id === identifier);
    if (!surface) throw new Error(`Canonical reference ${identifier} is absent`);
    const [positions, indices] = await Promise.all([
      fetchArray(`${this.review.overrides.base_url}${surface.positions.path}`, Float32Array),
      fetchArray(`${this.review.overrides.base_url}${surface.indices.path}`, Uint32Array),
    ]);
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: identifier < 0 ? '#48a9dc' : '#ef8d45', side: THREE.DoubleSide, roughness: .72 }));
    this.scene.add(this.mesh);
    const sphere = geometry.boundingSphere!;
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).add(new THREE.Vector3(0, -4, 2.2).setLength(Math.max(100, sphere.radius * 4.57)));
    this.camera.near = Math.max(1, sphere.radius / 100);
    this.camera.far = Math.max(10_000, sphere.radius * 20);
    this.camera.lookAt(sphere.center);
    this.controls.saveState();
    this.render();
  }
  reset(): void { this.controls.reset(); this.render(); }
  destroy(): void { this.observer.disconnect(); this.controls.dispose(); this.renderer.dispose(); }
  private resize(): void {
    const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }
  private render(): void { this.renderer.render(this.scene, this.camera); }
}

await main();

async function fetchJson<T>(url: string): Promise<T> { const response = await fetch(url); if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`); return response.json() as Promise<T>; }
async function fetchArray<T extends Float32Array | Uint32Array>(url: string, Type: { new(buffer: ArrayBuffer): T }): Promise<T> { const response = await fetch(url); if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`); return new Type(await response.arrayBuffer()); }
function required<T extends HTMLElement = HTMLElement>(selector: string): T { const element = root.querySelector<T>(selector); if (!element) throw new Error(`Missing ${selector}`); return element; }
