import type {
  CatalogGateway,
  CatalogMediaItem,
  CatalogPage,
  CatalogRequestOptions,
  CatalogSection,
  MediaDetails,
  SeriesEpisode,
  SeriesSeason,
  SeriesSeasonSummary,
} from '@moviestv/catalog';
import { canonicalMediaId } from '@moviestv/catalog';
import {
  defaultCatalogFetcher,
  fetchBoundedCatalogJson,
  type CatalogFetcher,
} from './CatalogJsonLoader';

type CinemetaKind = 'movie' | 'series';

interface CinemetaVideo {
  id?: string;
  title?: string;
  name?: string;
  season?: number | string;
  episode?: number | string;
  number?: number | string;
  overview?: string;
  description?: string;
  released?: string;
  thumbnail?: string;
  runtime?: string;
  imdbRating?: string | number;
}

interface CinemetaMeta {
  id?: string;
  imdb_id?: string;
  type?: string;
  name?: string;
  title?: string;
  poster?: string;
  background?: string;
  description?: string;
  overview?: string;
  releaseInfo?: string;
  released?: string;
  imdbRating?: string | number;
  rating?: string | number;
  genres?: string[];
  cast?: string[];
  runtime?: string;
  certification?: string;
  videos?: CinemetaVideo[];
}

interface CatalogResponse {
  metas?: CinemetaMeta[];
}

interface MetaResponse {
  meta?: CinemetaMeta | null;
}

const SECTIONS: CatalogSection[] = [
  { id: 'home:popular-movies', title: 'Popular Movies', kinds: ['movie'] },
  { id: 'home:popular-series', title: 'Popular Series', kinds: ['series'] },
  { id: 'movies:popular', title: 'Popular Movies', kinds: ['movie'] },
  { id: 'movies:featured', title: 'Featured Movies', kinds: ['movie'] },
  { id: 'series:popular', title: 'Popular Series', kinds: ['series'] },
  { id: 'series:featured', title: 'Featured Series', kinds: ['series'] },
];

function safeText(
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

function safeHttpUrl(value: unknown): string | undefined {
  const normalized = safeText(value, 2_048);
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
    let fragment = url.hash.slice(1);
    try {
      fragment = decodeURIComponent(fragment);
    } catch {
      return undefined;
    }
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:')
      || url.username
      || url.password
      || hasSensitiveQuery
      || sensitive.test(fragment)
      || hasCredentialPathSegment(url.pathname)
      || url.href.length > 2_048
    ) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function safeTextArray(
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const result = value
    .slice(0, maxItems)
    .flatMap((entry) => {
      const normalized = safeText(entry, maxLength);
      if (!normalized || seen.has(normalized)) return [];
      seen.add(normalized);
      return [normalized];
    });
  return result.length ? result : undefined;
}

const SECTION_ENDPOINTS: Record<string, { kind: CinemetaKind; catalog: string }> = {
  'home:popular-movies': { kind: 'movie', catalog: 'top' },
  'home:popular-series': { kind: 'series', catalog: 'top' },
  'movies:popular': { kind: 'movie', catalog: 'top' },
  'movies:featured': { kind: 'movie', catalog: 'imdbRating' },
  'series:popular': { kind: 'series', catalog: 'top' },
  'series:featured': { kind: 'series', catalog: 'imdbRating' },
};

function firstYear(value?: string): number | undefined {
  const match = value?.match(/\b(19|20)\d{2}\b/);
  if (!match) return undefined;
  const year = Number(match[0]);
  return Number.isFinite(year) ? year : undefined;
}

function numberValue(value?: string | number): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function runtimeMinutes(value?: string): number | undefined {
  if (!value) return undefined;
  const hourMatch = value.match(/(\d+)\s*h/i);
  const minuteMatch = value.match(/(\d+)\s*m/i);
  if (hourMatch) {
    return Number(hourMatch[1]) * 60 + (minuteMatch ? Number(minuteMatch[1]) : 0);
  }
  const direct = value.match(/\d+/);
  return direct ? Number(direct[0]) : undefined;
}

function imdbId(meta: CinemetaMeta): string | null {
  const value = safeText(meta.imdb_id ?? meta.id, 32);
  return value && /^tt\d+$/i.test(value) ? value : null;
}

function normalizeItem(meta: CinemetaMeta, kind: CinemetaKind): CatalogMediaItem | null {
  const imdb = imdbId(meta);
  const title = safeText(meta.name ?? meta.title, 500);
  if (!imdb || !title) return null;

  const overview = safeText(meta.description ?? meta.overview, 4_000);
  const posterUrl = safeHttpUrl(meta.poster);
  const backdropUrl = safeHttpUrl(meta.background);
  const genres = safeTextArray(meta.genres, 100, 128);

  return {
    id: canonicalMediaId('cinemeta', kind, imdb),
    kind,
    title,
    ...(overview ? { overview } : {}),
    year: firstYear(meta.releaseInfo) ?? firstYear(meta.released),
    ...(posterUrl ? { posterUrl } : {}),
    ...(backdropUrl ? { backdropUrl } : {}),
    rating: numberValue(meta.imdbRating ?? meta.rating),
    ...(genres ? { genres } : {}),
    providerId: 'cinemeta',
    externalIds: { imdb },
  };
}

function parseCanonicalId(mediaId: string): { kind: CinemetaKind; imdb: string } | null {
  const match = /^cinemeta:(movie|series):(tt\d+)$/i.exec(mediaId);
  return match ? { kind: match[1].toLowerCase() as CinemetaKind, imdb: match[2] } : null;
}

function releasedDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 100_000
    ? parsed
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 10_000
    ? parsed
    : null;
}

