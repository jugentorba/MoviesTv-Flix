import type { ExternalMediaIds, PlaybackProgress } from './media';
import { normalizeLanguageTag } from './languages';

export const MAX_MY_LIST_ITEMS = 200;

export interface MyListMediaItem {
  mediaId: string;
  kind: 'movie' | 'series';
  title: string;
  providerId: string;
  externalIds: ExternalMediaIds;
  posterUrl?: string;
  backdropUrl?: string;
  year?: number;
}

export type MyListMediaIdentity = Pick<
  MyListMediaItem,
  'mediaId' | 'kind' | 'externalIds'
>;

function sameExternalMediaIdentity(
  left: ExternalMediaIds,
  right: ExternalMediaIds,
): boolean {
  const leftImdb = left.imdb?.trim().toLowerCase();
  const rightImdb = right.imdb?.trim().toLowerCase();
  const leftTmdb = left.tmdb?.trim();
  const rightTmdb = right.tmdb?.trim();

  if (leftImdb && rightImdb && leftImdb !== rightImdb) return false;
  if (leftTmdb && rightTmdb && leftTmdb !== rightTmdb) return false;

  return Boolean(
    (leftImdb && rightImdb && leftImdb === rightImdb)
    || (leftTmdb && rightTmdb && leftTmdb === rightTmdb),
  );
}

export function sameMyListMedia(
  left: MyListMediaIdentity,
  right: MyListMediaIdentity,
): boolean {
  return left.kind === right.kind
    && (
      left.mediaId === right.mediaId
      || sameExternalMediaIdentity(
        left.externalIds,
        right.externalIds,
      )
    );
}

export interface UserPreferences {
  appLocale: string | 'system';
  preferredAudioLanguages: string[];
  preferredSubtitleLanguages: string[];
  subtitlesEnabled: boolean;
  autoplay: boolean;
  favoriteChannelIds: string[];
  myListItems: MyListMediaItem[];
}

