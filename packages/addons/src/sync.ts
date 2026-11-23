import { stableTextCompare } from '@moviestv/core';
import { isSafePublicConfiguredManifestUrl } from './stremio-config';
import { MAX_PROVIDER_URL_LENGTH } from './url-policy';
import type {
  AddonConfigField,
  AddonDescriptor,
  InstalledAddon,
  SafeAddonConfigValue,
} from './types';

export interface SafeAddonSyncIdentity {
  name: string;
  capabilities: AddonDescriptor['capabilities'];
  supportedMediaKinds: AddonDescriptor['supportedMediaKinds'];
  configurable: boolean;
}

export interface SafeAddonSyncRecord {
  addonId: string;
  manifestUrl?: string;
  sourceType: InstalledAddon['sourceType'];
  enabled: boolean;
  priority: number;
  safeConfig: Record<string, SafeAddonConfigValue>;
  setupIncomplete: boolean;
  updatedAt: string;
  identity?: SafeAddonSyncIdentity;
}

export interface AddonStateRecord {
  installed: InstalledAddon;
  safeConfig: Record<string, SafeAddonConfigValue>;
  descriptor?: AddonDescriptor;
  syncIdentity?: SafeAddonSyncIdentity;
}

const SENSITIVE_CONFIG_KEY =
  /(api[-_]?key|access[-_]?token|auth[-_]?token|bearer|credential|debrid|password|passwd|secret|token)/i;

