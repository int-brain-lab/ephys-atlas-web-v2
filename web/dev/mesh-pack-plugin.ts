import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';

const PACK_ID = /^[a-z0-9][a-z0-9._-]*$/;

export interface LocalMeshPack {
  readonly root: string;
  readonly urlPrefix: string;
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
    pack_id?: string;
    purpose?: string;
    lods?: Array<{ resource?: { path?: string } }>;
    validation?: { report?: { path?: string } };
  };
  if (manifest.format !== 'atlas-mesh-pack-v1' || manifest.purpose !== 'production') {
    throw new Error('EPHYS_ATLAS_REAL_MESH_PACK must contain a production atlas-mesh-pack-v1 manifest');
  }
  if (typeof manifest.pack_id !== 'string' || !PACK_ID.test(manifest.pack_id)) {
    throw new Error('EPHYS_ATLAS_REAL_MESH_PACK must declare a safe immutable pack_id');
  }
  const urlPrefix = `/__local-assets/mesh/${manifest.pack_id}/`;
  const paths = [
    ...(manifest.lods ?? []).map((lod) => lod.resource?.path),
    manifest.validation?.report?.path,
  ];
  if (paths.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new Error('EPHYS_ATLAS_REAL_MESH_PACK manifest has incomplete resources');
  }
  return {
    root: resolvedRoot,
    urlPrefix,
    manifestUrl: `${urlPrefix}manifest.json`,
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
        if (!pathname.startsWith(pack.urlPrefix)) return next();
        const relative = decodeURIComponent(pathname.slice(pack.urlPrefix.length));
        if (!pack.allowedPaths.has(relative)) { response.statusCode = 404; response.end('Not found'); return; }
        const target = path.resolve(pack.root, relative);
        if (!target.startsWith(`${pack.root}${path.sep}`)) { response.statusCode = 403; response.end('Forbidden'); return; }
        try {
          const bytes = await readFile(target);
          response.setHeader('Content-Type', target.endsWith('.json') ? 'application/json' : 'application/vnd.ibl.eam3');
          response.setHeader('Content-Length', bytes.byteLength);
          response.setHeader('Access-Control-Allow-Origin', '*');
          response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
          response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          response.end(bytes);
        } catch { next(); }
      });
    },
  };
}
