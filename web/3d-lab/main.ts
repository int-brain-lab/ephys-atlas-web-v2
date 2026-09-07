import '../src/styles.css';
import './styles.css';
import { ResourceFetcher } from '../src/data/cache.js';
import type { MeshPackV1 } from '../src/data/schema-v1.js';
import type { BrainCameraPose, Scene3DViewState } from '../src/domain/types.js';
import { MeshPackSource } from '../src/rendering/3d/mesh-pack-source.js';
import {
  RetainedBrainScene3DViewportFactory,
  type BrainScene3DViewport,
  type RegionalPresentation,
} from '../src/rendering/3d/brain-scene-viewport.js';

interface MeshDescriptor { readonly url: string; readonly bytes: number; readonly sha256: string }
interface MeshVariant extends MeshDescriptor { readonly id: 'd042' | 'native'; readonly label: string }
interface ReviewComponent {
  readonly component_id: number;
  readonly source_allen_id: number;
  readonly first_triangle: number;
  readonly proposed_movement: 'left' | 'right' | 'fixed';
  readonly reason: string;
  readonly review_status: string;
}
interface ReviewEvidence { readonly components?: readonly ReviewComponent[] }
interface ReviewableComponent {
  readonly component_id: number;
  readonly source_allen_id: number;
  readonly bounds?: { readonly minimum_um: readonly [number, number, number]; readonly maximum_um: readonly [number, number, number] };
  readonly centroid_um?: readonly [number, number, number];
  readonly explode_displacement_um?: readonly [number, number, number];
}

const rootElement = document.querySelector<HTMLElement>('#app');
if (!rootElement) throw new Error('3-D lab root is missing');
const root: HTMLElement = rootElement;
const legacyMesh = import.meta.env.VITE_3D_LAB_MESH as MeshDescriptor | undefined;
const configuredVariants = import.meta.env.VITE_3D_LAB_VARIANTS as readonly MeshVariant[] | undefined;
const variants = configuredVariants?.length ? configuredVariants : [{
  id: 'd042' as const,
  label: legacyMesh ? 'D042 reviewed geometry' : 'Canonical synthetic fixture',
  ...(legacyMesh ?? {
    url: '/__mesh-pack-fixture/manifest.json', bytes: 3917,
    sha256: '6076d1604f67b3e711506e0d400adf58db49f5f6077790ca4d96d2557c56737a',
  }),
}];
const isComparison = variants.some((variant) => variant.id === 'native');
const review = import.meta.env.VITE_3D_LAB_REVIEW as ReviewEvidence | undefined;
const catalog = import.meta.env.VITE_3D_LAB_CATALOG as { mappings: Record<string, { atlas_id: number; acronym: string; color_hex: string }[]> } | undefined;
const flagged = (review?.components ?? []).filter((component) => component.reason === 'dominant-extent-review');

root.innerHTML = `<main class="mesh-lab">
  <header><div><p>${isComparison ? 'Local candidate comparison' : legacyMesh ? 'Allen brain anatomy · D042 reviewed geometry · local preview' : 'Non-production · canonical synthetic fixture'}</p><h1>${legacyMesh || isComparison ? '3-D brain anatomy' : 'Retained 3-D viewport'}</h1></div><strong id="status" role="status">Loading…</strong></header>
  ${isComparison ? '<div class="review-warning" role="note"><strong>Native movement preview</strong> Proposed assignments, awaiting your review.</div>' : ''}
  <section class="mesh-layout">
    <div id="scene" aria-label="Interactive bilateral 3-D brain fixture"></div>
    <aside>
      ${isComparison ? `<label>Geometry <select id="variant">${variants.map((variant) => `<option value="${variant.id}"${variant.id === 'native' ? ' selected' : ''}>${variant.label}</option>`).join('')}</select></label>` : ''}
      <label>Mapping <select id="mapping"><option>allen</option><option>beryl</option><option>cosmos</option></select></label>
      ${isComparison ? '<label class="check"><input id="side-colours" type="checkbox"> Colour original sides: left blue, right orange</label>' : ''}
      <label>Explode <input id="explode" type="range" min="0" max="1" step="0.01" value="0"><output id="explode-value">0.00</output></label>
      ${flagged.length ? `<section id="movement-review" class="movement-review"><h2>Flagged movement review</h2><label>Component <select id="review-component">${flagged.map((component, index) => `<option value="${index}">${reviewLabel(component)}</option>`).join('')}</select></label><label class="check"><input id="show-context" type="checkbox" checked> Show surrounding anatomy</label><button id="next-review" type="button">Next flagged component</button><p id="review-detail"></p></section>` : ''}
      <button id="show-all" type="button">Show both hemispheres</button>
      <button id="deactivate" type="button">Deactivate</button>
      <p>Click a region to select it. Drag rotates; scroll zooms; double-click resets the camera.</p>
      ${isComparison ? '<details><summary>Geometry details</summary><pre id="diagnostics"></pre></details>' : '<pre id="diagnostics"></pre>'}
    </aside>
  </section>
</main>`;

