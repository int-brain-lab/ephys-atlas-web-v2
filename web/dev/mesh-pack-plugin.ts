import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';

const PREFIX = '/__real-mesh-pack/';

export interface LocalMeshPack {
  readonly root: string;
  readonly manifestUrl: string;
  readonly manifestBytes: number;
  readonly manifestSha256: string;
  readonly allowedPaths: ReadonlySet<string>;
}

export async function loadLocalMeshPack(root: string): Promise<LocalMeshPack> {
  const resolvedRoot = path.resolve(root);
  const manifestBytes = await readFile(path.join(resolvedRoot, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
    format?: string;
    purpose?: string;
    lods?: Array<{ resource?: { path?: string } }>;
    validation?: { report?: { path?: string } };
  };
  if (manifest.format !== 'atlas-mesh-pack-v1' || manifest.purpose !== 'production') {
    throw new Error('EPHYS_ATLAS_REAL_MESH_PACK must contain a production atlas-mesh-pack-v1 manifest');
  }
  const paths = [
    ...(manifest.lods ?? []).map((lod) => lod.resource?.path),
    manifest.validation?.report?.path,
  ];
  if (paths.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new Error('EPHYS_ATLAS_REAL_MESH_PACK manifest has incomplete resources');
  }
  return {
    root: resolvedRoot,
    manifestUrl: `${PREFIX}manifest.json`,
    manifestBytes: manifestBytes.byteLength,
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    allowedPaths: new Set(['manifest.json', ...(paths as string[])]),
  };
}

/** Development-only access to an explicitly configured, validated real mesh pack. */
export function localMeshPackPlugin(pack: LocalMeshPack): Plugin {
  return {
    name: 'local-real-mesh-pack',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url ? new URL(request.url, 'http://localhost').pathname : '';
        if (!pathname.startsWith(PREFIX)) return next();
        const relative = decodeURIComponent(pathname.slice(PREFIX.length));
        if (!pack.allowedPaths.has(relative)) { response.statusCode = 404; response.end('Not found'); return; }
        const target = path.resolve(pack.root, relative);
        if (!target.startsWith(`${pack.root}${path.sep}`)) { response.statusCode = 403; response.end('Forbidden'); return; }
        try {
          const bytes = await readFile(target);
          response.setHeader('Content-Type', target.endsWith('.json') ? 'application/json' : 'application/vnd.ibl.eam3');
          response.setHeader('Content-Length', bytes.byteLength);
          response.setHeader('Cache-Control', 'no-store');
          response.end(bytes);
        } catch { next(); }
      });
    },
  };
}
