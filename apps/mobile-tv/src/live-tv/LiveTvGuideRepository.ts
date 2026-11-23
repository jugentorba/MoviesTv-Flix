import type { GuideChannel, GuideProgramme, GuideSnapshot } from '@moviestv/live-tv';

export const LIVE_TV_GUIDE_CONFIG_KEY = '@moviestv/live-tv/guide/config/v1';
export const LIVE_TV_GUIDE_CACHE_KEY = '@moviestv/live-tv/guide/cache/v1';
export const LIVE_TV_GUIDE_SECURE_URL_KEY = 'moviestv.live-tv.guide.url.v1';

export interface LiveTvGuideStorageKeys {
  config: string;
  cache: string;
  secureUrl: string;
}

const LIVE_TV_GUIDE_LEGACY_OWNER_KEY =
  '@moviestv/live-tv/guide/legacy-owner/v1';

const LEGACY_GUIDE_KEYS: LiveTvGuideStorageKeys = {
  config: LIVE_TV_GUIDE_CONFIG_KEY,
  cache: LIVE_TV_GUIDE_CACHE_KEY,
  secureUrl: LIVE_TV_GUIDE_SECURE_URL_KEY,
};

function guideScope(userId: string | null | undefined): string {
  const normalized = userId?.trim();
  return normalized
    ? `user:${encodeURIComponent(normalized)}`
    : 'guest';
}

function secureStoreKeyPart(value: string): string {
  const symbols = Array.from(value);
  return `${symbols.length}_${symbols
    .map((symbol) => symbol.codePointAt(0)!.toString(16))
    .join('_')}`;
}

function previousScopedGuideStorageKeysForUser(
  userId: string | null | undefined,
): LiveTvGuideStorageKeys {
  const scope = guideScope(userId);
  return {
    config: `${LIVE_TV_GUIDE_CONFIG_KEY}:${scope}`,
    cache: `${LIVE_TV_GUIDE_CACHE_KEY}:${scope}`,
    secureUrl: `${LIVE_TV_GUIDE_SECURE_URL_KEY}:${scope}`,
  };
}

export function liveTvGuideStorageKeysForUser(
  userId: string | null | undefined,
): LiveTvGuideStorageKeys {
  const scope = guideScope(userId);
  return {
    config: `${LIVE_TV_GUIDE_CONFIG_KEY}:${scope}`,
    cache: `${LIVE_TV_GUIDE_CACHE_KEY}:${scope}`,
    secureUrl: [
      LIVE_TV_GUIDE_SECURE_URL_KEY,
      'scope2',
      secureStoreKeyPart(scope),
    ].join('.'),
  };
}

export function liveTvGuideFallbackStorageKeysForUser(
  userId: string | null | undefined,
): LiveTvGuideStorageKeys[] {
  const previousCurrent = previousScopedGuideStorageKeysForUser(userId);
  const guest = liveTvGuideStorageKeysForUser(null);
  const previousGuest = previousScopedGuideStorageKeysForUser(null);

  return userId
    ? [previousCurrent, guest, previousGuest, LEGACY_GUIDE_KEYS]
    : [previousCurrent, LEGACY_GUIDE_KEYS];
}

export interface GuideStringStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface GuideSecureStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface GuideConfigState {
  configured: boolean;
  sourceRevision: number;
  secure: boolean;
  publicUrl?: string;
}

const EMPTY_CONFIG: GuideConfigState = {
  configured: false,
  sourceRevision: 0,
  secure: false,
};

const MAX_GUIDE_CACHE_BYTES = 10_485_760;
const MAX_GUIDE_CONFIG_BYTES = 16_384;
const MAX_GUIDE_URL_LENGTH = 4_096;
const MAX_GUIDE_CHANNEL_ID_LENGTH = 512;
const MAX_GUIDE_DISPLAY_NAME_LENGTH = 500;
const MAX_GUIDE_DISPLAY_NAMES = 20;
const MAX_GUIDE_PROGRAMME_TITLE_LENGTH = 500;
const MAX_GUIDE_PROGRAMME_SUBTITLE_LENGTH = 500;
const MAX_GUIDE_PROGRAMME_DESCRIPTION_LENGTH = 4_000;

function boundedGuideText(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > maxLength
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)
  ) return undefined;
  return normalized;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveRevision(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0;
}

function utf8ByteLength(value: string, stopAfter = Number.POSITIVE_INFINITY): number {
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
    if (bytes > stopAfter) return bytes;
  }
  return bytes;
}

