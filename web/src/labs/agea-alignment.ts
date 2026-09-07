import type { RegionMetadata, VolumeFeaturePayload, VolumeGridDescriptor } from '../data/contracts.js';
import { ResourceFetcher } from '../data/cache.js';
import { loadAtlasRegionCatalog } from '../data/atlas-regions.js';
import { ProjectionPackSource, type RegisteredProjectionRegistration } from '../rendering/projection-pack-source.js';
import { RetainedProjectionViewportFactory, registeredVolumeCanvasPlacement } from '../rendering/retained-projection-viewport.js';
import type { ProjectionViewport } from '../rendering/projection-viewport.js';
import type { VolumeSlice } from '../rendering/volume.js';
import { regionIdFromPath } from '../rendering/region-id.js';
import { locateVolumePlane } from '../rendering/chunked-volume-source.js';
import { resolveRegionalPresentation } from '../application/regional-presentation.js';
import { applyAffine, planeToWorld, worldToPlane, worldToCursorState, type Matrix4, type WorldCoordinateUm } from '../core/spatial.js';
import { ANATOMY_10UM_CALIBRATION, regionalIndicesToWorld, worldToRegionalIndices } from '../core/slice-calibration.js';
import { alignmentFeature, alignmentGrid, coarseBoundaryPath, sourceVoxel } from './agea-alignment-model.js';
import { loadArray, type LabManifest } from './agea-data.js';
import { AXES, offset, PLANES, type Axis } from './agea-model.js';
import './agea-alignment.css';

const SVG = 'http://www.w3.org/2000/svg';
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function button(text: string, action: () => void): HTMLButtonElement {
  const b = el('button', text); b.type = 'button'; b.onclick = action; return b;
}
const fmt = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
const PRESETS: readonly [string, WorldCoordinateUm][] = [
  ['Midline / ventricles', { ml: 0, ap: -800, dv: -2000 }],
  ['Striatum', { ml: 1800, ap: 800, dv: -2800 }],
  ['Hippocampus', { ml: 2200, ap: -2400, dv: -1800 }],
  ['Cerebellum', { ml: 0, ap: -6000, dv: -2600 }],
  ['Anterior extent', { ml: 0, ap: 4000, dv: -2000 }],
];
type Layer = 'image' | 'expression';
interface ReviewNote { judgment: string; note: string; context: ReturnType<AlignmentReview['snapshot']> }

/** Lab orchestration only. Anatomy, scalar placement, painting and guides use
 * the application's retained projection factory without changing its guards.
 */
export class AlignmentReview {
  private readonly root = el('section', '', 'agea-alignment');
  private readonly status = el('p', 'Loading alignment resources…', 'alignment-status');
  private readonly views = el('div', '', 'alignment-views');
  private readonly inspector = el('div', '', 'alignment-inspector');
  private readonly noteList = el('ol', '', 'alignment-notes');
  private readonly abort = new AbortController();
  private factory: RetainedProjectionViewportFactory | null = null;
  private source: ProjectionPackSource | null = null;
  private grid: VolumeGridDescriptor | null = null;
  private regions: readonly RegionMetadata[] = [];
  private imageFeature: VolumeFeaturePayload | null = null;
  private expressionFeature: VolumeFeaturePayload | null = null;
  private values: Float32Array | null = null;
  private gene = '';
  private layer: Layer = 'image';
  private world: WorldCoordinateUm = { ml: 0, ap: -800, dv: -2000 };
  private outlines = true;
  private coarse = true;
  private opacity = 1;
  private blink = false;
  private phase = true;
  private timer: number | null = null;
  private active = false;
  private disposed = false;
  private renderGeneration = 0;
  private expressionGeneration = 0;
  private pendingExpression: Promise<void> = Promise.resolve();
  private readonly notes: ReviewNote[] = [];
  private readonly panels = new Map<Axis, { host: HTMLElement; caption: HTMLElement; viewport: ProjectionViewport;
    registration: RegisteredProjectionRegistration; overlay: SVGSVGElement; control: HTMLInputElement }>();
  private readonly outlineControl = el('input');
  private readonly coarseControl = el('input');
  private readonly blinkControl = el('input');
  private readonly opacityControl = el('input');
  private readonly layerControl = el('select');
  private readonly onPop = () => { this.readUrl(); this.updateControls(); void this.render(); };

