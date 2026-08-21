import type { BinaryArrayDescriptor } from './contracts.js';

/** Transport boundary for immutable release resources. */
export interface ResourceReader {
  resolve(base: string, relative: string): string;
  readJson(location: string): Promise<unknown>;
  readArray(location: string, descriptor: BinaryArrayDescriptor): Promise<number[]>;
  readBytes(location: string, signal?: AbortSignal): Promise<ArrayBuffer>;
}
