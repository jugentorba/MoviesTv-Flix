import type { CachedCatalogValue, CatalogCache } from '@moviestv/catalog';

const KEY_PREFIX = '@moviestv/catalog/v1/';
const MAX_CATALOG_CACHE_BYTES = 5_242_880;

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800
      && code <= 0xdbff
      && index + 1 < value.length
    ) {
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
    if (bytes > MAX_CATALOG_CACHE_BYTES) return bytes;
  }
  return bytes;
}

interface StringStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

interface StoredCatalogValue {
  value: unknown;
  expiresAt: number;
}

function isStoredCatalogValue(value: unknown): value is StoredCatalogValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return 'value' in record && typeof record.expiresAt === 'number' && Number.isFinite(record.expiresAt);
}

export class AsyncStorageCatalogCache implements CatalogCache {
  constructor(private readonly storage: StringStorage) {}

  async get<T>(key: string, now = Date.now()): Promise<CachedCatalogValue<T> | null> {
    const storageKey = `${KEY_PREFIX}${key}`;
    const raw = await this.storage.getItem(storageKey);
    if (!raw) return null;
    if (utf8ByteLength(raw) > MAX_CATALOG_CACHE_BYTES) {
      await this.storage.removeItem(storageKey);
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isStoredCatalogValue(parsed)) throw new Error('Invalid catalog cache entry');
      return {
        value: parsed.value as T,
        stale: now > parsed.expiresAt,
      };
    } catch {
      await this.storage.removeItem(storageKey);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlMs: number, now = Date.now()): Promise<void> {
    const storageKey = `${KEY_PREFIX}${key}`;
    const stored: StoredCatalogValue = {
      value,
      expiresAt: now + Math.max(0, ttlMs),
    };

    let serialized: string;
    try {
      serialized = JSON.stringify(stored);
    } catch {
      await this.storage.removeItem(storageKey);
      return;
    }

    if (utf8ByteLength(serialized) > MAX_CATALOG_CACHE_BYTES) {
      await this.storage.removeItem(storageKey);
      return;
    }

    await this.storage.setItem(storageKey, serialized);
  }
}