const SENSITIVE_CONFIG_VALUE =
  /(?:^|[\s?&#;,])(?:token|key|secret|auth|signature|session|credential)\s*[:=]/i;

function safeLocalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > 2_048
    || /[\u0000-\u001f\u007f]/.test(normalized)
    || SENSITIVE_CONFIG_VALUE.test(normalized)
  ) return undefined;
  return normalized;
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

function safeLocalUrl(value: unknown): string | undefined {
  const normalized = safeLocalString(value);
  if (!normalized) return undefined;

  try {
    const url = new URL(normalized);
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
    return undefined;
  }
}

function safeLocalValue(
  field: AddonConfigField,
  value: unknown,
): SafeAddonConfigValue | undefined {
  if (field.type === 'boolean') {
    return typeof value === 'boolean' ? value : undefined;
  }

  const normalized = field.type === 'url'
    ? safeLocalUrl(value)
    : safeLocalString(value);
  if (!normalized) return undefined;

  if (
    field.type === 'select'
    && field.options?.length
    && !field.options.some((option) => option.value === normalized)
  ) {
    return undefined;
  }

  return normalized;
}

function safeSyncValue(
  field: AddonConfigField,
  value: unknown,
): SafeAddonConfigValue | undefined {
  const normalized = safeLocalValue(field, value);
  if (normalized === undefined) return undefined;
  if (field.type !== 'url' || typeof normalized !== 'string') {
    return normalized;
  }

  try {
    const url = new URL(normalized);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function isSensitiveAddonConfigField(field: AddonConfigField): boolean {
  return field.secret
    || field.type === 'secret'
    || SENSITIVE_CONFIG_KEY.test(field.key)
    || SENSITIVE_CONFIG_KEY.test(field.label);
}

function sanitizedAddonConfig(
  fields: AddonConfigField[],
  values: Record<string, unknown>,
  sanitizeValue: (
    field: AddonConfigField,
    value: unknown,
  ) => SafeAddonConfigValue | undefined,
): Record<string, SafeAddonConfigValue> {
  const sensitiveKeys = new Set(
    fields
      .filter(isSensitiveAddonConfigField)
      .map((field) => field.key),
  );
  const result: Record<string, SafeAddonConfigValue> = {};
  for (const field of fields) {
    // A malformed manifest can declare the same key more than once with
    // conflicting field types. If any declaration is sensitive, treat the
    // whole key as sensitive so the submitted value can never be copied into
    // plain metadata by a duplicate non-secret declaration.
    if (sensitiveKeys.has(field.key)) continue;
    const value = sanitizeValue(field, values[field.key]);
    if (value === undefined) continue;
    result[field.key] = value;
  }
  return result;
}

export function sanitizeAddonConfig(
  fields: AddonConfigField[],
  values: Record<string, unknown>,
): Record<string, SafeAddonConfigValue> {
  return sanitizedAddonConfig(fields, values, safeLocalValue);
}

function sanitizeAddonConfigForSync(
  fields: AddonConfigField[],
  values: Record<string, unknown>,
): Record<string, SafeAddonConfigValue> {
  return sanitizedAddonConfig(fields, values, safeSyncValue);
}

function suspiciousConfiguredPath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  const configSegments = segments.at(-1) === 'manifest.json'
    ? segments.slice(0, -1)
    : segments;

  return configSegments.some((segment) => {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return true;
    }

    if (decoded.length > 80) return true;
    if (/[={}\[\]"'<>]/.test(decoded)) return true;
    if (SENSITIVE_CONFIG_KEY.test(decoded)) return true;

    // Configured Stremio URLs commonly encode key=value pairs or opaque
    // credential/config blobs in a path segment. Ordinary provider slugs do not.
    if (decoded.includes('=')) return true;
    if (/^[a-f0-9]{24,}$/i.test(decoded)) return true;
    if (
      decoded.length >= 12
      && /[A-Z]/.test(decoded)
      && /[a-z]/.test(decoded)
      && /\d/.test(decoded)
      && !/[._~-]/.test(decoded)
    ) {
      return true;
    }

    return false;
  });
}

export function safeManifestUrlForSync(manifestUrl?: string): string | undefined {
  const raw = manifestUrl?.trim();
  if (!raw || raw.length > MAX_PROVIDER_URL_LENGTH) return undefined;

  try {
    const url = new URL(raw);
    const normalized = url.toString();
    if (
      normalized.length > MAX_PROVIDER_URL_LENGTH
      || url.protocol !== 'https:'
      || url.username
      || url.password
    ) return undefined;
    if (url.search || url.hash) return undefined;
    if (!url.pathname.endsWith('/manifest.json') && url.pathname !== '/manifest.json') {
      return undefined;
    }
    if (suspiciousConfiguredPath(url.pathname)) return undefined;
    return normalized;
  } catch {
    return undefined;
  }
}

function safeConfigurableBaseManifestUrl(
  manifestUrl?: string,
): string | undefined {
  const safe = safeManifestUrlForSync(manifestUrl);
  if (!safe) return undefined;
  try {
    return (
      new URL(safe).pathname === '/manifest.json'
      || isSafePublicConfiguredManifestUrl(safe)
    )
      ? safe
      : undefined;
  } catch {
    return undefined;
  }
}

export function toSafeAddonSyncRecord(
  installed: InstalledAddon,
  fields: AddonConfigField[],
  values: Record<string, unknown>,
  descriptor?: AddonDescriptor,
): SafeAddonSyncRecord {
  const manifestUrl = descriptor?.configurable
    ? safeConfigurableBaseManifestUrl(installed.manifestUrl)
    : safeManifestUrlForSync(
      installed.manifestUrl ?? descriptor?.manifestUrl,
    );
  return {
    addonId: installed.addonId,
    ...(manifestUrl ? { manifestUrl } : {}),
    sourceType: installed.sourceType,
    enabled: installed.enabled,
    priority: installed.priority,
    safeConfig: sanitizeAddonConfigForSync(fields, values),
    setupIncomplete: installed.setupIncomplete,
    updatedAt: installed.updatedAt,
    ...(descriptor ? {
      identity: {
        name: descriptor.name,
        capabilities: [...descriptor.capabilities],
        supportedMediaKinds: [...descriptor.supportedMediaKinds],
        // Optional safe fields do not by themselves imply a device-only
        // configurable/runtime endpoint.
        configurable: Boolean(
          descriptor.configurable
          || descriptor.requiresConfiguration,
        ),
      },
    } : {}),
  };
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function requiresLocalSetup(record: AddonStateRecord): boolean {
  const requiredSecret = Boolean(
    record.descriptor?.configurationFields.some(
      (field) => isSensitiveAddonConfigField(field) && field.required,
    ),
  );
  const hasPortableConfiguredEndpoint = isSafePublicConfiguredManifestUrl(
    record.installed.manifestUrl ?? record.descriptor?.manifestUrl,
  );
  const requiresRuntimeEndpoint = !hasPortableConfiguredEndpoint && Boolean(
    record.descriptor?.configurable
    || record.syncIdentity?.configurable
    || (
      record.descriptor
      && !record.installed.manifestUrl
      && !record.descriptor.manifestUrl
    ),
  );
  return requiredSecret || requiresRuntimeEndpoint;
}

function applyDeviceSecretGate(
  record: AddonStateRecord,
  locallyConfiguredIds: ReadonlySet<string>,
): AddonStateRecord {
  if (!requiresLocalSetup(record)) return record;
  if (locallyConfiguredIds.has(record.installed.addonId)) return record;
  return {
    ...record,
    installed: {
      ...record.installed,
      // A descriptor-backed local provider cannot run without its required
      // device secret, so disable it locally. A remote-only shadow has no
      // local descriptor yet; preserve the synchronized user toggle and let
      // setupIncomplete alone block runtime use on this device.
      ...(record.descriptor ? { enabled: false } : {}),
      setupIncomplete: true,
    },
  };
}

function remoteOnlyState(remote: SafeAddonSyncRecord): AddonStateRecord {
  const safeManifestUrl = safeManifestUrlForSync(remote.manifestUrl);
  const safePublicRestore = Boolean(
    safeManifestUrl
    && (
      !remote.identity?.configurable
      || isSafePublicConfiguredManifestUrl(safeManifestUrl)
    ),
  );

  return {
    installed: {
      addonId: remote.addonId,
      ...(safeManifestUrl ? { manifestUrl: safeManifestUrl } : {}),
      sourceType: remote.sourceType,
      // Keep the synchronized preference even while setupIncomplete prevents
      // the provider from becoming usable. The hydration layer needs this
      // value so automatic safe reconfiguration (for example Nuvio locale
      // settings) does not turn a provider back on when the user disabled it.
      enabled: remote.enabled,
      priority: remote.priority,
      installedAt: remote.updatedAt,
      updatedAt: remote.updatedAt,
      setupIncomplete: safePublicRestore
        ? remote.setupIncomplete
        : true,
    },
    safeConfig: { ...remote.safeConfig },
    descriptor: undefined,
    syncIdentity: remote.identity ? { ...remote.identity } : undefined,
  };
}

export function reconcileInstalledAddons(
  local: AddonStateRecord[],
  remote: SafeAddonSyncRecord[],
  locallyConfiguredIds: ReadonlySet<string>,
): AddonStateRecord[] {
  const localById = new Map(local.map((record) => [record.installed.addonId, record]));
  const remoteById = new Map(remote.map((record) => [record.addonId, record]));
  const ids = new Set([...localById.keys(), ...remoteById.keys()]);
  const reconciled: AddonStateRecord[] = [];

  for (const addonId of ids) {
    const localRecord = localById.get(addonId);
    const remoteRecord = remoteById.get(addonId);

    if (!localRecord && remoteRecord) {
      reconciled.push(remoteOnlyState(remoteRecord));
      continue;
    }
    if (!localRecord) continue;
    if (!remoteRecord) {
      reconciled.push(applyDeviceSecretGate(localRecord, locallyConfiguredIds));
      continue;
    }

    const remoteWins = timestamp(remoteRecord.updatedAt)
      >= timestamp(localRecord.installed.updatedAt);
    const safeRemoteManifestUrl = safeManifestUrlForSync(
      remoteRecord.manifestUrl,
    );
    const merged: AddonStateRecord = remoteWins
      ? {
          installed: {
            ...localRecord.installed,
            ...(safeRemoteManifestUrl ? { manifestUrl: safeRemoteManifestUrl } : {}),
            sourceType: remoteRecord.sourceType,
            enabled: remoteRecord.enabled,
            priority: remoteRecord.priority,
            setupIncomplete: remoteRecord.setupIncomplete,
            updatedAt: remoteRecord.updatedAt,
          },
          safeConfig: { ...remoteRecord.safeConfig },
          descriptor: localRecord.descriptor,
          syncIdentity: remoteRecord.identity
            ? { ...remoteRecord.identity }
            : localRecord.syncIdentity,
        }
      : localRecord;

    reconciled.push(applyDeviceSecretGate(merged, locallyConfiguredIds));
  }

  return reconciled.sort((a, b) =>
    b.installed.priority - a.installed.priority
    || stableTextCompare(a.installed.addonId, b.installed.addonId));
}
