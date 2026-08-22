import '../src/styles.css';
import './styles.css';
import { ResourceFetcher } from '../src/data/cache.js';
import { MeshPackSource } from '../src/rendering/3d/mesh-pack-source.js';
import {
  RetainedBrainScene3DViewportFactory,
  type RegionalPresentation,
} from '../src/rendering/3d/brain-scene-viewport.js';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('3-D lab root is missing');
root.innerHTML = `<main class="mesh-lab">
  <header><div><p>Non-production · canonical synthetic fixture</p><h1>Retained 3-D viewport</h1></div><strong id="status" role="status">Loading…</strong></header>
  <section class="mesh-layout">
    <div id="scene" aria-label="Interactive bilateral 3-D brain fixture"></div>
    <aside>
      <label>Mapping <select id="mapping"><option>allen</option><option>beryl</option><option>cosmos</option></select></label>
      <label>Explode <input id="explode" type="range" min="0" max="1" step="0.01" value="0"><output id="explode-value">0.00</output></label>
      <button id="show-all" type="button">Show both hemispheres</button>
      <button id="deactivate" type="button">Deactivate</button>
      <p>Click a hemisphere to select it. Drag rotates; double-click resets the camera.</p>
      <pre id="diagnostics"></pre>
    </aside>
  </section>
</main>`;

const scene = required('#scene');
const status = required('#status');
const diagnostics = required('#diagnostics');
const source = new MeshPackSource({
  manifest: {
    url: new URL('/__mesh-pack-fixture/manifest.json', location.href).toString(),
    bytes: 3664,
    sha256: '782724b36203a2329fae047f81f5cf432e870d719b6db1d5e0ed75b982c022d4',
  },
  fetcher: new ResourceFetcher(),
});
const factory = new RetainedBrainScene3DViewportFactory(source);
const visible = new Set([-315, 315]);
const selected = new Set<number>();
let mapping: RegionalPresentation['mapping'] = 'allen';

const presentation = (): RegionalPresentation => ({
  mapping,
  anatomyColors: new Map([[-315, '#3f8fbd'], [315, '#db7c3d']]),
  featureColors: null,
  visibleRegionIds: visible,
  selectedRegionIds: selected,
  highlightedRegionId: null,
  featureSide: null,
});
const viewport = factory.create(scene);
factory.setInteractionSink({
  regionPointer(event) {
    scene.dataset.lastPointerType = event.type;
    scene.dataset.lastRegionId = event.regionId === null ? '' : String(event.regionId);
    if (event.type !== 'select' || event.regionId === null) return;
    selected.has(event.regionId) ? selected.delete(event.regionId) : selected.add(event.regionId);
    viewport.setPresentation(presentation());
    diagnostics.textContent = `selected ${[...selected].join(', ') || 'none'}`;
  },
  cameraChanged(pose, phase) { scene.dataset.cameraPhase = phase; scene.dataset.cameraPose = JSON.stringify(pose); },
  error(error) { status.textContent = `3-D failed: ${error.message}`; },
});
viewport.setPresentation(presentation());
viewport.activate();

const ready = new MutationObserver(() => {
  if (scene.dataset.scene3dState === 'ready') status.textContent = `Ready · ${scene.dataset.lod}`;
});
ready.observe(scene, { attributes: true, attributeFilter: ['data-scene3d-state', 'data-lod'] });

document.querySelector<HTMLSelectElement>('#mapping')!.onchange = (event) => {
  mapping = (event.target as HTMLSelectElement).value as RegionalPresentation['mapping'];
  selected.clear();
  diagnostics.textContent = '';
  viewport.setPresentation(presentation());
};
document.querySelector<HTMLInputElement>('#explode')!.oninput = (event) => {
  const explode = Number((event.target as HTMLInputElement).value);
  required('#explode-value').textContent = explode.toFixed(2);
  viewport.setViewState({ explode, camera: null });
};
required('#show-all').onclick = () => { visible.clear(); visible.add(-315); visible.add(315); viewport.setPresentation(presentation()); };
required('#deactivate').onclick = (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  if (button.dataset.active === 'false') { viewport.activate(); button.dataset.active = 'true'; button.textContent = 'Deactivate'; }
  else { viewport.deactivate(); button.dataset.active = 'false'; button.textContent = 'Reactivate'; }
};
addEventListener('beforeunload', () => { ready.disconnect(); factory.destroy(); }, { once: true });

function required(selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}
