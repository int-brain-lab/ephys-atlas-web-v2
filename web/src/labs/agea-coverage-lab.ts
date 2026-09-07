import { CanvasVolumeSliceRenderer } from '../rendering/canvas-volume-renderer.js';
import { AlignmentReview } from './agea-alignment.js';
import { loadArray, loadManifest, type Experiment, type LabManifest } from './agea-data.js';
import { analyze, AXES, CATEGORIES, category, offset, PLANES, planePoint, readState, writeState,
  type Axis, type LabState, type Stats, type Triple } from './agea-model.js';
import './agea-coverage-lab.css';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function button(text: string, action: () => void): HTMLButtonElement {
  const node = el('button', text); node.type = 'button'; node.onclick = action; return node;
}
const fmt = (v: number | null): string => v === null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 4 });
const pct = (n: number, d: number): string => d ? `${(100 * n / d).toFixed(1)}%` : '—';

class CoverageLab {
  private alignmentReview: AlignmentReview | null = null;
  private readonly experiments = el('details', '', 'agea-experiments');
  private readonly experimentSummary = el('summary', 'Change experiment');
  private readonly otherTools = el('details', '', 'agea-other-tools');
  private manifest!: LabManifest;
  private labels = new Int32Array();
  private frequency = new Uint16Array();
  private values: Float32Array | null = null;
  private analysis: ReturnType<typeof analyze> | null = null;
  private state!: LabState;
  private abort: AbortController | null = null;
  private generation = 0;
  private disposed = false;
  private page = 0;
  private readonly cache = new Map<string, Float32Array>();
  private readonly panels: { axis: Axis; masked: boolean; canvas: HTMLCanvasElement; renderer: CanvasVolumeSliceRenderer; caption: HTMLElement }[] = [];
  private readonly status = el('p', 'Loading pinned AGEA data…', 'agea-status');
  private readonly search = el('input');
  private readonly sort = el('select');
  private readonly results = el('div', '', 'agea-results');
  private readonly resultCount = el('p');
  private readonly selected = el('h2');
  private readonly views = el('div', '', 'agea-views');
  private readonly legend = el('div', '', 'agea-legend');
  private readonly inspector = el('div', '', 'agea-inspector');
  private readonly stats = el('div');
  private readonly histogram = el('canvas');
  private readonly sliders: HTMLInputElement[] = [];
  private readonly modeButtons = new Map<LabState['mode'], HTMLButtonElement>();
  private readonly outlines = el('input');
  private readonly rescale = el('input');
  private readonly onPop = () => {
    this.state = readState(location.search, this.manifest.shape, this.manifest.features.map(f => f.id));
    this.persist(false);
    this.makePanels(); void this.select(this.state.gene, false);
  };

