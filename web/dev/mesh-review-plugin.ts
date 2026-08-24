import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';

const PREFIX = '/__mesh-review/';

/** Explicit local-only access to an ignored review bundle; disabled unless configured. */
export function meshReviewPlugin(configuredRoot: string | undefined): Plugin | null {
  if (!configuredRoot) return null;
  const reviewRoot = path.resolve(configuredRoot);
  return {
    name: 'local-mesh-production-review',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url ? new URL(request.url, 'http://localhost').pathname : '';
        if (!pathname.startsWith(PREFIX)) return next();
        const target = path.resolve(reviewRoot, decodeURIComponent(pathname.slice(PREFIX.length)));
        if (!target.startsWith(`${reviewRoot}${path.sep}`)) {
          response.statusCode = 403;
          response.end('Forbidden');
          return;
        }
        try {
          const [bytes, metadata] = await Promise.all([readFile(target), stat(target)]);
          response.setHeader('Content-Type', mediaType(target));
          response.setHeader('Content-Length', metadata.size);
          response.setHeader('Cache-Control', 'no-store');
          response.end(bytes);
        } catch {
          next();
        }
      });
    },
  };
}

function mediaType(target: string): string {
  if (target.endsWith('.json')) return 'application/json';
  if (target.endsWith('.html')) return 'text/html; charset=utf-8';
  if (target.endsWith('.gz')) return 'application/vnd.ibl.eam3';
  return 'application/octet-stream';
}