const scene = required('#scene');
const status = required('#status');
const diagnostics = required('#diagnostics');
const requestedVariant = new URL(location.href).searchParams.get('variant');
let activeVariant = variants.find((variant) => variant.id === requestedVariant)
  ?? variants.find((variant) => variant.id === 'native') ?? variants[0]!;
const variantControl = root.querySelector<HTMLSelectElement>('#variant');
if (variantControl) variantControl.value = activeVariant.id;
let factory: RetainedBrainScene3DViewportFactory | null = null;
let viewport: BrainScene3DViewport | null = null;
let manifest: MeshPackV1 | null = null;
let mapping: RegionalPresentation['mapping'] = 'allen';
let viewState: Scene3DViewState = { explode: 0, camera: null };
let loadGeneration = 0;
let activeReviewIndex: number | null = null;
const manifests = new Map<MeshVariant['id'], MeshPackV1>();
const visible = new Set<number>();
const selected = new Set<number>();

function showAll(): void {
  visible.clear();
  if (!manifest) return;
  for (const item of manifest.presentations) {
    const id = item.mappings[mapping];
    if (id !== null) visible.add(id);
  }
}

function anatomyColors(): Map<number, string> {
  if (root.querySelector<HTMLInputElement>('#side-colours')?.checked) {
    return new Map([...visible].map((id) => [id, id < 0 ? '#3f8fbd' : '#db7c3d']));
  }
  return catalog ? new Map((catalog.mappings[mapping] ?? []).map((region) => [region.atlas_id, region.color_hex])) : new Map([[-315, '#3f8fbd'], [315, '#db7c3d']]);
}

const presentation = (): RegionalPresentation => ({
  mapping,
  anatomyColors: anatomyColors(),
  featureColors: null,
  visibleRegionIds: visible,
  selectedRegionIds: selected,
  highlightedRegionId: null,
  featureSide: null,
});

function installInteractionSink(nextFactory: RetainedBrainScene3DViewportFactory): void {
  nextFactory.setInteractionSink({
    regionPointer(event) {
      scene.dataset.lastPointerType = event.type;
      scene.dataset.lastRegionId = event.regionId === null ? '' : String(event.regionId);
      if (event.type !== 'select' || event.regionId === null) return;
      selected.has(event.regionId) ? selected.delete(event.regionId) : selected.add(event.regionId);
      viewport?.setPresentation(presentation());
      updateDiagnostics(`selected ${[...selected].join(', ') || 'none'}`);
    },
    cameraChanged(pose, phase) {
      viewState = { ...viewState, camera: pose };
      scene.dataset.cameraPhase = phase;
      scene.dataset.cameraPose = JSON.stringify(pose);
    },
    error(error) { status.textContent = `3-D failed: ${error.message}`; },
  });
}

async function loadVariant(variant: MeshVariant): Promise<void> {
  const generation = ++loadGeneration;
  activeVariant = variant;
  const url = new URL(location.href);
  if (isComparison) { url.searchParams.set('variant', variant.id); history.replaceState(null, '', url); }
  status.textContent = `Loading ${variant.label}…`;
  scene.dataset.scene3dState = 'loading';
  factory?.destroy();
  const nextSource = new MeshPackSource({
    manifest: { url: new URL(variant.url, location.href).toString(), bytes: variant.bytes, sha256: variant.sha256 },
    fetcher: new ResourceFetcher(),
  });
  const loadedManifest = await nextSource.loadManifest();
  if (generation !== loadGeneration) { nextSource.dispose(); return; }
  manifest = loadedManifest;
  manifests.set(variant.id, loadedManifest);
  if (isComparison && !viewState.camera) viewState = { ...viewState, camera: wholeBrainPose(loadedManifest) };
  if (variant.id === 'd042' && !manifests.has('native')) await preloadNativeManifest(generation);
  if (generation !== loadGeneration) { nextSource.dispose(); return; }
  showAll();
  selected.clear();
  factory = new RetainedBrainScene3DViewportFactory(nextSource);
  installInteractionSink(factory);
  viewport = factory.create(scene);
  viewport.setPresentation(presentation());
  viewport.setViewState(viewState);
  viewport.activate();
  if (activeReviewIndex !== null) applyReviewSelection(activeReviewIndex);
  updateReviewAvailability();
  updateDiagnostics();
}

