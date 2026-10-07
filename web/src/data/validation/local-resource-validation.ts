import type { BinaryArrayDescriptor, EncodedResourceDescriptor } from '../contracts.js';
import { binaryBytes } from './binary.js';
import { object, resolveRelativePath, string } from './primitives.js';
import { parseArtifactDescriptors } from './artifact.js';


/** Integrity, bounded decoding, and declared-resource accounting for local releases. */
interface ArtifactExpectation {
  path: string;
  bytes: number;
  sha256: string;
  decodedBytes: number;
  codec: 'none' | 'gzip';
  context: string;
}

export interface ResourceExpectation {
  path: string;
  context: string;
  bytes?: number;
  sha256?: string;
  decodedBytes?: number;
  codec?: 'none' | 'gzip';
}

export interface LocalDatasetValidationLimits {
  readonly maximumResourceDecodedBytes: number;
  readonly maximumDecodedBytes: number;
}

export const DEFAULT_LOCAL_DATASET_VALIDATION_LIMITS: LocalDatasetValidationLimits = Object.freeze({
  maximumResourceDecodedBytes: 256 * 1024 * 1024,
  maximumDecodedBytes: 3 * 1024 * 1024 * 1024,
});

export interface LocalDatasetValidationOptions {
  readonly signal?: AbortSignal;
  readonly limits?: LocalDatasetValidationLimits;
}

export interface DecodedBudget {
  total: number;
}

export function safeNonnegativeInteger(value: number, context: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${context} must be a safe non-negative integer`);
  return value;
}

export function checkedAdd(left: number, right: number, context: string): number {
  safeNonnegativeInteger(left, context);
  safeNonnegativeInteger(right, context);
  if (right > Number.MAX_SAFE_INTEGER - left) throw new Error(`${context} exceeds the safe integer range`);
  return left + right;
}

export function validationLimits(options: LocalDatasetValidationOptions): LocalDatasetValidationLimits {
  const limits = options.limits ?? DEFAULT_LOCAL_DATASET_VALIDATION_LIMITS;
  safeNonnegativeInteger(limits.maximumResourceDecodedBytes, 'Per-resource decoded byte limit');
  safeNonnegativeInteger(limits.maximumDecodedBytes, 'Aggregate decoded byte limit');
  return limits;
}

export function parseArtifacts(value: unknown, baseFile: string, context: string): ArtifactExpectation[] {
  return parseArtifactDescriptors(value, context).map((item, index) => {
    const resource = item.resource;
    const path = resolveRelativePath(
      baseFile,
      resource.path,
      `${context}[${index}].path`,
    );
    return {
      path,
      bytes: resource.bytes,
      sha256: resource.sha256,
      decodedBytes: resource.codec.decodedBytes,
      codec: resource.codec.name,
      context: `${context}[${index}]`,
    };
  });
}

async function readJsonResource(
  files: ReadonlyMap<string, Blob>,
  path: string,
  context: string,
  signal?: AbortSignal,
): Promise<unknown> {
  signal?.throwIfAborted();
  const file = files.get(path);
  if (!file) throw new Error(`Local dataset is missing ${path} (${context})`);
  try {
    const bytes = await decodedBuffer(file, 'none', path, file.size, signal);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${path} is not valid JSON: ${error.message}`);
    throw error;
  }
}

export async function parseJsonResource(
  files: ReadonlyMap<string, Blob>,
  path: string,
  context: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return object(await readJsonResource(files, path, context, signal), context);
}

