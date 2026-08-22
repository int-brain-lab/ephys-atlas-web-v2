import type { EncodedResourceV1, MeshDecoderV1 } from '../../data/schema-v1.js';
import type { MeshChunk } from './mesh-pack-codec.js';
import type { MeshWorkerRequest, MeshWorkerResponse } from './mesh-pack-worker.js';

export interface MeshWorkerLike {
  onmessage: ((event: MessageEvent<MeshWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: MeshWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface MeshDecodeResult {
  readonly chunks: readonly MeshChunk[];
  readonly byteLength: number;
}

export class MeshPackRuntime {
  private readonly worker: MeshWorkerLike;
  private readonly pending = new Map<number, { resolve(value: MeshDecodeResult): void; reject(error: Error): void; abort?: () => void }>();
  private nextId = 1;
  private disposed = false;

  constructor(worker?: MeshWorkerLike) {
    this.worker = worker ?? new Worker(new URL('./mesh-pack-worker.ts', import.meta.url), { type: 'module', name: 'atlas-mesh-pack' }) as MeshWorkerLike;
    this.worker.onmessage = (event) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      pending.abort?.();
      if (event.data.ok) pending.resolve({ chunks: event.data.chunks, byteLength: event.data.byteLength });
      else pending.reject(new Error(event.data.error));
    };
    this.worker.onerror = (event) => this.failAll(new Error(event.message || 'Mesh worker failed'));
    this.worker.onmessageerror = () => this.failAll(new Error('Mesh worker returned an unreadable message'));
  }

  decode(compressed: ArrayBuffer, resource: EncodedResourceV1, decoder: MeshDecoderV1, maxDecodedBytes: number, signal?: AbortSignal): Promise<MeshDecodeResult> {
    if (this.disposed) return Promise.reject(new Error('Mesh pack runtime was disposed'));
    if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const abort = signal ? () => {
        if (!this.pending.delete(id)) return;
        this.worker.postMessage({ id, op: 'cancel' });
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      } : undefined;
      if (abort) signal!.addEventListener('abort', abort, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        ...(abort ? { abort: () => signal!.removeEventListener('abort', abort) } : {}),
      });
      this.worker.postMessage({ id, op: 'decode', compressed, resource, decoder, maxDecodedBytes }, [compressed]);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    this.failAll(new Error('Mesh pack runtime was disposed'));
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.abort?.();
      pending.reject(error);
    }
    this.pending.clear();
  }
}
