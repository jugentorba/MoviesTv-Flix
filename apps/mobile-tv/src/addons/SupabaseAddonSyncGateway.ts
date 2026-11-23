import type { SupabaseClient } from '@supabase/supabase-js';
import {
  safeManifestUrlForSync,
  type AddonCapability,
  type SafeAddonConfigValue,
  type SafeAddonSyncRecord,
} from '@moviestv/addons';

const SENSITIVE_CONFIG_KEY =
  /(api[-_]?key|access[-_]?token|auth[-_]?token|bearer|credential|debrid|password|passwd|secret|token)/i;

export const DEFAULT_ADDON_SYNC_TIMEOUT_MS = 8_000;

async function withSyncTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Provider synchronization timeout is invalid');
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Provider synchronization timed out'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve(operation),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function safeString(
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

function safeUserId(value: string): string {
  const normalized = typeof value === 'string'
    ? value.trim()
    : '';
  if (
    !normalized
    || normalized.length > 512
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error('Provider sync user id is invalid');
  }
  return normalized;
}

function validTimestamp(value: unknown): value is string {
  return Boolean(
    safeString(value, 64)
    && !Number.isNaN(Date.parse(value as string)),
  );
}

function safePriority(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= -2_147_483_648
    && value <= 2_147_483_647
    ? value
    : null;
}

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

function safeConfigString(value: unknown): string | undefined {
  const text = safeString(value, 2_048);
  if (!text) return undefined;

  const sensitiveAssignment =
    /(?:^|[\s?&#;,])(?:token|key|secret|auth|signature|session|credential)\s*[:=]/i;
  if (sensitiveAssignment.test(text)) return undefined;

  try {
    const url = new URL(text);
    const sensitive =
      /token|key|secret|auth|signature|session|credential/i;
    const hasSensitiveQuery = [...url.searchParams.entries()].some(
      ([key, queryValue]) => (
        sensitive.test(key)
        || sensitive.test(queryValue)
      ),
    );
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || hasSensitiveQuery
      || hasSensitiveUrlFragment(url.hash, sensitive)
      || hasCredentialPathSegment(url.pathname)
      || url.href.length > 2_048
    ) {
      return undefined;
    }
    return url.href;
  } catch {
    return text;
  }
}

function safeConfig(value: unknown): Record<string, SafeAddonConfigValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const result: Record<string, SafeAddonConfigValue> = {};
  for (
    const [rawKey, entry]
    of Object.entries(value as Record<string, unknown>).slice(0, 200)
  ) {
    const key = safeString(rawKey, 128);
    if (!key || SENSITIVE_CONFIG_KEY.test(key)) continue;
    if (typeof entry === 'boolean') {
      result[key] = entry;
      continue;
    }
    const text = safeConfigString(entry);
    if (text) result[key] = text;
  }
  return result;
}

function safeCapabilities(value: unknown): AddonCapability[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<AddonCapability>([
    'stream',
    'catalog',
    'subtitle',
    'live-tv',
  ]);
  return [...new Set(
    value
      .slice(0, 20)
      .filter((entry): entry is AddonCapability => (
        typeof entry === 'string'
        && allowed.has(entry as AddonCapability)
      )),
  )].slice(0, 4);
}

function safeMediaKinds(value: unknown): Array<'movie' | 'series'> {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .slice(0, 20)
      .filter((entry): entry is 'movie' | 'series' => (
        entry === 'movie' || entry === 'series'
      )),
  )].slice(0, 2);
}

function mapRow(value: unknown): SafeAddonSyncRecord | null {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
  ) return null;
  const row = value as Record<string, unknown>;
  const addonId = safeString(row.addon_id, 512);
  const priority = safePriority(row.priority);
  if (!addonId) return null;
  if (
    row.source_type !== 'native'
    && row.source_type !== 'stremio-manifest'
  ) return null;
  if (typeof row.enabled !== 'boolean' || priority === null) return null;
  if (
    typeof row.setup_incomplete !== 'boolean'
    || !validTimestamp(row.updated_at)
  ) return null;

  const manifestUrl = typeof row.manifest_url === 'string'
    ? safeManifestUrlForSync(row.manifest_url)
    : undefined;
  const name = safeString(row.provider_name, 500);
  const capabilities = safeCapabilities(row.capabilities);
  const supportedMediaKinds = safeMediaKinds(row.media_kinds);
  const configurable = row.configurable === true;

  return {
    addonId,
    ...(manifestUrl ? { manifestUrl } : {}),
    sourceType: row.source_type,
    enabled: row.enabled,
    priority,
    safeConfig: safeConfig(row.safe_config),
    setupIncomplete: row.setup_incomplete,
    updatedAt: row.updated_at as string,
    ...(name || capabilities.length || supportedMediaKinds.length || configurable ? {
      identity: {
        name: name ?? addonId,
        capabilities,
        supportedMediaKinds,
        configurable,
      },
    } : {}),
  };
}

