import type { BinaryArrayDescriptor, BinaryDType, EncodedResourceDescriptor } from '../contracts.js';
import { array, dtype, object, relativePath, SHA256, string } from './primitives.js';

function safeNonnegativeInteger(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${context} must be a non-negative safe integer`);
  }
  return value;
}

function safeProduct(values: readonly number[], context: string): number {
  return values.reduce((product, value) => {
    const next = product * value;
    if (!Number.isSafeInteger(next)) throw new Error(`${context} exceeds the safe integer range`);
    return next;
  }, 1);
}

export function parseEncodedResource(value: unknown, context: string): EncodedResourceDescriptor {
  const item = object(value, context);
  const codecRaw = object(item.codec, `${context}.codec`);
  if (codecRaw.name !== 'none' && codecRaw.name !== 'gzip') {
    throw new Error(`${context}.codec.name must be none or gzip`);
  }
  const decodedBytes = safeNonnegativeInteger(codecRaw.decoded_bytes, `${context}.codec.decoded_bytes`);
  const encodedBytes = safeNonnegativeInteger(item.bytes, `${context}.bytes`);
  if (typeof item.sha256 !== 'string' || !SHA256.test(item.sha256)) {
    throw new Error(`${context}.sha256 must be 64 lowercase hexadecimal characters`);
  }
  if (codecRaw.name === 'none' && decodedBytes !== encodedBytes) {
    throw new Error(`${context} uncompressed encoded and decoded byte lengths must match`);
  }
  const level = codecRaw.level;
  if (level !== undefined && (codecRaw.name !== 'gzip' || typeof level !== 'number' || !Number.isInteger(level) || level < 0 || level > 9)) {
    throw new Error(`${context}.codec.level is invalid`);
  }
  return {
    path: relativePath(item.path, `${context}.path`),
    mediaType: string(item.media_type, `${context}.media_type`),
    bytes: encodedBytes,
    sha256: item.sha256,
    codec: {
      name: codecRaw.name,
      decodedBytes,
      ...(level !== undefined ? { level } : {}),
    },
  };
}

export function parseBinaryArray(value: unknown, context: string): BinaryArrayDescriptor {
  const item = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : (() => { throw new Error(`${context} must be an object`); })();
  const shape = array(item.shape, `${context}.shape`).map((dimension, index) => {
    return safeNonnegativeInteger(dimension, `${context}.shape[${index}]`);
  });
  if (shape.length === 0) throw new Error(`${context}.shape must not be empty`);
  if (item.order !== 'C') throw new Error(`${context}.order must be C`);
  if (item.endianness !== 'little' && item.endianness !== 'not-applicable') {
    throw new Error(`${context}.endianness must be little or not-applicable`);
  }
  if (item.format !== 'raw-binary-array-v1') throw new Error(`${context}.format is unsupported`);
  const resource = parseEncodedResource(item.resource, `${context}.resource`);
  const parsedDtype = dtype(item.dtype, `${context}.dtype`);
  const expectedBytes = safeProduct([...shape, bytesPerElement(parsedDtype)], `${context}.shape byte product`);
  if (resource.codec.decodedBytes !== expectedBytes) {
    throw new Error(`${context} decoded bytes do not match dtype and shape`);
  }
  const descriptor: BinaryArrayDescriptor = {
    format: 'raw-binary-array-v1',
    ...resource,
    dtype: parsedDtype,
    shape,
    order: 'C',
    endianness: item.endianness,
  };
  return descriptor;
}

export function bytesPerElement(value: BinaryDType): number {
  return { uint8: 1, int16: 2, int32: 4, uint16: 2, uint32: 4, float16: 2, float32: 4, float64: 8 }[value];
}

export function binaryBytes(descriptor: BinaryArrayDescriptor): number {
  return safeProduct(
    [...descriptor.shape, bytesPerElement(descriptor.dtype)],
    `${descriptor.path} shape byte product`,
  );
}

export async function decodeResourceBytes(
  buffer: ArrayBuffer,
  descriptor: EncodedResourceDescriptor,
): Promise<ArrayBuffer> {
  if (descriptor.codec.name === 'none') return buffer;
  if (!('DecompressionStream' in globalThis)) throw new Error(`${descriptor.path} requires gzip support`);
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  const decoded = await new Response(stream).arrayBuffer();
  if (decoded.byteLength !== descriptor.codec.decodedBytes) {
    throw new Error(`${descriptor.path} decoded to ${decoded.byteLength} bytes; expected ${descriptor.codec.decodedBytes}`);
  }
  return decoded;
}

export function decodeBinaryArray(buffer: ArrayBuffer, descriptor: BinaryArrayDescriptor): number[] {
  const count = descriptor.shape.reduce((product, dimension) => product * dimension, 1);
  const elementBytes = bytesPerElement(descriptor.dtype);
  const expected = count * elementBytes;
  if (buffer.byteLength !== expected) {
    throw new Error(`${descriptor.path} has ${buffer.byteLength} bytes; expected ${expected}`);
  }
  const view = new DataView(buffer);
  const values = new Array<number>(count);
  for (let i = 0; i < count; i += 1) {
    const offset = i * elementBytes;
    switch (descriptor.dtype) {
      case 'uint8': values[i] = view.getUint8(offset); break;
      case 'int16': values[i] = view.getInt16(offset, true); break;
      case 'int32': values[i] = view.getInt32(offset, true); break;
      case 'uint16': values[i] = view.getUint16(offset, true); break;
      case 'uint32': values[i] = view.getUint32(offset, true); break;
      case 'float32': values[i] = view.getFloat32(offset, true); break;
      case 'float64': values[i] = view.getFloat64(offset, true); break;
      case 'float16': values[i] = float16ToNumber(view.getUint16(offset, true)); break;
    }
  }
  return values;
}

function float16ToNumber(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) return fraction === 0 ? sign * 0 : sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}
