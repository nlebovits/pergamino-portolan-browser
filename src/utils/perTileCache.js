// A PMTiles source that keeps the bytes it reads in Cache Storage, for the
// hero map of the home view (PerHeroMap.vue).
//
// Browsers do not reuse cached responses to fetch() requests with a Range
// header, and source.coop sends `cache-control: no-cache`. Without this file,
// every visit downloads the hero tiles again. The pmtiles library also turns
// the HTTP cache off on purpose for Chrome on Windows.
//
// Each cached entry is keyed by the archive URL, its ETag, and the byte range.
// The library reads the header (offset 0) without an ETag, so the header
// always comes from the network. The library then sends that ETag with every
// directory and tile read. A republished archive has a new ETag, so an old
// entry never matches. The header read also deletes the entries of other ETags.
//
// When Cache Storage is missing or fails (a private window, a full quota, an
// insecure origin), the source reads from the network only.

import { FetchSource } from 'pmtiles';

const CACHE_NAME = 'per-hero-pmtiles-v1';
// The key of an entry is a URL that is never fetched.
const KEY_ORIGIN = 'https://pmtiles-cache.invalid/';
// The most entries one archive keeps. The oldest entries go first.
export const MAX_ENTRIES = 400;

function keyPrefix(url) {
  return `${KEY_ORIGIN}${encodeURIComponent(url)}/`;
}

export function entryKey(url, etag, offset, length) {
  return `${keyPrefix(url)}${encodeURIComponent(etag)}/${offset}-${length}`;
}

function openCache(storage) {
  try {
    return storage?.open ? storage.open(CACHE_NAME).catch(() => null) : Promise.resolve(null);
  }
  catch {
    return Promise.resolve(null);
  }
}

export class CachedSource {
  /**
   * @param {string} url The absolute URL of a PMTiles archive.
   * @param {Object} [options]
   * @param {Object} [options.inner] The source that reads the network. A FetchSource by default.
   * @param {CacheStorage} [options.storage] The Cache Storage. `globalThis.caches` by default.
   */
  constructor(url, { inner = new FetchSource(url), storage = globalThis.caches } = {}) {
    this.url = url;
    this.inner = inner;
    this.cache = openCache(storage);
  }

  getKey() {
    return this.url;
  }

  async getBytes(offset, length, signal, etag) {
    const cache = etag ? await this.cache : null;
    const key = cache ? entryKey(this.url, etag, offset, length) : null;
    if (cache) {
      try {
        const hit = await cache.match(key);
        if (hit) {
          return { data: await hit.arrayBuffer(), etag };
        }
      }
      catch {
        // Read the network.
      }
    }
    const result = await this.inner.getBytes(offset, length, signal, etag);
    if (cache && result.etag === etag) {
      // Response copies the bytes, so the caller keeps its buffer.
      cache.put(key, new Response(result.data.slice(0))).catch(() => {});
    }
    else if (offset === 0 && result.etag) {
      this.prune(result.etag);
    }
    return result;
  }

  // Deletes the entries of other ETags, and the oldest entries over MAX_ENTRIES.
  async prune(etag) {
    const cache = await this.cache;
    if (!cache) {
      return;
    }
    try {
      const keys = (await cache.keys()).map(request => request.url).filter(key => key.startsWith(keyPrefix(this.url)));
      const current = `${keyPrefix(this.url)}${encodeURIComponent(etag)}/`;
      const stale = keys.filter(key => !key.startsWith(current));
      const fresh = keys.filter(key => key.startsWith(current));
      const excess = fresh.slice(0, Math.max(0, fresh.length - MAX_ENTRIES));
      await Promise.all([...stale, ...excess].map(key => cache.delete(key)));
    }
    catch {
      // The cache stays as it is.
    }
  }
}
