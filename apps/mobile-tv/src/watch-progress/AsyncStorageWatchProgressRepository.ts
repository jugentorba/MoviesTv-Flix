import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  dedupeWatchProgressRecords,
  type WatchProgressRecord,
} from '@moviestv/sync';
import {
  MAX_WATCH_PROGRESS_RECORDS,
  sanitizeWatchProgressRecord,
} from './watchProgressValidation';

export type WatchProgressScope =
  | { type: 'guest' }
  | { type: 'user'; userId: string };

export interface WatchProgressRepository {
  list(scope: WatchProgressScope): Promise<WatchProgressRecord[]>;
  put(scope: WatchProgressScope, record: WatchProgressRecord): Promise<void>;
  replaceAll(scope: WatchProgressScope, records: readonly WatchProgressRecord[]): Promise<void>;
}

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const MAX_WATCH_PROGRESS_STORAGE_BYTES = 16_777_216;

function exceedsStorageLimit(value: string): boolean {
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
    if (bytes > MAX_WATCH_PROGRESS_STORAGE_BYTES) return true;
  }
  return false;
}

function validateScope(scope: WatchProgressScope): WatchProgressScope {
  if (scope.type === 'guest') return scope;
  const userId = typeof scope.userId === 'string'
    ? scope.userId.trim()
    : '';
  if (
    !userId
    || userId.length > 512
    || /[\u0000-\u001f\u007f]/.test(userId)
  ) {
    throw new TypeError('Invalid watch progress scope');
  }

  return { type: 'user', userId };
}

function storageKey(scope: WatchProgressScope): string {
  const validScope = validateScope(scope);
  return validScope.type === 'guest'
    ? 'watch-progress:guest'
    : `watch-progress:user:${encodeURIComponent(validScope.userId)}`;
}

function normalizeRecords(
  records: readonly unknown[],
  rejectInvalid: boolean,
): WatchProgressRecord[] {
  const normalized = records.map(sanitizeWatchProgressRecord);
  if (rejectInvalid && normalized.some((record) => record === null)) {
    throw new TypeError('Invalid watch progress record');
  }

  const bounded = normalized
    .filter((record): record is WatchProgressRecord => record !== null)
    .sort((left, right) => (
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    ))
    .slice(0, MAX_WATCH_PROGRESS_RECORDS);

  return dedupeWatchProgressRecords(bounded)
    .slice(0, MAX_WATCH_PROGRESS_RECORDS);
}

export class AsyncStorageWatchProgressRepository implements WatchProgressRepository {
  constructor(private readonly storage: KeyValueStorage = AsyncStorage) {}

  async list(scope: WatchProgressScope): Promise<WatchProgressRecord[]> {
    return this.read(storageKey(scope));
  }

  async put(scope: WatchProgressScope, record: WatchProgressRecord): Promise<void> {
    const key = storageKey(scope);
    const normalized = sanitizeWatchProgressRecord(record);
    if (!normalized) throw new TypeError('Invalid watch progress record');

    const records = await this.read(key);
    await this.write(
      key,
      dedupeWatchProgressRecords([
        ...records,
        normalized,
      ]),
    );
  }

  async replaceAll(
    scope: WatchProgressScope,
    records: readonly WatchProgressRecord[],
  ): Promise<void> {
    const key = storageKey(scope);
    await this.write(
      key,
      normalizeRecords(records, true),
    );
  }

  private async read(key: string): Promise<WatchProgressRecord[]> {
    const stored = await this.storage.getItem(key);
    if (stored === null) return [];
    if (exceedsStorageLimit(stored)) {
      await this.storage.setItem(key, '[]');
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      await this.storage.setItem(key, '[]');
      return [];
    }

    if (!Array.isArray(parsed)) {
      await this.storage.setItem(key, '[]');
      return [];
    }

    const normalized = normalizeRecords(parsed, false);
    const serialized = JSON.stringify(normalized);
    if (serialized !== stored) {
      await this.storage.setItem(key, serialized);
    }
    return normalized;
  }

  private async write(
    key: string,
    records: readonly WatchProgressRecord[],
  ): Promise<void> {
    await this.storage.setItem(
      key,
      JSON.stringify(normalizeRecords(records, true)),
    );
  }
}
