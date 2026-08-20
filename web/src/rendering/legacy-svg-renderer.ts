import type { SliceAxis } from '../domain/types.js';
import type {
  RendererInteractionSink,
  RendererPresentation,
  SliceRenderModel,
  SliceRenderer,
} from './interfaces.js';
import { LEGACY_VIEW_BOXES, linkedGuides } from './slice-calibration.js';
import { regionalColorMap } from './scalar-colormap.js';
import { SvgSliceRenderer } from './svg-slice-renderer.js';
import { parseLegacyRegionCrosswalk, type LegacyRegionCrosswalk } from './legacy-region-crosswalk.js';
import type { RegionalSliceFrame, SliceRegionPointerEvent } from './types.js';
import {
  LEGACY_CURATED_SLICE_ASSETS,
  LEGACY_CURATED_SLICE_BASE_URL,
  legacyCuratedSliceUrl,
  legacyCuratedRegionsUrl,
} from './legacy-slice-assets.js';

export { LEGACY_CURATED_SLICE_BASE_URL };

interface AxisSliceBundle {
  entries: ReadonlyMap<number, string>;
  sortedIndices: readonly number[];
}

export interface LegacySvgSliceRendererOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface RendererMount {
  renderer: SvgSliceRenderer;
  frame?: RegionalSliceFrame;
}

export class LegacyCuratedSvgSliceRenderer implements SliceRenderer {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly axisBundles = new Map<SliceAxis, Promise<AxisSliceBundle>>();
  private readonly crosswalks = new Map<string, Promise<LegacyRegionCrosswalk>>();
  private readonly resolvedCrosswalks = new Map<string, LegacyRegionCrosswalk>();
  private regionTable: Promise<unknown> | null = null;
  private readonly mounts = new Map<HTMLElement, RendererMount>();
  private readonly renderTokens = new WeakMap<HTMLElement, number>();
  private readonly requestedIndices = new Map<SliceAxis, number>();
  private readonly requestedMappings = new Map<SliceAxis, RegionalSliceFrame['mapping']>();
  private interactionSink: RendererInteractionSink | null = null;
  private presentation: RendererPresentation = {
    feature: null,
    coloring: { statistic: 'mean', colormap: 'viridis', range: { mode: 'auto' }, scale: 'linear' },
    selectedRegionIds: [],
    hoveredRegionId: null,
  };

