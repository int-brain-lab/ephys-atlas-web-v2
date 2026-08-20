import {
  decompressSvgPack,
  parseIndexedSvgPack,
  type SvgPackDescriptor,
  type SvgPackFragment,
} from './svg-pack.js';

export type IsvgWorkerRequest =
  | { readonly id: number; readonly op: 'load'; readonly compressed: ArrayBuffer; readonly descriptor: SvgPackDescriptor; readonly maxDecodedBytes?: number }
  | { readonly id: number; readonly op: 'get'; readonly packId: string; readonly sliceIndex: number }
  | { readonly id: number; readonly op: 'evict'; readonly packId: string };

export type IsvgWorkerResult = IsvgLoadResult | SvgPackFragment | null;

export type IsvgWorkerResponse =
  | { readonly id: number; readonly ok: true; readonly result: IsvgWorkerResult }
  | { readonly id: number; readonly ok: false; readonly error: string };

export interface IsvgLoadResult {
  readonly projection: string;
  readonly packId: string;
  readonly sliceCount: number;
  readonly decodedBytes: number;
  readonly evictedPackIds: readonly string[];
}

interface ResidentPack {
  readonly packId: string;
  readonly projection: string;
  readonly decodedBytes: number;
  readonly pack: ReturnType<typeof parseIndexedSvgPack>;
}

const DEFAULT_MAX_DECODED_BYTES = 32 * 1024 * 1024;
const resident = new Map<string, ResidentPack>();
let maxDecodedBytes = DEFAULT_MAX_DECODED_BYTES;
let decodedBytes = 0;

function touch(packId: string): ResidentPack | undefined {
  const value = resident.get(packId);
  if (!value) return undefined;
  resident.delete(packId);
  resident.set(packId, value);
  return value;
}

function evictUntilFits(incoming: number): string[] {
  const evicted: string[] = [];
  while (resident.size && decodedBytes + incoming > maxDecodedBytes) {
    const oldest = resident.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const value = resident.get(oldest)!;
    resident.delete(oldest);
    decodedBytes -= value.decodedBytes;
    evicted.push(oldest);
  }
  return evicted;
}

function loadPack(compressed: ArrayBuffer, descriptor: SvgPackDescriptor, requestedMax?: number): Promise<IsvgLoadResult> {
  if (requestedMax !== undefined) {
    if (!Number.isSafeInteger(requestedMax) || requestedMax <= 0) throw new Error('maxDecodedBytes must be a positive integer');
    maxDecodedBytes = requestedMax;
  }
  return decompressSvgPack(compressed, descriptor).then((decoded) => {
    const parsed = parseIndexedSvgPack(decoded);
    if (parsed.projection !== descriptor.projection || parsed.packId !== descriptor.packId) {
      throw new Error(`SVG pack ${descriptor.packId} identity does not match its descriptor`);
    }
    if (descriptor.entries) {
      if (descriptor.entries.length !== parsed.entries.length) throw new Error(`SVG pack ${descriptor.packId} entry inventory does not match its descriptor`);
      descriptor.entries.forEach((expected, index) => {
        const actual = parsed.entries[index]!;
        if (actual.sliceIndex !== expected.sliceIndex || Math.abs(actual.worldCoordinateUm - expected.worldCoordinateUm) > 1e-6) {
          throw new Error(`SVG pack ${descriptor.packId} entry inventory does not match its descriptor`);
        }
      });
    }
    if (decoded.byteLength > maxDecodedBytes) {
      throw new Error(`SVG pack ${descriptor.packId} decoded size ${decoded.byteLength} exceeds maxDecodedBytes ${maxDecodedBytes}`);
    }
    const previous = resident.get(descriptor.packId);
    if (previous) {
      resident.delete(descriptor.packId);
      decodedBytes -= previous.decodedBytes;
    }
    const evictedPackIds = evictUntilFits(decoded.byteLength);
    resident.set(descriptor.packId, {
      packId: descriptor.packId,
      projection: parsed.projection,
      decodedBytes: decoded.byteLength,
      pack: parsed,
    });
    decodedBytes += decoded.byteLength;
    return {
      projection: parsed.projection,
      packId: parsed.packId,
      sliceCount: parsed.entries.length,
      decodedBytes: decoded.byteLength,
      evictedPackIds,
    };
  });
}

function handle(request: IsvgWorkerRequest): Promise<IsvgWorkerResult> {
  if (request.op === 'load') return loadPack(request.compressed, request.descriptor, request.maxDecodedBytes);
  if (request.op === 'evict') {
    const value = resident.get(request.packId);
    if (value) { resident.delete(request.packId); decodedBytes -= value.decodedBytes; }
    return Promise.resolve(null);
  }
  const value = touch(request.packId);
  return Promise.resolve(value?.pack.fragment(request.sliceIndex) ?? null);
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<IsvgWorkerRequest>) => void) | null;
  postMessage(message: IsvgWorkerResponse): void;
};

scope.onmessage = (event) => {
  const request = event.data;
  void handle(request).then(
    (result) => scope.postMessage({ id: request.id, ok: true, result }),
    (error: unknown) => scope.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
};
