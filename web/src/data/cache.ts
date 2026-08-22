const DEFAULT_CACHE_NAME = 'ibl-ephys-atlas-schema-v1-verified';

export interface ResourceIntegrity {
  bytes: number;
  sha256: string;
}

export interface FetchOptions {
  immutable?: boolean;
  signal?: AbortSignal;
  integrity?: ResourceIntegrity;
}

export class ResourceFetcher {
  private readonly inFlight = new Map<string, Promise<Response>>();
  private readonly fetchImpl: typeof fetch;

  constructor(
    fetchImpl: typeof fetch = fetch,
    private readonly cacheName = DEFAULT_CACHE_NAME,
  ) {
    this.fetchImpl = fetchImpl === fetch ? fetch.bind(globalThis) : fetchImpl;
  }

  async fetch(url: string, options: FetchOptions = {}): Promise<Response> {
    const location = new URL(url, globalThis.location?.href ?? 'http://localhost/').toString();
    const key = `${location}\u0000${options.integrity?.sha256 ?? 'unverified'}`;
    if (options.signal) return (await this.load(location, options)).clone();

    const existing = this.inFlight.get(key);
    if (existing) return (await existing).clone();

    const request = this.load(location, options);
    this.inFlight.set(key, request);
    try {
      return (await request).clone();
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async load(url: string, options: FetchOptions): Promise<Response> {
    const canPersist = options.immutable === true && options.integrity !== undefined && 'caches' in globalThis;
    if (canPersist) {
      const cache = await caches.open(this.cacheName);
      const cached = await cache.match(url);
      if (cached) {
        try {
          return await this.verify(cached, options.integrity!);
        } catch {
          await cache.delete(url);
        }
      }
    }

    const init: RequestInit = options.signal ? { signal: options.signal } : {};
    const response = await this.fetchImpl(url, init);
    if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url}`);

    const verified = options.integrity
      ? await this.verify(response, options.integrity)
      : response;

    if (canPersist) {
      const cache = await caches.open(this.cacheName);
      await cache.put(url, verified.clone());
    }
    return verified;
  }

  private async verify(response: Response, integrity: ResourceIntegrity): Promise<Response> {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== integrity.bytes) {
      throw new Error(`Resource byte length ${bytes.byteLength} does not match ${integrity.bytes}`);
    }
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    if (sha256 !== integrity.sha256) throw new Error('Resource SHA-256 mismatch');
    return new Response(bytes, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  async clearPersistentCache(): Promise<void> {
    if ('caches' in globalThis) await caches.delete(this.cacheName);
  }
}
