import type { Entry, FileEntry } from '@zip.js/zip.js';
import type { ParcellationId, RepresentationKind } from '../domain/types.js';
import { localDatasetReleaseId, validateLocalDatasetFiles } from './validate.js';
import type { ValidatedLocalDataset } from './validation/local-dataset.js';

export interface LocalArchiveLimits {
  readonly maximumArchiveBytes: number;
  readonly maximumEntries: number;
  readonly maximumEntryCompressedBytes: number;
  readonly maximumEntryExpandedBytes: number;
  readonly maximumExpandedBytes: number;
  readonly maximumResourceDecodedBytes: number;
  readonly maximumDecodedBytes: number;
  readonly maximumCompressionRatio: number;
  readonly maximumPathBytes: number;
  readonly maximumSegmentBytes: number;
  readonly maximumManifestBytes: number;
}

export const LOCAL_ARCHIVE_LIMITS: LocalArchiveLimits = Object.freeze({
  maximumArchiveBytes: 1024 * 1024 * 1024,
  maximumEntries: 20_000,
  maximumEntryCompressedBytes: 256 * 1024 * 1024,
  maximumEntryExpandedBytes: 256 * 1024 * 1024,
  maximumExpandedBytes: 1536 * 1024 * 1024,
  maximumResourceDecodedBytes: 256 * 1024 * 1024,
  maximumDecodedBytes: 1536 * 1024 * 1024,
  maximumCompressionRatio: 1000,
  maximumPathBytes: 512,
  maximumSegmentBytes: 128,
  maximumManifestBytes: 8 * 1024 * 1024,
});

export interface LocalArchiveEntryMetadata {
  readonly filename: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly compressionMethod: number;
  readonly directory: boolean;
  readonly encrypted: boolean;
  readonly symlink: boolean;
  readonly zip64: boolean;
  readonly diskNumberStart: number;
  readonly unixMode?: number;
}

export interface LocalArchiveInventory {
  readonly entries: readonly LocalArchiveEntryMetadata[];
  readonly expandedBytes: number;
  readonly compressedEntryBytes: number;
}

export interface LocalArchivePreview {
  readonly datasetId: string;
  readonly releaseId: string;
  readonly selector: string;
  readonly title: string;
  readonly provenanceSummary: string;
  readonly archiveBytes: number;
  readonly storedBytes: number;
  readonly declaredDecodedBytes: number;
  readonly fileCount: number;
  readonly featureCount: number;
  readonly featureIds: readonly string[];
  readonly representations: readonly RepresentationKind[];
  readonly parcellations: readonly ParcellationId[];
}

export interface PreparedLocalArchive {
  readonly files: ReadonlyMap<string, Blob>;
  readonly validated: ValidatedLocalDataset;
  readonly preview: LocalArchivePreview;
}

const textEncoder = new TextEncoder();
const CONTROL = /[\u0000-\u001f\u007f]/;

function safeInteger(value: number, description: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${description} is not a safe nonnegative integer`);
  return value;
}

export function validateLocalArchivePath(path: string, limits: LocalArchiveLimits = LOCAL_ARCHIVE_LIMITS): string {
  if (!path || path !== path.normalize('NFC') || CONTROL.test(path) || path.includes('\\') || path.includes('%')) {
    throw new Error(`Local dataset ZIP contains an unsafe path: ${JSON.stringify(path)}`);
  }
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes(':')) {
    throw new Error(`Local dataset ZIP contains an unsafe path: ${JSON.stringify(path)}`);
  }
  const segments = path.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Local dataset ZIP contains an unsafe path: ${JSON.stringify(path)}`);
  }
  if (textEncoder.encode(path).byteLength > limits.maximumPathBytes
    || segments.some((segment) => textEncoder.encode(segment).byteLength > limits.maximumSegmentBytes)) {
    throw new Error(`Local dataset ZIP path exceeds the admission limit: ${JSON.stringify(path)}`);
  }
  const lower = path.toLocaleLowerCase('en-US');
  if (lower.endsWith('.zip') || lower.endsWith('.ibl-ephys-atlas.zip')) {
    throw new Error(`Nested ZIP entries are unsupported: ${path}`);
  }
  return path;
}

