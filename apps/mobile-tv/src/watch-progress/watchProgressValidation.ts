import type { WatchProgressRecord } from '@moviestv/sync';

export const MAX_WATCH_PROGRESS_RECORDS = 2_000;
export const MAX_WATCH_MEDIA_ID_LENGTH = 512;
export const MAX_WATCH_TITLE_LENGTH = 500;
export const MAX_WATCH_SERIES_ID_LENGTH = 512;
export const MAX_WATCH_POSTER_URL_LENGTH = 2_048;
export const MAX_WATCH_SECONDS = 31_536_000;
export const MAX_WATCH_SEASON_NUMBER = 10_000;
export const MAX_WATCH_EPISODE_NUMBER = 100_000;

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

export function validWatchProgressTimestamp(
  value: unknown,
): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return Boolean(
    normalized
    && normalized.length <= 64
    && !/[\u0000-\u001f\u007f]/.test(normalized)
    && !Number.isNaN(Date.parse(normalized))
  );
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

function safePosterUrl(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = safeString(value, MAX_WATCH_POSTER_URL_LENGTH);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    const sensitive = /token|key|secret|auth|signature|session|credential/i;
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
      return null;
    }
    const hasSensitiveFragment = sensitive.test(fragment);
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || hasSensitiveQuery
      || hasSensitiveFragment
      || hasCredentialPathSegment(url.pathname)
      || url.href.length > MAX_WATCH_POSTER_URL_LENGTH
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

function safeExternalIds(
  value: unknown,
): WatchProgressRecord['externalIds'] | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return null;

  const source = value as Record<string, unknown>;
  const imdb = safeString(source.imdb, 32);
  const tmdb = safeString(source.tmdb, 32);
  if (
    source.imdb !== undefined
    && source.imdb !== null
    && (!imdb || !/^tt\d+$/i.test(imdb))
  ) {
    return null;
  }
  if (
    source.tmdb !== undefined
    && source.tmdb !== null
    && (!tmdb || !/^\d+$/.test(tmdb))
  ) {
    return null;
  }

  return imdb || tmdb
    ? {
        ...(imdb ? { imdb: imdb.toLowerCase() } : {}),
        ...(tmdb ? { tmdb } : {}),
      }
    : undefined;
}

function optionalInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

function safeSeconds(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= MAX_WATCH_SECONDS
    ? value
    : null;
}

export function sanitizeWatchProgressRecord(
  value: unknown,
): WatchProgressRecord | null {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
  ) return null;

  const source = value as Record<string, unknown>;
  const mediaId = safeString(
    source.mediaId ?? source.media_id,
    MAX_WATCH_MEDIA_ID_LENGTH,
  );
  const title = safeString(
    source.title,
    MAX_WATCH_TITLE_LENGTH,
  );
  const kind = source.kind;
  const positionSeconds = safeSeconds(
    source.positionSeconds ?? source.position_seconds,
  );
  const durationSeconds = safeSeconds(
    source.durationSeconds ?? source.duration_seconds,
  );
  const completed = source.completed;
  const updatedAtValue = source.updatedAt ?? source.updated_at;
  const updatedAt = validWatchProgressTimestamp(updatedAtValue)
    ? updatedAtValue.trim()
    : undefined;
  const posterUrl = safePosterUrl(
    source.posterUrl ?? source.poster_url,
  );
  const year = optionalInteger(
    source.year ?? source.release_year,
    1888,
    3000,
  );
  const externalIds = source.externalIds !== undefined
    ? safeExternalIds(source.externalIds)
    : safeExternalIds({
        imdb: source.imdb_id,
        tmdb: source.tmdb_id,
      });
  const seriesIdValue = source.seriesId ?? source.series_id;
  const seriesId = seriesIdValue === undefined || seriesIdValue === null
    ? undefined
    : safeString(seriesIdValue, MAX_WATCH_SERIES_ID_LENGTH) ?? null;
  const seasonNumber = optionalInteger(
    source.seasonNumber ?? source.season_number,
    0,
    MAX_WATCH_SEASON_NUMBER,
  );
  const episodeNumber = optionalInteger(
    source.episodeNumber ?? source.episode_number,
    1,
    MAX_WATCH_EPISODE_NUMBER,
  );
  const resetAtValue = source.resetAt ?? source.reset_at;
  const resetAt = resetAtValue === undefined || resetAtValue === null
    ? undefined
    : validWatchProgressTimestamp(resetAtValue)
      ? resetAtValue.trim()
      : null;

  if (
    !mediaId
    || !title
    || (kind !== 'movie' && kind !== 'episode')
    || positionSeconds === null
    || durationSeconds === null
    || typeof completed !== 'boolean'
    || updatedAt === undefined
    || posterUrl === null
    || year === null
    || externalIds === null
    || seriesId === null
    || seasonNumber === null
    || episodeNumber === null
    || resetAt === null
  ) return null;

  return {
    mediaId,
    kind,
    title,
    ...(posterUrl ? { posterUrl } : {}),
    ...(year !== undefined ? { year } : {}),
    ...(externalIds ? { externalIds } : {}),
    ...(seriesId !== undefined ? { seriesId } : {}),
    ...(seasonNumber !== undefined ? { seasonNumber } : {}),
    ...(episodeNumber !== undefined ? { episodeNumber } : {}),
    positionSeconds,
    durationSeconds,
    completed,
    ...(resetAt ? { resetAt } : {}),
    updatedAt,
  };
}
