import { decodeAnatomyPack, type AnatomyPackDecodeContext, type DecodedAnatomyPack } from './generated-anatomy-pack-codec.js';

interface DecodeRequest {
  id: number;
  compressed: ArrayBuffer;
  context: AnatomyPackDecodeContext;
}

export type AnatomyPackWorkerResponse =
  | { id: number; ok: true; result: DecodedAnatomyPack }
  | { id: number; ok: false; error: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent<DecodeRequest>) => void) | null;
  postMessage(message: AnatomyPackWorkerResponse): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { id, compressed, context } = event.data;
  void decodeAnatomyPack(compressed, context).then(
    (result) => scope.postMessage({ id, ok: true, result }),
    (error: unknown) => scope.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
};
