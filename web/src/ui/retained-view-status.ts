import type { CursorState, ParcellationId, RepresentationKind, SliceAxis, StaticProjectionId } from '../domain/types.js';
import { OperationStatus, type OperationStatusUpdate } from './operation-status.js';

interface ViewContentIdentity {
  readonly datasetId: string;
  readonly releaseId: string | null;
  readonly representation: RepresentationKind;
  readonly featureRepresentation: RepresentationKind | null;
  readonly featureId: string | null;
  readonly parcellation: ParcellationId;
}

export type RetainedViewRequest =
  | { readonly kind: 'slice'; readonly content: ViewContentIdentity; readonly axis: SliceAxis;
      readonly sliceIndex: number; readonly cursor: CursorState; readonly coordinate: string }
  | { readonly kind: 'static'; readonly content: ViewContentIdentity; readonly projectionId: StaticProjectionId };

type Updating = 'feature' | 'slice' | 'static';
const SLICE_PROGRESS_DELAY_MS = 150;
const READY: OperationStatusUpdate = { state: 'ready', title: '' };

function sameGeometry(left: RetainedViewRequest | null, right: RetainedViewRequest): boolean {
  if (!left || left.kind !== right.kind) return false;
  const a = left.content, b = right.content;
  if (a.datasetId !== b.datasetId || a.releaseId !== b.releaseId || a.representation !== b.representation
    || a.featureRepresentation !== b.featureRepresentation || a.featureId !== b.featureId
    || a.parcellation !== b.parcellation) return false;
  return left.kind === 'slice' && right.kind === 'slice'
    ? left.axis === right.axis && left.sliceIndex === right.sliceIndex
    : left.kind === 'static' && right.kind === 'static' && left.projectionId === right.projectionId;
}

function sameRequest(left: RetainedViewRequest | null, right: RetainedViewRequest): boolean {
  if (!sameGeometry(left, right)) return false;
  return left?.kind === 'slice' && right.kind === 'slice'
    ? left.cursor.xUm === right.cursor.xUm && left.cursor.yUm === right.cursor.yUm && left.cursor.zUm === right.cursor.zUm
    : true;
}

/** UI request/status ownership only; viewports continue to own geometry and readiness. */
export class RetainedViewStatus {
  readonly initialStatus: OperationStatus;
  readonly updateStatus: OperationStatus;
  private requested: RetainedViewRequest | null = null;
  private displayed: RetainedViewRequest | null = null;
  private geometry: RetainedViewRequest | null = null;
  private generation = 0;
  private progressTimer: number | null = null;
  private pendingKind: Updating | null = null;
  private disposed = false;

  constructor(private readonly frame: HTMLElement, announcementHost: HTMLElement, private readonly headerStatus?: HTMLElement) {
    this.initialStatus = new OperationStatus('centered', announcementHost);
    this.updateStatus = new OperationStatus('compact', announcementHost);
  }

  get updating(): Updating | null { return this.pendingKind; }
  get displayedRequest(): RetainedViewRequest | null { return this.displayed; }

  begin(request: RetainedViewRequest): { token: number; geometryChanged: boolean } | null {
    if (this.disposed || sameRequest(this.requested, request)) return null;
    const geometryChanged = !sameGeometry(this.geometry, request);
    this.requested = request;
    this.geometry = request;
    return { token: ++this.generation, geometryChanged };
  }

  isCurrent(token: number): boolean { return !this.disposed && token === this.generation; }

  invalidate(): void {
    this.generation += 1;
    this.requested = null;
    this.geometry = null;
    this.clearProgress();
  }

  pending(kind: Updating, retained: boolean, status: OperationStatusUpdate, delayed = false): void {
    this.clearProgress();
    this.pendingKind = kind;
    this.frame.dataset.updating = kind === 'static' ? 'true' : kind;
    this.frame.setAttribute('aria-busy', 'true');
    this.update(retained, delayed ? READY : status);
    if (delayed) {
      // Guide-only changes may supersede the render token while the same
      // geometry remains pending. They must not suppress its delayed feedback.
      this.progressTimer = window.setTimeout(() => {
        this.progressTimer = null;
        if (this.disposed || this.pendingKind !== 'slice') return;
        this.frame.dataset.sliceProgress = 'true';
        this.headerStatus?.setAttribute('aria-label', 'Loading slice');
        this.update(retained, status);
      }, SLICE_PROGRESS_DELAY_MS);
    }
  }

  complete(token: number): boolean {
    if (!this.isCurrent(token)) return false;
    this.displayed = this.requested;
    this.clearProgress();
    this.pendingKind = null;
    delete this.frame.dataset.updating;
    this.frame.setAttribute('aria-busy', 'false');
    this.update(false, READY);
    return true;
  }

  error(kind: Updating, retained: boolean, status: OperationStatusUpdate): void {
    this.clearProgress();
    this.pendingKind = kind;
    this.frame.dataset.updating = kind === 'static' ? 'true' : kind;
    this.frame.setAttribute('aria-busy', 'false');
    this.update(retained, status);
  }

  update(retained: boolean, status: OperationStatusUpdate): void {
    this.initialStatus.update(retained ? READY : status);
    this.updateStatus.update(retained ? status : READY);
  }

  private clearProgress(): void {
    if (this.progressTimer !== null) window.clearTimeout(this.progressTimer);
    this.progressTimer = null;
    delete this.frame.dataset.sliceProgress;
    if (this.headerStatus?.getAttribute('aria-label') === 'Loading slice') this.headerStatus.removeAttribute('aria-label');
  }

  dispose(): void {
    this.invalidate();
    this.disposed = true;
    this.pendingKind = null;
    delete this.frame.dataset.updating;
    this.frame.setAttribute('aria-busy', 'false');
    this.update(false, READY);
  }
}