function videoIdCoordinates(video: CinemetaVideo): { season: number; episode: number } | null {
  const match = video.id?.trim().match(/:(\d+):(\d+)$/);
  if (!match) return null;
  const season = nonNegativeInteger(match[1]);
  const episode = positiveInteger(match[2]);
  return season !== null && episode !== null ? { season, episode } : null;
}

function episodeNumber(video: CinemetaVideo): number | null {
  return positiveInteger(video.episode ?? video.number)
    ?? videoIdCoordinates(video)?.episode
    ?? null;
}

function validSeason(video: CinemetaVideo): number | null {
  return nonNegativeInteger(video.season)
    ?? videoIdCoordinates(video)?.season
    ?? null;
}

function normalizeEpisodes(
  seriesId: string,
  videos: readonly CinemetaVideo[],
  seasonNumber: number,
): SeriesEpisode[] {
  const seenEpisodes = new Set<number>();
  return videos
    .slice(0, 10_000)
    .map((video): SeriesEpisode | null => {
      const season = validSeason(video);
      const episode = episodeNumber(video);
      if (
        season !== seasonNumber
        || episode === null
        || seenEpisodes.has(episode)
      ) return null;
      const id = safeText(video.id, 512)
        ?? `${seriesId}:${season}:${episode}`;
      const title = safeText(
        video.title ?? video.name ?? `Episode ${episode}`,
        500,
      );
      if (!title || id.length > 2_048) return null;
      seenEpisodes.add(episode);
      const overview = safeText(video.overview ?? video.description, 4_000);
      const stillUrl = safeHttpUrl(video.thumbnail);
      return {
        id,
        seriesId,
        seasonNumber: season,
        episodeNumber: episode,
        title,
        ...(overview ? { overview } : {}),
        airDate: releasedDate(video.released),
        runtimeMinutes: runtimeMinutes(video.runtime),
        ...(stillUrl ? { stillUrl } : {}),
        rating: numberValue(video.imdbRating),
      };
    })
    .filter((episode): episode is SeriesEpisode => episode !== null)
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
    .slice(0, 1_000);
}

function seasonSummaries(
  seriesId: string,
  videos: readonly CinemetaVideo[],
): SeriesSeasonSummary[] {
  const summaries = new Map<
    number,
    { episodeCount: number; airDate?: string }
  >();
  const seenEpisodes = new Set<string>();
  for (const video of videos.slice(0, 10_000)) {
    const season = validSeason(video);
    const episode = episodeNumber(video);
    if (season === null || episode === null) continue;
    const identity = `${season}:${episode}`;
    if (seenEpisodes.has(identity)) continue;
    seenEpisodes.add(identity);
    const current = summaries.get(season) ?? { episodeCount: 0 };
    const airDate = releasedDate(video.released);
    const earliestAirDate = (
      !current.airDate
      || (airDate && airDate < current.airDate)
    )
      ? airDate
      : current.airDate;
    summaries.set(season, {
      episodeCount: current.episodeCount + 1,
      ...(earliestAirDate ? { airDate: earliestAirDate } : {}),
    });
  }

  return [...summaries.entries()]
    .sort(([a], [b]) => a - b)
    .slice(0, 500)
    .map(([seasonNumber, summary]) => ({
      id: `${seriesId}:season:${seasonNumber}`,
      seasonNumber,
      name: `Season ${seasonNumber}`,
      episodeCount: summary.episodeCount,
      ...(summary.airDate ? { airDate: summary.airDate } : {}),
    }));
}

export class CinemetaCatalogGateway implements CatalogGateway {
  readonly id = 'cinemeta';

