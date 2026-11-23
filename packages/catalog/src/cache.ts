export interface CachedCatalogValue<T> {
  value: T;
  stale: boolean;
}

export interface CatalogCache {
  get<T>(key: string, now?: number): Promise<CachedCatalogValue<T> | null>;
  set<T>(key: string, value: T, ttlMs: number, now?: number): Promise<void>;
}

interface StoredValue {
  value: unknown;
  expiresAt: number;
}

export class MemoryCatalogCache implements CatalogCache {
  private readonly values = new Map<string, StoredValue>();
  private readonly maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = Number.isFinite(maxEntries)
      ? Math.max(1, Math.floor(maxEntries))
      : 500;
  }

  async get<T>(
    key: string,
    now = Date.now(),
  ): Promise<CachedCatalogValue<T> | null> {
    const stored = this.values.get(key);
    if (!stored) return null;

    // Refresh recency on reads so actively used catalog/detail entries are
    // retained while old one-off searches and pages are evicted first.
    this.values.delete(key);
    this.values.set(key, stored);

    return {
      value: stored.value as T,
      stale: now > stored.expiresAt,
    };
  }

  async set<T>(
    key: string,
    value: T,
    ttlMs: number,
    now = Date.now(),
  ): Promise<void> {
    this.values.delete(key);
    this.values.set(key, {
      value,
      expiresAt: now + Math.max(0, ttlMs),
    });

    while (this.values.size > this.maxEntries) {
      const oldest = this.values.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.values.delete(oldest);
    }
  }
}