  constructor(private readonly manifest: LabManifest, private readonly labels: Int32Array) {
    this.status.setAttribute('role', 'status');
    this.readUrl(); this.build();
    window.addEventListener('popstate', this.onPop);
    void this.start().catch(error => this.fail(error));
  }

  attach(host: HTMLElement): void { this.active = true; host.replaceChildren(this.root); this.setBlinkTimer(); void this.render(); }
  pause(): void { this.active = false; this.setBlinkTimer(); }
  dispose(): void {
    this.disposed = true; this.abort.abort(); this.active = false; this.setBlinkTimer();
    window.removeEventListener('popstate', this.onPop); this.factory?.destroy(); this.source?.dispose();
  }
  setExpression(id: string, values: Float32Array | null): void {
    if (id === this.gene && values === this.values) return;
    this.gene = id; this.values = values; this.expressionFeature = null;
    const token = ++this.expressionGeneration;
    if (this.layer === 'expression') this.clearViews();
    this.pendingExpression = (async () => {
      if (values && this.grid) {
        const feature = await alignmentFeature(values, this.grid, id, true);
        if (token !== this.expressionGeneration || this.disposed) return;
        this.expressionFeature = feature;
      }
      await this.render();
    })().catch(error => this.fail(error));
  }

  private async start(): Promise<void> {
    const alignment = this.manifest.alignment;
    if (!alignment || !this.manifest.anatomy_image) throw new Error('Alignment data unavailable. Re-run tools.agea_coverage_lab to prepare the reference image.');
    // Pin the exact website manifest for this review. Nested projection bytes
    // still pass the production source's normal size/SHA verification.
    const fetcher = new ResourceFetcher();
    const manifestUrl = new URL(alignment.projection_pack_url, location.href).href;
    const response = await fetcher.fetch(manifestUrl, { integrity: alignment.projection_pack, signal: this.abort.signal });
    const manifestBytes = await response.arrayBuffer();
    this.source = new ProjectionPackSource({ manifestUrl, fetchImpl: async (input, init) => {
      if (String(input) === manifestUrl) return new Response(manifestBytes.slice(0), { headers: { 'Content-Type': 'application/json' } });
      return fetch(input, init);
    } });
    const [catalog, image, registrations] = await Promise.all([
      loadAtlasRegionCatalog(), loadArray(this.manifest.anatomy_image, 'float32', this.manifest.shape, this.abort.signal),
      Promise.all(AXES.map(axis => this.source!.getRegistration(axis))),
    ]);
    if (this.disposed) return;
    if (registrations.some(r => r.referenceSpaceId !== alignment.candidate_reference_space_id)) throw new Error('Website reference space differs from the pinned review candidate');
    this.grid = alignmentGrid(this.manifest, alignment.candidate_reference_space_id);
    this.regions = catalog.mappings.allen;
    this.imageFeature = await alignmentFeature(Float32Array.from(image), this.grid, 'agea-anatomical-reference', false);
    if (this.disposed) return;
    this.factory = new RetainedProjectionViewportFactory({ source: this.source, maxVolumeDecodedBytes: 8 * 1024 * 1024 });
    this.factory.setInteractionSink({ hover: () => undefined, inspect: () => undefined,
      toggleSelection: () => undefined, moveCursor: cursor => this.move({ ml: cursor.xUm, ap: cursor.yUm, dv: cursor.zUm }),
      stepSlice: (axis, delta) => this.step(axis, delta), reportError: error => this.fail(error) });
    AXES.forEach((axis, i) => this.createPanel(axis, registrations[i]!));
    if (this.values) {
      const values = this.values; this.values = null; this.setExpression(this.gene, values);
      await this.pendingExpression;
    }
    this.updateControls(); await this.render();
  }