export function defaultUserPreferences(): UserPreferences {
  return {
    appLocale: 'system',
    preferredAudioLanguages: ['en', 'fr', 'de'],
    preferredSubtitleLanguages: [],
    subtitlesEnabled: true,
    autoplay: true,
    favoriteChannelIds: [],
    myListItems: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(
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

function normalizeLanguageList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value.slice(0, 20)) {
    const safe = boundedString(item, 128);
    if (!safe) continue;
    const normalized = normalizeLanguageTag(safe);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeStringList(
  value: unknown,
  maxItems = 1_000,
  maxLength = 512,
): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value.slice(0, maxItems)) {
    const normalized = boundedString(item, maxLength);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
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

function safeHttpsUrl(value: unknown): string | undefined {
  const normalized = boundedString(value, 2_048);
  if (!normalized) return undefined;
  try {
    const url = new URL(normalized);
    const sensitive = /token|key|secret|auth|signature|session|credential/i;
    const hasSensitiveQuery = [...url.searchParams.entries()].some(
      ([key, queryValue]) => (
        sensitive.test(key)
        || sensitive.test(queryValue)
      ),
    );
    const hasSensitiveFragment = sensitive.test(
      decodeURIComponent(url.hash.slice(1)),
    );
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || hasSensitiveQuery
      || hasSensitiveFragment
      || hasCredentialPathSegment(url.pathname)
      || url.href.length > 2_048
    ) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function safeExternalIds(value: unknown): ExternalMediaIds {
  if (!isRecord(value)) return {};
  const imdb = boundedString(value.imdb, 32);
  const tmdb = boundedString(value.tmdb, 32);
  return {
    ...(imdb && /^tt\d+$/i.test(imdb) ? { imdb } : {}),
    ...(tmdb && /^\d+$/.test(tmdb) ? { tmdb } : {}),
  };
}

function mergeMyListSnapshots(
  primary: MyListMediaItem,
  secondary: MyListMediaItem,
): MyListMediaItem {
  return {
    ...secondary,
    ...primary,
    externalIds: {
      ...secondary.externalIds,
      ...primary.externalIds,
    },
  };
}

function normalizeMyListItems(value: unknown): MyListMediaItem[] {
  if (!Array.isArray(value)) return [];

  const result: MyListMediaItem[] = [];

  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const mediaId = boundedString(candidate.mediaId, 512);
    const title = boundedString(candidate.title, 500);
    const providerId = boundedString(candidate.providerId, 512);
    const kind = candidate.kind === 'movie' || candidate.kind === 'series'
      ? candidate.kind
      : undefined;
    if (!mediaId || !title || !providerId || !kind) continue;

    const posterUrl = safeHttpsUrl(candidate.posterUrl);
    const backdropUrl = safeHttpsUrl(candidate.backdropUrl);
    const year = typeof candidate.year === 'number'
      && Number.isInteger(candidate.year)
      && candidate.year >= 1880
      && candidate.year <= 3000
      ? candidate.year
      : undefined;
    const externalIds = safeExternalIds(candidate.externalIds);
    const normalized: MyListMediaItem = {
      mediaId,
      kind,
      title,
      providerId,
      externalIds,
      ...(posterUrl ? { posterUrl } : {}),
      ...(backdropUrl ? { backdropUrl } : {}),
      ...(year ? { year } : {}),
    };

    const duplicateIndexes: number[] = [];
    result.forEach((item, index) => {
      if (sameMyListMedia(item, normalized)) {
        duplicateIndexes.push(index);
      }
    });

    if (duplicateIndexes.length) {
      const primaryIndex = duplicateIndexes[0]!;
      let merged = result[primaryIndex]!;
      for (const duplicateIndex of duplicateIndexes.slice(1)) {
        merged = mergeMyListSnapshots(
          merged,
          result[duplicateIndex]!,
        );
      }
      merged = mergeMyListSnapshots(merged, normalized);
      result[primaryIndex] = merged;

      for (
        let index = duplicateIndexes.length - 1;
        index >= 1;
        index -= 1
      ) {
        result.splice(duplicateIndexes[index]!, 1);
      }
      continue;
    }

    result.push(normalized);
    if (result.length >= MAX_MY_LIST_ITEMS) break;
  }

  return result;
}

function normalizeAppLocale(value: unknown): string | 'system' {
  if (value === 'system') return 'system';
  if (typeof value !== 'string') return 'system';
  return normalizeLanguageTag(value) ?? 'system';
}

export function migrateUserPreferences(value: unknown): UserPreferences {
  const defaults = defaultUserPreferences();
  if (!isRecord(value)) return defaults;

  const audioSource = Array.isArray(value.preferredAudioLanguages)
    ? value.preferredAudioLanguages
    : value.audioLanguages;
  const normalizedAudio = normalizeLanguageList(audioSource);
  const preferredAudioLanguages =
    Array.isArray(audioSource)
    && audioSource.length > 0
    && normalizedAudio.length === 0
      ? defaults.preferredAudioLanguages
      : normalizedAudio;

  let preferredSubtitleLanguages = normalizeLanguageList(value.preferredSubtitleLanguages);
  if (!Array.isArray(value.preferredSubtitleLanguages) && typeof value.subtitleLanguage === 'string') {
    const legacySubtitle = value.subtitleLanguage.toLowerCase();
    if (legacySubtitle !== 'auto' && legacySubtitle !== 'off' && legacySubtitle !== 'none') {
      preferredSubtitleLanguages = normalizeLanguageList([value.subtitleLanguage]);
    }
  }

  const legacySubtitlesDisabled =
    typeof value.subtitleLanguage === 'string'
    && ['off', 'none'].includes(value.subtitleLanguage.toLowerCase());

  return {
    appLocale: normalizeAppLocale(value.appLocale),
    preferredAudioLanguages,
    preferredSubtitleLanguages,
    subtitlesEnabled:
      typeof value.subtitlesEnabled === 'boolean'
        ? value.subtitlesEnabled
        : !legacySubtitlesDisabled,
    autoplay: typeof value.autoplay === 'boolean' ? value.autoplay : defaults.autoplay,
    favoriteChannelIds: normalizeStringList(value.favoriteChannelIds),
    myListItems: normalizeMyListItems(value.myListItems),
  };
}

export function completedFromProgress(
  progress: PlaybackProgress,
  threshold = 0.9,
): boolean {
  if (progress.durationMs <= 0 || threshold <= 0 || threshold > 1) {
    return false;
  }

  return progress.positionMs / progress.durationMs >= threshold;
}