export async function sha256Hex(blob: Blob, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const reader = blob.stream().getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => { void reader.cancel(signal?.reason); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (!value) continue;
      length = checkedAdd(length, value.byteLength, 'SHA-256 input byte length');
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  signal?.throwIfAborted();
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    signal?.throwIfAborted();
    const chunk = chunks[index]!;
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
    chunks[index] = new Uint8Array();
  }
  chunks.length = 0;
  // WebCrypto has no cancellable digest API. The signal is checked immediately
  // before and after this bounded encoded-resource operation.
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  signal?.throwIfAborted();
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

class DecodedLengthError extends Error {}

async function decodedResource(
  blob: Blob,
  codec: 'none' | 'gzip',
  path: string,
  expectedBytes: number,
  signal: AbortSignal | undefined,
  collect: boolean,
): Promise<number | ArrayBuffer> {
  signal?.throwIfAborted();
  safeNonnegativeInteger(expectedBytes, `${path} decoded byte length`);
  if (codec === 'none') {
    if (blob.size !== expectedBytes) {
      throw new DecodedLengthError(`${path} decodes to ${blob.size} bytes; expected ${expectedBytes}`);
    }
    if (!collect) return blob.size;
    const bytes = await blob.arrayBuffer();
    signal?.throwIfAborted();
    return bytes;
  }
  if (!('DecompressionStream' in globalThis)) {
    throw new Error(`Cannot validate gzip resource ${path}: DecompressionStream is unavailable`);
  }
  const output = collect ? new Uint8Array(expectedBytes) : undefined;
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const abort = () => { void reader.cancel(signal?.reason); };
  signal?.addEventListener('abort', abort, { once: true });
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (!value) continue;
      if (value.byteLength > expectedBytes - total) {
        await reader.cancel();
        throw new DecodedLengthError(`${path} decodes to more than ${expectedBytes} bytes`);
      }
      output?.set(value, total);
      total += value.byteLength;
    }
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof DecodedLengthError) throw error;
    throw new Error(`Local resource ${path} is not valid gzip data`);
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  signal?.throwIfAborted();
  if (total !== expectedBytes) throw new DecodedLengthError(`${path} decodes to ${total} bytes; expected ${expectedBytes}`);
  return output?.buffer ?? total;
}

async function decodedByteLength(
  blob: Blob,
  codec: 'none' | 'gzip',
  path: string,
  expectedBytes: number,
  signal?: AbortSignal,
): Promise<number> {
  return await decodedResource(blob, codec, path, expectedBytes, signal, false) as number;
}

export async function decodedBuffer(
  blob: Blob,
  codec: 'none' | 'gzip',
  path: string,
  expectedBytes: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  return await decodedResource(blob, codec, path, expectedBytes, signal, true) as ArrayBuffer;
}

export function addResource(
  resources: Map<string, ResourceExpectation>,
  expectation: ResourceExpectation,
  budget: DecodedBudget,
  limits: LocalDatasetValidationLimits,
): void {
  if (expectation.bytes !== undefined) safeNonnegativeInteger(expectation.bytes, `${expectation.path} encoded byte length`);
  if (expectation.decodedBytes !== undefined) {
    safeNonnegativeInteger(expectation.decodedBytes, `${expectation.path} decoded byte length`);
    if (expectation.decodedBytes > limits.maximumResourceDecodedBytes) {
      throw new Error(`${expectation.path} exceeds the per-resource decoded-size limit`);
    }
  }
  const existing = resources.get(expectation.path);
  if (!existing) {
    const decodedBytes = expectation.decodedBytes ?? expectation.bytes ?? 0;
    if (decodedBytes > limits.maximumDecodedBytes - budget.total) {
      throw new Error('Local dataset exceeds its aggregate decoded-size limit');
    }
    budget.total += decodedBytes;
    resources.set(expectation.path, expectation);
    return;
  }
  for (const key of ['bytes', 'sha256', 'decodedBytes', 'codec'] as const) {
    const previous = existing[key];
    const next = expectation[key];
    if (previous !== undefined && next !== undefined && previous !== next) {
      throw new Error(`Inconsistent declarations for ${expectation.path}: ${existing.context} and ${expectation.context}`);
    }
  }
  const mergedBytes = expectation.bytes ?? existing.bytes;
  const mergedSha256 = expectation.sha256 ?? existing.sha256;
  const mergedDecodedBytes = expectation.decodedBytes ?? existing.decodedBytes;
  const mergedCodec = expectation.codec ?? existing.codec;
  const merged: ResourceExpectation = {
    path: expectation.path,
    context: `${existing.context}; ${expectation.context}`,
    ...(mergedBytes === undefined ? {} : { bytes: mergedBytes }),
    ...(mergedSha256 === undefined ? {} : { sha256: mergedSha256 }),
    ...(mergedDecodedBytes === undefined ? {} : { decodedBytes: mergedDecodedBytes }),
    ...(mergedCodec === undefined ? {} : { codec: mergedCodec }),
  };
  const previousContribution = existing.decodedBytes ?? existing.bytes ?? 0;
  const mergedContribution = merged.decodedBytes ?? merged.bytes ?? 0;
  if (mergedContribution > limits.maximumResourceDecodedBytes) {
    throw new Error(`${expectation.path} exceeds the per-resource decoded-size limit`);
  }
  const totalWithoutExisting = budget.total - previousContribution;
  if (mergedContribution > limits.maximumDecodedBytes - totalWithoutExisting) {
    throw new Error('Local dataset exceeds its aggregate decoded-size limit');
  }
  budget.total = totalWithoutExisting + mergedContribution;
  resources.set(expectation.path, merged);
}