  private build(): void {
    this.root.append(el('h3', 'Alignment review'),
      el('p', 'Fixed source-transform candidate · white: website anatomy · orange: coarse AGEA label boundaries.'),
      el('p', 'The reference image and labels are CCF-derived. Their agreement checks coordinates and rendering, not independent biological registration of expression.', 'alignment-caveat'));
    const controls = el('div', '', 'alignment-controls');
    this.layerControl.setAttribute('aria-label', 'Alignment base layer');
    for (const [value, label] of [['image', 'Anatomical reference image'], ['expression', 'Selected expression']]) {
      const option = el('option', label); option.value = value!; this.layerControl.append(option);
    }
    this.layerControl.onchange = () => { this.layer = this.layerControl.value as Layer; this.persist(); this.clearViews(); void this.render(); };
    controls.append(this.layerControl);
    for (const [input, title, key] of [[this.outlineControl, 'Website outlines', 'outlines'],
      [this.coarseControl, 'Coarse AGEA boundaries', 'coarse'], [this.blinkControl, 'Blink website outlines', 'blink']] as const) {
      input.type = 'checkbox'; input.onchange = () => { this[key] = input.checked; this.phase = true; this.persist(); this.setBlinkTimer(); this.present(); };
      const label = el('label'); label.append(input, title); controls.append(label);
    }
    this.opacityControl.type = 'range'; this.opacityControl.min = '0'; this.opacityControl.max = '1'; this.opacityControl.step = '.05';
    this.opacityControl.setAttribute('aria-label', 'Alignment image opacity');
    this.opacityControl.oninput = () => { this.opacity = Number(this.opacityControl.value); this.persist(false); this.present(); };
    const opacity = el('label', 'Image opacity '); opacity.append(this.opacityControl); controls.append(opacity);
    const presets = el('div', '', 'alignment-presets');
    for (const [name, world] of PRESETS) presets.append(button(name, () => this.move(world)));
    this.root.append(controls, el('p', 'Presets are review starting points, not certified landmark coordinates.'), presets, this.status, this.views, this.inspector);
    const review = el('section', '', 'alignment-review-form'); review.append(el('h3', 'Record this location'));
    const judgment = el('select'); judgment.setAttribute('aria-label', 'Alignment judgment');
    for (const text of ['Uncertain', 'Looks consistent', 'Clear mismatch']) judgment.append(el('option', text));
    const note = el('textarea'); note.setAttribute('aria-label', 'Alignment review note'); note.placeholder = 'Which structure or boundary? In which plane?'; note.maxLength = 4000;
    review.append(judgment, note, button('Save review note', () => {
      if (!this.grid || !this.factory || this.root.dataset.ready !== 'true') { this.status.textContent = 'Wait for the current alignment views before saving a note.'; return; }
      this.notes.push({ judgment: judgment.value, note: note.value, context: this.snapshot() });
      const item = el('li', `${judgment.value} · ${Object.values(this.world).map(fmt).join(' / ')} µm · ${note.value}`);
      // Capture the coordinate by value; later notes must not change this target.
      const saved = { ...this.world }; item.append(button('Revisit', () => this.move(saved)));
      this.noteList.append(item); note.value = '';
    }), button('Download alignment review', () => this.download()), el('p', 'Notes stay in this page until downloaded; reload clears unsaved notes.'), this.noteList);
    const provenance = el('details'); provenance.append(el('summary', 'Fixed transform and source evidence'),
      el('pre', JSON.stringify({ affine: this.manifest.index_to_world_um, source: this.manifest.source, alignment: this.manifest.alignment }, null, 2)));
    this.root.append(review, provenance); this.updateControls();
  }

