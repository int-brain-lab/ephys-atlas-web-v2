import type {
  RendererInteractionSink,
  RendererPresentation,
  SliceRenderModel,
  SliceRenderer,
} from './interfaces.js';

interface TargetState {
  model: SliceRenderModel;
  kind: 'regional' | 'volume';
}

export class HybridSliceRenderer implements SliceRenderer {
  private readonly targets = new Map<HTMLElement, TargetState>();
  private presentation: RendererPresentation | null = null;

  constructor(
    private readonly regional: SliceRenderer,
    private readonly volume: SliceRenderer,
  ) {}

  render(target: HTMLElement, model: SliceRenderModel): void | Promise<void> {
    const kind = model.feature?.representation === 'volume' ? 'volume' : 'regional';
    const previous = this.targets.get(target);
    if (previous && previous.kind !== kind) this.delegate(previous.kind).clear(target);
    this.targets.set(target, { model, kind });
    return this.delegate(kind).render(target, model);
  }

  updatePresentation(presentation: RendererPresentation): void {
    const previousFeature = this.presentation?.feature;
    this.presentation = presentation;
    this.regional.updatePresentation?.(presentation);
    this.volume.updatePresentation?.(presentation);

    const nextKind = presentation.feature?.representation === 'volume' ? 'volume' : 'regional';
    const featureChanged = previousFeature !== presentation.feature;
    if (!featureChanged) return;
    for (const [target, state] of this.targets) {
      const nextModel = { ...state.model, feature: presentation.feature };
      const nextState = { model: nextModel, kind: nextKind } as const;
      if (state.kind !== nextKind) this.delegate(state.kind).clear(target);
      this.targets.set(target, nextState);
      void Promise.resolve(this.delegate(nextKind).render(target, nextModel)).catch(() => undefined);
    }
  }

  setInteractionSink(sink: RendererInteractionSink): void {
    this.regional.setInteractionSink?.(sink);
    this.volume.setInteractionSink?.(sink);
  }

  clear(target: HTMLElement): void {
    const state = this.targets.get(target);
    if (state) this.delegate(state.kind).clear(target);
    else {
      this.regional.clear(target);
      this.volume.clear(target);
    }
    this.targets.delete(target);
  }

  destroy(): void {
    this.targets.clear();
    this.regional.destroy?.();
    this.volume.destroy?.();
  }

  private delegate(kind: 'regional' | 'volume'): SliceRenderer {
    return kind === 'volume' ? this.volume : this.regional;
  }
}