async function preloadNativeManifest(generation: number): Promise<void> {
  const native = variants.find((variant) => variant.id === 'native');
  if (!native) return;
  const preload = new MeshPackSource({
    manifest: { url: new URL(native.url, location.href).toString(), bytes: native.bytes, sha256: native.sha256 },
    fetcher: new ResourceFetcher(),
  });
  try {
    const loaded = await preload.loadManifest();
    if (generation === loadGeneration) manifests.set('native', loaded);
  } finally { preload.dispose(); }
}

function updateDiagnostics(extra = ''): void {
  if (!isComparison || !manifest) { diagnostics.textContent = extra; return; }
  diagnostics.textContent = [
    `variant ${activeVariant.id}`,
    `pack ${manifest.pack_id}`,
    `geometry ${manifest.geometry_id}`,
    `policy ${manifest.geometry_policy}`,
    extra,
  ].filter(Boolean).join('\n');
}

function updateReviewAvailability(): void {
  const detail = root.querySelector<HTMLElement>('#review-detail');
  if (detail && activeVariant.id === 'd042') detail.textContent = 'D042 comparison: selecting a case shows the same Allen source; focus uses the native candidate bounds.';
}

function focusReviewComponent(index: number): void {
  if (!manifest || !flagged[index]) return;
  activeReviewIndex = index;
  const item = flagged[index]!;
  const nativeManifest = manifests.get('native') ?? (activeVariant.id === 'native' ? manifest : null);
  const component = (nativeManifest?.components as readonly ReviewableComponent[] | undefined)?.find((candidate) => candidate.component_id === item.component_id);
  if (!component) { updateDiagnostics(`component ${item.component_id} is absent from this pack`); return; }
  applyReviewSelection(index);
  const pose = focusPose(component, viewState.explode);
  if (pose) {
    viewState = { ...viewState, camera: pose };
    viewport?.setViewState(viewState);
  }
  const detail = root.querySelector<HTMLElement>('#review-detail');
  if (detail) detail.textContent = `${sourceAcronym(item.source_allen_id)} (${item.source_allen_id}), source triangle ${item.first_triangle}: proposed ${item.proposed_movement}; ${item.review_status}.`;
  updateDiagnostics(`review ${index + 1}/${flagged.length} · component ${item.component_id}`);
}

function applyReviewSelection(index: number): void {
  if (!manifest || !flagged[index]) return;
  const sourceAllenId = flagged[index]!.source_allen_id;
  const ids = manifest.presentations
    .filter((candidate) => candidate.source_allen_id === sourceAllenId)
    .map((candidate) => candidate.mappings[mapping])
    .filter((id): id is number => id !== null);
  selected.clear();
  for (const id of ids) selected.add(id);
  if (!reviewContextVisible()) {
    visible.clear();
    for (const id of ids) visible.add(id);
  } else showAll();
  viewport?.setPresentation(presentation());
}

function focusPose(component: ReviewableComponent, explode: number): BrainCameraPose | null {
  const minimum = component.bounds?.minimum_um;
  const maximum = component.bounds?.maximum_um;
  const center: readonly [number, number, number] | null = component.centroid_um
    ?? (minimum && maximum ? [
      (minimum[0] + maximum[0]) / 2, (minimum[1] + maximum[1]) / 2, (minimum[2] + maximum[2]) / 2,
    ] : null);
  if (!center) return null;
  const movement = component.explode_displacement_um ?? [0, 0, 0];
  const movedCenter: readonly [number, number, number] = [
    center[0] + movement[0] * explode,
    center[1] + movement[1] * explode,
    center[2] + movement[2] * explode,
  ];
  const radius = minimum && maximum
    ? Math.max(100, Math.hypot(maximum[0] - minimum[0], maximum[1] - minimum[1], maximum[2] - minimum[2]) / 2)
    : 500;
  return {
    positionUm: [movedCenter[0], movedCenter[1] - radius * 4, movedCenter[2] + radius * 2.2],
    targetUm: movedCenter,
    up: [0, 0, 1],
  };
}

function wholeBrainPose(pack: MeshPackV1): BrainCameraPose | null {
  const bounded = (pack.components as readonly ReviewableComponent[]).filter((component) => component.bounds);
  if (!bounded.length) return null;
  const minimum: [number, number, number] = [Infinity, Infinity, Infinity];
  const maximum: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const component of bounded) for (let axis = 0; axis < 3; axis += 1) {
    minimum[axis] = Math.min(minimum[axis]!, component.bounds!.minimum_um[axis]!);
    maximum[axis] = Math.max(maximum[axis]!, component.bounds!.maximum_um[axis]!);
  }
  const center: [number, number, number] = [
    (minimum[0] + maximum[0]) / 2, (minimum[1] + maximum[1]) / 2, (minimum[2] + maximum[2]) / 2,
  ];
  const radius = Math.max(.5, Math.hypot(maximum[0] - minimum[0], maximum[1] - minimum[1], maximum[2] - minimum[2]) / 2);
  return { positionUm: [center[0], center[1] - radius * 4, center[2] + radius * 2.2], targetUm: center, up: [0, 0, 1] };
}

