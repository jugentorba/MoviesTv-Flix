import type { KeyValueStore } from './KeyValueStore';

export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const DEFAULT_MAX_STORAGE_BYTES = 16_777_216;

function exceedsByteLimit(value: string, maxBytes: number): boolean {
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
    if (bytes > maxBytes) return true;
  }
  return false;
}

export class AsyncStorageStore implements KeyValueStore {
  private readonly maxBytes: number;

  constructor(
    private readonly storage: AsyncStorageLike,
    maxBytes = DEFAULT_MAX_STORAGE_BYTES,
  ) {
    this.maxBytes = Number.isFinite(maxBytes) && maxBytes > 0
      ? Math.floor(maxBytes)
      : DEFAULT_MAX_STORAGE_BYTES;
  }

  async get<T>(key: string): Promise<T | null> {
    const stored = await this.storage.getItem(key);
    if (stored === null) return null;
    if (exceedsByteLimit(stored, this.maxBytes)) {
      await this.storage.removeItem(key);
      return null;
    }

    try {
      return JSON.parse(stored) as T;
    } catch {
      await this.storage.removeItem(key);
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    const serialized = JSON.stringify(value);
    if (exceedsByteLimit(serialized, this.maxBytes)) {
      throw new TypeError('Stored value is too large');
    }
    await this.storage.setItem(key, serialized);
  }

  async remove(key: string): Promise<void> {
    await this.storage.removeItem(key);
  }
}