function hasCredentialPathSegment(pathname: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  const credentialSegment =
    /^(?:access[-_]?token|auth[-_]?token|api[-_]?key|apikey|key|token|password|passwd|secret|signature|sig|credential|session)(?:=|:).+/i;

  return decoded
    .split('/')
    .filter(Boolean)
    .some((segment) => {
      if (credentialSegment.test(segment)) return true;
      if (segment.length > 80) return true;
      if (/[={}\[\]"'<>]/.test(segment)) return true;
      if (segment.includes('=')) return true;
      if (/^[a-f0-9]{24,}$/i.test(segment)) return true;
      if (
        /^[A-Za-z0-9_-]{32,}$/.test(segment)
        && /[A-Za-z]/.test(segment)
        && /\d/.test(segment)
      ) return true;
      if (
        segment.length >= 12
        && /[A-Z]/.test(segment)
        && /[a-z]/.test(segment)
        && /\d/.test(segment)
        && !/[._~-]/.test(segment)
      ) return true;
      return false;
    });
}

function normalizedGuideUrl(rawUrl: string): { url: string; secure: boolean } {
  try {
    const input = rawUrl.trim();
    if (!input || input.length > MAX_GUIDE_URL_LENGTH) {
      throw new Error('invalid');
    }
    const parsed = new URL(input);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new Error('invalid');
    }
    parsed.hash = '';
    if (parsed.href.length > MAX_GUIDE_URL_LENGTH) {
      throw new Error('invalid');
    }
    return {
      url: parsed.href,
      secure: Boolean(parsed.search)
        || hasCredentialPathSegment(parsed.pathname),
    };
  } catch {
    throw new Error('Guide URL must be HTTPS without embedded credentials');
  }
}

function safeConfig(value: unknown): GuideConfigState | null {
  const record = recordOf(value);
  if (
    !record
    || record.configured !== true
    || !positiveRevision(record.sourceRevision)
    || typeof record.secure !== 'boolean'
  ) {
    return null;
  }

  if (record.secure) {
    return {
      configured: true,
      sourceRevision: record.sourceRevision,
      secure: true,
    };
  }

  if (typeof record.publicUrl !== 'string') return null;
  try {
    const normalized = normalizedGuideUrl(record.publicUrl);
    if (normalized.secure) return null;
    return {
      configured: true,
      sourceRevision: record.sourceRevision,
      secure: false,
      publicUrl: normalized.url,
    };
  } catch {
    return null;
  }
}

function safeGuideChannel(value: unknown): GuideChannel | null {
  const record = recordOf(value);
  if (!record || !Array.isArray(record.displayNames)) return null;

  const id = boundedGuideText(
    record.id,
    MAX_GUIDE_CHANNEL_ID_LENGTH,
  );
  if (!id) return null;

  const displayNames = [...new Set(
    record.displayNames
      .slice(0, MAX_GUIDE_DISPLAY_NAMES + 1)
      .flatMap((name) => {
        const normalized = boundedGuideText(
          name,
          MAX_GUIDE_DISPLAY_NAME_LENGTH,
        );
        return normalized ? [normalized] : [];
      }),
  )];
  if (
    !displayNames.length
    || displayNames.length > MAX_GUIDE_DISPLAY_NAMES
  ) return null;

  const countryCode = typeof record.countryCode === 'string'
    && /^[A-Za-z]{2}$/.test(record.countryCode)
    ? record.countryCode.toUpperCase()
    : undefined;

  return {
    id,
    displayNames,
    ...(countryCode ? { countryCode } : {}),
  };
}

function safeGuideProgramme(value: unknown): GuideProgramme | null {
  const record = recordOf(value);
  if (!record) return null;

  const channelId = boundedGuideText(
    record.channelId,
    MAX_GUIDE_CHANNEL_ID_LENGTH,
  );
  const title = boundedGuideText(
    record.title,
    MAX_GUIDE_PROGRAMME_TITLE_LENGTH,
  );
  if (
    !channelId
    || !title
    || typeof record.startAtMs !== 'number'
    || !Number.isFinite(record.startAtMs)
    || typeof record.endAtMs !== 'number'
    || !Number.isFinite(record.endAtMs)
    || record.endAtMs <= record.startAtMs
  ) {
    return null;
  }

  const subtitle = record.subtitle === undefined
    ? undefined
    : boundedGuideText(
      record.subtitle,
      MAX_GUIDE_PROGRAMME_SUBTITLE_LENGTH,
    );
  const description = record.description === undefined
    ? undefined
    : boundedGuideText(
      record.description,
      MAX_GUIDE_PROGRAMME_DESCRIPTION_LENGTH,
    );
  if (
    (record.subtitle !== undefined && !subtitle)
    || (record.description !== undefined && !description)
  ) return null;

  return {
    channelId,
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(description ? { description } : {}),
    startAtMs: record.startAtMs,
    endAtMs: record.endAtMs,
  };
}

function safeSnapshot(value: unknown): GuideSnapshot | null {
  const record = recordOf(value);
  if (
    !record
    || !positiveRevision(record.sourceRevision)
    || typeof record.fetchedAtMs !== 'number'
    || !Number.isFinite(record.fetchedAtMs)
    || !Array.isArray(record.channels)
    || !Array.isArray(record.programmes)
  ) return null;

  if (record.channels.length > 20_000 || record.programmes.length > 250_000) return null;

  const channels: GuideChannel[] = [];
  const channelIds = new Set<string>();
  for (const entry of record.channels) {
    const channel = safeGuideChannel(entry);
    if (!channel || channelIds.has(channel.id)) return null;
    channelIds.add(channel.id);
    channels.push(channel);
  }

  const programmes: GuideProgramme[] = [];
  for (const entry of record.programmes) {
    const programme = safeGuideProgramme(entry);
    if (!programme || !channelIds.has(programme.channelId)) return null;
    programmes.push(programme);
  }

  if (!channels.length || !programmes.length) return null;

  return {
    sourceRevision: record.sourceRevision,
    fetchedAtMs: record.fetchedAtMs,
    channels,
    programmes,
  };
}

export class LiveTvGuideRepository {
  constructor(
    private readonly storage: GuideStringStorage,
    private readonly secureStorage: GuideSecureStorage,
    private readonly keys: LiveTvGuideStorageKeys = LEGACY_GUIDE_KEYS,
    private readonly fallbackKeys: readonly LiveTvGuideStorageKeys[] = [],
  ) {}

  private isGuestScope(): boolean {
    return this.keys.config === liveTvGuideStorageKeysForUser(null).config;
  }

  private isLegacyFallback(
    keys: LiveTvGuideStorageKeys,
  ): boolean {
    return (
      keys.config === LEGACY_GUIDE_KEYS.config
      && keys.cache === LEGACY_GUIDE_KEYS.cache
      && keys.secureUrl === LEGACY_GUIDE_KEYS.secureUrl
    );
  }

  private async legacyMigrationAllowed(): Promise<boolean> {
    if (this.keys.config === LEGACY_GUIDE_KEYS.config) return true;
    if (this.isGuestScope()) return true;

    const owner = await this.storage.getItem(
      LIVE_TV_GUIDE_LEGACY_OWNER_KEY,
    );
    if (owner !== null) return owner === this.keys.config;

    await this.storage.setItem(
      LIVE_TV_GUIDE_LEGACY_OWNER_KEY,
      this.keys.config,
    );
    return true;
  }

  private async readMigratedString(
    key: keyof Pick<LiveTvGuideStorageKeys, 'config' | 'cache'>,
  ): Promise<string | null> {
    const primaryKey = this.keys[key];
    const current = await this.storage.getItem(primaryKey);
    if (current !== null) return current;

    for (const fallback of this.fallbackKeys) {
      const fallbackKey = fallback[key];
      if (fallbackKey === primaryKey) continue;
      if (
        this.isLegacyFallback(fallback)
        && !(await this.legacyMigrationAllowed())
      ) {
        continue;
      }
      const value = await this.storage.getItem(fallbackKey);
      if (value === null) continue;

      await this.storage.setItem(primaryKey, value);
      await this.storage.removeItem(fallbackKey);
      return value;
    }

    return null;
  }

  private async readSecureMigrationKey(key: string): Promise<string | null> {
    try {
      return await this.secureStorage.getItemAsync(key);
    } catch {
      // Previous scoped keys used ":" and can be rejected by native Expo
      // SecureStore. They remain readable in browser vaults where migration is
      // still useful, but an invalid native fallback must not block the guide.
      return null;
    }
  }

  private async deleteSecureMigrationKey(key: string): Promise<void> {
    try {
      await this.secureStorage.deleteItemAsync(key);
    } catch {
      // Best-effort cleanup for an old key the native secure store rejects.
    }
  }

  private async readMigratedSecureUrl(): Promise<string | null> {
    const current = await this.secureStorage.getItemAsync(
      this.keys.secureUrl,
    );
    if (current !== null) return current;

    for (const fallback of this.fallbackKeys) {
      if (fallback.secureUrl === this.keys.secureUrl) continue;
      if (
        this.isLegacyFallback(fallback)
        && !(await this.legacyMigrationAllowed())
      ) {
        continue;
      }
      const value = await this.readSecureMigrationKey(
        fallback.secureUrl,
      );
      if (value === null) continue;

      await this.secureStorage.setItemAsync(this.keys.secureUrl, value);
      await this.deleteSecureMigrationKey(fallback.secureUrl);
      return value;
    }

    return null;
  }

  async loadConfig(): Promise<GuideConfigState> {
    const raw = await this.readMigratedString('config');
    if (!raw) return { ...EMPTY_CONFIG };
    if (
      utf8ByteLength(raw, MAX_GUIDE_CONFIG_BYTES)
      > MAX_GUIDE_CONFIG_BYTES
    ) {
      await this.storage.removeItem(this.keys.config);
      return { ...EMPTY_CONFIG };
    }

    try {
      const parsed = safeConfig(JSON.parse(raw));
      if (parsed) return parsed;
    } catch {
      // fall through to cleanup
    }

    await this.storage.removeItem(this.keys.config);
    return { ...EMPTY_CONFIG };
  }

  async resolveUrl(): Promise<string | null> {
    const config = await this.loadConfig();
    if (!config.configured) return null;

    if (config.secure) {
      const secureUrl = await this.readMigratedSecureUrl();
      if (!secureUrl) {
        await this.storage.removeItem(this.keys.config);
        return null;
      }

      try {
        return normalizedGuideUrl(secureUrl).url;
      } catch {
        await Promise.all([
          this.storage.removeItem(this.keys.config),
          this.secureStorage.deleteItemAsync(this.keys.secureUrl),
        ]);
        return null;
      }
    }

    return config.publicUrl ?? null;
  }

  async saveValidatedUrl(rawUrl: string): Promise<GuideConfigState> {
    const normalized = normalizedGuideUrl(rawUrl);
    const current = await this.loadConfig();
    const currentUrl = await this.resolveUrl();
    const unchanged = current.configured
      && current.secure === normalized.secure
      && currentUrl === normalized.url;
    const sourceRevision = unchanged
      ? current.sourceRevision
      : current.sourceRevision >= Number.MAX_SAFE_INTEGER
        ? 1
        : Math.max(1, current.sourceRevision + 1);

    const next: GuideConfigState = normalized.secure
      ? { configured: true, sourceRevision, secure: true }
      : {
        configured: true,
        sourceRevision,
        secure: false,
        publicUrl: normalized.url,
      };

    if (normalized.secure) {
      await this.secureStorage.setItemAsync(
        this.keys.secureUrl,
        normalized.url,
      );
    } else {
      await this.secureStorage.deleteItemAsync(this.keys.secureUrl);
    }

    await this.storage.setItem(this.keys.config, JSON.stringify(next));
    if (!unchanged) await this.clearCache();
    return next;
  }

  async removeConfig(): Promise<void> {
    await Promise.all([
      this.storage.removeItem(this.keys.config),
      this.storage.removeItem(this.keys.cache),
      this.secureStorage.deleteItemAsync(this.keys.secureUrl),
    ]);
  }

  async loadCache(sourceRevision: number): Promise<GuideSnapshot | null> {
    if (!positiveRevision(sourceRevision)) return null;
    const raw = await this.readMigratedString('cache');
    if (!raw) return null;
    if (utf8ByteLength(raw, MAX_GUIDE_CACHE_BYTES) > MAX_GUIDE_CACHE_BYTES) {
      await this.storage.removeItem(this.keys.cache);
      return null;
    }

    try {
      const snapshot = safeSnapshot(JSON.parse(raw));
      if (!snapshot) {
        await this.storage.removeItem(this.keys.cache);
        return null;
      }
      if (snapshot.sourceRevision !== sourceRevision) {
        await this.storage.removeItem(this.keys.cache);
        return null;
      }
      return snapshot;
    } catch {
      await this.storage.removeItem(this.keys.cache);
      return null;
    }
  }

  async saveCache(snapshot: GuideSnapshot): Promise<void> {
    const safe = safeSnapshot(snapshot);
    if (!safe) throw new Error('Invalid Live TV guide cache snapshot');
    const serialized = JSON.stringify(safe);
    if (
      utf8ByteLength(serialized, MAX_GUIDE_CACHE_BYTES)
      > MAX_GUIDE_CACHE_BYTES
    ) {
      await this.storage.removeItem(this.keys.cache);
      throw new Error('Live TV guide cache is too large');
    }
    await this.storage.setItem(this.keys.cache, serialized);
  }

  async clearCache(): Promise<void> {
    await this.storage.removeItem(this.keys.cache);
  }
}
