/** Experimental indexed transport for concatenated UTF-8 SVG fragments. */
export interface SvgPackFragment {
  readonly sliceIndex: number;
  readonly worldCoordinateUm: number;
  readonly svg: string;
}

export interface SvgPackEntry {
  readonly sliceIndex: number;
  readonly worldCoordinateUm: number;
  readonly offset: number;
  readonly length: number;
}

export interface IndexedSvgPack {
  readonly projection: string;
  readonly packId: string;
  readonly entries: readonly SvgPackEntry[];
  fragment(sliceIndex: number): SvgPackFragment | undefined;
}

/** Metadata needed by the indexed-pack worker before it accepts a pack. */
export interface SvgPackDescriptor {
  readonly projection: string;
  readonly packId: string;
  readonly uncompressedBytes: number;
  readonly entries?: readonly Pick<SvgPackEntry, 'sliceIndex' | 'worldCoordinateUm'>[];
}

export interface SvgPack {
  readonly projection: string;
  readonly packId: string;
  readonly fragments: readonly SvgPackFragment[];
}

const MAGIC = [0x49, 0x53, 0x56, 0x47];
const VERSION = 1;
const HEADER_SIZE = 28;
const ENTRY_SIZE = 20;
const MAX_COUNT = 1_000_000;

function fail(message: string): never {
  throw new Error(`Invalid SVG pack: ${message}`);
}

function decodeUtf8(decoder: TextDecoder, bytes: Uint8Array, label: string): string {
  try {
    return decoder.decode(bytes);
  } catch {
    return fail(`invalid ${label} UTF-8`);
  }
}

/** Parses only the header and fixed index. SVG text is decoded on lookup. */
export function parseIndexedSvgPack(input: ArrayBuffer | Uint8Array): IndexedSvgPack {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < HEADER_SIZE) fail('truncated header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const validHeader = MAGIC.every((value, index) => bytes[index] === value)
    && view.getUint8(4) === VERSION
    && view.getUint8(5) === 0
    && view.getUint16(6, true) === HEADER_SIZE;
  if (!validHeader) fail('bad magic, version, flags, or header size');

  const projectionLength = view.getUint16(8, true);
  const packIdLength = view.getUint16(10, true);
  const count = view.getUint32(12, true);
  const tableOffset = view.getUint32(16, true);
  const payloadOffset = view.getUint32(20, true);
  const payloadLength = view.getUint32(24, true);
  const stringsEnd = HEADER_SIZE + projectionLength + packIdLength;
  if (count > MAX_COUNT
    || tableOffset !== stringsEnd
    || payloadOffset !== tableOffset + count * ENTRY_SIZE
    || payloadOffset + payloadLength !== bytes.byteLength) {
    fail('invalid offsets or lengths');
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const projection = decodeUtf8(decoder, bytes.subarray(HEADER_SIZE, HEADER_SIZE + projectionLength), 'identity');
  const packId = decodeUtf8(decoder, bytes.subarray(HEADER_SIZE + projectionLength, stringsEnd), 'identity');
  if (!projection || !packId || projection.includes('\0') || packId.includes('\0')) fail('invalid identity');

  const entries: SvgPackEntry[] = [];
  let previousSliceIndex = -1;
  let expectedOffset = 0;
  for (let index = 0; index < count; index += 1) {
    const at = tableOffset + index * ENTRY_SIZE;
    const sliceIndex = view.getInt32(at, true);
    const worldCoordinateUm = view.getFloat64(at + 4, true);
    const offset = view.getUint32(at + 12, true);
    const length = view.getUint32(at + 16, true);
    if (sliceIndex <= previousSliceIndex
      || !Number.isFinite(worldCoordinateUm)
      || offset !== expectedOffset
      || length > payloadLength - offset) {
      fail('invalid fragment table entry');
    }
    entries.push({ sliceIndex, worldCoordinateUm, offset, length });
    previousSliceIndex = sliceIndex;
    expectedOffset += length;
  }
  if (expectedOffset !== payloadLength) fail('fragment table does not cover payload');

  return {
    projection,
    packId,
    entries,
    fragment(sliceIndex: number): SvgPackFragment | undefined {
      let low = 0;
      let high = entries.length - 1;
      let entry: SvgPackEntry | undefined;
      while (low <= high) {
        const middle = (low + high) >> 1;
        const candidate = entries[middle]!;
        if (candidate.sliceIndex === sliceIndex) { entry = candidate; break; }
        if (candidate.sliceIndex < sliceIndex) low = middle + 1;
        else high = middle - 1;
      }
      if (!entry) return undefined;
      const start = payloadOffset + entry.offset;
      return {
        sliceIndex: entry.sliceIndex,
        worldCoordinateUm: entry.worldCoordinateUm,
        svg: decodeUtf8(decoder, bytes.subarray(start, start + entry.length), 'SVG fragment'),
      };
    },
  };
}

/** Decompresses the gzip transport and verifies its declared uncompressed size. */
export async function decompressSvgPack(
  compressed: ArrayBuffer,
  descriptor: Pick<SvgPackDescriptor, 'packId' | 'uncompressedBytes'>,
): Promise<ArrayBuffer> {
  if (!('DecompressionStream' in globalThis)) {
    throw new Error(`SVG pack ${descriptor.packId} requires gzip DecompressionStream support`);
  }
  let decoded: ArrayBuffer;
  try {
    decoded = await new Response(
      new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).arrayBuffer();
  } catch (error) {
    throw new Error(`SVG pack ${descriptor.packId} could not be decompressed`, { cause: error });
  }
  if (decoded.byteLength !== descriptor.uncompressedBytes) {
    throw new Error(`SVG pack ${descriptor.packId} decodes to ${decoded.byteLength} bytes; expected ${descriptor.uncompressedBytes}`);
  }
  return decoded;
}

/** Full decoder used by validation and round-trip tests. */
export function decodeSvgPack(input: ArrayBuffer | Uint8Array): SvgPack {
  const indexed = parseIndexedSvgPack(input);
  return {
    projection: indexed.projection,
    packId: indexed.packId,
    fragments: indexed.entries.map((entry) => {
      const fragment = indexed.fragment(entry.sliceIndex);
      if (!fragment) return fail('indexed fragment disappeared');
      return fragment;
    }),
  };
}