  constructor(options: LegacySvgSliceRendererOptions = {}) {
    const baseUrl = options.baseUrl ?? LEGACY_CURATED_SLICE_BASE_URL;
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  setInteractionSink(sink: RendererInteractionSink): void {
    this.interactionSink = sink;
  }

  updatePresentation(presentation: RendererPresentation): void {
    this.presentation = presentation;
    for (const mount of this.mounts.values()) {
      if (mount.frame) mount.renderer.render(this.withPresentation(mount.frame, this.resolvedCrosswalks.get(mount.frame.mapping)));
    }
  }

  async render(target: HTMLElement, model: SliceRenderModel): Promise<void> {
    const token = (this.renderTokens.get(target) ?? 0) + 1;
    this.renderTokens.set(target, token);
    this.requestedIndices.set(model.axis, model.sliceIndex);
    this.requestedMappings.set(model.axis, model.parcellation);
    const [bundle, crosswalk] = await Promise.all([this.loadAxis(model.axis), this.loadCrosswalk(model.parcellation)]);
    if (this.renderTokens.get(target) !== token) return;

    const assetIndex = this.nearestIndex(bundle.sortedIndices, model.sliceIndex);
    const fragment = bundle.entries.get(assetIndex);
    if (!fragment) throw new Error(`No curated ${model.axis} SVG fragment near index ${model.sliceIndex}`);

    const mount = this.ensureMount(target);
    const frame: RegionalSliceFrame = {
      axis: model.axis,
      index: assetIndex,
      mapping: model.parcellation,
      svgFragment: fragment,
      viewBox: LEGACY_VIEW_BOXES[model.axis],
      guides: linkedGuides(model.slices, model.axis),
    };
    mount.frame = frame;
    mount.renderer.render(this.withPresentation(frame, crosswalk));

    target.dataset.sliceAsset = 'legacy-curated-v1';
    target.dataset.assetIndex = String(assetIndex);
  }

  clear(target: HTMLElement): void {
    this.renderTokens.set(target, (this.renderTokens.get(target) ?? 0) + 1);
    this.mounts.get(target)?.renderer.dispose();
    this.mounts.delete(target);
    target.replaceChildren();
    delete target.dataset.sliceAsset;
    delete target.dataset.assetIndex;
  }

  destroy(): void {
    for (const [target, mount] of this.mounts) {
      mount.renderer.dispose();
      target.replaceChildren();
    }
    this.mounts.clear();
    this.axisBundles.clear();
    this.crosswalks.clear();
    this.resolvedCrosswalks.clear();
    this.regionTable = null;
    this.requestedIndices.clear();
    this.requestedMappings.clear();
  }

  private withPresentation(frame: RegionalSliceFrame, crosswalk?: LegacyRegionCrosswalk): RegionalSliceFrame {
    const selectedRegionIds = new Set<number>();
    for (const id of this.presentation.selectedRegionIds) {
      const atlasId = Number(id);
      const legacyIndex = crosswalk?.atlasIdToLegacyIndex.get(atlasId);
      if (legacyIndex != null) selectedRegionIds.add(legacyIndex);
    }
    const hoveredAtlasId = this.presentation.hoveredRegionId == null
      ? null
      : Number(this.presentation.hoveredRegionId);
    const highlightedRegionId = hoveredAtlasId == null || !Number.isFinite(hoveredAtlasId)
      ? null
      : crosswalk?.atlasIdToLegacyIndex.get(hoveredAtlasId) ?? null;
    const feature = this.presentation.feature;
    const atlasColors = feature?.representation === 'regional' && feature.parcellation === frame.mapping
      ? regionalColorMap(feature, this.presentation.coloring) : undefined;
    const regionColors = atlasColors && crosswalk ? new Map<number, string>() : undefined;
    if (atlasColors && regionColors && crosswalk) {
      for (const [atlasId, color] of atlasColors) {
        const legacyIndex = crosswalk.atlasIdToLegacyIndex.get(atlasId);
        if (legacyIndex != null) regionColors.set(legacyIndex, color);
      }
    }
    return {
      ...frame,
      ...(regionColors ? { regionColors } : {}),
      selectedRegionIds,
      highlightedRegionId,
    };
  }

  private async loadCrosswalk(mapping: RegionalSliceFrame['mapping']): Promise<LegacyRegionCrosswalk> {
    let pending = this.crosswalks.get(mapping);
    if (!pending) {
      pending = this.fetchCrosswalk(mapping);
      this.crosswalks.set(mapping, pending);
      pending.catch(() => this.crosswalks.delete(mapping));
    }
    return pending;
  }

  private async fetchCrosswalk(mapping: RegionalSliceFrame['mapping']): Promise<LegacyRegionCrosswalk> {
    const raw = await this.loadRegionTable();
    const crosswalk = parseLegacyRegionCrosswalk(raw, mapping);
    this.resolvedCrosswalks.set(mapping, crosswalk);
    return crosswalk;
  }

  private loadRegionTable(): Promise<unknown> {
    if (this.regionTable) return this.regionTable;
    this.regionTable = this.fetchRegionTable();
    this.regionTable.catch(() => { this.regionTable = null; });
    return this.regionTable;
  }

  private async fetchRegionTable(): Promise<unknown> {
    const response = await this.fetchImpl(legacyCuratedRegionsUrl(this.baseUrl), { mode: 'cors', cache: 'force-cache' });
    if (!response.ok) throw new Error(`Legacy region crosswalk request failed (${response.status})`);
    return response.json();
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
    const url = legacyCuratedSliceUrl(axis, this.baseUrl);
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
    this.assertKnownInventory(axis, sortedIndices);
    return { entries, sortedIndices };
  }

  private assertKnownInventory(axis: SliceAxis, indices: readonly number[]): void {
    const expected = LEGACY_CURATED_SLICE_ASSETS[axis];
    const first = indices[0];
    const last = indices[indices.length - 1];
    const step = expected.step ?? 1;
    const regular = indices.every(
      (index, position) => position === 0 || index - (indices[position - 1] ?? index) === step,
    );
    if (
      indices.length !== expected.entryCount ||
      first !== expected.minIndex ||
      last !== expected.maxIndex ||
      !regular
    ) {
      throw new Error(
        `Curated ${axis} slice inventory does not match the pinned v1 asset ` +
          `(${indices.length} entries, ${first ?? 'none'}..${last ?? 'none'})`,
      );
    }
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

  private onRegionPointer(event: SliceRegionPointerEvent): void {
    const sink = this.interactionSink;
    if (!sink) return;
    if (event.type === 'leave') {
      sink.hover(null);
      return;
    }
    const mapping = this.requestedMappings.get(event.axis);
    const resolved = mapping ? this.resolvedCrosswalks.get(mapping) : undefined;
    if (!resolved) return;
    const atlasId = resolved.legacyIndexToAtlasId.get(event.regionId);
    if (atlasId == null) return;
    const hit = {
      regionId: String(atlasId),
      axis: event.axis,
      sliceIndex: this.requestedIndices.get(event.axis) ?? 0,
    };
    if (event.type === 'select') sink.toggleSelection(hit);
    else sink.hover(hit);
  }

  private ensureMount(target: HTMLElement): RendererMount {
    const existing = this.mounts.get(target);
    if (existing) return existing;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('view-frame__brain-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Curated Allen atlas anatomical slice');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const figureLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    figureLayer.classList.add('view-frame__slice-figure');
    const guideLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    guideLayer.classList.add('view-frame__guide-layer');
    guideLayer.setAttribute('aria-hidden', 'true');
    svg.append(figureLayer, guideLayer);
    target.replaceChildren(svg);

    const mount: RendererMount = {
      renderer: new SvgSliceRenderer(
        { svg, figureLayer, guideLayer },
        { onRegionPointer: (event) => this.onRegionPointer(event) },
      ),
    };
    this.mounts.set(target, mount);
    return mount;
  }
}
