import type { BinaryArrayDescriptor, EncodedResourceDescriptor } from './contracts.js';

/** Transport boundary for immutable release resources. */
export interface ResourceReader {
  resolve(base: string, relative: string): string;
  readJson(location: string, signal?: AbortSignal, resource?: EncodedResourceDescriptor): Promise<unknown>;
  readArray(location: string, descriptor: BinaryArrayDescriptor, signal?: AbortSignal): Promise<number[]>;
  readBytes(location: string, signal?: AbortSignal, resource?: EncodedResourceDescriptor): Promise<ArrayBuffer>;
}
