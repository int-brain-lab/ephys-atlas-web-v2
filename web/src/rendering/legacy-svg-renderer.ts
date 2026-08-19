import type { SliceAxis } from '../domain/types.js';
import type { SliceRenderModel, SliceRenderer } from './interfaces.js';
import { LEGACY_VIEW_BOXES, linkedGuides } from './slice-calibration.js';

export const LEGACY_CURATED_SLICE_BASE_URL = 'https://atlas.internationalbrainlab.org/data/json/';

interface AxisSliceBundle {
  entries: ReadonlyMap<number, string>;
  sortedIndices: readonly number[];
}

export interface LegacySvgSliceRendererOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface SvgMount {
  svg: SVGSVGElement;
  figure: SVGGElement;
  guides: SVGGElement;
}

export class LegacyCuratedSvgSliceRenderer implements SliceRenderer {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly axisBundles = new Map<SliceAxis, Promise<AxisSliceBundle>>();
  private readonly mounts = new Map<HTMLElement, SvgMount>();
  private readonly renderTokens = new WeakMap<HTMLElement, number>();

  constructor(options: LegacySvgSliceRendererOptions = {}) {
    const baseUrl = options.baseUrl ?? LEGACY_CURATED_SLICE_BASE_URL;
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  async render(target: HTMLElement, model: SliceRenderModel): Promise<void> {
    const token = (this.renderTokens.get(target) ?? 0) + 1;
    this.renderTokens.set(target, token);
    const bundle = await this.loadAxis(model.axis);
    if (this.renderTokens.get(target) !== token) return;

    const assetIndex = this.nearestIndex(bundle.sortedIndices, model.sliceIndex);
    const fragment = bundle.entries.get(assetIndex);
    if (!fragment) throw new Error(`No curated ${model.axis} SVG fragment near index ${model.sliceIndex}`);

    const mount = this.ensureMount(target);
    const viewBox = LEGACY_VIEW_BOXES[model.axis];
    mount.svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
    mount.figure.innerHTML = fragment;
    mount.guides.replaceChildren();
    for (const guide of linkedGuides(model.slices, model.axis)) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.classList.add('slice-guide');
      line.dataset.sourceAxis = guide.sourceAxis;
      if (guide.dimension === 'x') {
        line.setAttribute('x1', String(guide.position));
        line.setAttribute('x2', String(guide.position));
        line.setAttribute('y1', String(viewBox.y));
        line.setAttribute('y2', String(viewBox.y + viewBox.height));
      } else {
        line.setAttribute('x1', String(viewBox.x));
        line.setAttribute('x2', String(viewBox.x + viewBox.width));
        line.setAttribute('y1', String(guide.position));
        line.setAttribute('y2', String(guide.position));
      }
      mount.guides.append(line);
    }

    target.dataset.sliceAsset = 'legacy-curated-v1';
    target.dataset.assetIndex = String(assetIndex);
  }

  clear(target: HTMLElement): void {
    this.renderTokens.set(target, (this.renderTokens.get(target) ?? 0) + 1);
    this.mounts.delete(target);
    target.replaceChildren();
    delete target.dataset.sliceAsset;
    delete target.dataset.assetIndex;
  }

  destroy(): void {
    for (const target of this.mounts.keys()) target.replaceChildren();
    this.mounts.clear();
    this.axisBundles.clear();
  }

  private async loadAxis(axis: SliceAxis): Promise<AxisSliceBundle> {
    let pending = this.axisBundles.get(axis);
    if (!pending) {
      pending = this.fetchAxis(axis);
      this.axisBundles.set(axis, pending);
      pending.catch(() => this.axisBundles.delete(axis));
    }
    return pending;
  }

  private async fetchAxis(axis: SliceAxis): Promise<AxisSliceBundle> {
    const url = new URL(`slices_${axis}.json`, this.baseUrl).toString();
    const response = await this.fetchImpl(url, { mode: 'cors', cache: 'force-cache' });
    if (!response.ok) throw new Error(`Curated slice request failed (${response.status})`);
    const raw: unknown = await response.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Invalid curated ${axis} slice bundle`);

    const entries = new Map<number, string>();
    for (const [key, value] of Object.entries(raw)) {
      const index = Number.parseInt(key, 10);
      if (Number.isInteger(index) && typeof value === 'string' && value.includes('<')) entries.set(index, value);
    }
    const sortedIndices = [...entries.keys()].sort((a, b) => a - b);
    if (!sortedIndices.length) throw new Error(`Curated ${axis} slice bundle contains no SVG fragments`);
    return { entries, sortedIndices };
  }

  private nearestIndex(indices: readonly number[], requested: number): number {
    let lo = 0;
    let hi = indices.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const value = indices[mid] ?? 0;
      if (value < requested) lo = mid + 1;
      else hi = mid;
    }
    const upper = indices[lo] ?? indices[0] ?? 0;
    const lower = indices[Math.max(0, lo - 1)] ?? upper;
    return Math.abs(lower - requested) <= Math.abs(upper - requested) ? lower : upper;
  }

  private ensureMount(target: HTMLElement): SvgMount {
    const existing = this.mounts.get(target);
    if (existing) return existing;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('view-frame__brain-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Curated Allen atlas anatomical slice');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const figure = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    figure.classList.add('view-frame__slice-figure');
    const guides = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    guides.classList.add('view-frame__guide-layer');
    guides.setAttribute('aria-hidden', 'true');
    svg.append(figure, guides);
    target.replaceChildren(svg);

    const mount = { svg, figure, guides };
    this.mounts.set(target, mount);
    return mount;
  }
}