export function validateLocalArchiveInventory(
  archiveBytes: number,
  entries: readonly LocalArchiveEntryMetadata[],
  limits: LocalArchiveLimits = LOCAL_ARCHIVE_LIMITS,
): LocalArchiveInventory {
  if (safeInteger(archiveBytes, 'Archive byte size') > limits.maximumArchiveBytes) {
    throw new Error(`Local dataset ZIP exceeds ${limits.maximumArchiveBytes} bytes`);
  }
  if (!entries.length) throw new Error('Local dataset ZIP is empty');
  if (entries.length > limits.maximumEntries) throw new Error(`Local dataset ZIP exceeds ${limits.maximumEntries} entries`);
  const seen = new Set<string>();
  let expandedBytes = 0;
  let compressedEntryBytes = 0;
  for (const entry of entries) {
    const path = validateLocalArchivePath(entry.filename, limits);
    if (seen.has(path)) throw new Error(`Local dataset ZIP contains duplicate path: ${path}`);
    seen.add(path);
    if (entry.directory) throw new Error(`Local dataset ZIP contains a directory entry: ${path}`);
    if (entry.encrypted) throw new Error(`Encrypted ZIP entries are unsupported: ${path}`);
    if (entry.symlink) throw new Error(`Symbolic links are unsupported in local dataset ZIPs: ${path}`);
    if (entry.zip64 || entry.diskNumberStart !== 0) throw new Error(`Split or Zip64 entries are unsupported: ${path}`);
    if (![0, 8].includes(entry.compressionMethod)) throw new Error(`Unsupported ZIP compression method for ${path}`);
    if (entry.unixMode !== undefined) {
      const fileType = entry.unixMode & 0o170000;
      if (fileType !== 0 && fileType !== 0o100000) throw new Error(`ZIP entry is not a regular file: ${path}`);
    }
    const compressed = safeInteger(entry.compressedSize, `${path} compressed size`);
    const expanded = safeInteger(entry.uncompressedSize, `${path} expanded size`);
    if (compressed > limits.maximumEntryCompressedBytes || expanded > limits.maximumEntryExpandedBytes) {
      throw new Error(`ZIP entry exceeds its byte limit: ${path}`);
    }
    if (expanded > 0 && (compressed === 0 || expanded / compressed > limits.maximumCompressionRatio)) {
      throw new Error(`ZIP entry exceeds its compression-ratio limit: ${path}`);
    }
    expandedBytes += expanded;
    compressedEntryBytes += compressed;
    safeInteger(expandedBytes, 'Aggregate expanded size');
    safeInteger(compressedEntryBytes, 'Aggregate compressed size');
    if (expandedBytes > limits.maximumExpandedBytes) throw new Error('Local dataset ZIP exceeds its expanded-size limit');
    if (path === 'manifest.json' && expanded > limits.maximumManifestBytes) {
      throw new Error('Local dataset manifest exceeds its byte limit');
    }
  }
  if (!seen.has('manifest.json')) {
    const wrapped = [...seen].some((path) => path.endsWith('/manifest.json'));
    throw new Error(wrapped
      ? 'Local dataset ZIP has an enclosing directory; manifest.json must be at its root'
      : 'Local dataset ZIP must contain manifest.json at its root');
  }
  return { entries, expandedBytes, compressedEntryBytes };
}

function metadata(entry: Entry): LocalArchiveEntryMetadata {
  return {
    filename: entry.filename,
    compressedSize: entry.compressedSize,
    uncompressedSize: entry.uncompressedSize,
    compressionMethod: entry.compressionMethod,
    directory: entry.directory,
    encrypted: entry.encrypted,
    symlink: entry.symlink,
    zip64: entry.zip64,
    diskNumberStart: entry.diskNumberStart,
    ...(entry.unixMode === undefined ? {} : { unixMode: entry.unixMode }),
  };
}

export async function prepareLocalArchive(
  archive: Blob,
  signal?: AbortSignal,
  limits: LocalArchiveLimits = LOCAL_ARCHIVE_LIMITS,
): Promise<PreparedLocalArchive> {
  signal?.throwIfAborted();
  if (safeInteger(archive.size, 'Archive byte size') > limits.maximumArchiveBytes) {
    throw new Error(`Local dataset ZIP exceeds ${limits.maximumArchiveBytes} bytes`);
  }
  const { BlobReader, BlobWriter, ZipReader } = await import('@zip.js/zip.js/index-native.js');
  const reader = new ZipReader(new BlobReader(archive), {
    strictness: 'strict',
    checkCrc32: true,
    checkOverlappingEntry: true,
    useWebWorkers: false,
  });
  try {
    const rawEntries: Entry[] = [];
    for await (const entry of reader.getEntriesGenerator({ strictness: 'strict' })) {
      signal?.throwIfAborted();
      rawEntries.push(entry);
      if (rawEntries.length > limits.maximumEntries) {
        throw new Error(`Local dataset ZIP exceeds ${limits.maximumEntries} entries`);
      }
    }
    const entries = rawEntries.filter((entry): entry is FileEntry => !entry.directory);
    validateLocalArchiveInventory(archive.size, rawEntries.map(metadata), limits);
    const files = new Map<string, Blob>();
    for (const entry of entries) {
      signal?.throwIfAborted();
      const blob = await entry.getData(new BlobWriter('application/octet-stream'), {
        strictness: 'strict',
        checkCrc32: true,
        checkOverlappingEntry: true,
        ...(signal ? { signal } : {}),
        useWebWorkers: false,
      });
      if (blob.size !== entry.uncompressedSize) throw new Error(`ZIP entry size changed during extraction: ${entry.filename}`);
      files.set(entry.filename, blob);
    }
    const validated = await validateLocalDatasetFiles(files, {
      ...(signal ? { signal } : {}),
      limits: {
        maximumResourceDecodedBytes: limits.maximumResourceDecodedBytes,
        maximumDecodedBytes: limits.maximumDecodedBytes,
      },
    });
    const representations = new Set<RepresentationKind>();
    for (const feature of validated.features) {
      if (feature.representations.regional) representations.add('regional');
      if (feature.representations.volume) representations.add('volume');
    }
    const preview: LocalArchivePreview = {
      datasetId: validated.document.datasetId,
      releaseId: validated.document.release.releaseId,
      selector: localDatasetReleaseId(validated.document.datasetId, validated.document.release.releaseId),
      title: validated.document.title,
      provenanceSummary: [
        `${validated.document.provenance.builder.name} ${validated.document.provenance.builder.version}`,
        `recipe ${validated.document.provenance.recipe.id}`,
        `${validated.document.provenance.sources.length.toLocaleString('en-US')} source${validated.document.provenance.sources.length === 1 ? '' : 's'}`,
      ].join(' · '),
      archiveBytes: archive.size,
      storedBytes: validated.storedBytes,
      declaredDecodedBytes: validated.declaredDecodedBytes,
      fileCount: validated.declaredPaths.length,
      featureCount: validated.features.length,
      featureIds: validated.features.map((feature) => feature.id),
      representations: [...representations].sort(),
      parcellations: validated.document.parcellations.map((item) => item.id).sort(),
    };
    return { files, validated, preview };
  } finally {
    await reader.close();
  }
}