function reviewContextVisible(): boolean { return root.querySelector<HTMLInputElement>('#show-context')?.checked ?? true; }
function sourceAcronym(sourceAllenId: number): string {
  return catalog?.mappings.allen?.find((region) => Math.abs(region.atlas_id) === sourceAllenId)?.acronym ?? `Allen ${sourceAllenId}`;
}
function reviewLabel(component: ReviewComponent): string {
  return `${sourceAcronym(component.source_allen_id)} · ${component.proposed_movement} · triangle ${component.first_triangle}`;
}

const ready = new MutationObserver(() => {
  if (scene.dataset.scene3dState === 'ready') status.textContent = `Ready · ${activeVariant.label} · ${scene.dataset.lod}`;
});
ready.observe(scene, { attributes: true, attributeFilter: ['data-scene3d-state', 'data-lod'] });

variantControl?.addEventListener('change', (event) => {
  const id = (event.target as HTMLSelectElement).value;
  const variant = variants.find((candidate) => candidate.id === id);
  if (variant) void loadVariant(variant).catch((error: unknown) => {
    if (activeVariant === variant) status.textContent = `3-D failed: ${error instanceof Error ? error.message : String(error)}`;
  });
});
root.querySelector<HTMLSelectElement>('#mapping')!.onchange = (event) => {
  mapping = (event.target as HTMLSelectElement).value as RegionalPresentation['mapping'];
  showAll();
  selected.clear();
  if (activeReviewIndex !== null) applyReviewSelection(activeReviewIndex);
  updateDiagnostics();
  viewport?.setPresentation(presentation());
};
root.querySelector<HTMLInputElement>('#side-colours')?.addEventListener('change', () => viewport?.setPresentation(presentation()));
root.querySelector<HTMLInputElement>('#explode')!.oninput = (event) => {
  const explode = Number((event.target as HTMLInputElement).value);
  required('#explode-value').textContent = explode.toFixed(2);
  let camera = viewState.camera;
  if (camera && activeReviewIndex !== null) {
    const item = flagged[activeReviewIndex];
    const component = manifests.get('native')?.components.find((candidate) => candidate.component_id === item?.component_id);
    if (component) {
      const delta = explode - viewState.explode;
      const moved = (point: readonly [number, number, number]): readonly [number, number, number] => [
        point[0] + delta * component.explode_displacement_um[0],
        point[1] + delta * component.explode_displacement_um[1],
        point[2] + delta * component.explode_displacement_um[2],
      ];
      camera = { ...camera, positionUm: moved(camera.positionUm), targetUm: moved(camera.targetUm) };
    }
  }
  viewState = { explode, camera };
  viewport?.setViewState(viewState);
};
root.querySelector<HTMLSelectElement>('#review-component')?.addEventListener('change', (event) => focusReviewComponent(Number((event.target as HTMLSelectElement).value)));
root.querySelector<HTMLInputElement>('#show-context')?.addEventListener('change', () => {
  const index = Number(root.querySelector<HTMLSelectElement>('#review-component')?.value ?? 0);
  focusReviewComponent(index);
});
root.querySelector<HTMLButtonElement>('#next-review')?.addEventListener('click', () => {
  const select = root.querySelector<HTMLSelectElement>('#review-component');
  if (!select) return;
  select.value = String((Number(select.value) + 1) % flagged.length);
  focusReviewComponent(Number(select.value));
});
required('#show-all').onclick = () => {
  activeReviewIndex = null; showAll(); selected.clear(); updateDiagnostics(); viewport?.setPresentation(presentation());
  if (isComparison && manifest) {
    viewState = { ...viewState, camera: wholeBrainPose(manifest) };
    viewport?.setViewState(viewState);
    const context = root.querySelector<HTMLInputElement>('#show-context');
    if (context) context.checked = true;
  }
};
required('#deactivate').onclick = (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  if (button.dataset.active === 'false') { viewport?.activate(); button.dataset.active = 'true'; button.textContent = 'Deactivate'; }
  else { viewport?.deactivate(); button.dataset.active = 'false'; button.textContent = 'Reactivate'; }
};
addEventListener('beforeunload', () => { ready.disconnect(); factory?.destroy(); }, { once: true });

await loadVariant(activeVariant);

function required(selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}
