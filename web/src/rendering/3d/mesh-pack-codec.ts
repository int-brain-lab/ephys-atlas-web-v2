import { MeshoptDecoder } from 'meshoptimizer';
import type { MeshDecoderV1, MeshHemisphereV1 } from '../../data/schema-v1.js';

export interface MeshRange {
  readonly featureId: number;
  readonly signedAllenId: number;
  readonly signedExplodeGroupId: number;
  readonly indexStart: number;
  readonly indexCount: number;
  readonly vertexStart: number;
  readonly vertexCount: number;
}

export interface MeshChunk {
  readonly hemisphere: MeshHemisphereV1;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly featureIds: Uint16Array;
  readonly indices: Uint32Array;
  readonly ranges: readonly MeshRange[];
}

type ArrayDescriptor = Readonly<{
  byte_offset: number;
  count: number;
  component_type: string;
  item_size: number;
}>;

type BlockDescriptor = Readonly<{
  byte_offset: number;
  byte_length: number;
  codec: string;
  stride: number;
}>;

interface HeaderRange {
  feature_id: number;
  signed_allen_id: number;
  signed_explode_group_id: number;
  index_start: number;
  index_count: number;
  vertex_start: number;
  vertex_count: number;
}

interface HeaderChunk {
  hemisphere: MeshHemisphereV1;
  ranges: HeaderRange[];
  arrays?: Record<string, ArrayDescriptor>;
  vertex_count?: number;
  index_count?: number;
  bounds?: { minimum_um: [number, number, number]; maximum_um: [number, number, number] };
  blocks?: Record<string, BlockDescriptor>;
}

interface MeshHeader {
  encoding: string;
  chunks: HeaderChunk[];
}

const PREFIX_BYTES = 12;

function integer(value: unknown, context: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new Error(`${context} is invalid`);
  return Number(value);
}

function ranges(value: unknown, vertexCount: number, indexCount: number): MeshRange[] {
  if (!Array.isArray(value)) throw new Error('Mesh range inventory is invalid');
  const features = new Set<number>();
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') throw new Error('Mesh range is invalid');
    const item = candidate as Partial<HeaderRange>;
    const featureId = integer(item.feature_id, 'Mesh range feature ID');
    if (features.has(featureId)) throw new Error(`Mesh range feature ${featureId} is duplicated`);
    features.add(featureId);
    const indexStart = integer(item.index_start, 'Mesh range index start');
    const indexCountValue = integer(item.index_count, 'Mesh range index count', 1);
    const vertexStart = integer(item.vertex_start, 'Mesh range vertex start');
    const vertexCountValue = integer(item.vertex_count, 'Mesh range vertex count', 1);
    if (indexStart + indexCountValue > indexCount || indexCountValue % 3) throw new Error(`Mesh range ${featureId} indices are out of bounds`);
    if (vertexStart + vertexCountValue > vertexCount) throw new Error(`Mesh range ${featureId} vertices are out of bounds`);
    const signedAllenId = integer(Math.abs(Number(item.signed_allen_id)), 'Mesh range Allen identity', 1) * (Number(item.signed_allen_id) < 0 ? -1 : 1);
    const signedExplodeGroupId = integer(Math.abs(Number(item.signed_explode_group_id)), 'Mesh range explode identity', 1) * (Number(item.signed_explode_group_id) < 0 ? -1 : 1);
    return { featureId, signedAllenId, signedExplodeGroupId, indexStart, indexCount: indexCountValue, vertexStart, vertexCount: vertexCountValue };
  });
}

function typedArray<T extends Float32Array | Uint16Array | Uint32Array>(
  data: Uint8Array,
  payloadOffset: number,
  descriptor: ArrayDescriptor | undefined,
  Type: { new(buffer: ArrayBufferLike, byteOffset: number, length: number): T; BYTES_PER_ELEMENT: number },
  componentType: string,
  itemSize: number,
): T {
  if (!descriptor || descriptor.component_type !== componentType || descriptor.item_size !== itemSize) throw new Error(`Mesh ${componentType} array descriptor is invalid`);
  const byteOffset = data.byteOffset + payloadOffset + integer(descriptor.byte_offset, 'Mesh array byte offset');
  const count = integer(descriptor.count, 'Mesh array count');
  const byteLength = count * Type.BYTES_PER_ELEMENT;
  if (byteOffset % Type.BYTES_PER_ELEMENT || byteOffset + byteLength > data.byteOffset + data.byteLength) throw new Error(`Mesh ${componentType} array is out of bounds`);
  return new Type(data.buffer, byteOffset, count);
}

function block(data: Uint8Array, payloadOffset: number, descriptor: BlockDescriptor | undefined, codec: string, stride: number): Uint8Array {
  if (!descriptor || descriptor.codec !== codec || descriptor.stride !== stride) throw new Error(`Mesh ${codec} block descriptor is invalid`);
  const start = payloadOffset + integer(descriptor.byte_offset, `Mesh ${codec} offset`);
  const end = start + integer(descriptor.byte_length, `Mesh ${codec} length`, 1);
  if (end > data.byteLength) throw new Error(`Mesh ${codec} block is out of bounds`);
  return data.subarray(start, end);
}

function validateChunk(chunk: MeshChunk): MeshChunk {
  const vertexCount = chunk.featureIds.length;
  if (chunk.positions.length !== vertexCount * 3 || chunk.normals.length !== vertexCount * 3 || chunk.indices.length % 3) throw new Error('Mesh chunk array counts are inconsistent');
  if ([...chunk.indices].some((index) => index >= vertexCount)) throw new Error('Mesh chunk index is out of bounds');
  for (const range of chunk.ranges) {
    for (let index = range.vertexStart; index < range.vertexStart + range.vertexCount; index += 1) {
      if (chunk.featureIds[index] !== range.featureId) throw new Error(`Mesh range ${range.featureId} feature buffer differs`);
    }
  }
  return chunk;
}

