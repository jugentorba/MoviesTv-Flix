import { stableTextCompare } from '@moviestv/core';
import {
  safeManifestUrlForSync,
  sanitizeAddonConfig,
  type AddonStateRecord,
} from '@moviestv/addons';
import type { KeyValueStore } from '@moviestv/storage';

const DEFAULT_STORAGE_KEY = 'moviestv.addons';
const GUEST_STORAGE_KEY = 'moviestv.addons:guest';
const PRIORITY_STEP = 100;

export interface PendingAddonRemoval {
  addonId: string;
  removedAt: string;
}

interface AddonSyncOutbox {
  upsertIds: string[];
  removals: PendingAddonRemoval[];
}

const EMPTY_OUTBOX: AddonSyncOutbox = {
  upsertIds: [],
  removals: [],
};

const LEGACY_REMOVAL_TIMESTAMP = '1970-01-01T00:00:00.000Z';

const SENSITIVE_CONFIG_KEY =
  /(api[-_]?key|access[-_]?token|auth[-_]?token|bearer|credential|debrid|password|passwd|secret|token)/i;

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeStoredString(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > maxLength
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) return undefined;
  return normalized;
}

function stringArray(
  value: unknown,
  allowed?: ReadonlySet<string>,
  maxItems = 500,
): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const normalized: string[] = [];
  for (const entry of value) {
    const text = safeStoredString(entry, 512);
    if (!text || (allowed && !allowed.has(text))) return null;
    normalized.push(text);
  }
  return normalized;
}

function validConfigurationFields(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 200) return false;
  const allowedTypes = new Set([
    'text',
    'secret',
    'boolean',
    'select',
    'url',
  ]);
  return value.every((entry) => {
    const field = objectRecord(entry);
    if (
      !field
      || !safeStoredString(field.key, 128)
      || !safeStoredString(field.label, 256)
      || typeof field.type !== 'string'
      || !allowedTypes.has(field.type)
      || typeof field.required !== 'boolean'
      || typeof field.secret !== 'boolean'
    ) return false;
    if (field.defaultValue !== undefined) {
      if (
        typeof field.defaultValue === 'string'
        && !safeStoredString(field.defaultValue, 2_048)
      ) return false;
      if (
        typeof field.defaultValue !== 'string'
        && typeof field.defaultValue !== 'boolean'
      ) return false;
    }
    if (field.options !== undefined) {
      if (!Array.isArray(field.options) || field.options.length > 200) {
        return false;
      }
      if (!field.options.every((option) => {
        const item = objectRecord(option);
        return Boolean(
          item
          && safeStoredString(item.value, 256)
          && safeStoredString(item.label, 256),
        );
      })) return false;
    }
    return true;
  });
}

function validRequestProtocol(value: unknown): boolean {
  const protocol = objectRecord(value);
  if (!protocol) return false;
  return Boolean(
    stringArray(
      protocol.types,
      new Set(['movie', 'series']),
      2,
    )
    && stringArray(protocol.idPrefixes, undefined, 500),
  );
}

function validCatalogProtocol(value: unknown): boolean {
  const protocol = objectRecord(value);
  if (!protocol || !Array.isArray(protocol.catalogs) || protocol.catalogs.length > 500) {
    return false;
  }
  const validCatalogs = protocol.catalogs.every((entry) => {
    const catalog = objectRecord(entry);
    if (
      !catalog
      || (catalog.type !== 'movie' && catalog.type !== 'series')
      || !safeStoredString(catalog.id, 512)
      || !safeStoredString(catalog.name, 500)
      || !Array.isArray(catalog.extra)
      || catalog.extra.length > 100
    ) return false;
    return catalog.extra.every((extraValue) => {
      const extra = objectRecord(extraValue);
      if (
        !extra
        || !safeStoredString(extra.name, 128)
        || typeof extra.isRequired !== 'boolean'
      ) return false;
      return extra.options === undefined
        || Boolean(stringArray(extra.options, undefined, 200));
    });
  });
  if (!validCatalogs) return false;
  return protocol.meta === undefined || validRequestProtocol(protocol.meta);
}

