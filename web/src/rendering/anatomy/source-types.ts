import type { SliceAxis } from '../../core/spatial.js';

export interface GeneratedAnatomySliceSourceOptions {
  manifestUrl: string;
  packDepth?: 8 | 16 | 32;
  fetchImpl?: typeof fetch;
  maxCachedBytes?: number;
  scheduleIdle?: (callback: () => void) => void;
  onPerformance?: (event: AnatomyPackPerformanceEvent) => void;
}

export type AnatomyPackPerformancePhase =
  | 'fetch'
  | 'read-response'
  | 'sha256'
  | 'gunzip'
  | 'utf8'
  | 'json-parse'
  | 'validate'
  | 'worker-roundtrip';

export interface AnatomyPackPerformanceEvent {
  phase: AnatomyPackPerformancePhase;
  axis: SliceAxis;
  packIndex: number;
  path: string;
  durationMs: number;
  compressedBytes: number;
  decodedBytes?: number;
}
