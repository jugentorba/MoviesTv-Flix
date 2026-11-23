export type LiveTvResourceType = 'channel' | 'tv';

export interface LiveTvCatalog {
  type: LiveTvResourceType;
  id: string;
  name: string;
  requiredExtras?: string[];
}

export interface LiveTvProtocol {
  catalogs: LiveTvCatalog[];
  streamTypes: LiveTvResourceType[];
}

/**
 * How a provider serves channels.
 *
 * - `addon`: a Stremio-compatible add-on; streams are resolved per channel over
 *   HTTP through the add-on's stream handler.
 * - `playlist`: an imported M3U playlist; each channel carries its own stream
 *   URL and nothing is fetched to resolve it.
 *
 * Absent means `addon`, so existing descriptors keep their behavior.
 */
export type LiveTvProviderKind = 'addon' | 'playlist';

export interface LiveTvProviderDescriptor {
  addonId: string;
  name: string;
  manifestUrl: string;
  priority: number;
  liveTv: LiveTvProtocol;
  kind?: LiveTvProviderKind;
}

export interface LiveTvChannel {
  id: string;
  providerId: string;
  remoteId: string;
  resourceType: LiveTvResourceType;
  title: string;
  posterUrl?: string;
  countryCode?: string;
  genres?: string[];
  /**
   * Playback URL for `playlist` providers only.
   *
   * An M3U entry already contains its stream URL, so there is no add-on stream
   * handler to call. This value commonly embeds provider credentials in the
   * path, so it is runtime-only: never write it to a sync payload, a log, an
   * error message or exported media metadata.
   */
  directStreamUrl?: string;
}

type UnknownRecord = Record<string, unknown>;

function recordOf(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= 512
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function normalizeResourceType(
  value: unknown,
): LiveTvResourceType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'channel' || normalized === 'tv'
    ? normalized
    : null;
}

function normalizeResourceName(
  value: unknown,
): 'catalog' | 'stream' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'catalog' || normalized === 'stream'
    ? normalized
    : null;
}
function resourceType(value: unknown): value is LiveTvResourceType {
  return value === 'channel' || value === 'tv';
}

function resourceTypes(value: unknown): LiveTvResourceType[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<LiveTvResourceType>();
  return value
    .slice(0, 100)
    .flatMap((entry) => {
      const normalized = normalizeResourceType(entry);
      if (!normalized || seen.has(normalized)) return [];
      seen.add(normalized);
      return [normalized];
    });
}

function genreStrings(...values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const candidates = Array.isArray(value)
      ? value.slice(0, 100)
      : typeof value === 'string'
        ? value.split(/[;,|]/).slice(0, 100)
        : [];
    for (const candidate of candidates) {
      if (!nonEmpty(candidate)) continue;
      const normalized = candidate.trim();
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(normalized);
      if (result.length >= 100) return result;
    }
  }
  return result;
}

function mergeGenreLists(
  primary: readonly string[] | undefined,
  secondary: readonly string[] | undefined,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const genre of [...(primary ?? []), ...(secondary ?? [])]) {
    const normalized = genre.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function normalizedCountryCodeValue(value: string): string {
  const code = value.trim().toUpperCase();
  if (code === 'UK') return 'GB';
  if (code === 'KS' || code === 'KV') return 'XK';
  return code;
}

function requiredCatalogExtras(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of value.slice(0, 100)) {
    const record = recordOf(candidate);
    if (!record || record.isRequired !== true || !nonEmpty(record.name)) {
      continue;
    }
    const name = record.name.trim();
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }

  return result;
}