function decodeRawChunk(data: Uint8Array, payloadOffset: number, chunk: HeaderChunk): MeshChunk {
  if (!chunk.arrays) throw new Error('Mesh raw chunk arrays are missing');
  const positions = typedArray(data, payloadOffset, chunk.arrays.positions, Float32Array, 'float32', 3);
  const normals = typedArray(data, payloadOffset, chunk.arrays.normals, Float32Array, 'float32', 3);
  const featureIds = typedArray(data, payloadOffset, chunk.arrays.feature_ids, Uint16Array, 'uint16', 1);
  const indices = typedArray(data, payloadOffset, chunk.arrays.indices, Uint32Array, 'uint32', 1);
  return validateChunk({ hemisphere: chunk.hemisphere, positions, normals, featureIds, indices, ranges: ranges(chunk.ranges, featureIds.length, indices.length) });
}

function finiteVector(value: unknown, context: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) throw new Error(`${context} is invalid`);
  return value as [number, number, number];
}

function decodeMeshoptChunk(data: Uint8Array, payloadOffset: number, chunk: HeaderChunk): MeshChunk {
  const vertexCount = integer(chunk.vertex_count, 'Meshopt vertex count', 1);
  const indexCount = integer(chunk.index_count, 'Meshopt index count', 3);
  if (indexCount % 3 || !chunk.blocks || !chunk.bounds) throw new Error('Meshopt chunk descriptor is incomplete');
  const minimum = finiteVector(chunk.bounds.minimum_um, 'Meshopt minimum bounds');
  const maximum = finiteVector(chunk.bounds.maximum_um, 'Meshopt maximum bounds');
  if (minimum.some((value, axis) => value > maximum[axis]!)) throw new Error('Meshopt bounds are inverted');
  const vertexBytes = new Uint8Array(vertexCount * 8);
  const normalBytes = new Uint8Array(vertexCount * 4);
  const indices = new Uint32Array(indexCount);
  MeshoptDecoder.decodeVertexBuffer(vertexBytes, vertexCount, 8, block(data, payloadOffset, chunk.blocks.vertices, 'meshopt-vertex', 8));
  MeshoptDecoder.decodeVertexBuffer(normalBytes, vertexCount, 4, block(data, payloadOffset, chunk.blocks.normals, 'meshopt-oct', 4), 'OCTAHEDRAL');
  MeshoptDecoder.decodeIndexBuffer(new Uint8Array(indices.buffer), indexCount, 4, block(data, payloadOffset, chunk.blocks.indices, 'meshopt-index', 4));
  const vertices = new Uint16Array(vertexBytes.buffer);
  const signedNormals = new Int8Array(normalBytes.buffer);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const featureIds = new Uint16Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      positions[vertex * 3 + axis] = minimum[axis]! + (maximum[axis]! - minimum[axis]!) * vertices[vertex * 4 + axis]! / 16383;
      normals[vertex * 3 + axis] = signedNormals[vertex * 4 + axis]! / 127;
    }
    featureIds[vertex] = vertices[vertex * 4 + 3]!;
  }
  return validateChunk({ hemisphere: chunk.hemisphere, positions, normals, featureIds, indices, ranges: ranges(chunk.ranges, vertexCount, indexCount) });
}

export async function decodeMeshLod(data: Uint8Array, decoder: MeshDecoderV1): Promise<readonly MeshChunk[]> {
  if (data.byteLength < PREFIX_BYTES) throw new Error('Mesh LOD is truncated');
  if (new TextDecoder().decode(data.subarray(0, 4)) !== decoder.container) throw new Error('Mesh LOD magic differs from decoder contract');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(4, true) !== decoder.container_version) throw new Error('Mesh LOD version differs from decoder contract');
  const headerLength = view.getUint32(8, true);
  const payloadOffset = Math.ceil((PREFIX_BYTES + headerLength) / 4) * 4;
  if (headerLength === 0 || payloadOffset > data.byteLength) throw new Error('Mesh LOD header is truncated');
  let header: MeshHeader;
  try {
    header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(PREFIX_BYTES, PREFIX_BYTES + headerLength))) as MeshHeader;
  } catch (error) {
    throw new Error('Mesh LOD header is invalid', { cause: error });
  }
  if (header.encoding !== decoder.encoding || !Array.isArray(header.chunks)) throw new Error('Mesh LOD encoding differs from decoder contract');
  if (header.encoding === 'meshopt-quantized-v1') await MeshoptDecoder.ready;
  const chunks = header.chunks.map((chunk) => {
    if (chunk.hemisphere !== 'left' && chunk.hemisphere !== 'right') throw new Error('Mesh chunk hemisphere is invalid');
    return header.encoding === 'raw-v1' ? decodeRawChunk(data, payloadOffset, chunk) : decodeMeshoptChunk(data, payloadOffset, chunk);
  });
  if (chunks.length !== 2 || chunks[0]?.hemisphere !== 'left' || chunks[1]?.hemisphere !== 'right') throw new Error('Mesh LOD must contain ordered bilateral chunks');
  return chunks;
}

export function meshChunksByteLength(chunks: readonly MeshChunk[]): number {
  const buffers = new Set<ArrayBufferLike>();
  for (const chunk of chunks) {
    buffers.add(chunk.positions.buffer);
    buffers.add(chunk.normals.buffer);
    buffers.add(chunk.featureIds.buffer);
    buffers.add(chunk.indices.buffer);
  }
  return [...buffers].reduce((total, buffer) => total + buffer.byteLength, 0);
}
