import type { BinaryArrayDescriptor, BinaryDType } from '../contracts.js';
import { array, dtype, relativePath, SHA256 } from './primitives.js';

export function parseBinaryArray(value: unknown, context: string): BinaryArrayDescriptor {
  const item = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : (() => { throw new Error(`${context} must be an object`); })();
  const shape = array(item.shape, `${context}.shape`).map((dimension, index) => {
    if (typeof dimension !== 'number' || !Number.isInteger(dimension) || dimension < 0) {
      throw new Error(`${context}.shape[${index}] must be a non-negative integer`);
    }
    return dimension;
  });
  if (shape.length === 0) throw new Error(`${context}.shape must not be empty`);
  if (item.order !== 'C') throw new Error(`${context}.order must be C`);
  if (item.endianness !== 'little' && item.endianness !== 'not-applicable') {
    throw new Error(`${context}.endianness must be little or not-applicable`);
  }
  const descriptor: BinaryArrayDescriptor = {
    path: relativePath(item.path, `${context}.path`),
    dtype: dtype(item.dtype, `${context}.dtype`),
    shape,
    order: 'C',
    endianness: item.endianness,
  };
  if (item.sha256 !== undefined) {
    if (typeof item.sha256 !== 'string' || !SHA256.test(item.sha256)) {
      throw new Error(`${context}.sha256 must be 64 lowercase hexadecimal characters`);
    }
    descriptor.sha256 = item.sha256;
  }
  if (item.bytes !== undefined) {
    if (typeof item.bytes !== 'number' || !Number.isInteger(item.bytes) || item.bytes < 0) {
      throw new Error(`${context}.bytes must be a non-negative integer`);
    }
    descriptor.bytes = item.bytes;
  }
  return descriptor;
}

export function bytesPerElement(value: BinaryDType): number {
  return { int16: 2, int32: 4, uint16: 2, uint32: 4, float16: 2, float32: 4, float64: 8 }[value];
}

export function binaryBytes(descriptor: BinaryArrayDescriptor): number {
  return descriptor.shape.reduce((product, dimension) => product * dimension, 1) * bytesPerElement(descriptor.dtype);
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
