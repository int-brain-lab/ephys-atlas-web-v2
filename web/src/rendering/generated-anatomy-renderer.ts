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
import type { AnatomySlice, AnatomySliceSource, RegionalSliceFrame, SliceRegionPointerEvent } from './types.js';

interface RendererMount {
  renderer: SvgSliceRenderer;
  frame?: RegionalSliceFrame;
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
  private readonly requestedIndices = new Map<SliceAxis, number>();
  private interactionSink: RendererInteractionSink | null = null;
  private presentation: RendererPresentation = {
    feature: null,
    regions: [],
    coloring: { mode: 'feature', statistic: 'mean', colormap: 'viridis', range: { mode: 'auto' }, scale: 'linear' },
    selectedRegionIds: [],
    hoveredRegionId: null,
  };

  constructor(private readonly source: AnatomySliceSource) {}

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
    const slice = await this.source.loadSlice(model.axis, model.sliceIndex);
    const world = cursorStateToWorld(model.cursor);
    const guides = await this.source.guidesForWorld(model.axis, world);
    if (this.renderTokens.get(target) !== token) return;

    const mount = this.ensureMount(target);
    const frame: RegionalSliceFrame = {
      axis: model.axis,
      index: slice.sliceIndex,
      mapping: model.parcellation,
      svgFragment: anatomySliceSvgFragment(slice),
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
    this.source.prefetchAdjacentPacks?.(model.axis, model.sliceIndex);
  }

  clear(target: HTMLElement): void {
    this.renderTokens.set(target, (this.renderTokens.get(target) ?? 0) + 1);
    this.mounts.get(target)?.renderer.dispose();
    this.mounts.delete(target);
    target.replaceChildren();
    delete target.dataset.sliceAsset;
    delete target.dataset.assetIndex;
    delete target.dataset.worldCoordinateUm;
  }

  destroy(): void {
    for (const [target, mount] of this.mounts) {
      mount.renderer.dispose();
      target.replaceChildren();
    }
    this.mounts.clear();
    this.requestedIndices.clear();
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
        },
      ),
    };
    this.mounts.set(target, mount);
    return mount;
  }
}
