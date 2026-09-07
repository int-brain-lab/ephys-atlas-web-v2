import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

/** Local audit artifacts only. Nothing is copied into a production build. */
export function ageaLabPlugin(directory: string | undefined): Plugin {
  return {
    name: 'agea-coverage-lab',
    async configureServer(server) {
      const root = directory ? path.resolve(directory) : null;
      const allowed = new Set<string>(['coverage-lab-index.json']);
      let failure = 'AGEA lab data is not configured. Prepare the lab and set AGEA_LAB_DIR.';
      if (root) {
        try {
          const descriptor = JSON.parse(await readFile(path.join(root, 'coverage-lab-index.json'), 'utf8'));
          if (typeof descriptor.path !== 'string' || !path.resolve(root, descriptor.path).startsWith(root + path.sep)) throw new Error('Unsafe lab metadata path');
          const encoded = await readFile(path.join(root, descriptor.path));
          if (encoded.byteLength !== descriptor.bytes
            || createHash('sha256').update(encoded).digest('hex') !== descriptor.sha256) throw new Error('Lab metadata integrity mismatch');
          const manifest = JSON.parse(gunzipSync(encoded).toString('utf8'));
          if (manifest.format !== 'agea-coverage-lab-only' || manifest.scientific_release !== false) throw new Error('Not a coverage lab');
          for (const entry of [descriptor, manifest.labels, manifest.measured_counts,
            ...(manifest.anatomy_image ? [manifest.anatomy_image] : []),
            ...manifest.features.map((feature: { volume: { path: string } }) => feature.volume)]) {
            const target = path.resolve(root, entry.path);
            if (!target.startsWith(root + path.sep)) throw new Error('Unsafe lab resource path');
            allowed.add(entry.path);
          }
          failure = '';
        } catch (error) { failure = String(error); }
      }
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/__agea_lab__/')) return next();
        response.setHeader('Cache-Control', 'no-store');
        if (failure || !root) { response.statusCode = 503; response.end(failure); return; }
        const relative = url.pathname.slice('/__agea_lab__/'.length);
        if (!allowed.has(relative)) { response.statusCode = 404; response.end('Undeclared lab resource'); return; }
        try {
          const bytes = await readFile(path.join(root, relative));
          response.setHeader('Content-Type', relative.endsWith('.json') ? 'application/json' : 'application/gzip');
          response.setHeader('Content-Length', bytes.byteLength);
          response.end(bytes);
        } catch { response.statusCode = 404; response.end('Lab resource unavailable'); }
      });
    },
  };
}
