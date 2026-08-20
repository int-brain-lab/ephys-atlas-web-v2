import {
  decodeAnatomyPack,
  type AnatomyPackDecodeContext,
  type DecodedAnatomyPack,
} from './generated-anatomy-pack-codec.js';
import type { AnatomyPackWorkerResponse } from './generated-anatomy-pack-worker.js';

export interface AnatomyPackDecoder {
  readonly offThread: boolean;
  decode(compressed: ArrayBuffer, context: AnatomyPackDecodeContext): Promise<DecodedAnatomyPack>;
  dispose(): void;
}

class InlineAnatomyPackDecoder implements AnatomyPackDecoder {
  readonly offThread = false;

  decode(compressed: ArrayBuffer, context: AnatomyPackDecodeContext): Promise<DecodedAnatomyPack> {
    return decodeAnatomyPack(compressed, context);
  }

  dispose(): void {}
}

class WorkerAnatomyPackDecoder implements AnatomyPackDecoder {
  readonly offThread = true;
  private readonly worker = new Worker(new URL('./generated-anatomy-pack-worker.ts', import.meta.url), {
    type: 'module',
    name: 'anatomy-pack-decoder',
  });
  private readonly pending = new Map<number, {
    resolve: (result: DecodedAnatomyPack) => void;
    reject: (error: Error) => void;
  }>();
  private nextId = 1;
  private disposed = false;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<AnatomyPackWorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new Error(response.error));
    };
    this.worker.onerror = (event) => {
      this.failAll(new Error(event.message || 'Anatomy pack worker failed'));
    };
    this.worker.onmessageerror = () => {
      this.failAll(new Error('Anatomy pack worker returned an unreadable message'));
    };
  }

  decode(compressed: ArrayBuffer, context: AnatomyPackDecodeContext): Promise<DecodedAnatomyPack> {
    if (this.disposed) return Promise.reject(new Error('Anatomy pack decoder has been disposed'));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, compressed, context }, [compressed]);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    this.failAll(new Error('Anatomy pack decoder was disposed'));
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export function createAnatomyPackDecoder(): AnatomyPackDecoder {
  return typeof Worker === 'function' ? new WorkerAnatomyPackDecoder() : new InlineAnatomyPackDecoder();
}