  private createPanel(axis: Axis, registration: RegisteredProjectionRegistration): void {
    const section = el('section', '', 'alignment-plane'); section.append(el('h4', axis));
    const control = el('input'); control.type = 'range'; control.min = '0';
    control.max = String(ANATOMY_10UM_CALIBRATION[axis].indexCount - 1); control.step = '1';
    control.setAttribute('aria-label', `Alignment ${axis} slice`);
    control.oninput = () => { const indices = worldToRegionalIndices(this.world); indices[axis] = Number(control.value); this.move(regionalIndicesToWorld(indices), false); };
    const host = el('div', '', 'alignment-viewport'); host.tabIndex = 0; host.setAttribute('aria-label', `Alignment ${axis} viewport`);
    const viewport = this.factory!.create(host, axis);
    const overlay = document.createElementNS(SVG, 'svg'); overlay.classList.add('alignment-coarse'); overlay.setAttribute('aria-hidden', 'true');
    host.append(overlay);
    host.addEventListener('click', event => {
      if (this.root.dataset.ready !== 'true') return;
      const svg = host.querySelector<SVGSVGElement>('.projection-viewport__regional');
      const matrix = svg?.getScreenCTM(); if (!matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const slice = worldToPlane(registration.worldToPlaneIndex, this.world).slice;
      this.move(planeToWorld(registration.planeIndexToWorldUm, { slice, u: point.x, v: point.y }));
    });
    host.onkeydown = event => {
      const shift = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!shift) return; event.preventDefault();
      const point = worldToPlane(registration.worldToPlaneIndex, this.world);
      this.move(planeToWorld(registration.planeIndexToWorldUm, { slice: point.slice, u: point.u + shift[0]! * 20, v: point.v + shift[1]! * 20 }));
    };
    const caption = el('p', '', 'alignment-caption'); section.append(control, host, caption); this.views.append(section);
    this.panels.set(axis, { host, caption, viewport, registration, overlay, control });
  }

