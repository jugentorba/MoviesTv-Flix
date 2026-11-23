export {};

function loadModule(path: string): Record<string, unknown> {
  try {
    return require(path) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function memoryStringStorage() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      async getItem(key: string) { return values.get(key) ?? null; },
      async setItem(key: string, value: string) { values.set(key, value); },
      async removeItem(key: string) { values.delete(key); },
    },
  };
}

describe('AsyncStorageCatalogCache', () => {
  it('persists values and reports fresh versus stale using the stored expiry', async () => {
    const mod = loadModule('../AsyncStorageCatalogCache');
    const AsyncStorageCatalogCache = mod.AsyncStorageCatalogCache as undefined | (new (storage: any) => any);
    expect(AsyncStorageCatalogCache).toBeDefined();
    const { storage } = memoryStringStorage();
    const cache = new AsyncStorageCatalogCache!(storage);

    await cache.set('search:Dune', { items: [{ id: 'demo:movie:1' }] }, 50, 100);
    await expect(cache.get('search:Dune', 120)).resolves.toEqual({
      value: { items: [{ id: 'demo:movie:1' }] },
      stale: false,
    });
    await expect(cache.get('search:Dune', 151)).resolves.toEqual({
      value: { items: [{ id: 'demo:movie:1' }] },
      stale: true,
    });
  });

  it('returns null and removes malformed persisted cache entries', async () => {
    const mod = loadModule('../AsyncStorageCatalogCache');
    const AsyncStorageCatalogCache = mod.AsyncStorageCatalogCache as undefined | (new (storage: any) => any);
    expect(AsyncStorageCatalogCache).toBeDefined();
    const { values, storage } = memoryStringStorage();
    values.set('@moviestv/catalog/v1/bad', '{not-json');
    const cache = new AsyncStorageCatalogCache!(storage);

    await expect(cache.get('bad', 100)).resolves.toBeNull();
    expect(values.has('@moviestv/catalog/v1/bad')).toBe(false);
  });

  it('rejects oversized persisted entries before parsing them', async () => {
    const mod = loadModule('../AsyncStorageCatalogCache');
    const AsyncStorageCatalogCache = mod.AsyncStorageCatalogCache as undefined | (new (storage: any) => any);
    expect(AsyncStorageCatalogCache).toBeDefined();
    const { values, storage } = memoryStringStorage();
    const key = '@moviestv/catalog/v1/oversized';
    values.set(key, 'x'.repeat(5_242_881));
    const cache = new AsyncStorageCatalogCache!(storage);

    await expect(cache.get('oversized', 100)).resolves.toBeNull();
    expect(values.has(key)).toBe(false);
  });

  it('does not persist catalog cache entries above the size ceiling', async () => {
    const mod = loadModule('../AsyncStorageCatalogCache');
    const AsyncStorageCatalogCache = mod.AsyncStorageCatalogCache as undefined | (new (storage: any) => any);
    expect(AsyncStorageCatalogCache).toBeDefined();
    const { values, storage } = memoryStringStorage();
    const key = '@moviestv/catalog/v1/huge-write';
    values.set(key, JSON.stringify({
      value: { items: [] },
      expiresAt: 100,
    }));
    const cache = new AsyncStorageCatalogCache!(storage);

    await cache.set(
      'huge-write',
      { payload: 'x'.repeat(5_242_881) },
      1000,
      100,
    );

    expect(values.has(key)).toBe(false);
  });

});
