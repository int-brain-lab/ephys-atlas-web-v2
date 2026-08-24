import type { RegionalPresentation } from '../../application/regional-presentation.js';
import { ResourceFetcher, type ResourceIntegrity } from '../../data/cache.js';
import type { Scene3DViewState } from '../../domain/types.js';
import type {
  BrainScene3DInteractionSink,
  BrainScene3DViewport,
  BrainScene3DViewportFactory,
} from './brain-scene-viewport.js';

export interface LazyBrainScene3DAsset extends ResourceIntegrity {
  readonly url: string;
}

/** Defers Three, worker, source, and asset work until a scene host is created. */
export class LazyBrainScene3DViewportFactory implements BrainScene3DViewportFactory {
  private sink: BrainScene3DInteractionSink = {};
  private inner: BrainScene3DViewportFactory | null = null;
  private pending: Promise<BrainScene3DViewportFactory> | null = null;
  private readonly viewports = new Set<LazyBrainScene3DViewport>();
  private destroyed = false;

  constructor(private readonly asset: LazyBrainScene3DAsset) {}

  create(host: HTMLElement): BrainScene3DViewport {
    if (this.destroyed) throw new Error('Lazy 3-D viewport factory was destroyed');
    const viewport = new LazyBrainScene3DViewport(host, () => this.viewports.delete(viewport));
    this.viewports.add(viewport);
    void this.load().then((factory) => {
      if (!viewport.isDestroyed) viewport.install(factory.create(host));
    }).catch((error: unknown) => {
      if (!viewport.isDestroyed && !this.destroyed) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        viewport.fail(normalized);
        this.sink.error?.(normalized);
      }
    });
    return viewport;
  }

  setInteractionSink(sink: BrainScene3DInteractionSink): void {
    this.sink = sink;
    this.inner?.setInteractionSink(sink);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const viewport of [...this.viewports]) viewport.destroy();
    this.inner?.destroy();
  }

  private load(): Promise<BrainScene3DViewportFactory> {
    if (this.inner) return Promise.resolve(this.inner);
    if (this.pending) return this.pending;
    this.pending = Promise.all([
      import('./mesh-pack-source.js'),
      import('./brain-scene-viewport.js'),
    ]).then(([{ MeshPackSource }, { RetainedBrainScene3DViewportFactory }]) => {
      const source = new MeshPackSource({ manifest: this.asset, fetcher: new ResourceFetcher() });
      const factory = new RetainedBrainScene3DViewportFactory(source);
      factory.setInteractionSink(this.sink);
      if (this.destroyed) {
        factory.destroy();
        throw new Error('Lazy 3-D viewport factory was destroyed');
      }
      this.inner = factory;
      return factory;
    });
    return this.pending;
  }
}

class LazyBrainScene3DViewport implements BrainScene3DViewport {
  private inner: BrainScene3DViewport | null = null;
  private presentation: RegionalPresentation | null = null;
  private viewState: Scene3DViewState | null = null;
  private active = false;
  private destroyed = false;

  constructor(private readonly host: HTMLElement, private readonly onDestroy: () => void) {
    host.dataset.scene3dState = 'loading';
    host.dataset.active = 'false';
  }

  get isDestroyed(): boolean { return this.destroyed; }

  setPresentation(presentation: RegionalPresentation): void {
    this.assertActiveObject();
    this.presentation = presentation;
    this.inner?.setPresentation(presentation);
  }

  setViewState(state: Scene3DViewState): void {
    this.assertActiveObject();
    this.viewState = state;
    this.inner?.setViewState(state);
  }

  activate(): void {
    this.assertActiveObject();
    this.active = true;
    this.host.dataset.active = 'true';
    this.inner?.activate();
  }

  deactivate(): void {
    this.active = false;
    this.host.dataset.active = 'false';
    this.inner?.deactivate();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.active = false;
    this.inner?.destroy();
    this.onDestroy();
    if (!this.inner) this.host.dataset.scene3dState = 'destroyed';
  }

  install(viewport: BrainScene3DViewport): void {
    if (this.destroyed) {
      viewport.destroy();
      return;
    }
    this.inner = viewport;
    if (this.presentation) viewport.setPresentation(this.presentation);
    if (this.viewState) viewport.setViewState(this.viewState);
    if (this.active) viewport.activate();
    else viewport.deactivate();
  }

  fail(error: Error): void {
    this.host.dataset.scene3dState = 'error';
    this.host.dataset.error = error.message;
  }

  private assertActiveObject(): void {
    if (this.destroyed) throw new Error('Lazy 3-D viewport was destroyed');
  }
}
