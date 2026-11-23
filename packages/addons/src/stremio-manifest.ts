import { parseLiveTvCapability } from '@moviestv/live-tv';
import { isSensitiveAddonConfigField } from './sync';
import type {
  AddonCapability,
  AddonCatalogDefinition,
  AddonCatalogExtra,
  AddonCatalogProtocol,
  AddonConfigField,
  AddonDescriptor,
  AddonMetaProtocol,
  AddonStreamProtocol,
  AddonSubtitleProtocol,
  SafeAddonConfigValue,
} from './types';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeString(
  value: unknown,
  maxLength = 512,
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

function requiredString(
  record: Record<string, unknown>,
  key: string,
  maxLength = 512,
): string {
  const value = safeString(record[key], maxLength);
  if (!value) {
    throw new Error(`Invalid Stremio manifest: missing or invalid ${key}`);
  }
  return value;
}

function optionalString(
  value: unknown,
  maxLength = 512,
): string | undefined {
  return safeString(value, maxLength);
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

function optionalHttpUrl(value: unknown): string | undefined {
  const normalized = safeString(value, 2_048);
  if (!normalized) return undefined;
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

const SENSITIVE_CONFIG_VALUE =
  /(?:^|[\s?&#;,])(?:token|key|secret|auth|signature|session|credential)\s*[:=]/i;

function safeConfigDefault(
  type: AddonConfigField['type'],
  value: unknown,
  options: readonly string[],
): SafeAddonConfigValue | undefined {
  if (type === 'boolean') {
    return typeof value === 'boolean' ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;

  const normalized = safeString(value, 2_048);
  if (!normalized || SENSITIVE_CONFIG_VALUE.test(normalized)) {
    return undefined;
  }

  if (type === 'select' && options.length && !options.includes(normalized)) {
    return undefined;
  }

  if (type === 'url') {
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

  return normalized;
}

function stringArray(
  value: unknown,
  maxItems = 500,
  maxLength = 512,
): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .flatMap((entry) => {
      const normalized = safeString(entry, maxLength);
      return normalized ? [normalized] : [];
    });
}

function mediaKinds(value: unknown): Array<'movie' | 'series'> {
  const seen = new Set<'movie' | 'series'>();
  return stringArray(value)
    .flatMap((entry) => {
      const normalized = entry.toLowerCase();
      if (
        (normalized !== 'movie' && normalized !== 'series')
        || seen.has(normalized)
      ) return [];
      seen.add(normalized);
      return [normalized];
    });
}

function resourceName(
  value: unknown,
): 'stream' | 'subtitles' | 'catalog' | 'meta' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'stream'
    || normalized === 'subtitles'
    || normalized === 'catalog'
    || normalized === 'meta'
    ? normalized
    : null;
}

function normalizeConfigField(value: unknown): AddonConfigField | null {
  const record = asRecord(value);
  if (!record) return null;
  const key = optionalString(record.key, 128);
  const rawTypeValue = optionalString(record.type, 32);
  if (!key || !rawTypeValue) return null;
  const rawType = rawTypeValue.toLowerCase();

  let type: AddonConfigField['type'];
  if (rawType === 'password' || rawType === 'secret') type = 'secret';
  else if (rawType === 'checkbox' || rawType === 'boolean') type = 'boolean';
  else if (rawType === 'select') type = 'select';
  else if (rawType === 'url') type = 'url';
  else if (rawType === 'text' || rawType === 'number') type = 'text';
  else return null;

  const label = optionalString(record.title, 256) ?? key;
  const explicitSecret = rawType === 'password' || rawType === 'secret';
  const baseField: AddonConfigField = {
    key,
    label,
    type,
    required: record.required === true,
    secret: explicitSecret,
  };
  if (isSensitiveAddonConfigField(baseField)) {
    return {
      ...baseField,
      type: 'secret',
      secret: true,
    };
  }

  const rawOptions = stringArray(record.options, 200, 256);
  const defaultValue = safeConfigDefault(
    type,
    record.default,
    rawOptions,
  );
  return {
    ...baseField,
    ...(rawOptions.length
      ? { options: rawOptions.map((option) => ({ value: option, label: option })) }
      : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
  };
}

function mergeConfigFields(
  fields: readonly AddonConfigField[],
): AddonConfigField[] {
  const merged = new Map<string, AddonConfigField>();

  for (const field of fields) {
    const existing = merged.get(field.key);
    if (!existing) {
      merged.set(field.key, field);
      continue;
    }

    const sensitive = (
      existing.secret
      || existing.type === 'secret'
      || field.secret
      || field.type === 'secret'
    );
    const preferred = (
      sensitive
      && !(existing.secret || existing.type === 'secret')
    )
      ? field
      : existing;

    const next: AddonConfigField = {
      ...preferred,
      required: existing.required || field.required,
      secret: sensitive,
      type: sensitive ? 'secret' : preferred.type,
    };
    if (sensitive) {
      delete next.defaultValue;
      delete next.options;
    }
    merged.set(field.key, next);
  }

  return [...merged.values()];
}

function declaredMediaTypes(
  record: Record<string, unknown>,
): Array<'movie' | 'series'> {
  const seen = new Set<'movie' | 'series'>(mediaKinds(record.types));
  if (Array.isArray(record.catalogs)) {
    for (const candidate of record.catalogs.slice(0, 500)) {
      const catalog = asRecord(candidate);
      const type = typeof catalog?.type === 'string'
        ? catalog.type.trim().toLowerCase()
        : '';
      if (type === 'movie' || type === 'series') {
        seen.add(type);
      }
    }
  }
  return [...seen];
}

function resolveStreamProtocol(record: Record<string, unknown>): AddonStreamProtocol | null {
  const resources = record.resources;
  if (!Array.isArray(resources)) throw new Error('Invalid Stremio manifest: missing resources');
  const globalTypes = declaredMediaTypes(record);
  const globalPrefixes = stringArray(record.idPrefixes);

  for (const resource of resources) {
    if (resourceName(resource) === 'stream') {
      return globalTypes.length ? { types: globalTypes, idPrefixes: globalPrefixes } : null;
    }
    const resourceRecord = asRecord(resource);
    if (!resourceRecord || resourceName(resourceRecord.name) !== 'stream') continue;
    const types = mediaKinds(resourceRecord.types);
    const hasScopedTypes = Object.prototype.hasOwnProperty.call(resourceRecord, 'types');
    if (hasScopedTypes && !types.length) continue;
    const supportedTypes = types.length ? types : globalTypes;
    if (!supportedTypes.length) continue;
    const prefixes = stringArray(resourceRecord.idPrefixes);
    return {
      types: supportedTypes,
      idPrefixes: prefixes.length ? prefixes : globalPrefixes,
    };
  }

  return null;
}

function resolveSubtitleProtocol(record: Record<string, unknown>): AddonSubtitleProtocol | null {
  const resources = record.resources;
  if (!Array.isArray(resources)) throw new Error('Invalid Stremio manifest: missing resources');
  const globalTypes = declaredMediaTypes(record);
  const globalPrefixes = stringArray(record.idPrefixes);

  for (const resource of resources) {
    if (resourceName(resource) === 'subtitles') {
      return globalTypes.length ? { types: globalTypes, idPrefixes: globalPrefixes } : null;
    }
    const resourceRecord = asRecord(resource);
    if (!resourceRecord || resourceName(resourceRecord.name) !== 'subtitles') continue;
    const types = mediaKinds(resourceRecord.types);
    const hasScopedTypes = Object.prototype.hasOwnProperty.call(resourceRecord, 'types');
    if (hasScopedTypes && !types.length) continue;
    const supportedTypes = types.length ? types : globalTypes;
    if (!supportedTypes.length) continue;
    const prefixes = stringArray(resourceRecord.idPrefixes);
    return {
      types: supportedTypes,
      idPrefixes: prefixes.length ? prefixes : globalPrefixes,
    };
  }

  return null;
}

function hasResource(
  record: Record<string, unknown>,
  name: 'stream' | 'subtitles' | 'catalog' | 'meta',
): boolean {
  const resources = record.resources;
  if (!Array.isArray(resources)) return false;
  return resources.some((resource) => (
    resourceName(resource) === name
    || resourceName(asRecord(resource)?.name) === name
  ));
}

function normalizeCatalogExtra(value: unknown): AddonCatalogExtra | null {
  const record = asRecord(value);
  if (!record) return null;
  const name = optionalString(record.name, 128);
  if (!name) return null;
  const options = stringArray(record.options, 200, 256);
  return {
    name,
    isRequired: record.isRequired === true,
    ...(options.length ? { options } : {}),
  };
}

function normalizeCatalog(
  value: unknown,
  fallbackType?: 'movie' | 'series',
): AddonCatalogDefinition | null {
  const record = asRecord(value);
  if (!record) return null;
  const explicitType = typeof record.type === 'string'
    ? record.type.trim().toLowerCase()
    : '';
  const hasExplicitType = (
    record.type !== undefined
    && record.type !== null
    && !(typeof record.type === 'string' && !record.type.trim())
  );
  const type = (
    explicitType === 'movie' || explicitType === 'series'
      ? explicitType
      : !hasExplicitType
        ? fallbackType
        : undefined
  );
  const id = optionalString(record.id, 512);
  if (!type || !id) return null;
  const name = optionalString(record.name, 500) ?? id;
  const extra = Array.isArray(record.extra)
    ? record.extra
      .slice(0, 100)
      .map(normalizeCatalogExtra)
      .filter((item): item is AddonCatalogExtra => item !== null)
    : [];
  return { type, id, name, extra };
}

function resolveMetaProtocol(record: Record<string, unknown>): AddonMetaProtocol | undefined {
  const resources = record.resources;
  if (!Array.isArray(resources)) return undefined;
  const globalTypes = declaredMediaTypes(record);
  const globalPrefixes = stringArray(record.idPrefixes);

  for (const resource of resources) {
    if (resourceName(resource) === 'meta') {
      return globalTypes.length
        ? { types: globalTypes, idPrefixes: globalPrefixes }
        : undefined;
    }
    const resourceRecord = asRecord(resource);
    if (!resourceRecord || resourceName(resourceRecord.name) !== 'meta') continue;
    const types = mediaKinds(resourceRecord.types);
    const supportedTypes = types.length ? types : globalTypes;
    if (!supportedTypes.length) return undefined;
    const prefixes = stringArray(resourceRecord.idPrefixes);
    return {
      types: supportedTypes,
      idPrefixes: prefixes.length ? prefixes : globalPrefixes,
    };
  }

  return undefined;
}

function resolveCatalogProtocol(record: Record<string, unknown>): AddonCatalogProtocol | null {
  if (!hasResource(record, 'catalog')) return null;
  const globalTypes = mediaKinds(record.types);
  const fallbackType = globalTypes.length === 1
    ? globalTypes[0]
    : undefined;
  const catalogs = Array.isArray(record.catalogs)
    ? record.catalogs
      .slice(0, 500)
      .map((catalog) => normalizeCatalog(catalog, fallbackType))
      .filter((catalog): catalog is AddonCatalogDefinition => catalog !== null)
    : [];
  if (!catalogs.length) return null;

  const meta = resolveMetaProtocol(record);
  return {
    catalogs,
    ...(meta ? { meta } : {}),
  };
}

function unionMediaKinds(
  stream: AddonStreamProtocol | null,
  subtitle: AddonSubtitleProtocol | null,
  catalog: AddonCatalogProtocol | null,
): Array<'movie' | 'series'> {
  const result = new Set<'movie' | 'series'>();
  stream?.types.forEach((kind) => result.add(kind));
  subtitle?.types.forEach((kind) => result.add(kind));
  catalog?.catalogs.forEach((entry) => result.add(entry.type));
  return [...result];
}

export function parseStremioManifest(payload: unknown, manifestUrl: string): AddonDescriptor {
  const record = asRecord(payload);
  if (!record) throw new Error('Invalid Stremio manifest');

  const id = requiredString(record, 'id', 512);
  const name = requiredString(record, 'name', 500);
  const version = requiredString(record, 'version', 128);
  const stream = resolveStreamProtocol(record);
  const subtitle = resolveSubtitleProtocol(record);
  const catalog = resolveCatalogProtocol(record);
  const liveTv = parseLiveTvCapability(record);

  if (!stream && !subtitle && !catalog && !liveTv) {
    throw new Error('Stremio manifest does not provide a supported MoviesTv-Flix capability');
  }

  const config = Array.isArray(record.config)
    ? mergeConfigFields(
        record.config
          .slice(0, 200)
          .map(normalizeConfigField)
          .filter((field): field is AddonConfigField => field !== null),
      )
    : [];
  const behaviorHints = asRecord(record.behaviorHints);
  const configurable =
    behaviorHints?.configurable === true
    || behaviorHints?.configurationRequired === true
    || config.length > 0;
  const requiresConfiguration =
    behaviorHints?.configurationRequired === true
    || config.some((field) => field.required && field.defaultValue === undefined);

  const capabilities: AddonCapability[] = [
    ...(stream ? ['stream' as const] : []),
    ...(subtitle ? ['subtitle' as const] : []),
    ...(catalog ? ['catalog' as const] : []),
    ...(liveTv ? ['live-tv' as const] : []),
  ];

  return {
    id,
    name,
    version,
    description: optionalString(record.description, 4_000),
    logoUrl: optionalHttpUrl(record.logo),
    sourceType: 'stremio-manifest',
    capabilities,
    requiresConfiguration,
    configurable,
    configurationFields: config,
    supportedMediaKinds: unionMediaKinds(stream, subtitle, catalog),
    manifestUrl,
    ...(stream ? { stream } : {}),
    ...(subtitle ? { subtitle } : {}),
    ...(catalog ? { catalog } : {}),
    ...(liveTv ? { liveTv } : {}),
  };
}
