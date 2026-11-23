import type { StreamSource } from '@moviestv/core';

export interface OfflineMediaSnapshot {
  mediaId?: string;
  kind?: 'movie' | 'episode';
  title?: string;
  posterUrl?: string;
  year?: number;
  externalIds?: {
    imdb?: string;
    tmdb?: string;
  };
  seriesId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

export interface OfflineDownloadMetadata {
  schemaVersion: 1;
  fileName: string;
  title: string;
  downloadedAt: string;
  mediaId?: string;
  kind?: 'movie' | 'episode';
  posterUrl?: string;
  year?: number;
  externalIds?: {
    imdb?: string;
    tmdb?: string;
  };
  seriesId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  providerId?: string;
  quality?: string;
  audioLanguage?: string;
  sourceSizeBytes?: number;
}

export function offlineEpisodeCode(
  metadata: Pick<OfflineDownloadMetadata, 'seasonNumber' | 'episodeNumber'>,
): string | undefined {
  const { seasonNumber, episodeNumber } = metadata;
  if (
    !Number.isInteger(seasonNumber)
    || seasonNumber === undefined
    || seasonNumber < 0
    || !Number.isInteger(episodeNumber)
    || episodeNumber === undefined
    || episodeNumber <= 0
  ) {
    return undefined;
  }
  return `S${seasonNumber}E${episodeNumber}`;
}

export const OFFLINE_METADATA_SUFFIX = '.moviestv.json';
export const OFFLINE_PARTIAL_SUFFIX = '.moviestv-partial';
export const MAX_OFFLINE_METADATA_TEXT_LENGTH = 65_536;

export function canReadOfflineMetadataFile(
  size: number | null | undefined,
): boolean {
  return typeof size === 'number'
    && Number.isFinite(size)
    && size >= 0
    && size <= MAX_OFFLINE_METADATA_TEXT_LENGTH;
}

export function offlineMetadataFileName(fileName: string): string {
  const safe = fileName.trim();
  if (
    !safe
    || safe === '.'
    || safe === '..'
    || /[\\/\u0000-\u001f\u007f]/.test(safe)
    || safe.length + OFFLINE_METADATA_SUFFIX.length > 255
  ) {
    throw new Error('Invalid offline metadata filename');
  }
  return `${safe}${OFFLINE_METADATA_SUFFIX}`;
}

function safeOptionalString(value: string | undefined, maxLength = 2048): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) return undefined;
  return normalized;
}

export function buildOfflineDownloadMetadata(
  fileName: string,
  source: StreamSource,
  media: OfflineMediaSnapshot | undefined,
  downloadedAt: string,
): OfflineDownloadMetadata {
  const safeFileName = fileName.trim();
  if (safeFileName.length > 255 || !safeFileName || safeFileName === '.' || safeFileName === '..' || /[\\/\u0000-\u001f\u007f]/.test(safeFileName)) {
    throw new Error('Invalid offline download filename');
  }
  const parsedDownloadedAt = Date.parse(downloadedAt);
  if (!Number.isFinite(parsedDownloadedAt)) throw new Error('Invalid offline download timestamp');
  const audioLanguage = safeOptionalString(source.audioLanguages?.[0] ?? source.language, 128);
  const imdb = safeOptionalString(media?.externalIds?.imdb, 32);
  const tmdb = safeOptionalString(media?.externalIds?.tmdb, 32);
  const externalIds = {
    ...(imdb && /^tt\d+$/i.test(imdb) ? { imdb } : {}),
    ...(tmdb && /^\d+$/.test(tmdb) ? { tmdb } : {}),
  };
  let posterUrl: string | undefined;
  const posterCandidate = safeOptionalString(media?.posterUrl, 2_048);
  if (posterCandidate && validHttpsUrl(posterCandidate)) {
    posterUrl = new URL(posterCandidate).href;
  }
  const title = (media?.title?.trim() || source.name?.trim() || 'MoviesTv-Flix')
    .replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 500) || 'MoviesTv-Flix';
  return {
    schemaVersion: 1,
    fileName: safeFileName,
    title,
    downloadedAt: new Date(parsedDownloadedAt).toISOString(),
    ...(safeOptionalString(media?.mediaId, 512) ? { mediaId: safeOptionalString(media?.mediaId, 512)! } : {}),
    ...(media?.kind ? { kind: media.kind } : {}),
    ...(posterUrl ? { posterUrl } : {}),
    ...(Number.isInteger(media?.year) && (media?.year ?? 0) >= 1888 && (media?.year ?? 0) <= 3000 ? { year: media!.year } : {}),
    ...(Object.keys(externalIds).length ? { externalIds } : {}),
    ...(safeOptionalString(media?.seriesId, 512)
      ? { seriesId: safeOptionalString(media?.seriesId, 512)! }
      : {}),
    ...(Number.isInteger(media?.seasonNumber) && (media?.seasonNumber ?? -1) >= 0 && (media?.seasonNumber ?? 0) <= 10_000 ? { seasonNumber: media!.seasonNumber } : {}),
    ...(Number.isInteger(media?.episodeNumber) && (media?.episodeNumber ?? 0) > 0 && (media?.episodeNumber ?? 0) <= 100_000 ? { episodeNumber: media!.episodeNumber } : {}),
    ...(safeOptionalString(source.providerId, 512) ? { providerId: safeOptionalString(source.providerId, 512)! } : {}),
    ...(safeOptionalString(source.quality, 128) ? { quality: safeOptionalString(source.quality, 128)! } : {}),
    ...(audioLanguage ? { audioLanguage } : {}),
    ...(Number.isSafeInteger(source.sizeBytes) && (source.sizeBytes ?? 0) > 0 ? { sourceSizeBytes: source.sizeBytes } : {}),
  };
}

