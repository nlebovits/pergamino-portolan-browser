import { describe, it, expect } from 'vitest';
import { CachedSource, MAX_ENTRIES, entryKey } from '../../src/utils/perTileCache.js';

const URL_A = 'https://data.example.org/a.pmtiles';

// A Cache Storage with one cache, kept in a Map.
function fakeStorage() {
  const entries = new Map();
  const cache = {
    entries,
    match: async key => (entries.has(key) ? new Response(entries.get(key).slice(0)) : undefined),
    put: async (key, response) => { entries.set(key, await response.arrayBuffer()); },
    keys: async () => [...entries.keys()].map(url => ({ url })),
    delete: async key => entries.delete(key)
  };
  return { cache, open: async () => cache };
}

// A network source that answers each range with bytes and counts the reads.
function fakeNetwork(etag = '"v1"') {
  const network = {
    etag,
    reads: 0,
    getBytes: async (offset, length) => {
      network.reads++;
      return { data: new Uint8Array(length).fill(offset % 251).buffer, etag: network.etag };
    }
  };
  return network;
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('CachedSource', () => {
  it('keys by the archive URL', () => {
    expect(new CachedSource(URL_A, { inner: fakeNetwork(), storage: fakeStorage() }).getKey()).toBe(URL_A);
  });

  it('reads a tile from the network once, then from the cache', async () => {
    const storage = fakeStorage();
    const network = fakeNetwork();
    const source = new CachedSource(URL_A, { inner: network, storage });
    const first = await source.getBytes(1000, 16, undefined, '"v1"');
    await settle();
    const second = await source.getBytes(1000, 16, undefined, '"v1"');
    expect(network.reads).toBe(1);
    expect(new Uint8Array(second.data)).toEqual(new Uint8Array(first.data));
    expect(second.etag).toBe('"v1"');
    expect(storage.cache.entries.has(entryKey(URL_A, '"v1"', 1000, 16))).toBe(true);
  });

  it('always reads the header from the network', async () => {
    const network = fakeNetwork();
    const source = new CachedSource(URL_A, { inner: network, storage: fakeStorage() });
    await source.getBytes(0, 16384);
    await source.getBytes(0, 16384);
    expect(network.reads).toBe(2);
  });

  it('misses after the archive changes its ETag, and the header read deletes the old entries', async () => {
    const storage = fakeStorage();
    const network = fakeNetwork('"v1"');
    const source = new CachedSource(URL_A, { inner: network, storage });
    await source.getBytes(1000, 16, undefined, '"v1"');
    await settle();
    network.etag = '"v2"';
    await source.getBytes(0, 16384);
    await settle();
    await source.getBytes(1000, 16, undefined, '"v2"');
    await settle();
    expect(network.reads).toBe(3);
    expect([...storage.cache.entries.keys()]).toEqual([entryKey(URL_A, '"v2"', 1000, 16)]);
  });

  it('keeps at most MAX_ENTRIES entries per archive, and drops the oldest', async () => {
    const storage = fakeStorage();
    for (let i = 0; i <= MAX_ENTRIES; i++) {
      storage.cache.entries.set(entryKey(URL_A, '"v1"', i * 10, 10), new ArrayBuffer(10));
    }
    storage.cache.entries.set(entryKey('https://data.example.org/b.pmtiles', '"x"', 0, 10), new ArrayBuffer(10));
    const source = new CachedSource(URL_A, { inner: fakeNetwork('"v1"'), storage });
    await source.getBytes(0, 16384);
    await settle();
    await settle();
    expect(storage.cache.entries.has(entryKey(URL_A, '"v1"', 0, 10))).toBe(false);
    expect(storage.cache.entries.has(entryKey(URL_A, '"v1"', MAX_ENTRIES * 10, 10))).toBe(true);
    expect(storage.cache.entries.has(entryKey('https://data.example.org/b.pmtiles', '"x"', 0, 10))).toBe(true);
  });

  it('reads the network when Cache Storage is missing or fails', async () => {
    const network = fakeNetwork();
    const none = new CachedSource(URL_A, { inner: network, storage: undefined });
    await none.getBytes(1000, 16, undefined, '"v1"');
    await none.getBytes(1000, 16, undefined, '"v1"');
    const broken = new CachedSource(URL_A, { inner: network, storage: { open: () => Promise.reject(new Error('SecurityError')) } });
    const result = await broken.getBytes(1000, 16, undefined, '"v1"');
    expect(network.reads).toBe(3);
    expect(result.data.byteLength).toBe(16);
  });
});
