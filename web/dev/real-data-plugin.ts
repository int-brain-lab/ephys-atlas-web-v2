import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';

const REAL_PREFIX = '/__real-data/';
const DATASET_ID = /^[a-z0-9][a-z0-9._-]*$/;
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface RealDevelopmentRelease {
  releaseRoot: string;
  datasetId: string;
  title: string;
  description: string;
  releaseId: string;
  featureId: string;
  manifestBytes: number;
  manifestSha256: string;
}

function mediaType(filePath: string): string {
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.csv')) return 'text/csv; charset=utf-8';
  return 'application/octet-stream';
}

function setStaticHeaders(response: import('node:http').ServerResponse, immutable: boolean): void {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  response.setHeader(
    'Cache-Control',
    immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=60, must-revalidate',
  );
}

export async function loadRealDevelopmentRelease(
  releasePath: string,
  featureId: string,
): Promise<RealDevelopmentRelease> {
  const releaseRoot = path.resolve(releasePath);
  const manifestPath = path.join(releaseRoot, 'manifest.json');
  let document: unknown;
  let manifestBytes: Uint8Array;
  try {
    manifestBytes = await readFile(manifestPath);
    document = JSON.parse(Buffer.from(manifestBytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(`Cannot read real development release manifest at ${manifestPath}`, { cause: error });
  }
  if (!document || typeof document !== 'object') throw new Error(`Invalid release manifest at ${manifestPath}`);
  const manifest = document as {
    dataset_id?: unknown;
    title?: unknown;
    description?: unknown;
    features?: unknown;
    release?: { immutable?: unknown; release_id?: unknown };
  };
  if (typeof manifest.dataset_id !== 'string' || !DATASET_ID.test(manifest.dataset_id)) {
    throw new Error(`dev-real requires a valid dataset_id in ${manifestPath}`);
  }
  if (typeof manifest.title !== 'string' || manifest.title.length === 0
    || typeof manifest.description !== 'string') {
    throw new Error(`dev-real requires dataset title and description in ${manifestPath}`);
  }
  if (manifest.release?.immutable !== true || typeof manifest.release.release_id !== 'string'
    || !RELEASE_ID.test(manifest.release.release_id)) {
    throw new Error(`dev-real requires an immutable release identity in ${manifestPath}`);
  }
  if (!Array.isArray(manifest.features)
    || !manifest.features.some((feature) => feature && typeof feature === 'object' && (feature as { id?: unknown }).id === featureId)) {
    throw new Error(`Default feature ${featureId} is not present in ${manifestPath}`);
  }
  return {
    releaseRoot,
    datasetId: manifest.dataset_id,
    title: manifest.title,
    description: manifest.description,
    releaseId: manifest.release.release_id,
    featureId,
    manifestBytes: manifestBytes.byteLength,
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
  };
}

export function realReleasePlugin(configured: RealDevelopmentRelease | readonly RealDevelopmentRelease[]): Plugin {
  const releases = Array.isArray(configured) ? configured : [configured];
  const identities = new Set<string>();
  for (const release of releases) {
    const identity = `${release.datasetId}/${release.releaseId}`;
    if (identities.has(identity)) throw new Error(`Duplicate real development release ${identity}`);
    identities.add(identity);
  }
  return {
    name: 'ephys-atlas-real-development-release',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url ? new URL(request.url, 'http://localhost').pathname : '';
        if (pathname === `${REAL_PREFIX}catalog.json`) {
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          setStaticHeaders(response, false);
          const datasets = new Map<string, RealDevelopmentRelease[]>();
          for (const release of releases) {
            const group = datasets.get(release.datasetId) ?? [];
            group.push(release);
            datasets.set(release.datasetId, group);
          }
          const body = JSON.stringify({
            schema_version: '1.0',
            default_project: 'synthetic-development',
            projects: [{
              project_id: 'synthetic-development',
              title: 'Synthetic development data',
              dataset_ids: [...datasets.keys()],
              default_dataset: releases[0]!.datasetId,
              editions: [],
            }],
            datasets: [...datasets.values()].map((group) => ({
              dataset_id: group[0]!.datasetId,
              title: group[0]!.title,
              description: group[0]!.description,
              default_release: group[0]!.releaseId,
              releases: group.map((release) => ({
                release_id: release.releaseId,
                label: `Synthetic ${release.releaseId}`,
                status: 'development',
                manifest: {
                  path: `./${release.datasetId}/${release.releaseId}/manifest.json`,
                  media_type: 'application/json',
                  bytes: release.manifestBytes,
                  sha256: release.manifestSha256,
                  codec: { name: 'none', decoded_bytes: release.manifestBytes },
                },
              })),
            })),
          });
          response.setHeader('Content-Length', Buffer.byteLength(body));
          response.end(body);
          return;
        }
        const release = releases.find((candidate) => pathname.startsWith(
          `${REAL_PREFIX}${candidate.datasetId}/${candidate.releaseId}/`,
        ));
        if (!release) return next();
        const releasePrefix = `${REAL_PREFIX}${release.datasetId}/${release.releaseId}/`;
        const relative = decodeURIComponent(pathname.slice(releasePrefix.length));
        const target = path.resolve(release.releaseRoot, relative);
        if (target !== release.releaseRoot && !target.startsWith(`${release.releaseRoot}${path.sep}`)) {
          response.statusCode = 403;
          response.end('Forbidden');
          return;
        }
        try {
          const metadata = await stat(target);
          if (!metadata.isFile()) return next();
          response.setHeader('Content-Type', mediaType(target));
          response.setHeader('Content-Length', metadata.size);
          setStaticHeaders(response, true);
          response.end(await readFile(target));
        } catch {
          next();
        }
      });
    },
  };
}
