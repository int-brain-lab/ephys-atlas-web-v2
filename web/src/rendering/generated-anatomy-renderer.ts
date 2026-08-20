import type { SliceAxis } from '../domain/types.js';
import { cursorStateToWorld } from './coordinate-space.js';
import type {
  RendererInteractionSink,
  RendererPresentation,
  SliceRenderModel,
  SliceRenderer,
} from './interfaces.js';
import { bilateralAtlasRegionColorMap, bilateralFeatureColorMap } from './scalar-colormap.js';
import { SvgSliceRenderer } from './svg-slice-renderer.js';
import type { SvgSlicePerformanceEvent } from './svg-slice-renderer.js';
import type { AnatomySlice, AnatomySliceSource, RegionalSliceFrame, SliceRegionPointerEvent } from './types.js';

interface RendererMount {
  renderer: SvgSliceRenderer;
  frame?: RegionalSliceFrame;
}

interface PendingGeometryRender {
  model: SliceRenderModel;
  token: number;
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface GeometryRenderSchedule {
  pending: PendingGeometryRender | undefined;
  timer: number | null;
  inFlight: boolean;
  lastStartedAt: number;
}

const GEOMETRY_RENDER_INTERVAL_MS = 40;

export interface GeneratedAnatomySliceRendererOptions {
  onPerformance?: (event: SvgSlicePerformanceEvent) => void;
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function anatomySliceSvgFragment(slice: AnatomySlice): string {
  return slice.paths.map((path) => (
    `<path class="atlas-region" fill-rule="evenodd" data-allen-id="${path.atlasIds.allen}" data-beryl-id="${path.atlasIds.beryl}" ` +
    `data-cosmos-id="${path.atlasIds.cosmos}" d="${escapeAttribute(path.d)}"/>`
  )).join('');
}

/** Default regional renderer for immutable, scientifically registered anatomy packs. */
export class GeneratedAnatomySliceRenderer implements SliceRenderer {
  private readonly mounts = new Map<HTMLElement, RendererMount>();
  private readonly renderTokens = new WeakMap<HTMLElement, number>();
  private readonly geometrySchedules = new Map<HTMLElement, GeometryRenderSchedule>();
  private readonly requestedIndices = new Map<SliceAxis, number>();
  private interactionSink: RendererInteractionSink | null = null;
  private presentation: RendererPresentation = {
    feature: null,
    regions: [],
    coloring: { mode: 'feature', statistic: 'mean', colormap: 'viridis', range: { mode: 'auto' }, scale: 'linear' },
    selectedRegionIds: [],
    hoveredRegionId: null,
  };

  constructor(
    private readonly source: AnatomySliceSource,
    private readonly options: GeneratedAnatomySliceRendererOptions = {},
  ) {}

  setInteractionSink(sink: RendererInteractionSink): void {
    this.interactionSink = sink;
  }

  updatePresentation(presentation: RendererPresentation): void {
    this.presentation = presentation;
    for (const mount of this.mounts.values()) {
      if (mount.frame) mount.renderer.render(this.withPresentation(mount.frame));
    }
  }

  async render(target: HTMLElement, model: SliceRenderModel): Promise<void> {
    const token = (this.renderTokens.get(target) ?? 0) + 1;
    this.renderTokens.set(target, token);
    this.requestedIndices.set(model.axis, model.sliceIndex);
    const world = cursorStateToWorld(model.cursor);
    const existing = this.mounts.get(target);
    if (existing?.frame?.axis === model.axis
      && existing.frame.index === model.sliceIndex
      && existing.frame.mapping === model.parcellation) {
      this.cancelPendingGeometryRender(target);
      const guides = await this.source.guidesForWorld(model.axis, world);
      if (this.renderTokens.get(target) !== token) return;
      existing.frame = { ...existing.frame, guides };
      existing.renderer.updateGuides(existing.frame);
      return;
    }

    return this.scheduleGeometryRender(target, model, token);
  }

  private async renderGeometry(target: HTMLElement, model: SliceRenderModel, token: number): Promise<void> {
    const world = cursorStateToWorld(model.cursor);
    const existing = this.mounts.get(target);

    const previousIndex = existing?.frame?.axis === model.axis ? existing.frame.index : null;
    const [slice, guides] = await Promise.all([
      this.source.loadSlice(model.axis, model.sliceIndex),
      this.source.guidesForWorld(model.axis, world),
    ]);
    if (this.renderTokens.get(target) !== token) return;

    const mount = this.ensureMount(target);
    const serializeStarted = this.options.onPerformance ? performance.now() : 0;
    const svgFragment = anatomySliceSvgFragment(slice);
    this.reportPerformance({
      phase: 'serialize-fragment',
      axis: model.axis,
      sliceIndex: slice.sliceIndex,
      durationMs: this.options.onPerformance ? performance.now() - serializeStarted : 0,
      pathCount: slice.paths.length,
    });
    const frame: RegionalSliceFrame = {
      axis: model.axis,
      index: slice.sliceIndex,
      mapping: model.parcellation,
      svgFragment,
      viewBox: slice.viewBox,
      guides,
    };
    mount.frame = frame;
    mount.renderer.render(this.withPresentation(frame));
    target.dataset.sliceAsset = slice.packFormat === 'anatomy-pack-v2'
      ? 'generated-anatomy-v2'
      : 'generated-anatomy-v1';
    target.dataset.assetIndex = String(slice.sliceIndex);
    target.dataset.worldCoordinateUm = String(slice.worldCoordinateUm);
    if (previousIndex !== null && previousIndex !== model.sliceIndex) {
      this.source.prefetchNextPack?.(model.axis, model.sliceIndex, model.sliceIndex > previousIndex ? 1 : -1);
    }
  }