export function addBinaryResource(
  resources: Map<string, ResourceExpectation>,
  baseFile: string,
  descriptor: BinaryArrayDescriptor,
  context: string,
  budget: DecodedBudget,
  limits: LocalDatasetValidationLimits,
): string {
  const path = resolveRelativePath(baseFile, descriptor.path, context);
  const expectedBytes = binaryBytes(descriptor);
  if (descriptor.codec.decodedBytes !== expectedBytes) {
    throw new Error(`${context}.bytes is ${descriptor.bytes}; dtype and shape require ${expectedBytes}`);
  }
  addResource(resources, {
    path,
    context,
    bytes: descriptor.bytes,
    sha256: descriptor.sha256,
    decodedBytes: expectedBytes,
    codec: descriptor.codec.name,
  }, budget, limits);
  return path;
}

export function addEncodedResource(
  resources: Map<string, ResourceExpectation>,
  baseFile: string,
  descriptor: EncodedResourceDescriptor,
  context: string,
  budget: DecodedBudget,
  limits: LocalDatasetValidationLimits,
): string {
  const path = resolveRelativePath(baseFile, descriptor.path, context);
  addResource(resources, {
    path,
    context,
    bytes: descriptor.bytes,
    sha256: descriptor.sha256,
    decodedBytes: descriptor.codec.decodedBytes,
    codec: descriptor.codec.name,
  }, budget, limits);
  return path;
}

export async function validateEncodedResource(
  file: Blob,
  resource: ResourceExpectation,
  verified: Set<string>,
  signal?: AbortSignal,
): Promise<void> {
  if (resource.bytes !== undefined && file.size !== resource.bytes) {
    throw new Error(`${resource.path} has ${file.size} bytes; expected ${resource.bytes}`);
  }
  if (!verified.has(resource.path) && resource.sha256) {
    if (await sha256Hex(file, signal) !== resource.sha256) throw new Error(`SHA-256 mismatch for ${resource.path}`);
    verified.add(resource.path);
  }
}

export async function readDeclaredJsonResource(
  files: ReadonlyMap<string, Blob>,
  resource: ResourceExpectation,
  context: string,
  verified: Set<string>,
  decodedVerified: Set<string>,
  signal?: AbortSignal,
): Promise<unknown> {
  const file = files.get(resource.path);
  if (!file) throw new Error(`Local dataset is missing ${resource.path} (${resource.context})`);
  await validateEncodedResource(file, resource, verified, signal);
  const expectedBytes = resource.decodedBytes ?? resource.bytes ?? file.size;
  const bytes = await decodedBuffer(file, resource.codec ?? 'none', resource.path, expectedBytes, signal);
  decodedVerified.add(resource.path);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${resource.path} is not valid JSON (${context}): ${error.message}`);
    throw error;
  }
}

export async function validateResourceFiles(
  files: ReadonlyMap<string, Blob>,
  resources: ReadonlyMap<string, ResourceExpectation>,
  verified: Set<string>,
  decodedVerified: Set<string>,
  signal?: AbortSignal,
): Promise<void> {
  for (const resource of resources.values()) {
    signal?.throwIfAborted();
    const file = files.get(resource.path);
    if (!file) throw new Error(`Local dataset is missing ${resource.path} (${resource.context})`);
    await validateEncodedResource(file, resource, verified, signal);
    if (resource.decodedBytes !== undefined && !decodedVerified.has(resource.path)) {
      await decodedByteLength(file, resource.codec ?? 'none', resource.path, resource.decodedBytes, signal);
      decodedVerified.add(resource.path);
    }
  }
}

/** Validate the complete browser-supported schema-v1 graph before IndexedDB is mutated. */
