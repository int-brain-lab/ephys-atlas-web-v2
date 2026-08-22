import type { EncodedResourceV1, MeshDecoderV1 } from '../../data/schema-v1.js';
import { decodeMeshLod, meshChunksByteLength, type MeshChunk } from './mesh-pack-codec.js';

export type MeshWorkerRequest =
  | { readonly id: number; readonly op: 'decode'; readonly compressed: ArrayBuffer; readonly resource: EncodedResourceV1; readonly decoder: MeshDecoderV1; readonly maxDecodedBytes: number }
  | { readonly id: number; readonly op: 'cancel' };

export type MeshWorkerResponse =
  | { readonly id: number; readonly ok: true; readonly chunks: readonly MeshChunk[]; readonly byteLength: number }
  | { readonly id: number; readonly ok: false; readonly error: string };

const cancelled = new Set<number>();
const active = new Set<number>();

async function decompress(compressed: ArrayBuffer, resource: EncodedResourceV1): Promise<Uint8Array> {
  if (resource.codec.name !== 'gzip') throw new Error('Mesh LOD resource must use explicit gzip');
  if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot decode gzip mesh resources');
  const stream = new Response(compressed).body;
  if (!stream) throw new Error('Mesh LOD has no readable body');
  const decoded = await new Response(stream.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  if (decoded.byteLength !== resource.codec.decoded_bytes) throw new Error('Mesh LOD decoded length differs from its descriptor');
  return new Uint8Array(decoded);
}

export async function decodeMeshWorkerRequest(request: Extract<MeshWorkerRequest, { op: 'decode' }>): Promise<{ chunks: readonly MeshChunk[]; byteLength: number }> {
  if (!Number.isSafeInteger(request.maxDecodedBytes) || request.maxDecodedBytes <= 0) throw new Error('Mesh decoded byte budget must be a positive integer');
  if (request.resource.codec.decoded_bytes > request.maxDecodedBytes) throw new Error('Mesh LOD declared decoded size exceeds the CPU budget');
  const decoded = await decompress(request.compressed, request.resource);
  const chunks = await decodeMeshLod(decoded, request.decoder);
  const byteLength = meshChunksByteLength(chunks);
  if (byteLength > request.maxDecodedBytes) throw new Error('Mesh LOD decoded arrays exceed the CPU budget');
  return { chunks, byteLength };
}

function transferables(chunks: readonly MeshChunk[]): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  for (const chunk of chunks) {
    for (const array of [chunk.positions, chunk.normals, chunk.featureIds, chunk.indices]) {
      if (array.buffer instanceof ArrayBuffer) buffers.add(array.buffer);
    }
  }
  return [...buffers];
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<MeshWorkerRequest>) => void) | null;
  postMessage(message: MeshWorkerResponse, transfer?: Transferable[]): void;
};

scope.onmessage = (event) => {
  const request = event.data;
  if (request.op === 'cancel') {
    if (active.has(request.id)) cancelled.add(request.id);
    return;
  }
  active.add(request.id);
  void decodeMeshWorkerRequest(request).then(
    ({ chunks, byteLength }) => {
      active.delete(request.id);
      if (cancelled.delete(request.id)) return;
      scope.postMessage({ id: request.id, ok: true, chunks, byteLength }, transferables(chunks));
    },
    (error: unknown) => {
      active.delete(request.id);
      if (cancelled.delete(request.id)) return;
      scope.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    },
  );
};