  private step(axis: Axis, delta: number): void {
    const indices = worldToRegionalIndices(this.world);
    indices[axis] = Math.max(0, Math.min(ANATOMY_10UM_CALIBRATION[axis].indexCount - 1, indices[axis] + delta));
    this.move(regionalIndicesToWorld(indices));
  }
  private move(world: WorldCoordinateUm, push = true): void {
    this.world = regionalIndicesToWorld(worldToRegionalIndices(world)); this.persist(push); void this.render();
  }
  private readUrl(): void {
    const p = new URLSearchParams(location.search); const xyz = p.get('align_world')?.split(',').map(Number);
    if (xyz?.length === 3 && xyz.every(Number.isFinite)) this.world = regionalIndicesToWorld(worldToRegionalIndices({ ml: xyz[0]!, ap: xyz[1]!, dv: xyz[2]! }));
    this.layer = p.get('align_layer') === 'expression' ? 'expression' : 'image';
    this.outlines = p.get('align_outlines') !== '0'; this.coarse = p.get('align_coarse') !== '0'; this.blink = p.get('align_blink') === '1';
    const opacity = p.get('align_opacity'); this.opacity = opacity !== null && Number.isFinite(Number(opacity)) ? Math.max(0, Math.min(1, Number(opacity))) : 1;
  }
  private persist(push = true): void {
    const url = new URL(location.href); url.searchParams.set('align_world', [this.world.ml, this.world.ap, this.world.dv].join(','));
    for (const [key, value] of Object.entries({ layer: this.layer, outlines: this.outlines ? '1' : '0', coarse: this.coarse ? '1' : '0', blink: this.blink ? '1' : '0', opacity: String(this.opacity) })) url.searchParams.set(`align_${key}`, value);
    if (url.href !== location.href) { if (push) history.pushState(null, '', url); else history.replaceState(null, '', url); }
  }
  private updateControls(): void {
    this.layerControl.value = this.layer; this.outlineControl.checked = this.outlines; this.coarseControl.checked = this.coarse;
    this.blinkControl.checked = this.blink; this.opacityControl.value = String(this.opacity); this.setBlinkTimer();
  }
  private setBlinkTimer(): void {
    if (this.timer !== null) window.clearInterval(this.timer); this.timer = null;
    if (this.active && this.blink && !this.disposed) this.timer = window.setInterval(() => { this.phase = !this.phase; this.present(); }, 700);
  }
  private feature(): VolumeFeaturePayload | null { return this.layer === 'image' ? this.imageFeature : this.expressionFeature; }
  private present(): void {
    const feature = this.feature(); if (!this.factory || !feature) return;
    const coloring = { mode: 'feature', statistic: 'mean', colormap: this.layer === 'image' ? 'cividis' : 'viridis', range: { mode: 'auto' }, scale: { kind: 'linear' } } as const;
    this.factory.updatePresentation({ feature, coloring, volumeOpacity: this.opacity, anatomyOutlines: this.outlines && (!this.blink || this.phase),
      regional: resolveRegionalPresentation({ mapping: 'allen', feature, anatomyRegions: this.regions, coloring, selectedRegionIds: [], hoveredRegionId: null }) });
    for (const panel of this.panels.values()) panel.overlay.style.display = this.coarse ? '' : 'none';
  }
  private clearViews(): void { ++this.renderGeneration; this.root.dataset.ready = 'false'; for (const panel of this.panels.values()) { panel.viewport.clear(); panel.overlay.replaceChildren(); } }
  private async render(): Promise<void> {
    if (!this.active || !this.factory || !this.grid || this.disposed) return;
    const feature = this.feature(); this.root.dataset.ready = 'false';
    if (!feature) { this.status.textContent = 'Expression loading or unavailable. Choose the anatomical reference image to continue reviewing.'; return; }
    const token = ++this.renderGeneration; const world = { ...this.world }; const indices = worldToRegionalIndices(world);
    this.present(); this.status.textContent = 'Loading aligned views…';
    try {
      await Promise.all([...this.panels].map(async ([axis, panel]) => {
        panel.control.value = String(indices[axis]);
        await panel.viewport.render({ axis, sliceIndex: indices[axis], cursor: worldToCursorState(world), parcellation: 'allen', feature });
        if (token !== this.renderGeneration || this.disposed) return;
        const location = locateVolumePlane(feature, axis, world);
        if (location.status === 'out-of-grid') { panel.overlay.replaceChildren(); return; }
        const p = PLANES[axis]; const width = this.manifest.shape[p.x]!; const height = this.manifest.shape[p.y]!;
        const slice: VolumeSlice = { axis, index: location.index, width, height, data: new Float32Array(),
          widthAxis: axis === 'sagittal' ? 'coronal' : 'sagittal', heightAxis: axis === 'horizontal' ? 'coronal' : 'horizontal' };
        const placement = registeredVolumeCanvasPlacement(feature, slice, panel.registration);
        const v = placement.viewBox; panel.overlay.setAttribute('viewBox', `${v.x} ${v.y} ${v.width} ${v.height}`);
        const group = document.createElementNS(SVG, 'g');
        group.setAttribute('transform', `translate(${placement.x + (placement.flipX ? placement.width : 0)} ${placement.y + (placement.flipY ? placement.height : 0)}) scale(${placement.width / width * (placement.flipX ? -1 : 1)} ${placement.height / height * (placement.flipY ? -1 : 1)})`);
        const path = document.createElementNS(SVG, 'path'); path.setAttribute('d', coarseBoundaryPath(this.labels, this.manifest.shape, axis, location.index));
        group.append(path); panel.overlay.replaceChildren(group);
        const asset = Number(panel.host.dataset.assetIndex); const displayedWorld = Number(panel.host.dataset.worldCoordinateUm);
        const sourceWorld = applyAffine(this.manifest.index_to_world_um as unknown as Matrix4,
          [p.fixed === 0 ? location.index : 0, p.fixed === 1 ? location.index : 0, p.fixed === 2 ? location.index : 0]);
        const sourceFixed = sourceWorld[axis === 'coronal' ? 1 : axis === 'sagittal' ? 0 : 2]!;
        panel.caption.textContent = `Native request ${indices[axis]} · displayed outline ${asset} (${fmt(displayedWorld)} µm) · AGEA ${location.index} (${fmt(sourceFixed)} µm) · plane difference ${fmt(displayedWorld - sourceFixed)} µm`;
      }));
      if (token !== this.renderGeneration || this.disposed) return;
      this.root.dataset.ready = 'true'; this.status.textContent = `Alignment ready · ${this.layer === 'image' ? 'CCF-derived reference image (Cividis)' : 'original expression energy (Viridis)'} · fixed transform, awaiting review.`;
      this.inspect();
    } catch (error) { if (token === this.renderGeneration && !this.disposed) { this.clearViews(); this.fail(error); } }
  }
  private websiteRegion(axis: Axis): number | null {
    const panel = this.panels.get(axis); const svg = panel?.host.querySelector<SVGSVGElement>('.projection-viewport__regional');
    const screen = svg?.getScreenCTM(); if (!panel || !screen) return null;
    const point = worldToPlane(panel.registration.worldToPlaneIndex, this.world);
    const client = new DOMPoint(point.u, point.v).matrixTransform(screen);
    for (const path of svg!.querySelectorAll<SVGPathElement>('.view-frame__slice-figure path')) {
      const matrix = path.getScreenCTM();
      if (matrix && path.isPointInFill(client.matrixTransform(matrix.inverse()))) return regionIdFromPath('allen', path);
    }
    return null;
  }
  snapshot() {
    const voxel = this.grid ? sourceVoxel(this.grid, this.world) : null;
    const index = voxel?.index; const flat = index ? offset(index, this.manifest.shape) : null;
    return { world: { ...this.world }, fractional_source_index: voxel?.fractional ?? null, source_index: index ?? null,
      coarse_label: flat === null ? null : this.labels[flat]!, expression: flat === null ? null : this.values?.[flat] ?? null,
      experiment_id: this.gene, layer: this.layer, outlines: this.outlines, coarse_boundaries: this.coarse, opacity: this.opacity,
      website_regions: Object.fromEntries(AXES.map(axis => [axis, this.websiteRegion(axis)])),
      displayed_planes: Object.fromEntries([...this.panels].map(([axis, p]) => [axis, { native_index: Number(p.host.dataset.assetIndex), world_coordinate_um: Number(p.host.dataset.worldCoordinateUm), source_index: Number(p.host.dataset.volumeIndex) }])),
      url: location.href };
  }
  private inspect(): void {
    const s = this.snapshot(); const label = s.coarse_label; const name = label === null ? 'Out of AGEA grid' : label === 0 ? 'Unlabelled' : `${this.manifest.regions[String(label)]?.acronym ?? label} (${label})`;
    this.inspector.replaceChildren(el('h4', 'Shared cursor'), el('p', `ML / AP / DV: ${Object.values(s.world).map(fmt).join(' / ')} µm`),
      el('p', `AGEA ML / DV / AP voxel: ${s.source_index?.join(' / ') ?? 'out of grid'} · coarse label: ${name}`),
      el('p', `Expression: ${s.expression === null ? 'unavailable' : s.expression === -1 ? '−1 (missing)' : fmt(s.expression)}`),
      el('p', 'Website labels at the displayed outline planes: ' + AXES.map(axis => {
        const id = s.website_regions[axis]; const region = this.regions.find(r => Number(r.id) === -Math.abs(id ?? 0));
        return `${axis}: ${id === null ? 'no path' : `${region?.acronym ?? id} (${id})`}`;
      }).join(' · ')), el('small', 'Different labels near boundaries may reflect the 200 µm modal labels and sparse outline-plane offsets shown above.'));
  }
  private fail(error: unknown): void { if (!this.disposed) { this.root.dataset.ready = 'false'; this.status.textContent = `Alignment unavailable: ${String(error)}`; } }
  private download(): void {
    const report = { format: 'agea-alignment-review-only', scientific_release: false, alignment_accepted: false,
      sources: this.manifest.source, alignment: this.manifest.alignment, grid: this.grid, current: this.snapshot(), notes: this.notes,
      limitations: 'Fixed source-affine candidate; CCF-derived template is not independent expression registration. Website labels come from sparse displayed planes.',
      created_utc: new Date().toISOString() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const a = el('a'); a.href = url; a.download = 'agea-alignment-review.json'; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