function validLiveTvProtocol(value: unknown): boolean {
  const protocol = objectRecord(value);
  if (
    !protocol
    || !Array.isArray(protocol.catalogs)
    || protocol.catalogs.length > 500
  ) return false;
  const allowedTypes = new Set(['channel', 'tv']);
  if (!stringArray(protocol.streamTypes, allowedTypes, 2)) return false;
  return protocol.catalogs.every((entry) => {
    const catalog = objectRecord(entry);
    return Boolean(
      catalog
      && typeof catalog.type === 'string'
      && allowedTypes.has(catalog.type)
      && safeStoredString(catalog.id, 512)
      && safeStoredString(catalog.name, 500)
      && (
        catalog.requiredExtras === undefined
        || stringArray(catalog.requiredExtras, undefined, 100)
      ),
    );
  });
}

const SENSITIVE_CONFIG_VALUE =
  /(?:^|[\s?&#;,])(?:token|key|secret|auth|signature|session|credential)\s*[:=]/i;

function hasCredentialPathSegment(pathname: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  const credentialSegment =
    /^(?:access[-_]?token|auth[-_]?token|api[-_]?key|apikey|key|token|password|passwd|secret|signature|sig|credential|session|debrid|alldebrid|realdebrid)(?:=|:).+/i;
  return decoded
    .split('/')
    .some((segment) => credentialSegment.test(segment));
}

function hasSensitiveUrlFragment(
  hash: string,
  sensitive: RegExp,
): boolean {
  if (!hash) return false;
  try {
    return sensitive.test(decodeURIComponent(hash.slice(1)));
  } catch {
    return true;
  }
}

function safeStoredArtworkUrl(value: unknown): string | undefined {
  const normalized = safeStoredString(value, 2_048);
  if (!normalized || SENSITIVE_CONFIG_VALUE.test(normalized)) {
    return undefined;
  }
  try {
    const url = new URL(normalized);
    const sensitive =
      /token|key|secret|auth|signature|session|credential/i;
    const hasSensitiveQuery = [...url.searchParams.entries()].some(
      ([key, queryValue]) => (
        sensitive.test(key)
        || sensitive.test(queryValue)
      ),
    );
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:')
      || url.username
      || url.password
      || hasSensitiveQuery
      || hasSensitiveUrlFragment(url.hash, sensitive)
      || hasCredentialPathSegment(url.pathname)
      || url.href.length > 2_048
    ) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function safeLegacyConfigValue(value: unknown): string | boolean | undefined {
  if (typeof value === 'boolean') return value;
  const text = safeStoredString(value, 2_048);
  if (!text || SENSITIVE_CONFIG_VALUE.test(text)) return undefined;

  try {
    const url = new URL(text);
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '');
    const localHttp = url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '::1'].includes(hostname);
    const sensitive =
      /token|key|secret|auth|signature|session|credential/i;
    const hasSensitiveQuery = [...url.searchParams.entries()].some(
      ([key, queryValue]) => (
        sensitive.test(key)
        || sensitive.test(queryValue)
      ),
    );
    if (
      (url.protocol !== 'https:' && !localHttp)
      || url.username
      || url.password
      || hasSensitiveQuery
      || hasSensitiveUrlFragment(url.hash, sensitive)
      || hasCredentialPathSegment(url.pathname)
      || url.href.length > 2_048
    ) return undefined;
    return url.href;
  } catch {
    return text;
  }
}

function scrubDescriptorSensitiveFields(
  descriptor: NonNullable<AddonStateRecord['descriptor']>,
): NonNullable<AddonStateRecord['descriptor']> {
  const sensitiveKeys = new Set(
    descriptor.configurationFields
      .filter((field) => (
        field.secret
        || field.type === 'secret'
        || SENSITIVE_CONFIG_KEY.test(field.key)
        || SENSITIVE_CONFIG_KEY.test(field.label)
      ))
      .map((field) => field.key),
  );

  const configurationFields = descriptor.configurationFields.map((field) => {
    const sensitive = sensitiveKeys.has(field.key);
    if (sensitive) {
      const scrubbed = {
        ...field,
        type: 'secret' as const,
        secret: true,
      };
      delete scrubbed.defaultValue;
      delete scrubbed.options;
      return scrubbed;
    }

    const scrubbed = { ...field };
    if (field.defaultValue !== undefined) {
      const safeDefault = sanitizeAddonConfig(
        [scrubbed],
        { [scrubbed.key]: field.defaultValue },
      )[scrubbed.key];
      if (safeDefault === undefined) delete scrubbed.defaultValue;
      else scrubbed.defaultValue = safeDefault;
    }
    return scrubbed;
  });
  const logoUrl = safeStoredArtworkUrl(descriptor.logoUrl);
  const scrubbed = {
    ...descriptor,
    configurationFields,
  };
  if (logoUrl) scrubbed.logoUrl = logoUrl;
  else delete scrubbed.logoUrl;
  return scrubbed;
}

function usableDescriptor(value: unknown): value is NonNullable<AddonStateRecord['descriptor']> {
  const descriptor = objectRecord(value);
  if (!descriptor) return false;
  const allowedCapabilities = new Set([
    'stream',
    'catalog',
    'subtitle',
    'live-tv',
  ]);
  const allowedKinds = new Set(['movie', 'series']);
  if (
    !safeStoredString(descriptor.id, 512)
    || !safeStoredString(descriptor.name, 500)
    || !safeStoredString(descriptor.version, 128)
    || (descriptor.sourceType !== 'native'
      && descriptor.sourceType !== 'stremio-manifest')
    || !stringArray(descriptor.capabilities, allowedCapabilities, 4)
    || typeof descriptor.requiresConfiguration !== 'boolean'
    || !validConfigurationFields(descriptor.configurationFields)
    || !stringArray(descriptor.supportedMediaKinds, allowedKinds, 2)
    || (
      descriptor.configurable !== undefined
      && typeof descriptor.configurable !== 'boolean'
    )
    || (
      descriptor.description !== undefined
      && !safeStoredString(descriptor.description, 4_000)
    )
    || (
      descriptor.logoUrl !== undefined
      && !safeStoredString(descriptor.logoUrl, 2_048)
    )
  ) return false;

  if (descriptor.stream !== undefined && !validRequestProtocol(descriptor.stream)) {
    return false;
  }
  if (
    descriptor.subtitle !== undefined
    && !validRequestProtocol(descriptor.subtitle)
  ) return false;
  if (
    descriptor.catalog !== undefined
    && !validCatalogProtocol(descriptor.catalog)
  ) return false;
  if (
    descriptor.liveTv !== undefined
    && !validLiveTvProtocol(descriptor.liveTv)
  ) return false;
  return true;
}

function usableSyncIdentity(
  value: unknown,
): value is NonNullable<AddonStateRecord['syncIdentity']> {
  const identity = objectRecord(value);
  if (!identity) return false;
  return Boolean(
    safeStoredString(identity.name, 500)
    && stringArray(
      identity.capabilities,
      new Set(['stream', 'catalog', 'subtitle', 'live-tv']),
      4,
    )
    && stringArray(
      identity.supportedMediaKinds,
      new Set(['movie', 'series']),
      2,
    )
    && typeof identity.configurable === 'boolean',
  );
}

function normalizedSafeConfig(
  value: unknown,
  descriptor?: NonNullable<AddonStateRecord['descriptor']>,
): AddonStateRecord['safeConfig'] {
  const source = objectRecord(value);
  if (!source) return {};

  const generic: AddonStateRecord['safeConfig'] = {};
  for (const [rawKey, rawValue] of Object.entries(source).slice(0, 200)) {
    const key = safeStoredString(rawKey, 128);
    if (!key || SENSITIVE_CONFIG_KEY.test(key)) continue;
    const safe = safeLegacyConfigValue(rawValue);
    if (safe !== undefined) generic[key] = safe;
  }

  return descriptor
    ? sanitizeAddonConfig(
      descriptor.configurationFields,
      generic,
    )
    : generic;
}

function normalizeStoredRecord(value: unknown): AddonStateRecord | null {
  const record = objectRecord(value);
  const installed = objectRecord(record?.installed);
  if (!record || !installed) return null;

  const addonId = safeStoredString(installed.addonId, 512);
  const sourceType = installed.sourceType;
  const installedAt = safeStoredString(installed.installedAt, 64);
  const updatedAt = safeStoredString(installed.updatedAt, 64);
  if (
    !addonId
    || (sourceType !== 'native' && sourceType !== 'stremio-manifest')
    || typeof installed.enabled !== 'boolean'
    || typeof installed.priority !== 'number'
    || !Number.isFinite(installed.priority)
    || !installedAt
    || !updatedAt
    || !validTimestamp(installedAt)
    || !validTimestamp(updatedAt)
    || typeof installed.setupIncomplete !== 'boolean'
  ) return null;

  const manifestUrl = typeof installed.manifestUrl === 'string'
    ? safeManifestUrlForSync(installed.manifestUrl)
    : undefined;
  const lastValidatedAt = (
    typeof installed.lastValidatedAt === 'string'
    && validTimestamp(installed.lastValidatedAt)
  )
    ? installed.lastValidatedAt
    : undefined;

  let descriptor = usableDescriptor(record.descriptor)
    ? scrubDescriptorSensitiveFields(record.descriptor)
    : undefined;
  if (descriptor?.manifestUrl) {
    const safeDescriptorManifest = safeManifestUrlForSync(
      descriptor.manifestUrl,
    );
    descriptor = {
      ...descriptor,
      ...(safeDescriptorManifest
        ? { manifestUrl: safeDescriptorManifest }
        : {}),
    };
    if (!safeDescriptorManifest) delete descriptor.manifestUrl;
  }

  return {
    installed: {
      addonId,
      ...(manifestUrl ? { manifestUrl } : {}),
      sourceType,
      enabled: installed.enabled,
      priority: installed.priority,
      installedAt,
      updatedAt,
      ...(lastValidatedAt ? { lastValidatedAt } : {}),
      setupIncomplete: installed.setupIncomplete,
    },
    safeConfig: normalizedSafeConfig(
      record.safeConfig,
      descriptor,
    ),
    ...(descriptor ? { descriptor } : {}),
    ...(usableSyncIdentity(record.syncIdentity)
      ? { syncIdentity: record.syncIdentity }
      : {}),
  };
}

function normalizeStoredRecords(
  values: readonly unknown[],
): AddonStateRecord[] {
  const byId = new Map<string, AddonStateRecord>();
  for (const value of values.slice(0, 500)) {
    const record = normalizeStoredRecord(value);
    if (!record) continue;
    const existing = byId.get(record.installed.addonId);
    if (
      !existing
      || Date.parse(record.installed.updatedAt)
        > Date.parse(existing.installed.updatedAt)
    ) {
      byId.set(record.installed.addonId, record);
    }
  }
  return [...byId.values()];
}

function sortByPriority(
  records: readonly AddonStateRecord[],
): AddonStateRecord[] {
  return [...records].sort((left, right) =>
    right.installed.priority - left.installed.priority
    || stableTextCompare(left.installed.addonId, right.installed.addonId));
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(
    values.filter((value) => typeof value === 'string' && value.trim()),
  )];
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function normalizeRemovals(
  values: readonly PendingAddonRemoval[],
): PendingAddonRemoval[] {
  const byId = new Map<string, PendingAddonRemoval>();
  for (const value of values) {
    if (!value.addonId?.trim() || !validTimestamp(value.removedAt)) continue;
    const current = byId.get(value.addonId);
    if (
      !current
      || Date.parse(value.removedAt) > Date.parse(current.removedAt)
    ) {
      byId.set(value.addonId, {
        addonId: value.addonId,
        removedAt: value.removedAt,
      });
    }
  }
  return [...byId.values()];
}

export function addonStorageKeyForUser(
  userId: string | null | undefined,
): string {
  return userId
    ? `moviestv.addons:user:${encodeURIComponent(userId)}`
    : GUEST_STORAGE_KEY;
}

export function addonFallbackStorageKeysForUser(
  userId: string | null | undefined,
): string[] {
  return userId
    ? [GUEST_STORAGE_KEY, DEFAULT_STORAGE_KEY]
    : [DEFAULT_STORAGE_KEY];
}

export class AsyncStorageAddonRepository {
  private readonly syncOutboxKey: string;

  constructor(
    private readonly store: KeyValueStore,
    private readonly storageKey = DEFAULT_STORAGE_KEY,
    private readonly fallbackStorageKeys: readonly string[] = [],
  ) {
    this.syncOutboxKey = `${storageKey}:sync-outbox`;
  }

  async list(): Promise<AddonStateRecord[]> {
    const records = await this.store.get<unknown>(
      this.storageKey,
    );
    if (Array.isArray(records)) {
      const normalized = sortByPriority(normalizeStoredRecords(records));
      if (JSON.stringify(normalized) !== JSON.stringify(records)) {
        await this.store.set(this.storageKey, normalized);
      }
      return normalized;
    }

    if (records !== null) {
      await this.store.remove(this.storageKey);
    }

    for (const fallbackKey of this.fallbackStorageKeys) {
      if (fallbackKey === this.storageKey) continue;
      const fallback = await this.store.get<unknown>(fallbackKey);
      if (!Array.isArray(fallback)) {
        if (fallback !== null) await this.store.remove(fallbackKey);
        continue;
      }

      const migrated = sortByPriority(normalizeStoredRecords(fallback));
      await this.store.set(this.storageKey, migrated);
      await this.store.remove(fallbackKey);

      if (this.storageKey.startsWith('moviestv.addons:user:')) {
        for (const record of migrated) {
          await this.markPendingUpsert(record.installed.addonId);
        }
      }

      return migrated;
    }

    return [];
  }

  async save(record: AddonStateRecord): Promise<void> {
    const normalizedRecord = normalizeStoredRecord(record);
    if (!normalizedRecord) {
      throw new Error('Provider metadata is invalid');
    }

    const records = await this.list();
    const index = records.findIndex(
      (candidate) => (
        candidate.installed.addonId
        === normalizedRecord.installed.addonId
      ),
    );

    if (index >= 0) records[index] = normalizedRecord;
    else records.push(normalizedRecord);

    await this.store.set(
      this.storageKey,
      sortByPriority(records),
    );
  }

  async remove(addonId: string): Promise<void> {
    const records = await this.list();
    await this.store.set(
      this.storageKey,
      records.filter(
        (record) => record.installed.addonId !== addonId,
      ),
    );
  }

  async pendingUpsertIds(): Promise<string[]> {
    return (await this.readOutbox()).upsertIds;
  }

  async pendingRemovalIds(): Promise<string[]> {
    return (await this.readOutbox()).removals.map(
      ({ addonId }) => addonId,
    );
  }

  async pendingRemovals(): Promise<PendingAddonRemoval[]> {
    return (await this.readOutbox()).removals;
  }

  async markPendingUpsert(addonId: string): Promise<void> {
    const outbox = await this.readOutbox();
    await this.writeOutbox({
      upsertIds: uniqueIds([...outbox.upsertIds, addonId]),
      removals: outbox.removals.filter(
        (removal) => removal.addonId !== addonId,
      ),
    });
  }

  async clearPendingUpsert(addonId: string): Promise<void> {
    const outbox = await this.readOutbox();
    await this.writeOutbox({
      ...outbox,
      upsertIds: outbox.upsertIds.filter((id) => id !== addonId),
    });
  }

  async markPendingRemoval(
    addonId: string,
    removedAt = new Date().toISOString(),
  ): Promise<void> {
    const outbox = await this.readOutbox();
    await this.writeOutbox({
      upsertIds: outbox.upsertIds.filter((id) => id !== addonId),
      removals: normalizeRemovals([
        ...outbox.removals.filter(
          (removal) => removal.addonId !== addonId,
        ),
        { addonId, removedAt },
      ]),
    });
  }

  async clearPendingRemoval(addonId: string): Promise<void> {
    const outbox = await this.readOutbox();
    await this.writeOutbox({
      ...outbox,
      removals: outbox.removals.filter(
        (removal) => removal.addonId !== addonId,
      ),
    });
  }

  async reorder(
    addonIds: readonly string[],
    updatedAt?: string,
  ): Promise<void> {
    const normalizedUpdatedAt = updatedAt === undefined
      ? undefined
      : safeStoredString(updatedAt, 64);
    if (
      updatedAt !== undefined
      && (
        !normalizedUpdatedAt
        || !validTimestamp(normalizedUpdatedAt)
      )
    ) {
      throw new TypeError('Invalid provider reorder timestamp');
    }

    const records = await this.list();
    const byId = new Map(
      records.map((record) => [record.installed.addonId, record]),
    );
    const ordered: AddonStateRecord[] = [];
    const seen = new Set<string>();

    for (const addonId of addonIds) {
      const record = byId.get(addonId);
      if (!record || seen.has(addonId)) continue;
      ordered.push(record);
      seen.add(addonId);
    }

    for (const record of records) {
      if (seen.has(record.installed.addonId)) continue;
      ordered.push(record);
      seen.add(record.installed.addonId);
    }

    const reprioritized = ordered.map((record, index) => ({
      ...record,
      installed: {
        ...record.installed,
        priority: (ordered.length - index) * PRIORITY_STEP,
        ...(normalizedUpdatedAt
          ? { updatedAt: normalizedUpdatedAt }
          : {}),
      },
    }));

    await this.store.set(this.storageKey, reprioritized);
  }

  private async readOutbox(): Promise<AddonSyncOutbox> {
    const raw = await this.store.get<unknown>(this.syncOutboxKey);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      if (raw !== null) await this.store.remove(this.syncOutboxKey);
      return { ...EMPTY_OUTBOX };
    }

    const record = raw as Record<string, unknown>;
    const removals = Array.isArray(record.removals)
      ? record.removals.flatMap((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return [];
        }
        const removal = value as Record<string, unknown>;
        if (
          typeof removal.addonId !== 'string'
          || !removal.addonId.trim()
          || !validTimestamp(removal.removedAt)
        ) {
          return [];
        }
        return [{
          addonId: removal.addonId,
          removedAt: removal.removedAt,
        }];
      })
      : [];

    const legacyRemovals = Array.isArray(record.removalIds)
      ? uniqueIds(record.removalIds.filter(
        (value): value is string => typeof value === 'string',
      )).map((addonId) => ({
        addonId,
        removedAt: LEGACY_REMOVAL_TIMESTAMP,
      }))
      : [];

    return {
      upsertIds: Array.isArray(record.upsertIds)
        ? uniqueIds(record.upsertIds.filter(
          (value): value is string => typeof value === 'string',
        ))
        : [],
      removals: normalizeRemovals([
        ...removals,
        ...legacyRemovals,
      ]),
    };
  }

  private async writeOutbox(outbox: AddonSyncOutbox): Promise<void> {
    const normalized = {
      upsertIds: uniqueIds(outbox.upsertIds),
      removals: normalizeRemovals(outbox.removals),
    };

    if (
      normalized.upsertIds.length === 0
      && normalized.removals.length === 0
    ) {
      await this.store.remove(this.syncOutboxKey);
      return;
    }

    await this.store.set(this.syncOutboxKey, normalized);
  }
}
