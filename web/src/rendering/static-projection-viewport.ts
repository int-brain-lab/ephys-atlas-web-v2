import type { StaticProjectionId } from '../domain/types.js';
import { regionalPresentationColors, regionalPresentationIds } from '../application/regional-presentation.js';
import { regionIdFromPath } from './region-id.js';
import type { RegisteredProjectionSource, StaticProjectionFrame } from './projection-pack-source.js';
import type {
  ProjectionInteractionSink,
  ProjectionPresentation,
  RegionHit,
  StaticProjectionRenderModel,
  StaticProjectionViewport,
} from './projection-viewport.js';
import { SvgSliceRenderer } from './svg-slice-renderer.js';
import type { RegionalSliceFrame, SliceRegionPointerEvent } from './types.js';

function presentationFrame(
  source: StaticProjectionFrame,
  model: StaticProjectionRenderModel,
  presentation: ProjectionPresentation,
): RegionalSliceFrame {
  const semantics = presentation.regional;
  return {
    axis: source.projectionId,
    index: 0,
    mapping: model.parcellation,
    svgFragment: source.svgFragment,
    viewBox: source.viewBox,
    guides: [],
    regionColors: regionalPresentationColors(semantics, presentation.feature?.representation === 'regional'),
    selectedRegionIds: semantics.selectedRegionIds,
    highlightedRegionIds: semantics.highlightedRegionId == null
      ? new Set()
      : regionalPresentationIds([semantics.highlightedRegionId]),
  };
}

/** Affine-free retained SVG map sharing regional coloring and interaction. */
export class RetainedStaticProjectionViewport implements StaticProjectionViewport {
  private readonly root: HTMLDivElement;
  private readonly renderer: SvgSliceRenderer;
  private readonly error: HTMLDivElement;
  private frame: StaticProjectionFrame | null = null;
  private renderedFrame: RegionalSliceFrame | null = null;
  private model: StaticProjectionRenderModel | null = null;
  private token = 0;
  private activeAbort: AbortController | null = null;

  constructor(
    target: HTMLElement,
    private readonly projectionId: StaticProjectionId,
    private readonly source: RegisteredProjectionSource,
    private readonly presentation: () => ProjectionPresentation,
    private readonly interactionSink: () => ProjectionInteractionSink | null,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'static-projection-viewport';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('static-projection-viewport__svg', 'view-frame__brain-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${projectionId} regional projection`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const figureLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    figureLayer.classList.add('view-frame__slice-figure');
    const guideLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.append(figureLayer, guideLayer);
    this.error = document.createElement('div');
    this.error.className = 'projection-viewport__error';
    this.error.setAttribute('role', 'status');
    this.error.hidden = true;
    this.root.append(svg, this.error);
    this.renderer = new SvgSliceRenderer({ svg, figureLayer, guideLayer }, {
      onRegionPointer: (event) => this.onRegionPointer(event),
    });
    target.replaceChildren(this.root);
  }

  async render(model: StaticProjectionRenderModel): Promise<void> {
    if (model.projectionId !== this.projectionId) {
      throw new Error(`${this.projectionId} viewport cannot render ${model.projectionId}`);
    }
    const token = ++this.token;
    this.activeAbort?.abort();
    const abort = new AbortController();
    this.activeAbort = abort;
    this.error.hidden = true;
    try {
      const frame = this.frame ?? await this.load(abort.signal);
      if (this.token !== token) return;
      this.frame = frame;
      this.model = model;
      this.renderedFrame = presentationFrame(frame, model, this.presentation());
      this.renderer.render(this.renderedFrame);
      this.root.dataset.syntheticFixture = String(frame.syntheticFixture);
      this.root.dataset.mode = model.feature?.representation === 'volume' ? 'anatomy-only' : 'regional';
    } finally {
      if (this.activeAbort === abort) this.activeAbort = null;
    }
  }

  updatePresentation(): void {
    if (this.frame && this.model) {
      const presentation = this.presentation();
      if (presentation.regional.mapping !== this.model.parcellation) {
        if (this.renderedFrame) this.renderer.render({
          ...this.renderedFrame,
          selectedRegionIds: new Set(),
          highlightedRegionIds: new Set(),
        });
        return;
      }
      this.renderedFrame = presentationFrame(this.frame, this.model, presentation);
      this.renderer.render(this.renderedFrame);
    }
  }

  clear(): void {
    this.token += 1;
    this.activeAbort?.abort();
    this.activeAbort = null;
    this.model = null;
    this.renderedFrame = null;
    this.renderer.clear();
  }

  showError(error: unknown): void {
    this.error.textContent = error instanceof Error ? error.message : 'Static projection could not be rendered';
    this.error.hidden = false;
  }

  destroy(): void {
    this.clear();
    this.renderer.dispose();
    this.root.remove();
  }

  private load(signal: AbortSignal): Promise<StaticProjectionFrame> {
    if (!this.source.loadStaticProjection) throw new Error('Static projections are not available from this source');
    return this.source.loadStaticProjection(this.projectionId, signal);
  }

  private onRegionPointer(event: SliceRegionPointerEvent): void {
    const sink = this.interactionSink();
    const model = this.model;
    if (!sink || !model) return;
    if (event.type === 'leave') {
      sink.hover(null);
      sink.inspect(null);
      return;
    }
    const hit: RegionHit = {
      regionId: String(-Math.abs(event.regionId)),
      projectionId: this.projectionId,
      sliceIndex: null,
    };
    if (event.type === 'select') sink.toggleSelection(hit);
    else if (event.type === 'hover') sink.hover(hit);
    else {
      const path = event.originalEvent.target instanceof SVGPathElement
        ? event.originalEvent.target
        : null;
      const physicalRegionId = path ? regionIdFromPath('allen', path) : null;
      if (physicalRegionId == null) return;
      sink.inspect({
        ...hit,
        physicalRegionId,
        parcellation: model.parcellation,
        clientX: event.originalEvent.clientX,
        clientY: event.originalEvent.clientY,
      });
    }
  }
}
