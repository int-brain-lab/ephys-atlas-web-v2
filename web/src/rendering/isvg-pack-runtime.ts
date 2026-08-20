import type { SvgPackDescriptor, SvgPackFragment } from './svg-pack.js';
import type { IsvgLoadResult, IsvgWorkerRequest, IsvgWorkerResponse } from './isvg-pack-worker.js';

export interface IsvgPackRuntimeOptions {
  readonly maxDecodedBytes?: number;
  /** Test hook; production callers should let the runtime create its module worker. */
  readonly worker?: IsvgWorkerLike;
}

export interface IsvgWorkerLike {
  onmessage: ((event: MessageEvent<IsvgWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: IsvgWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}

export class IsvgPackRuntime {
  private readonly worker: IsvgWorkerLike;
  private readonly maxDecodedBytes: number;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private nextId = 1;
  private disposed = false;

  constructor(options: IsvgPackRuntimeOptions = {}) {
    this.maxDecodedBytes = options.maxDecodedBytes ?? 32 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxDecodedBytes) || this.maxDecodedBytes <= 0) throw new Error('maxDecodedBytes must be a positive integer');
    this.worker = options.worker ?? new Worker(new URL('./isvg-pack-worker.ts', import.meta.url), { type: 'module', name: 'indexed-svg-pack' }) as IsvgWorkerLike;
    this.worker.onmessage = (event) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      if (event.data.ok) pending.resolve(event.data.result);
      else pending.reject(new Error(event.data.error));
    };
    this.worker.onerror = (event) => this.failAll(new Error(event.message || 'Indexed SVG worker failed'));
    this.worker.onmessageerror = () => this.failAll(new Error('Indexed SVG worker returned an unreadable message'));
  }

  load(pack: SvgPackDescriptor, compressed: ArrayBuffer | Uint8Array): Promise<IsvgLoadResult> {
    const buffer = compressed instanceof Uint8Array
      ? (compressed.byteOffset === 0 && compressed.byteLength === compressed.buffer.byteLength && compressed.buffer instanceof ArrayBuffer
        ? compressed.buffer.slice(0)
        : compressed.slice().buffer) as ArrayBuffer
      : compressed;
    return this.request({ id: 0, op: 'load', compressed: buffer, descriptor: pack, maxDecodedBytes: this.maxDecodedBytes }, [buffer]) as Promise<IsvgLoadResult>;
  }

  loadPack(pack: SvgPackDescriptor, compressed: ArrayBuffer | Uint8Array): Promise<IsvgLoadResult> {
    return this.load(pack, compressed);
  }

  get(packId: string, sliceIndex: number): Promise<SvgPackFragment | null> {
    return this.request({ id: 0, op: 'get', packId, sliceIndex });
  }

  getFragment(packId: string, sliceIndex: number): Promise<SvgPackFragment | null> {
    return this.get(packId, sliceIndex);
  }

  evict(packId: string): Promise<void> {
    return this.request({ id: 0, op: 'evict', packId }).then(() => undefined);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    this.failAll(new Error('Indexed SVG pack runtime was disposed'));
  }

  private request(request: IsvgWorkerRequest, transfer: Transferable[] = []): Promise<any> {
    if (this.disposed) return Promise.reject(new Error('Indexed SVG pack runtime was disposed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...request, id } as IsvgWorkerRequest, transfer);
    });
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export function createIsvgPackRuntime(options: IsvgPackRuntimeOptions = {}): IsvgPackRuntime {
  return new IsvgPackRuntime(options);
}

export { IsvgPackRuntime as IndexedSvgPackRuntime };
export const createIndexedSvgPackRuntime = createIsvgPackRuntime;