function validOptionalString(value: unknown, maxLength = 2048): boolean {
  return value === undefined || (typeof value === 'string' && Boolean(value.trim()) && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value));
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

function validHttpsUrl(value: string): boolean {
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > 2_048
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) return false;

  try {
    const url = new URL(normalized);
    const sensitiveQuery = /token|key|secret|auth|signature|session|credential/i;
    const hasSensitiveQuery = [...url.searchParams.entries()].some(
      ([key, queryValue]) => (
        sensitiveQuery.test(key)
        || sensitiveQuery.test(queryValue)
      ),
    );
    const hasSensitiveFragment = sensitiveQuery.test(
      decodeURIComponent(url.hash.slice(1)),
    );
    return (
      url.protocol === 'https:'
      && !url.username
      && !url.password
      && !hasSensitiveQuery
      && !hasSensitiveFragment
      && !hasCredentialPathSegment(url.pathname)
      && url.href.length <= 2_048
    );
  } catch {
    return false;
  }
}

function validExternalIds(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const ids = value as Record<string, unknown>;
  if (!Object.keys(ids).every((key) => key === 'imdb' || key === 'tmdb')) {
    return false;
  }
  const imdb = ids.imdb;
  const tmdb = ids.tmdb;
  return (
    (imdb === undefined || (
      validOptionalString(imdb as string | undefined, 32)
      && /^tt\d+$/i.test(String(imdb).trim())
    ))
    && (tmdb === undefined || (
      validOptionalString(tmdb as string | undefined, 32)
      && /^\d+$/.test(String(tmdb).trim())
    ))
  );
}

export function offlineMetadataMatchesFile(
  metadata: OfflineDownloadMetadata | null,
  fileName: string,
): metadata is OfflineDownloadMetadata {
  const normalized = fileName.trim();
  return Boolean(
    metadata
    && normalized
    && metadata.fileName === normalized,
  );
}

export function parseOfflineDownloadMetadata(
  value: string,
): OfflineDownloadMetadata | null {
  if (value.length > MAX_OFFLINE_METADATA_TEXT_LENGTH) return null;
  try {
    const parsed = JSON.parse(value) as Partial<OfflineDownloadMetadata>;
    if (
      parsed.schemaVersion !== 1
      || typeof parsed.fileName !== 'string'
      || !parsed.fileName.trim()
      || parsed.fileName.includes('/')
      || parsed.fileName.includes('\\')
      || parsed.fileName.trim() === '.'
      || parsed.fileName.trim() === '..'
      || parsed.fileName.includes('\u0000')
      || parsed.fileName.length > 255
      || typeof parsed.title !== 'string'
      || !parsed.title.trim()
      || parsed.title.length > 500
      || /[\u0000-\u001f\u007f]/.test(parsed.title)
      || typeof parsed.downloadedAt !== 'string'
      || parsed.downloadedAt.length > 64
      || !Number.isFinite(Date.parse(parsed.downloadedAt))
      || Date.parse(parsed.downloadedAt) > Date.now() + 86_400_000
      || !validOptionalString(parsed.mediaId, 512)
      || !validOptionalString(parsed.seriesId, 512)
      || !validOptionalString(parsed.posterUrl)
      || (parsed.posterUrl !== undefined && !validHttpsUrl(parsed.posterUrl))
      || !validOptionalString(parsed.providerId, 512)
      || !validOptionalString(parsed.quality, 128)
      || !validOptionalString(parsed.audioLanguage, 128)
      || !validExternalIds(parsed.externalIds)
      || (parsed.kind !== undefined && parsed.kind !== 'movie' && parsed.kind !== 'episode')
      || (parsed.year !== undefined && (!Number.isInteger(parsed.year) || parsed.year < 1888 || parsed.year > 3000))
      || (parsed.seasonNumber !== undefined && (!Number.isInteger(parsed.seasonNumber) || parsed.seasonNumber < 0 || parsed.seasonNumber > 10_000))
      || (parsed.episodeNumber !== undefined && (!Number.isInteger(parsed.episodeNumber) || parsed.episodeNumber <= 0 || parsed.episodeNumber > 100_000))
      || (parsed.sourceSizeBytes !== undefined && (!Number.isSafeInteger(parsed.sourceSizeBytes) || parsed.sourceSizeBytes <= 0))
    ) {
      return null;
    }

    return {
      ...parsed,
      fileName: parsed.fileName.trim(),
      title: parsed.title.trim(),
      ...(parsed.mediaId ? { mediaId: parsed.mediaId.trim() } : {}),
      ...(parsed.seriesId ? { seriesId: parsed.seriesId.trim() } : {}),
      ...(parsed.posterUrl ? { posterUrl: parsed.posterUrl.trim() } : {}),
      ...(parsed.providerId ? { providerId: parsed.providerId.trim() } : {}),
      ...(parsed.quality ? { quality: parsed.quality.trim() } : {}),
      ...(parsed.audioLanguage ? { audioLanguage: parsed.audioLanguage.trim() } : {}),
      ...(parsed.externalIds ? {
        externalIds: {
          ...(parsed.externalIds.imdb ? { imdb: parsed.externalIds.imdb.trim() } : {}),
          ...(parsed.externalIds.tmdb ? { tmdb: parsed.externalIds.tmdb.trim() } : {}),
        },
      } : {}),
    } as OfflineDownloadMetadata;
  } catch {
    return null;
  }
}
