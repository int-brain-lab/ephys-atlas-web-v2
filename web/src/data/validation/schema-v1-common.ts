/** Schema-v1 common semantic checks; the release contract is unchanged. */


export function fail(message: string): never {
  throw new Error(`schema v1: ${message}`);
}

export function object(value: unknown, context: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${context} must be an object`);
  return value as JsonObject;
}

export function array(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) fail(`${context} must be an array`);
  return value;
}

export function numberArray(value: unknown, length: number, context: string): number[] {
  const result = array(value, context);
  if (result.length !== length || result.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    fail(`${context} must contain ${length} finite numbers`);
  }
  return result as number[];
}

export function integers(value: unknown, context: string): number[] {
  const result = array(value, context);
  if (result.some((item) => typeof item !== 'number' || !Number.isInteger(item))) fail(`${context} must contain integers`);
  return result as number[];
}

export function required(record: JsonObject, keys: readonly string[], context: string): void {
  for (const key of keys) if (!(key in record)) fail(`${context} is missing ${key}`);
}

export function exactKeys(record: JsonObject, keys: readonly string[], context: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) if (!allowed.has(key)) fail(`${context} contains unsupported ${key}`);
  required(record, keys, context);
}

export function allowedKeys(
  record: JsonObject,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  context: string,
): void {
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of Object.keys(record)) if (!allowed.has(key)) fail(`${context} contains unsupported ${key}`);
  required(record, requiredKeys, context);
}

export function expect(value: unknown, expected: unknown, context: string): void {
  if (value !== expected) fail(`${context} must equal ${String(expected)}`);
}

export function unique(values: readonly unknown[], context: string): void {
  const normalized = values.map((value) => JSON.stringify(value));
  if (new Set(normalized).size !== normalized.length) fail(`duplicate ${context}`);
}

export function product(values: readonly number[]): number {
  return values.reduce((total, value) => total * value, 1);
}

export function increasing(values: readonly number[], context: string): void {
  if (values.some((value) => !Number.isFinite(value))) fail(`${context} must be finite`);
  if (values.slice(1).some((value, index) => values[index] === undefined || values[index]! >= value)) {
    fail(`${context} must be strictly increasing`);
  }
}

export function resourceSemantics(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) resourceSemantics(child);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as JsonObject;
  if (['path', 'media_type', 'bytes', 'sha256', 'codec'].every((key) => key in record)) {
    const codec = object(record.codec, 'resource codec');
    exactKeys(record, ['path', 'media_type', 'bytes', 'sha256', 'codec'], 'encoded resource');
    if (typeof record.path !== 'string' || !record.path || record.path.startsWith('/')
      || record.path.split('/').includes('..')) fail('encoded resource path is invalid');
    if (typeof record.media_type !== 'string' || !record.media_type) fail('encoded resource media type is invalid');
    if (!Number.isSafeInteger(record.bytes) || Number(record.bytes) < 0) fail('encoded resource byte length is invalid');
    if (typeof record.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(record.sha256)) fail('encoded resource SHA-256 is invalid');
    allowedKeys(codec, ['name', 'decoded_bytes'], ['level'], 'resource codec');
    if (!Number.isSafeInteger(codec.decoded_bytes) || Number(codec.decoded_bytes) < 0) fail('decoded resource byte length is invalid');
    required(codec, ['name', 'decoded_bytes'], 'resource codec');
    if (codec.name === 'none') {
      if (codec.decoded_bytes !== record.bytes) fail('uncompressed resource has unequal encoded and decoded lengths');
      if ('level' in codec) fail('uncompressed resource cannot declare compression level');
    } else if (codec.name !== 'gzip') fail('unsupported resource codec');
  }
  if (record.format === 'raw-binary-array-v1') {
    required(record, ['resource', 'dtype', 'shape', 'order', 'endianness'], 'binary array');
    const dtype = String(record.dtype);
    const bytes = DTYPE_BYTES[dtype];
    if (bytes === undefined) fail(`unsupported binary dtype ${dtype}`);
    const shape = integers(record.shape, 'binary shape');
    const resource = object(record.resource, 'binary resource');
    const codec = object(resource.codec, 'binary codec');
    if (codec.decoded_bytes !== product(shape) * bytes) fail('binary decoded length does not match dtype and shape');
    const endianness = dtype === 'uint8' ? 'not-applicable' : 'little';
    expect(record.endianness, endianness, 'binary endianness');
  }
  for (const child of Object.values(record)) resourceSemantics(child);
}

export type JsonObject = Record<string, unknown>;

export const DTYPE_BYTES: Readonly<Record<string, number>> = {
  uint8: 1,
  int16: 2,
  uint16: 2,
  float16: 2,
  int32: 4,
  uint32: 4,
  float32: 4,
  float64: 8,
};