export class SupabaseAddonSyncGateway {
  constructor(
    private readonly client: SupabaseClient,
    private readonly timeoutMs = DEFAULT_ADDON_SYNC_TIMEOUT_MS,
  ) {}

  async list(userId: string): Promise<SafeAddonSyncRecord[]> {
    const normalizedUserId = safeUserId(userId);
    const ordered = this.client
      .from('user_addons')
      .select(
        'addon_id,manifest_url,source_type,enabled,priority,safe_config,setup_incomplete,updated_at,provider_name,capabilities,media_kinds,configurable',
      )
      .eq('user_id', normalizedUserId)
      .order('priority', { ascending: false });
    const { data, error } = await withSyncTimeout(
      typeof ordered.limit === 'function'
        ? ordered.limit(500)
        : ordered,
      this.timeoutMs,
    );

    if (error) throw new Error(error.message);
    if (!Array.isArray(data)) return [];

    return data
      .slice(0, 500)
      .map((row) => mapRow(row))
      .filter((record): record is SafeAddonSyncRecord => record !== null);
  }

  async upsert(userId: string, record: SafeAddonSyncRecord): Promise<void> {
    const normalizedUserId = safeUserId(userId);
    const addonId = safeString(record.addonId, 512);
    const priority = safePriority(record.priority);
    const updatedAt = validTimestamp(record.updatedAt)
      ? record.updatedAt
      : null;
    if (
      !addonId
      || priority === null
      || !updatedAt
      || (record.sourceType !== 'native'
        && record.sourceType !== 'stremio-manifest')
      || typeof record.enabled !== 'boolean'
      || typeof record.setupIncomplete !== 'boolean'
    ) {
      throw new Error('Provider sync record is invalid');
    }

    const manifestUrl = safeManifestUrlForSync(record.manifestUrl);
    const identityName = safeString(record.identity?.name, 500);
    const capabilities = safeCapabilities(record.identity?.capabilities);
    const mediaKinds = safeMediaKinds(
      record.identity?.supportedMediaKinds,
    );
    const identity = record.identity && identityName
      ? {
          provider_name: identityName,
          capabilities,
          media_kinds: mediaKinds,
          configurable: record.identity.configurable === true,
        }
      : {
          provider_name: null,
          capabilities: [],
          media_kinds: [],
          configurable: false,
        };

    const { error } = await withSyncTimeout(
      this.client.from('user_addons').upsert({
        user_id: normalizedUserId,
        addon_id: addonId,
        manifest_url: manifestUrl ?? null,
        source_type: record.sourceType,
        enabled: record.enabled,
        priority,
        safe_config: safeConfig(record.safeConfig),
        setup_incomplete: record.setupIncomplete,
        updated_at: updatedAt,
        ...identity,
      }),
      this.timeoutMs,
    );

    if (error) throw new Error(error.message);
  }

  async remove(
    userId: string,
    addonId: string,
    notNewerThan?: string,
  ): Promise<boolean | void> {
    const normalizedUserId = safeUserId(userId);
    const normalizedAddonId = safeString(addonId, 512);
    if (!normalizedAddonId) {
      throw new Error('Provider id is invalid');
    }
    if (notNewerThan !== undefined && !validTimestamp(notNewerThan)) {
      throw new Error('Provider removal timestamp is invalid');
    }

    let query = this.client
      .from('user_addons')
      .delete()
      .eq('user_id', normalizedUserId)
      .eq('addon_id', normalizedAddonId);

    if (!notNewerThan) {
      const { error } = await withSyncTimeout(
        query,
        this.timeoutMs,
      );
      if (error) throw new Error(error.message);
      return;
    }

    query = query.lte('updated_at', notNewerThan);
    const { data, error } = await withSyncTimeout(
      query.select('addon_id'),
      this.timeoutMs,
    );
    if (error) throw new Error(error.message);
    return Array.isArray(data) && data.length > 0;
  }
}
