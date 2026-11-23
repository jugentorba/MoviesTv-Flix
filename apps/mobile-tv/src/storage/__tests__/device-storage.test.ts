import {
  CATALOG_CACHE_PREFIX,
  clearCatalogCache,
  formatBytes,
  isCatalogCacheKey,
  readDeviceStorage,
  utf8ByteLength,
  type KeyedStorage,
} from '../deviceStorage';

function storageOf(entries: Record<string, string | null>): KeyedStorage & {
  removed: string[][];
} {
  const removed: string[][] = [];
  return {
    removed,
    getAllKeys: async () => Object.keys(entries),
    multiGet: async (keys) => keys.map((key) => [key, entries[key] ?? null] as const),
    multiRemove: async (keys) => {
      removed.push([...keys]);
    },
  };
}

describe('utf8ByteLength', () => {
  it('counts bytes, not characters', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    // Two bytes each.
    expect(utf8ByteLength('ëë')).toBe(4);
    // Three bytes each.
    expect(utf8ByteLength('日本語')).toBe(9);
    // Astral plane: four bytes.
    expect(utf8ByteLength('🎬')).toBe(4);
  });
});

describe('readDeviceStorage', () => {
  it('separates disposable cache from user data', async () => {
    const storage = storageOf({
      [`${CATALOG_CACHE_PREFIX}home`]: 'x'.repeat(100),
      [`${CATALOG_CACHE_PREFIX}movies`]: 'y'.repeat(50),
      'moviestv.addons': 'z'.repeat(20),
      'moviestv:web-tv-layout:v1': '1',
    });

    const summary = await readDeviceStorage(storage);

    expect(summary.catalogCacheBytes).toBe(150);
    expect(summary.userDataBytes).toBe(21);
    expect(summary.totalBytes).toBe(171);
    expect(summary.catalogEntryCount).toBe(2);
    expect(summary.entryCount).toBe(4);
  });

  it('handles an empty device', async () => {
    const summary = await readDeviceStorage(storageOf({}));
    expect(summary).toEqual({
      totalBytes: 0,
      catalogCacheBytes: 0,
      userDataBytes: 0,
      entryCount: 0,
      catalogEntryCount: 0,
    });
  });

  it('ignores null values instead of counting them as data', async () => {
    const storage = storageOf({ kept: 'abc', missing: null });
    const summary = await readDeviceStorage(storage);
    expect(summary.totalBytes).toBe(3);
    expect(summary.entryCount).toBe(2);
  });
});

describe('clearCatalogCache', () => {
  it('removes only cache entries and reports the freed bytes', async () => {
    const storage = storageOf({
      [`${CATALOG_CACHE_PREFIX}home`]: 'x'.repeat(100),
      'moviestv.addons': 'must-survive',
      'moviestv:web-tv-layout:v1': 'must-survive-too',
    });

    const freed = await clearCatalogCache(storage);

    expect(freed).toBe(100);
    expect(storage.removed).toEqual([[`${CATALOG_CACHE_PREFIX}home`]]);
    const removedKeys = storage.removed.flat();
    expect(removedKeys).not.toContain('moviestv.addons');
    expect(removedKeys).not.toContain('moviestv:web-tv-layout:v1');
  });

  it('is a no-op when there is no cache', async () => {
    const storage = storageOf({ 'moviestv.addons': 'x' });
    expect(await clearCatalogCache(storage)).toBe(0);
    expect(storage.removed).toHaveLength(0);
  });
});

describe('isCatalogCacheKey', () => {
  it('matches only the catalog cache namespace', () => {
    expect(isCatalogCacheKey(`${CATALOG_CACHE_PREFIX}k`)).toBe(true);
    expect(isCatalogCacheKey('moviestv.addons')).toBe(false);
    expect(isCatalogCacheKey('@moviestv/catalog/v2/k')).toBe(false);
  });
});

describe('formatBytes', () => {
  it('formats readable sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024 * 3.5)).toBe('3.5 MB');
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
  });
});