  clear(target: HTMLElement): void {
    this.renderTokens.set(target, (this.renderTokens.get(target) ?? 0) + 1);
    this.clearGeometrySchedule(target);
    this.mounts.get(target)?.renderer.dispose();
    this.mounts.delete(target);
    target.replaceChildren();
    delete target.dataset.sliceAsset;
    delete target.dataset.assetIndex;
    delete target.dataset.worldCoordinateUm;
  }

  destroy(): void {
    for (const target of this.geometrySchedules.keys()) this.clearGeometrySchedule(target);
    for (const [target, mount] of this.mounts) {
      mount.renderer.dispose();
      target.replaceChildren();
    }
    this.mounts.clear();
    this.requestedIndices.clear();
  }

  private scheduleGeometryRender(target: HTMLElement, model: SliceRenderModel, token: number): Promise<void> {
    const schedule = this.geometrySchedules.get(target) ?? {
      pending: undefined,
      timer: null,
      inFlight: false,
      lastStartedAt: Number.NEGATIVE_INFINITY,
    };
    this.geometrySchedules.set(target, schedule);
    schedule.pending?.resolve();
    return new Promise<void>((resolve, reject) => {
      schedule.pending = { model, token, resolve, reject };
      this.pumpGeometryRender(target, schedule);
    });
  }

  private pumpGeometryRender(target: HTMLElement, schedule: GeometryRenderSchedule): void {
    if (schedule.inFlight || schedule.timer !== null || !schedule.pending) return;
    const waitMs = Math.max(0, GEOMETRY_RENDER_INTERVAL_MS - (performance.now() - schedule.lastStartedAt));
    if (waitMs > 0) {
      schedule.timer = window.setTimeout(() => {
        schedule.timer = null;
        this.pumpGeometryRender(target, schedule);
      }, waitMs);
      return;
    }
    const request = schedule.pending;
    schedule.pending = undefined;
    schedule.inFlight = true;
    schedule.lastStartedAt = performance.now();
    void this.renderGeometry(target, request.model, request.token)
      .then(request.resolve, request.reject)
      .finally(() => {
        schedule.inFlight = false;
        this.pumpGeometryRender(target, schedule);
      });
  }

  private cancelPendingGeometryRender(target: HTMLElement): void {
    const schedule = this.geometrySchedules.get(target);
    if (!schedule?.pending) return;
    schedule.pending.resolve();
    schedule.pending = undefined;
    if (schedule.timer !== null) {
      window.clearTimeout(schedule.timer);
      schedule.timer = null;
    }
  }

  private clearGeometrySchedule(target: HTMLElement): void {
    const schedule = this.geometrySchedules.get(target);
    if (!schedule) return;
    this.cancelPendingGeometryRender(target);
    this.geometrySchedules.delete(target);
  }

  private withPresentation(frame: RegionalSliceFrame): RegionalSliceFrame {
    const selectedRegionIds = new Set<number>();
    for (const id of this.presentation.selectedRegionIds) {
      const atlasId = Number(id);
      if (Number.isInteger(atlasId) && atlasId !== 0) {
        selectedRegionIds.add(-Math.abs(atlasId));
        selectedRegionIds.add(Math.abs(atlasId));
      }
    }
    const hovered = this.presentation.hoveredRegionId == null ? null : Number(this.presentation.hoveredRegionId);
    const highlightedRegionIds = new Set<number>();
    if (hovered != null && Number.isInteger(hovered) && hovered !== 0) {
      highlightedRegionIds.add(-Math.abs(hovered));
      highlightedRegionIds.add(Math.abs(hovered));
    }
    const feature = this.presentation.feature;
    const anatomyRegions = this.presentation.anatomyRegions ?? this.presentation.regions ?? [];
    const atlasColors = bilateralAtlasRegionColorMap(anatomyRegions);
    const regionColors = this.presentation.coloring.mode === 'anatomy'
      ? atlasColors
      : feature?.representation === 'regional' && feature.parcellation === frame.mapping
        ? bilateralFeatureColorMap(feature, this.presentation.coloring, anatomyRegions)
        : new Map([...atlasColors].filter(([atlasId]) => atlasId > 0));
    return {
      ...frame,
      ...(regionColors ? { regionColors } : {}),
      selectedRegionIds,
      highlightedRegionIds,
    };
  }

  private onRegionPointer(event: SliceRegionPointerEvent): void {
    const sink = this.interactionSink;
    if (!sink) return;
    if (event.type === 'leave') {
      sink.hover(null);
      return;
    }
    const hit = {
      regionId: String(-Math.abs(event.regionId)),
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
    svg.setAttribute('aria-label', 'Generated Allen atlas anatomical slice');
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
        {
          onRegionPointer: (event) => this.onRegionPointer(event),
          onSliceStep: (axis, delta) => this.interactionSink?.stepSlice(axis, delta),
          ...(this.options.onPerformance ? { onPerformance: this.options.onPerformance } : {}),
        },
      ),
    };
    this.mounts.set(target, mount);
    return mount;
  }

  private reportPerformance(event: SvgSlicePerformanceEvent): void {
    if (!this.options.onPerformance) return;
    try {
      this.options.onPerformance(event);
    } catch {
      // Performance observers must not affect rendering.
    }
  }
}