function parseCatalogs(
  value: unknown,
  fallbackType?: LiveTvResourceType,
): LiveTvCatalog[] {
  if (!Array.isArray(value)) return [];
  const catalogs: LiveTvCatalog[] = [];
  const seen = new Set<string>();
  for (const candidate of value.slice(0, 500)) {
    const catalog = recordOf(candidate);
    if (!catalog || !nonEmpty(catalog.id)) continue;

    const explicitType = normalizeResourceType(catalog.type);
    const hasExplicitType = (
      catalog.type !== undefined
      && catalog.type !== null
      && !(typeof catalog.type === 'string' && !catalog.type.trim())
    );
    const type = explicitType ?? (!hasExplicitType ? fallbackType : undefined);
    if (!type) continue;

    const id = catalog.id.trim();
    const identity = `${type}\u0000${id}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const requiredExtras = requiredCatalogExtras(catalog.extra);
    catalogs.push({
      type,
      id,
      name: nonEmpty(catalog.name) ? catalog.name.trim() : id,
      ...(requiredExtras.length ? { requiredExtras } : {}),
    });
  }
  return catalogs;
}

export function parseLiveTvCapability(payload: unknown): LiveTvProtocol | null {
  const manifest = recordOf(payload);
  if (!manifest || !Array.isArray(manifest.resources)) return null;

  const globalTypes = resourceTypes(manifest.types);
  const catalogs = parseCatalogs(
    manifest.catalogs,
    globalTypes.length === 1 ? globalTypes[0] : undefined,
  );
  if (!catalogs.length) return null;
  const catalogTypes = new Set<LiveTvResourceType>();
  const streamTypes = new Set<LiveTvResourceType>();
  const declaredCatalogTypes = [...new Set(
    catalogs.map((catalog) => catalog.type),
  )];
  const fallbackResourceTypes = globalTypes.length
    ? globalTypes
    : declaredCatalogTypes;

  for (const resource of manifest.resources.slice(0, 1_000)) {
    const directName = normalizeResourceName(resource);
    if (directName) {
      const destination = directName === 'catalog'
        ? catalogTypes
        : streamTypes;
      for (const type of fallbackResourceTypes) destination.add(type);
      continue;
    }

    const record = recordOf(resource);
    const name = normalizeResourceName(record?.name);
    if (!record || !name) continue;
    const scopedTypes = resourceTypes(record.types);
    const types = scopedTypes.length ? scopedTypes : fallbackResourceTypes;
    const destination = name === 'catalog' ? catalogTypes : streamTypes;
    for (const type of types) destination.add(type);
  }

  const usableCatalogs = catalogs.filter(
    (catalog) => catalogTypes.has(catalog.type) && streamTypes.has(catalog.type),
  );
  if (!usableCatalogs.length) return null;

  const usableStreamTypes = [...streamTypes].filter((type) =>
    usableCatalogs.some((catalog) => catalog.type === type));

  return { catalogs: usableCatalogs, streamTypes: usableStreamTypes };
}

function hasCredentialPathSegment(pathname: string): boolean {
  let decoded;
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

function safePoster(value: unknown): string | undefined {
  if (!nonEmpty(value)) return undefined;
  try {
    const url = new URL(value.trim());
    const sensitive =
      /token|key|secret|auth|signature|session|credential/i;
    const hasSensitiveQuery = [...url.searchParams.entries()].some(
      ([key, queryValue]) => (
        sensitive.test(key)
        || sensitive.test(queryValue)
      ),
    );
    let fragment = url.hash.slice(1);
    try {
      fragment = decodeURIComponent(fragment);
    } catch {
      return undefined;
    }
    const hasSensitiveFragment = sensitive.test(fragment);
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || hasSensitiveQuery
      || hasSensitiveFragment
      || hasCredentialPathSegment(url.pathname)
    ) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

const COUNTRY_ALIASES: Array<[string, string[]]> = [
  ['AL', ['al', 'albania', 'albanian', 'albanie', 'shqip', 'shqiperia', 'shqiperi']],
  ['FR', ['fr', 'france', 'french', 'francais', 'français']],
  ['XK', ['xk', 'ks', 'kv', 'kosovo', 'kosova', 'kosovë']],
  ['DE', ['de', 'germany', 'german', 'allemagne', 'deutsch']],
  ['IT', ['it', 'italy', 'italian', 'italie', 'italiano']],
  ['ES', ['es', 'spain', 'spanish', 'espagne', 'espanol', 'español']],
  ['GB', ['gb', 'uk', 'united kingdom', 'british', 'england']],
  ['US', ['us', 'usa', 'united states', 'american']],
];

const CHANNEL_HINTS: Array<[string, RegExp]> = [
  ['AL', /\b(top channel|tv klan|klan hd|vizion plus|rtsh|euronews albania|abc news albania|news 24|report tv|ora news)\b/i],
  ['XK', /\b(rtk|rtv\s*21|klan kosova|kohavision|ktv|dukagjini|t7|kanal\s*10)\b/i],
  ['FR', /\b(tf1|france [2345]|m6|arte|c8|w9|lci|bfm|rmc|canal\+|gulli)\b/i],
];

function normalizeCountryText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .trim();
}

function countryFromText(value: unknown): string | undefined {
  if (!nonEmpty(value)) return undefined;
  const normalized = normalizeCountryText(value);
  for (const [code, aliases] of COUNTRY_ALIASES) {
    if (aliases.some((alias) => normalized === alias || normalized.includes(` ${alias} `) || normalized.startsWith(`${alias} `) || normalized.endsWith(` ${alias}`))) {
      return code;
    }
  }
  return undefined;
}

function inferCountryCode(
  meta: UnknownRecord,
  genres: readonly string[],
  context?: { catalogId?: string; catalogName?: string },
): string | undefined {
  for (const candidate of [meta.countryCode, meta.country_code]) {
    if (typeof candidate === 'string' && /^[A-Za-z]{2}$/.test(candidate.trim())) {
      return normalizedCountryCodeValue(candidate);
    }
  }

  for (const candidate of [meta.country, meta.region, meta.language, context?.catalogName, context?.catalogId, ...genres]) {
    const inferred = countryFromText(candidate);
    if (inferred) return inferred;
  }

  const title = nonEmpty(meta.name) ? meta.name.trim() : '';
  for (const [code, pattern] of CHANNEL_HINTS) {
    if (pattern.test(title)) return code;
  }

  return undefined;
}

export function parseLiveTvCatalog(
  payload: unknown,
  providerId: string,
  type: LiveTvResourceType,
  context?: { catalogId?: string; catalogName?: string },
): LiveTvChannel[] {
  const data = recordOf(payload);
  if (!nonEmpty(providerId) || !resourceType(type)) return [];

  const metas = Array.isArray(payload)
    ? payload.slice(0, 10_000)
    : Array.isArray(data?.metas)
      ? data.metas.slice(0, 10_000)
      : Array.isArray(data?.channels)
        ? data.channels.slice(0, 10_000)
        : recordOf(data?.metas)
          ? [data!.metas]
          : recordOf(data?.channel)
            ? [data!.channel]
            : recordOf(data?.channels)
              ? [data!.channels]
              : [];
  if (!metas.length) return [];

  const normalizedProviderId = providerId.trim();
  const channelIndexByRemoteId = new Map<string, number>();
  const channels: LiveTvChannel[] = [];
  for (const value of metas) {
    const meta = recordOf(value);
    if (!meta || !nonEmpty(meta.id)) continue;

    const declaredType = normalizeResourceType(meta.type);
    const hasDeclaredType = (
      meta.type !== undefined
      && meta.type !== null
      && !(typeof meta.type === 'string' && !meta.type.trim())
    );
    if (hasDeclaredType && declaredType !== type) continue;

    const rawTitle = nonEmpty(meta.name)
      ? meta.name
      : nonEmpty(meta.title)
        ? meta.title
        : undefined;
    if (!rawTitle) continue;

    const remoteId = meta.id.trim();
    const title = rawTitle.trim();
    const channelId = `${normalizedProviderId}:${type}:${remoteId}`;
    if (title.length > 500 || channelId.length > 512) continue;
    const posterUrl = safePoster(meta.poster)
      ?? safePoster(meta.logo)
      ?? safePoster(meta.posterUrl);
    const genres = genreStrings(
      meta.genres,
      meta.genre,
      meta.categories,
      meta.category,
      meta.group,
    );
    const countryCode = inferCountryCode(meta, genres, context);

    const existingIndex = channelIndexByRemoteId.get(remoteId);
    if (existingIndex !== undefined) {
      const existing = channels[existingIndex];
      if (!existing) continue;
      const mergedGenres = mergeGenreLists(existing.genres, genres);
      channels[existingIndex] = {
        ...existing,
        ...(!existing.posterUrl && posterUrl ? { posterUrl } : {}),
        ...(!existing.countryCode && countryCode ? { countryCode } : {}),
        ...(mergedGenres.length ? { genres: mergedGenres } : {}),
      };
      continue;
    }

    channelIndexByRemoteId.set(remoteId, channels.length);
    channels.push({
      id: channelId,
      providerId: normalizedProviderId,
      remoteId,
      resourceType: type,
      title,
      ...(posterUrl ? { posterUrl } : {}),
      ...(countryCode ? { countryCode } : {}),
      ...(genres.length ? { genres } : {}),
    });
  }
  return channels;
}

function encodedId(value: string): string {
  if (!nonEmpty(value)) throw new Error('Live TV resource ID is missing');
  return encodeURIComponent(value.trim());
}

export function liveTvCatalogRequestPath(catalog: Pick<LiveTvCatalog, 'type' | 'id'>): string {
  if (!resourceType(catalog.type)) throw new Error('Unsupported Live TV catalog type');
  return `/catalog/${catalog.type}/${encodedId(catalog.id)}.json`;
}

export function liveTvStreamRequestPath(type: LiveTvResourceType, remoteId: string): string {
  if (!resourceType(type)) throw new Error('Unsupported Live TV stream type');
  return `/stream/${type}/${encodedId(remoteId)}.json`;
}