  constructor(private root: HTMLElement) {
    root.className = 'agea-lab';
    root.replaceChildren(this.status); this.status.setAttribute('role', 'status');
    void this.start().catch(error => { this.status.textContent = `Unable to open AGEA lab: ${String(error)}`; });
  }
  dispose(): void {
    this.alignmentReview?.dispose();
    for (const panel of this.panels) panel.renderer.dispose();
    this.disposed = true; this.abort?.abort(); this.cache.clear();
    window.removeEventListener('popstate', this.onPop);
  }
  private async start(): Promise<void> {
    this.manifest = await loadManifest();
    const [labels, frequency] = await Promise.all([
      loadArray(this.manifest.labels, 'int32', this.manifest.shape),
      loadArray(this.manifest.measured_counts, 'uint16', this.manifest.shape),
    ]);
    if (this.disposed) return;
    this.labels = Int32Array.from(labels); this.frequency = Uint16Array.from(frequency);
    this.state = readState(location.search, this.manifest.shape, this.manifest.features.map(f => f.id));
    this.build(); this.makePanels(); window.addEventListener('popstate', this.onPop);
    await this.select(this.state.gene, false);
  }
  private build(): void {
    const header = el('header', '', 'agea-header');
    header.append(el('p', 'IBL / EXPLORATORY DATA LAB', 'agea-eyebrow'), el('h1', 'AGEA coverage lab'),
      el('p', 'Where do gene-expression measurements and anatomical labels disagree?'));
    const badge = el('p', `Original IBL volumes · ${this.manifest.features.length.toLocaleString()} experiments · 200 µm grid`, 'agea-badge');
    const note = el('p', 'Exploratory policies only. Unlabelled does not necessarily mean outside the brain. Missing (−1) is different from measured zero.', 'agea-note');
    const aside = el('aside', '', 'agea-sidebar');
    this.search.type = 'search'; this.search.placeholder = 'Gene symbol or experiment ID'; this.search.setAttribute('aria-label', 'Search gene or experiment');
    this.search.oninput = () => { this.page = 0; this.renderResults(); };
    this.sort.setAttribute('aria-label', 'Sort experiments');
    for (const [value, text] of [['source', 'Source order'], ['disagreement', 'Most measured voxels unlabelled'], ['gene', 'Gene name']]) {
      const option = el('option', text); option.value = value!; this.sort.append(option);
    }
    this.sort.onchange = () => { this.page = 0; this.renderResults(); };
    const pagination = el('div', '', 'agea-pagination');
    pagination.append(button('Previous results', () => { this.page = Math.max(0, this.page - 1); this.renderResults(); }),
      button('Next results', () => { if ((this.page + 1) * 30 < this.filtered().length) this.page++; this.renderResults(); }));
    aside.append(el('h2', 'Experiments'), this.search, this.sort, this.resultCount, this.results, pagination);
    this.experiments.open = true; this.experiments.append(this.experimentSummary, aside);
    const content = el('main', '', 'agea-content');
    const modes = el('nav', '', 'agea-modes'); modes.setAttribute('aria-label', 'Investigation mode');
    for (const [mode, text] of [['coverage', 'Coverage'], ['expression', 'Expression'], ['comparison', 'Mask comparison'], ['frequency', 'Across experiments'], ['alignment', 'Alignment']] as const) {
      const b = button(text, () => { this.state.mode = mode; this.persist(); this.makePanels(); this.paint(); });
      this.modeButtons.set(mode, b); modes.append(b);
    }
    const controls = el('div', '', 'agea-controls');
    for (const [input, text, key] of [[this.outlines, 'Label boundaries', 'outlines'], [this.rescale, 'Recompute masked color range', 'rescale']] as const) {
      input.type = 'checkbox'; input.onchange = () => { this.state[key] = input.checked; this.persist(); this.paint(); };
      const label = el('label'); label.append(input, document.createTextNode(text)); controls.append(label);
    }
    const navigation = el('div', '', 'agea-navigation');
    this.manifest.axis_order.forEach((name, i) => {
      const label = el('label', `${name} index `); const input = el('input');
      input.type = 'range'; input.min = '0'; input.max = String(this.manifest.shape[i]! - 1); input.step = '1'; input.setAttribute('aria-label', `${name} index`);
      input.oninput = () => { this.state.cursor[i] = Number(input.value); this.persist(false); this.paint(); };
      label.append(input); navigation.append(label); this.sliders.push(input);
    });
    const analysis = el('section', '', 'agea-analysis');
    const hist = el('section', '', 'agea-card'); this.histogram.width = 700; this.histogram.height = 220;
    this.histogram.setAttribute('aria-label', 'Expression histograms for labelled and unlabelled measured voxels'); this.histogram.setAttribute('role', 'img');
    hist.append(el('h2', 'Expression distributions'), el('p', 'Teal: labelled · orange: unlabelled. Each curve is normalized to its own measured population; shared 48-bin value edges.'), this.histogram);
    analysis.append(this.inspector, this.stats, hist);
    const geometry = el('details', '', 'agea-card'); geometry.append(el('summary', 'Geometry & source provenance'));
    geometry.append(el('p', this.manifest.geometry_status), el('pre', JSON.stringify({
      shape: this.manifest.shape, axis_order: this.manifest.axis_order, index_to_world_um: this.manifest.index_to_world_um,
      variant: this.manifest.source_variant, sources: this.manifest.source }, null, 2)));
    this.otherTools.open = true; this.otherTools.append(el('summary', 'Other investigation tools'), modes);
    const sourceDetails = el('div', '', 'agea-source-details');
    sourceDetails.append(geometry, button('Download inspection report', () => this.download()));
    content.append(this.selected, this.otherTools, controls, navigation, this.legend, this.views, analysis, sourceDetails);
    const layout = el('div', '', 'agea-layout'); layout.append(this.experiments, content);
    this.root.replaceChildren(header, badge, note, this.status, layout); this.renderResults();
  }
  private filtered(): Experiment[] {
    const query = this.search.value.toLowerCase().trim();
    const list = this.manifest.features.filter(f => `${f.gene} ${f.experiment_id}`.toLowerCase().includes(query));
    if (this.sort.value === 'gene') list.sort((a, b) => a.gene.localeCompare(b.gene));
    if (this.sort.value === 'disagreement') list.sort((a, b) => this.disagreement(b) - this.disagreement(a));
    return list;
  }
  private disagreement(f: Experiment): number {
    const c = f.counts; const outside = c.label_zero_positive! + c.label_zero_zero!;
    const total = outside + c.label_nonzero_positive! + c.label_nonzero_zero!;
    return total ? outside / total : 0;
  }
  private renderResults(): void {
    const list = this.filtered(); this.resultCount.textContent = `${list.length.toLocaleString()} matches · ${this.page * 30 + (list.length ? 1 : 0)}–${Math.min(list.length, (this.page + 1) * 30)}`;
    this.results.replaceChildren(...list.slice(this.page * 30, (this.page + 1) * 30).map(f => {
      const b = button('', () => { void this.select(f.id); });
      b.append(el('strong', f.gene), el('small', `${f.experiment_id} · ${(this.disagreement(f) * 100).toFixed(1)}% unlabelled`));
      b.setAttribute('aria-pressed', String(f.id === this.state.gene)); return b;
    }));
  }
  private async select(id: string, persist = true): Promise<void> {
    this.abort?.abort(); this.abort = new AbortController(); const generation = ++this.generation;
    this.state.gene = id; if (persist) this.persist();
    const feature = this.manifest.features.find(f => f.id === id)!;
    this.values = null; this.analysis = null; this.selected.textContent = `${feature.gene} · experiment ${feature.experiment_id}`;
    this.experimentSummary.textContent = `Change experiment · ${feature.gene} (${feature.experiment_id})`;
    this.status.textContent = 'Loading expression volume…'; this.renderResults(); this.paint();
    try {
      const key = feature.volume.sha256; let values = this.cache.get(key);
      if (!values) values = Float32Array.from(await loadArray(feature.volume, 'float16', this.manifest.shape, this.abort.signal));
      if (generation !== this.generation || this.disposed) return;
      this.cache.delete(key); this.cache.set(key, values);
      while (this.cache.size > 2) this.cache.delete(this.cache.keys().next().value!);
      this.values = values; this.analysis = analyze(values, this.labels);
      this.status.textContent = 'Ready · click a voxel to inspect it; arrow keys move within a focused slice.';
      this.paint();
    } catch (error) {
      if (generation === this.generation && !this.disposed) this.status.textContent = `Volume unavailable: ${String(error)}. Select the experiment to retry.`;
    }
  }
  private persist(push = true): void {
    const url = writeState(this.state, location.href);
    if (url !== location.href) { if (push) history.pushState(null, '', url); else history.replaceState(null, '', url); }
  }
  private makePanels(): void {
    this.alignmentReview?.pause();
    for (const p of this.panels) p.renderer.dispose(); this.panels.length = 0; this.views.replaceChildren();
    if (this.state.mode === 'alignment') {
      this.alignmentReview ??= new AlignmentReview(this.manifest, this.labels);
      this.alignmentReview.attach(this.views);
      return;
    }
    for (const axis of AXES) {
      const section = el('section', '', 'agea-plane'); section.append(el('h3', axis[0]!.toUpperCase() + axis.slice(1)));
      const pair = el('div', '', 'agea-pair'); section.append(pair);
      for (const masked of this.state.mode === 'comparison' ? [false, true] : [false]) {
        const figure = el('figure'); const caption = el('figcaption'); const canvas = el('canvas');
        canvas.tabIndex = 0; canvas.setAttribute('aria-label', `${axis} ${masked ? 'masked' : 'all measurements'} slice`);
        const { x, y } = PLANES[axis];
        canvas.onclick = event => {
          if (!this.values && this.state.mode !== 'frequency') return;
          const rect = canvas.getBoundingClientRect();
          this.state.cursor = planePoint(axis, Math.min(this.manifest.shape[x]! - 1, Math.max(0, Math.floor((event.clientX - rect.left) / rect.width * this.manifest.shape[x]!))),
            Math.min(this.manifest.shape[y]! - 1, Math.max(0, Math.floor((event.clientY - rect.top) / rect.height * this.manifest.shape[y]!))), this.state.cursor);
          this.persist(); this.paint();
        };
        canvas.onkeydown = event => {
          const delta = { ArrowLeft: [x, -1], ArrowRight: [x, 1], ArrowUp: [y, -1], ArrowDown: [y, 1] }[event.key];
          if (!delta) return; event.preventDefault(); const dimension = delta[0]!;
          this.state.cursor[dimension] = Math.max(0, Math.min(this.manifest.shape[dimension]! - 1, this.state.cursor[dimension]! + delta[1]!));
          this.persist(false); this.paint();
        };
        figure.append(caption, canvas, el('small', `${this.manifest.axis_order[x]} index → · ${this.manifest.axis_order[y]} index ↓`)); pair.append(figure);
        this.panels.push({ axis, masked, canvas, caption, renderer: new CanvasVolumeSliceRenderer(canvas) });
      }
      this.views.append(section);
    }
  }
  private paint(): void {
    this.sliders.forEach((s, i) => { s.value = String(this.state.cursor[i]); });
    this.modeButtons.forEach((b, mode) => b.setAttribute('aria-pressed', String(mode === this.state.mode)));
    const alignment = this.state.mode === 'alignment';
    if (alignment !== this.root.classList.contains('agea-lab--alignment')) {
      this.experiments.open = !alignment; this.otherTools.open = !alignment;
      if (alignment) this.otherTools.parentElement!.append(this.otherTools);
      else this.selected.after(this.otherTools);
    }
    this.root.classList.toggle('agea-lab--alignment', alignment);
    this.root.querySelector('h1')!.textContent = alignment ? 'AGEA alignment review' : 'AGEA coverage lab';
    this.root.querySelectorAll<HTMLElement>('.agea-controls, .agea-navigation, .agea-legend, .agea-analysis').forEach(node => { node.hidden = alignment; });
    if (alignment) { this.alignmentReview?.setExpression(this.state.gene, this.values); return; }
    this.outlines.checked = this.state.outlines; this.rescale.checked = this.state.rescale;
    this.rescale.disabled = this.state.mode !== 'comparison';
    this.legend.replaceChildren();
    if (this.state.mode === 'coverage') for (const c of CATEGORIES) {
      const item = el('span', c.label); const swatch = el('i'); swatch.style.background = c.color; item.prepend(swatch); this.legend.append(item);
    } else this.legend.append(el('span', this.state.mode === 'frequency'
      ? `Measurement frequency: 0% (dark) → 100% (yellow), across all ${this.manifest.features.length.toLocaleString()} experiments. Zero is measured.`
      : 'Expression energy: 0 (dark) → upper bound (yellow). Grey checkerboard = excluded or missing.'));
    const colors = CATEGORIES.map(c => c.color.slice(1).match(/../g)!.map(v => parseInt(v, 16)));
    for (const panel of this.panels) {
      const { axis, masked } = panel; const plane = PLANES[axis];
      const width = this.manifest.shape[plane.x]!; const height = this.manifest.shape[plane.y]!;
      const upper = masked && this.state.rescale ? this.analysis?.labelled.max ?? 1 : this.analysis?.upper ?? 1;
      panel.caption.textContent = `${this.manifest.axis_order[plane.fixed]} ${this.state.cursor[plane.fixed]} · ${masked ? 'Label mask' : this.state.mode === 'comparison' ? 'All measurements' : this.state.mode} ${this.state.mode === 'expression' || this.state.mode === 'comparison' ? `· 0–${fmt(upper)}` : ''}`;
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = offset(planePoint(axis, x, y, this.state.cursor), this.manifest.shape);
        const label = this.labels[i]!; const v = this.values?.[i];
        let color: number[] = (x + y) % 2 ? [31, 43, 57] : [39, 51, 65];
        if (this.state.mode === 'frequency') color = this.scalar(this.frequency[i]! / this.manifest.features.length);
        else if (v !== undefined && this.state.mode === 'coverage') color = colors[category(v, label)]!;
        else if (v !== undefined && category(v, label) < 4 && (!masked || label !== 0)) color = this.scalar(v / Math.max(upper, Number.EPSILON));
        const pixel = (y * width + x) * 4; rgba.set([...color, 255], pixel);
      }
      panel.renderer.render({ axis, index: this.state.cursor[plane.fixed]!, width, height, rgba });
      const ctx = panel.canvas.getContext('2d')!;
      if (this.state.outlines) {
        ctx.strokeStyle = '#eff8ffbb'; ctx.lineWidth = .13; ctx.beginPath();
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const label = this.labels[offset(planePoint(axis, x, y, this.state.cursor), this.manifest.shape)]!;
          if (label === 0) continue;
          if (x === 0 || this.labels[offset(planePoint(axis, x - 1, y, this.state.cursor), this.manifest.shape)] !== label) { ctx.moveTo(x, y); ctx.lineTo(x, y + 1); }
          if (y === 0 || this.labels[offset(planePoint(axis, x, y - 1, this.state.cursor), this.manifest.shape)] !== label) { ctx.moveTo(x, y); ctx.lineTo(x + 1, y); }
          if (x === width - 1 || this.labels[offset(planePoint(axis, x + 1, y, this.state.cursor), this.manifest.shape)] === 0) { ctx.moveTo(x + 1, y); ctx.lineTo(x + 1, y + 1); }
          if (y === height - 1 || this.labels[offset(planePoint(axis, x, y + 1, this.state.cursor), this.manifest.shape)] === 0) { ctx.moveTo(x, y + 1); ctx.lineTo(x + 1, y + 1); }
        }
        ctx.stroke();
      }
      ctx.strokeStyle = '#ffffffbb'; ctx.lineWidth = .3;
      ctx.beginPath(); ctx.moveTo(this.state.cursor[plane.x]! + .5, 0); ctx.lineTo(this.state.cursor[plane.x]! + .5, height);
      ctx.moveTo(0, this.state.cursor[plane.y]! + .5); ctx.lineTo(width, this.state.cursor[plane.y]! + .5); ctx.stroke();
    }
    this.inspect(); this.paintAnalysis();
  }
  private scalar(t: number): number[] {
    t = Math.max(0, Math.min(1, t));
    return [Math.round(35 + t * 213), Math.round(43 + t * 178), Math.round(95 - t * 45)];
  }
  private inspect(): void {
    const i = offset(this.state.cursor, this.manifest.shape); const label = this.labels[i]!; const v = this.values?.[i];
    const region = this.manifest.regions[String(label)]; const m = this.manifest.index_to_world_um;
    const world = [0, 1, 2].map(row => m[row * 4]! * this.state.cursor[0] + m[row * 4 + 1]! * this.state.cursor[1] + m[row * 4 + 2]! * this.state.cursor[2] + m[row * 4 + 3]!);
    this.inspector.replaceChildren(el('h2', 'Voxel inspection'), el('p', `ML / DV / AP indices: ${this.state.cursor.join(' / ')}`),
      el('p', `Source ML / AP / DV: ${world.map(fmt).join(' / ')} µm`),
      el('p', label === 0 ? 'Label 0 · no region assigned' : `${region?.acronym ?? label} · ${region?.name ?? ''} · signed ID ${label}`),
      el('p', v === undefined ? 'Expression loading or unavailable' : `Expression: ${fmt(v)} · ${CATEGORIES[category(v, label)]!.label}`),
      el('p', `Measured in ${this.frequency[i]!.toLocaleString()} / ${this.manifest.features.length.toLocaleString()} experiments (${pct(this.frequency[i]!, this.manifest.features.length)})`));
  }
  private paintAnalysis(): void {
    this.stats.replaceChildren(); const ctx = this.histogram.getContext('2d')!; ctx.clearRect(0, 0, 700, 220);
    if (!this.analysis) return;
    const a = this.analysis; const table = el('table');
    const heading = el('tr'); for (const text of ['Measured population', 'Voxels', 'Mean', 'Median', '5–95%', 'Full range']) heading.append(el('th', text));
    table.append(heading);
    for (const [name, s] of [['All', a.all], ['Labelled', a.labelled], ['Unlabelled', a.unlabelled]] as [string, Stats][]) {
      const row = el('tr'); for (const text of [name, fmt(s.count), fmt(s.mean), fmt(s.median), `${fmt(s.q05)}–${fmt(s.q95)}`, `${fmt(s.min)}–${fmt(s.max)}`]) row.append(el('td', text)); table.append(row);
    }
    const counts = el('div', '', 'agea-counts');
    a.counts.forEach((n, i) => counts.append(el('p', `${CATEGORIES[i]!.label}: ${n.toLocaleString()} (${pct(n, this.labels.length)} of grid)`)));
    this.stats.append(el('h2', 'Mask impact · selected experiment'), table,
      el('p', `Applying the label mask retains ${pct(a.labelled.count, a.all.count)} of measured voxels. Counts below use the entire grid as denominator.`), counts);
    const probabilities = a.bins.map((bins, g) => bins.map(n => n / Math.max(1, g === 0 ? a.labelled.count : a.unlabelled.count)));
    const max = Math.max(.001, ...probabilities.flat());
    ctx.font = '12px sans-serif'; ctx.fillStyle = '#475569'; ctx.fillText(`${(max * 100).toFixed(1)}%`, 0, 16); ctx.fillText('0', 24, 195); ctx.fillText(fmt(a.upper), 615, 195); ctx.fillText('Expression energy →', 260, 216);
    probabilities.forEach((bins, g) => { ctx.strokeStyle = g === 0 ? '#148a98' : '#da7528'; ctx.lineWidth = 2; ctx.beginPath();
      bins.forEach((p, i) => { const x = 45 + (i + .5) / 48 * 610; const y = 175 - p / max * 150; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke(); });
  }
  private download(): void {
    const feature = this.manifest.features.find(f => f.id === this.state.gene)!;
    const report = { exploratory: true, production_policy: false, url: writeState(this.state, location.href),
      source: this.manifest.source, geometry_status: this.manifest.geometry_status, state: this.state,
      grid: { shape: this.manifest.shape, axis_order: this.manifest.axis_order, index_to_world_um: this.manifest.index_to_world_um },
      classification: 'Measured = finite and nonnegative; missing = -1; all other values unexpected. Labelled = supplied signed region ID is nonzero.',
      experiment: feature, voxel: { label: this.labels[offset(this.state.cursor, this.manifest.shape)],
        expression: this.values?.[offset(this.state.cursor, this.manifest.shape)] ?? null },
      analysis: this.analysis, histogram_rule: '48 equal-width bins over [0,max(all measured)], last bin closed; normalized independently per labelled/unlabelled measured population' };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const a = el('a'); a.href = url; a.download = `agea-inspection-${feature.experiment_id}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export function startAgeaCoverageLab(root: HTMLElement): () => void {
  const lab = new CoverageLab(root); return () => lab.dispose();
}
