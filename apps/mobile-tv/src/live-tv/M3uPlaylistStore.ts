import type { SecureStoreAdapter } from '../addons/SecureAddonSecretStore';
import type {
  M3uPlaylistRecord,
  M3uPlaylistSource,
} from './M3uLiveTvAdapter';

/**
 * Storage for imported M3U playlists.
 *
 * A playlist URL normally carries the provider's credentials in its path, so a
 * whole record is treated as a secret: it goes to the platform secure store on
 * native and to session memory on web. It is deliberately *not* part of
 * preferences or the sync payload — a playlist that exists on one device has no
 * meaning on another, and syncing it would copy credentials.
 *
 * An index key lists the record ids; each record lives under its own key so a
 * single corrupt entry cannot take the whole list down.
 */

export const MAX_M3U_PLAYLISTS = 20;
export const MAX_M3U_PLAYLIST_NAME_LENGTH = 120;
const MAX_M3U_PLAYLIST_URL_LENGTH = 4_096;
const MAX_STORED_RECORD_LENGTH = 8_192;

const KEY_PREFIX = 'moviestv.m3u';
const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const SCOPE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
export const DEFAULT_M3U_SCOPE = 'local';

export interface NewM3uPlaylist {
  name: string;
  url: string;
  priority?: number;
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_M3U_PLAYLIST_NAME_LENGTH);
  return normalized || null;
}

function playableUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > MAX_M3U_PLAYLIST_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // Authority credentials would be duplicated into every derived value; path
  // credentials are the form IPTV providers actually use.
  if (url.username || url.password) return null;
  return url.href;
}

/**
 * Keys are identity-scoped, like add-on secrets, so a guest playlist and a
 * signed-in playlist never read each other's storage.
 */
function scopePrefix(scope: string): string {
  return `${KEY_PREFIX}.${SCOPE_PATTERN.test(scope) ? scope : DEFAULT_M3U_SCOPE}`;
}

function indexKey(scope: string): string {
  return `${scopePrefix(scope)}.playlists`;
}

function recordKey(scope: string, id: string): string {
  return `${scopePrefix(scope)}.playlist.${id}`;
}

interface StoredRecord {
  id: string;
  name: string;
  url: string;
  priority: number;
  enabled: boolean;
}

/** Returns `null` for anything that is not a complete, valid record. */
function parseStoredRecord(raw: string | null): StoredRecord | null {
  if (!raw || raw.length > MAX_STORED_RECORD_LENGTH) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = parsed as Record<string, unknown>;

  const id = typeof value.id === 'string' ? value.id.trim() : '';
  if (!ID_PATTERN.test(id)) return null;
  const name = cleanName(value.name);
  const url = playableUrl(value.url);
  if (!name || !url) return null;
  const priority = (
    typeof value.priority === 'number'
    && Number.isFinite(value.priority)
  ) ? Math.trunc(value.priority) : 0;

  return {
    id,
    name,
    url,
    priority,
    enabled: value.enabled !== false,
  };
}

function parseIndex(raw: string | null): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const ids = parsed
    .filter((value): value is string => (
      typeof value === 'string' && ID_PATTERN.test(value.trim())
    ))
    .map((value) => value.trim());
  return [...new Set(ids)].slice(0, MAX_M3U_PLAYLISTS);
}

export class M3uPlaylistStore implements M3uPlaylistSource {
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly secure: SecureStoreAdapter,
    private readonly createId: () => string = defaultIdFactory(),
    private readonly scope: string = DEFAULT_M3U_SCOPE,
  ) {}

  /** Notifies after a successful add, toggle or removal. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // A failing subscriber must not break the write that just succeeded.
      }
    }
  }

  async list(): Promise<M3uPlaylistRecord[]> {
    const ids = await this.readIndex();
    if (!ids.length) return [];

    const records: M3uPlaylistRecord[] = [];
    for (const id of ids) {
      const record = await this.readRecord(id);
      if (record) records.push(record);
    }
    return records;
  }

  /**
   * Adds a playlist.
   *
   * Returns a discriminated result instead of throwing so the UI can show a
   * localized reason without string-matching an error message.
   */
  async add(
    playlist: NewM3uPlaylist,
  ): Promise<
    { ok: true; record: M3uPlaylistRecord }
    | { ok: false; reason: 'invalid-name' | 'invalid-url' | 'too-many' }
  > {
    const name = cleanName(playlist?.name);
    if (!name) return { ok: false, reason: 'invalid-name' };
    const url = playableUrl(playlist?.url);
    if (!url) return { ok: false, reason: 'invalid-url' };

    const ids = await this.readIndex();
    if (ids.length >= MAX_M3U_PLAYLISTS) {
      return { ok: false, reason: 'too-many' };
    }

    let id = this.createId();
    let attempt = 0;
    while (!ID_PATTERN.test(id) || ids.includes(id)) {
      attempt += 1;
      if (attempt > 5) return { ok: false, reason: 'too-many' };
      id = this.createId();
    }

    const record: M3uPlaylistRecord = {
      id,
      name,
      url,
      priority: (
        typeof playlist.priority === 'number'
        && Number.isFinite(playlist.priority)
      ) ? Math.trunc(playlist.priority) : 0,
      enabled: true,
    };
    await this.writeRecord(record);
    await this.writeIndex([...ids, id]);
    this.notify();
    return { ok: true, record };
  }

  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const record = await this.readRecord(id);
    if (!record) return false;
    await this.writeRecord({ ...record, enabled });
    this.notify();
    return true;
  }

  async remove(id: string): Promise<boolean> {
    if (!ID_PATTERN.test(id)) return false;
    const ids = await this.readIndex();
    if (!ids.includes(id)) return false;
    await this.secure.deleteItemAsync(recordKey(this.scope, id));
    await this.writeIndex(ids.filter((value) => value !== id));
    this.notify();
    return true;
  }

  private async readIndex(): Promise<string[]> {
    try {
      return parseIndex(await this.secure.getItemAsync(indexKey(this.scope)));
    } catch {
      return [];
    }
  }

  private async writeIndex(ids: readonly string[]): Promise<void> {
    await this.secure.setItemAsync(
      indexKey(this.scope),
      JSON.stringify(ids.slice(0, MAX_M3U_PLAYLISTS)),
    );
  }

  private async readRecord(id: string): Promise<M3uPlaylistRecord | null> {
    if (!ID_PATTERN.test(id)) return null;
    try {
      return parseStoredRecord(
        await this.secure.getItemAsync(recordKey(this.scope, id)),
      );
    } catch {
      return null;
    }
  }

  private async writeRecord(record: M3uPlaylistRecord): Promise<void> {
    await this.secure.setItemAsync(
      recordKey(this.scope, record.id),
      JSON.stringify({
        id: record.id,
        name: record.name,
        url: record.url,
        priority: record.priority,
        enabled: record.enabled,
      }),
    );
  }
}

/**
 * Ids are local, opaque and URL-safe. A timestamp plus a counter keeps them
 * unique without a random source, which makes tests deterministic.
 */
function defaultIdFactory(): () => string {
  let counter = 0;
  const startedAt = Date.now().toString(36);
  return () => {
    counter += 1;
    return `p${startedAt}${counter.toString(36)}`;
  };
}
