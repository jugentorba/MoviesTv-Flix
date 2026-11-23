/**
 * What the app actually keeps on the device, and the one part of it that is
 * safe to delete without losing user data.
 *
 * The catalog cache is disposable: it is a TTL'd copy of provider responses.
 * Preferences, add-ons, watch progress, profiles and downloads are user data and
 * are deliberately **not** touched here — clearing those would be destructive and
 * must never be one tap away in a Settings screen.
 */

export const CATALOG_CACHE_PREFIX = '@moviestv/catalog/v1/';

export interface DeviceStorageBreakdown {
  /** Everything the app has written to key-value storage. */
  totalBytes: number;
  /** Disposable catalog cache. */
  catalogCacheBytes: number;
  /** Everything else: preferences, add-ons, progress, profiles. */
  userDataBytes: number;
  entryCount: number;
  catalogEntryCount: number;
}

export interface KeyedStorage {
  getAllKeys(): Promise<readonly string[]>;
  multiGet(keys: readonly string[]): Promise<readonly [string, string | null][]>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

/** UTF-8 byte length of a string, matching what is actually stored. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export function isCatalogCacheKey(key: string): boolean {
  return key.startsWith(CATALOG_CACHE_PREFIX);
}

export async function readDeviceStorage(
  storage: KeyedStorage,
): Promise<DeviceStorageBreakdown> {
  const keys = await storage.getAllKeys();
  if (keys.length === 0) {
    return {
      totalBytes: 0,
      catalogCacheBytes: 0,
      userDataBytes: 0,
      entryCount: 0,
      catalogEntryCount: 0,
    };
  }

  const entries = await storage.multiGet(keys);
  let totalBytes = 0;
  let catalogCacheBytes = 0;
  let catalogEntryCount = 0;

  for (const [key, value] of entries) {
    if (typeof value !== 'string') continue;
    const bytes = utf8ByteLength(value);
    totalBytes += bytes;
    if (isCatalogCacheKey(key)) {
      catalogCacheBytes += bytes;
      catalogEntryCount += 1;
    }
  }

  return {
    totalBytes,
    catalogCacheBytes,
    userDataBytes: totalBytes - catalogCacheBytes,
    entryCount: keys.length,
    catalogEntryCount,
  };
}

/**
 * Removes cached catalog responses and nothing else.
 * Returns the number of bytes freed.
 */
export async function clearCatalogCache(
  storage: KeyedStorage,
): Promise<number> {
  const keys = await storage.getAllKeys();
  const cacheKeys = keys.filter(isCatalogCacheKey);
  if (cacheKeys.length === 0) return 0;

  const entries = await storage.multiGet(cacheKeys);
  const freed = entries.reduce(
    (total, [, value]) => (typeof value === 'string' ? total + utf8ByteLength(value) : total),
    0,
  );
  await storage.multiRemove(cacheKeys);
  return freed;
}

/** "812 KB" / "1.4 MB" — never a raw byte count. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** exponent;
  const digits = exponent === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[exponent]}`;
}