  constructor(
    private readonly baseUrl = 'https://v3-cinemeta.strem.io',
    private readonly fetcher: CatalogFetcher = defaultCatalogFetcher,
  ) {}

  async getSections(): Promise<CatalogSection[]> {
    return SECTIONS;
  }

  async browse(
    sectionId: string,
    cursor?: string,
    options: CatalogRequestOptions = {},
  ): Promise<CatalogPage> {
    const endpoint = SECTION_ENDPOINTS[sectionId];
    if (!endpoint) return { items: [] };

    const skip = cursor ? Number.parseInt(cursor, 10) : 0;
    const extra = Number.isFinite(skip) && skip > 0 ? `/skip=${skip}` : '';
    const response = await this.getJson<CatalogResponse>(
      `/catalog/${endpoint.kind}/${endpoint.catalog}${extra}.json`,
      options.timeoutMs,
    );
    const items = this.normalizeCatalog(response.metas, endpoint.kind);
    return {
      items,
      nextCursor: items.length > 0 ? String(skip + items.length) : undefined,
    };
  }

  async search(
    query: string,
    cursor?: string,
    options: CatalogRequestOptions = {},
  ): Promise<CatalogPage> {
    const skip = cursor ? Number.parseInt(cursor, 10) : 0;
    const extraParts = [`search=${encodeURIComponent(query)}`];
    if (Number.isFinite(skip) && skip > 0) extraParts.push(`skip=${skip}`);
    const extra = extraParts.join('&');

    const [movies, series] = await Promise.all([
      this.getJson<CatalogResponse>(
        `/catalog/movie/top/${extra}.json`,
        options.timeoutMs,
      ),
      this.getJson<CatalogResponse>(
        `/catalog/series/top/${extra}.json`,
        options.timeoutMs,
      ),
    ]);
    const items = [
      ...this.normalizeCatalog(movies.metas, 'movie'),
      ...this.normalizeCatalog(series.metas, 'series'),
    ];
    return {
      items,
      nextCursor: items.length > 0 ? String(skip + items.length) : undefined,
    };
  }

  async getDetails(
    mediaId: string,
    options: CatalogRequestOptions = {},
  ): Promise<MediaDetails | null> {
    const parsed = parseCanonicalId(mediaId);
    if (!parsed) return null;
    const response = await this.getJson<MetaResponse>(
      `/meta/${parsed.kind}/${parsed.imdb}.json`,
      options.timeoutMs,
    );
    if (!response.meta) return null;

    const item = normalizeItem(response.meta, parsed.kind);
    if (!item) return null;
    const videos = response.meta.videos ?? [];
    const seasons = parsed.kind === 'series' ? seasonSummaries(item.id, videos) : [];

    return {
      ...item,
      runtimeMinutes: runtimeMinutes(response.meta.runtime),
      releaseDate: releasedDate(response.meta.released),
      seasonCount: seasons.length || undefined,
      episodeCount: seasons.length
        ? seasons.reduce((total, season) => total + (season.episodeCount ?? 0), 0)
        : undefined,
      seasons: seasons.length ? seasons : undefined,
      cast: safeTextArray(response.meta.cast, 100, 256),
      certification: safeText(response.meta.certification, 32),
    };
  }

  async getSeason(
    seriesId: string,
    seasonNumber: number,
    options: CatalogRequestOptions = {},
  ): Promise<SeriesSeason | null> {
    const parsed = parseCanonicalId(seriesId);
    if (!parsed || parsed.kind !== 'series' || seasonNumber < 0) return null;

    const response = await this.getJson<MetaResponse>(
      `/meta/series/${parsed.imdb}.json`,
      options.timeoutMs,
    );
    if (!response.meta) return null;
    const episodes = normalizeEpisodes(seriesId, response.meta.videos ?? [], seasonNumber);
    if (!episodes.length) return null;

    return {
      seriesId,
      seasonNumber,
      name: `Season ${seasonNumber}`,
      episodes,
    };
  }

  private normalizeCatalog(metas: CinemetaMeta[] | undefined, kind: CinemetaKind): CatalogMediaItem[] {
    return (metas ?? [])
      .slice(0, 500)
      .map((meta) => normalizeItem(meta, kind))
      .filter((item): item is CatalogMediaItem => item !== null);
  }

  private async getJson<T>(
    path: string,
    timeoutMs?: number,
  ): Promise<T> {
    return await fetchBoundedCatalogJson(
      this.fetcher,
      `${this.baseUrl.replace(/\/+$/, '')}${path}`,
      timeoutMs,
    ) as T;
  }
}
