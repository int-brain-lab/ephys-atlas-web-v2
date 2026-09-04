import type { CursorState, SliceAxis } from '../core/spatial.js';
import type { ComparisonTarget } from '../domain/comparison.js';
import type { ExactDatasetRef } from '../domain/types.js';

export interface ComparisonSpatialContext {
  readonly dataset: ExactDatasetRef;
  readonly target: ComparisonTarget;
  readonly normalizationId: string;
  readonly orientation: SliceAxis;
  readonly cursor: CursorState;
}

export interface ComparisonSpatialRequest extends ComparisonSpatialContext {
  readonly featureId: string;
}

export interface ComparisonSpatialPort<Payload> {
  loadSpatialPlane(request: ComparisonSpatialRequest, signal: AbortSignal): Promise<Payload>;
}

export type ComparisonItemState<Payload> =
  | { readonly featureId: string; readonly status: 'pending' | 'loading' }
  | { readonly featureId: string; readonly status: 'ready'; readonly payload: Payload }
  | { readonly featureId: string; readonly status: 'error'; readonly error: string };

export interface ComparisonSessionSnapshot<Payload> {
  readonly status: 'idle' | 'loading' | 'ready' | 'disposed';
  readonly context: ComparisonSpatialContext | null;
  readonly items: readonly ComparisonItemState<Payload>[];
}

function uniqueFeatureIds(featureIds: readonly string[]): readonly string[] {
  return [...new Set(featureIds.filter(Boolean))];
}

function copyContext(context: ComparisonSpatialContext): ComparisonSpatialContext {
  return {
    dataset: { ...context.dataset },
    target: { ...context.target },
    normalizationId: context.normalizationId,
    orientation: context.orientation,
    cursor: { ...context.cursor },
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ComparisonSession<Payload> {
  private generation = 0;
  private disposed = false;
  private status: ComparisonSessionSnapshot<Payload>['status'] = 'idle';
  private context: ComparisonSpatialContext | null = null;
  private order: readonly string[] = [];
  private readonly items = new Map<string, ComparisonItemState<Payload>>();
  private queue: string[] = [];
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly port: ComparisonSpatialPort<Payload>,
    private readonly changed: () => void,
    private readonly maximumConcurrentRequests = 4,
  ) {
    if (!Number.isSafeInteger(maximumConcurrentRequests) || maximumConcurrentRequests < 1) {
      throw new Error('comparison concurrency must be a positive safe integer');
    }
  }

  snapshot(): ComparisonSessionSnapshot<Payload> {
    return {
      status: this.status,
      context: this.context === null ? null : copyContext(this.context),
      items: this.order.flatMap((id) => {
        const item = this.items.get(id);
        return item ? [item] : [];
      }),
    };
  }

  setVisible(context: ComparisonSpatialContext, featureIds: readonly string[]): void {
    if (this.disposed) throw new Error('comparison session is disposed');
    this.cancelActive();
    const generation = ++this.generation;
    this.context = copyContext(context);
    this.order = uniqueFeatureIds(featureIds);
    this.queue = [...this.order];
    this.items.clear();
    for (const featureId of this.order) this.items.set(featureId, { featureId, status: 'pending' });
    this.status = this.queue.length > 0 ? 'loading' : 'ready';
    this.changed();
    this.pump(generation);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.cancelActive();
    this.context = null;
    this.order = [];
    this.queue = [];
    this.items.clear();
    this.status = 'disposed';
    this.changed();
  }

  private cancelActive(): void {
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
  }

  private pump(generation: number): void {
    while (
      !this.disposed
      && generation === this.generation
      && this.active.size < this.maximumConcurrentRequests
      && this.queue.length > 0
    ) {
      const featureId = this.queue.shift();
      if (featureId === undefined || this.context === null) break;
      const controller = new AbortController();
      this.active.set(featureId, controller);
      this.items.set(featureId, { featureId, status: 'loading' });
      const request = { ...copyContext(this.context), featureId };
      this.changed();
      if (!this.isCurrent(generation, featureId, controller)) return;
      void this.load(generation, request, controller);
    }
  }

  private async load(
    generation: number,
    request: ComparisonSpatialRequest,
    controller: AbortController,
  ): Promise<void> {
    try {
      const payload = await this.port.loadSpatialPlane(request, controller.signal);
      if (!this.isCurrent(generation, request.featureId, controller)) return;
      this.items.set(request.featureId, { featureId: request.featureId, status: 'ready', payload });
      this.changed();
    } catch (error) {
      if (!this.isCurrent(generation, request.featureId, controller) || controller.signal.aborted) return;
      this.items.set(request.featureId, { featureId: request.featureId, status: 'error', error: message(error) });
      this.changed();
    } finally {
      if (!this.isCurrent(generation, request.featureId, controller)) return;
      this.active.delete(request.featureId);
      this.pump(generation);
      if (this.queue.length === 0 && this.active.size === 0) {
        this.status = 'ready';
        this.changed();
      }
    }
  }

  private isCurrent(generation: number, featureId: string, controller: AbortController): boolean {
    return !this.disposed
      && generation === this.generation
      && this.active.get(featureId) === controller;
  }
}
