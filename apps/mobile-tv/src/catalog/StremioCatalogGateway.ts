import type {
  AddonCatalogDefinition,
  AddonStateRecord,
} from '@moviestv/addons';
import {
  defaultCatalogFetcher,
  fetchBoundedCatalogJson,
  type CatalogFetcher,
} from './CatalogJsonLoader';
import {
  canonicalMediaId,
  type CatalogGateway,
  type CatalogMediaItem,
  type CatalogPage,
  type CatalogRequestOptions,
  type CatalogSection,
  type MediaDetails,
  type SeriesEpisode,
  type SeriesSeason,
  type SeriesSeasonSummary,
} from '@moviestv/catalog';

type MediaKind = 'movie' | 'series';

interface StremioVideo {
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
  thumbnailUrl?: string;
  still?: string;
  stillUrl?: string;
  runtime?: string | number;
  imdbRating?: string | number;
}

interface StremioMeta {
  id?: string;
  imdb_id?: string;
  imdbId?: string;
  imdb?: string;
  moviedb_id?: string | number;
  tmdb_id?: string | number;
  tmdbId?: string | number;
  type?: string;
  name?: string;
  title?: string;
  poster?: string;
  posterUrl?: string;
  logo?: string;
  background?: string;
  backdrop?: string;
  backdropUrl?: string;
  description?: string;
  overview?: string;
  releaseInfo?: string;
  released?: string;
  year?: string | number;
  imdbRating?: string | number;
  rating?: string | number;
  genres?: string[];
  cast?: string[];
  runtime?: string | number;
  certification?: string;
  videos?: StremioVideo[];
}

interface CatalogResponse {
  metas?: StremioMeta[];
}

interface MetaResponse {
  meta?: StremioMeta | null;
}

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

const MAX_STREMIO_SEARCH_CATALOGS = 50;
const MAX_STREMIO_SEARCH_CONCURRENCY = 8;
const MAX_STREMIO_SKIP = 1_000_000_000;
const MAX_STREMIO_ITEM_CACHE = 2_000;
const MAX_STREMIO_GENRE_SECTIONS = 40;

interface CatalogSectionBinding {
  catalog: AddonCatalogDefinition;
  fixedExtras: Array<{ name: string; value: string }>;
}


function normalizedSkipCursor(value: string | undefined): string | undefined {
  const normalized = safeText(value, 32);
  if (!normalized || !/^\d+$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  if (
    !Number.isSafeInteger(parsed)
    || parsed < 0
    || parsed > MAX_STREMIO_SKIP
  ) return undefined;
  return String(parsed);
}

async function mapSettledWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  if (!items.length) return [];

  const results = new Array<PromiseSettledResult<R>>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = {
          status: 'fulfilled',
          value: await mapper(items[index]!, index),
        };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    ),
  );
  return results;
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

function numberValue(value?: string | number): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstYear(value?: string): number | undefined {
  const match = value?.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

function runtimeMinutes(value?: string | number): number | undefined {
  if (
    typeof value === 'number'
    && Number.isFinite(value)
    && value > 0
    && value <= 100_000
  ) return Math.round(value);
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const hours = value.match(/(\d+)\s*h/i);
  const minutes = value.match(/(\d+)\s*m/i);
  if (hours) return Number(hours[1]) * 60 + (minutes ? Number(minutes[1]) : 0);
  const direct = value.match(/\d+/);
  const parsed = direct ? Number(direct[0]) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100_000
    ? parsed
    : undefined;
}

function releasedDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

function resourceExternalIds(resourceId: string | undefined): { imdb?: string; tmdb?: string } {
  const rawId = resourceId?.trim();
  if (!rawId) return {};
  if (/^tt\d+$/i.test(rawId)) return { imdb: rawId.toLowerCase() };
  if (/^tmdb:/i.test(rawId)) {
    const candidate = rawId.split(':').at(-1)?.trim();
    if (candidate && /^\d+$/.test(candidate)) return { tmdb: candidate };
  }
  return {};
}

function externalIds(meta: StremioMeta): { imdb?: string; tmdb?: string } {
  const result = resourceExternalIds(meta.id);

  for (const value of [meta.imdb_id, meta.imdbId, meta.imdb]) {
    const imdb = typeof value === 'string' ? value.trim() : '';
    if (imdb && /^tt\d+$/i.test(imdb)) {
      if (!result.imdb) result.imdb = imdb.toLowerCase();
      break;
    }
  }

  for (const value of [
    meta.moviedb_id,
    meta.tmdb_id,
    meta.tmdbId,
  ]) {
    if (value === undefined || value === null) continue;
    const tmdb = String(value).trim();
    if (/^\d+$/.test(tmdb)) {
      if (!result.tmdb) result.tmdb = tmdb;
      break;
    }
  }

  return result;
}

function endpointBase(manifestUrl: string): string {
  const url = new URL(manifestUrl);
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  const loopbackHttp = url.protocol === 'http:'
    && ['localhost', '127.0.0.1', '::1'].includes(hostname);
  if (
    (url.protocol !== 'https:' && !loopbackHttp)
    || url.username
    || url.password
  ) {
    throw new Error('Catalog manifest URL must be secure HTTPS');
  }

  url.hash = '';
  url.search = '';
  const suffix = '/manifest.json';
  if (!url.pathname.endsWith(suffix)) throw new Error('Catalog manifest URL is invalid');
  url.pathname = url.pathname.slice(0, -suffix.length);
  return url.toString().replace(/\/$/, '');
}

function extraPath(parts: string[]): string {
  return parts.length ? `/${parts.join('&')}` : '';
}

function hasExtra(catalog: AddonCatalogDefinition, name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return catalog.extra.some(
    (item) => item.name.trim().toLowerCase() === normalized,
  );
}

function catalogExtra(
  catalog: AddonCatalogDefinition,
  name: string,
) {
  const normalized = name.trim().toLowerCase();
  return catalog.extra.find(
    (item) => item.name.trim().toLowerCase() === normalized,
  );
}

function genreOptions(catalog: AddonCatalogDefinition): string[] {
  const options = catalogExtra(catalog, 'genre')?.options ?? [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const option of options) {
    const value = safeText(option, 256);
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    result.push(value);
    if (result.length >= MAX_STREMIO_GENRE_SECTIONS) break;
  }

  return result;
}

function requiredExtrasSatisfied(
  catalog: AddonCatalogDefinition,
  provided: ReadonlySet<string>,
): boolean {
  return catalog.extra.every((extra) => (
    !extra.isRequired
    || provided.has(extra.name.trim().toLowerCase())
  ));
}

function normalizeItem(providerId: string, meta: StremioMeta, kind: MediaKind): CatalogMediaItem | null {
  const resourceId = safeText(meta.id, 512);
  const title = safeText(meta.name ?? meta.title, 500);
  if (!resourceId || !title) return null;

  const id = canonicalMediaId(
    providerId,
    kind,
    encodeURIComponent(resourceId),
  );
  if (id.length > 2_048) return null;

  const overview = safeText(meta.description ?? meta.overview, 4_000);
  const posterUrl = safeHttpUrl(meta.poster)
    ?? safeHttpUrl(meta.posterUrl)
    ?? safeHttpUrl(meta.logo);
  const backdropUrl = safeHttpUrl(meta.background)
    ?? safeHttpUrl(meta.backdrop)
    ?? safeHttpUrl(meta.backdropUrl);
  const genres = safeTextArray(meta.genres, 100, 128);
  const declaredYear = typeof meta.year === 'number'
    ? meta.year
    : typeof meta.year === 'string'
      ? Number.parseInt(meta.year.trim(), 10)
      : Number.NaN;
  const year = Number.isInteger(declaredYear)
    && declaredYear >= 1888
    && declaredYear <= 3000
    ? declaredYear
    : firstYear(meta.releaseInfo) ?? firstYear(meta.released);

  const rating = numberValue(meta.imdbRating ?? meta.rating);
  return {
    id,
    kind,
    title,
    ...(overview ? { overview } : {}),
    ...(year !== undefined ? { year } : {}),
    ...(posterUrl ? { posterUrl } : {}),
    ...(backdropUrl ? { backdropUrl } : {}),
    ...(rating !== undefined ? { rating } : {}),
    ...(genres ? { genres } : {}),
    providerId,
    externalIds: externalIds(meta),
  };
}

function parseOwnedId(providerId: string, mediaId: string): { kind: MediaKind; resourceId: string } | null {
  for (const kind of ['movie', 'series'] as const) {
    const prefix = `${providerId}:${kind}:`;
    if (!mediaId.startsWith(prefix)) continue;
    try {
      const resourceId = decodeURIComponent(
        mediaId.slice(prefix.length),
      ).trim();
      if (
        !resourceId
        || resourceId.length > 512
        || /[\u0000-\u001f\u007f]/.test(resourceId)
      ) return null;
      return { kind, resourceId };
    } catch {
      return null;
    }
  }
  return null;
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

function videoIdCoordinates(video: StremioVideo): { season: number; episode: number } | null {
  const match = video.id?.trim().match(/:(\d+):(\d+)$/);
  if (!match) return null;
  const season = nonNegativeInteger(match[1]);
  const episode = positiveInteger(match[2]);
  return season !== null && episode !== null ? { season, episode } : null;
}

function episodeNumber(video: StremioVideo): number | null {
  return positiveInteger(video.episode ?? video.number)
    ?? videoIdCoordinates(video)?.episode
    ?? null;
}

function seasonNumber(video: StremioVideo): number | null {
  return nonNegativeInteger(video.season)
    ?? videoIdCoordinates(video)?.season
    ?? null;
}

function mergedVideoRows(
  incoming: readonly StremioVideo[],
  previous: readonly StremioVideo[],
): StremioVideo[] {
  const result: StremioVideo[] = [];
  const indexByIdentity = new Map<string, number>();

  const identity = (video: StremioVideo): string | null => {
    const season = seasonNumber(video);
    const episode = episodeNumber(video);
    if (season !== null && episode !== null) {
      return `episode:${season}:${episode}`;
    }
    const id = safeText(video.id, 512);
    return id ? `id:${id}` : null;
  };

  const mergeMissing = (
    primary: StremioVideo,
    secondary: StremioVideo,
  ): StremioVideo => ({
    id: safeText(primary.id, 512) ?? safeText(secondary.id, 512),
    title: safeText(primary.title, 500) ?? safeText(secondary.title, 500),
    name: safeText(primary.name, 500) ?? safeText(secondary.name, 500),
    season: primary.season ?? secondary.season,
    episode: primary.episode ?? secondary.episode,
    number: primary.number ?? secondary.number,
    overview: safeText(primary.overview, 4_000)
      ?? safeText(secondary.overview, 4_000),
    description: safeText(primary.description, 4_000)
      ?? safeText(secondary.description, 4_000),
    released: safeText(primary.released, 256)
      ?? safeText(secondary.released, 256),
    thumbnail: safeText(primary.thumbnail, 2_048)
      ?? safeText(secondary.thumbnail, 2_048),
    thumbnailUrl: safeText(primary.thumbnailUrl, 2_048)
      ?? safeText(secondary.thumbnailUrl, 2_048),
    still: safeText(primary.still, 2_048)
      ?? safeText(secondary.still, 2_048),
    stillUrl: safeText(primary.stillUrl, 2_048)
      ?? safeText(secondary.stillUrl, 2_048),
    runtime: primary.runtime ?? secondary.runtime,
    imdbRating: primary.imdbRating ?? secondary.imdbRating,
  });

  for (const video of [...incoming, ...previous]) {
    if (result.length >= 10_000) break;
    const key = identity(video);
    if (!key) continue;
    const existingIndex = indexByIdentity.get(key);
    if (existingIndex === undefined) {
      indexByIdentity.set(key, result.length);
      result.push(video);
      continue;
    }
    const existing = result[existingIndex];
    if (existing) result[existingIndex] = mergeMissing(existing, video);
  }

  return result;
}

function seasons(seriesId: string, videos: readonly StremioVideo[]): SeriesSeasonSummary[] {
  const counts = new Map<number, number>();
  const seenEpisodes = new Set<string>();
  for (const video of videos.slice(0, 10_000)) {
    const season = seasonNumber(video);
    const episode = episodeNumber(video);
    if (season === null || episode === null) continue;
    const identity = `${season}:${episode}`;
    if (seenEpisodes.has(identity)) continue;
    seenEpisodes.add(identity);
    counts.set(season, (counts.get(season) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .slice(0, 500)
    .map(([season, episodeCount]) => ({
      id: `${seriesId}:season:${season}`,
      seasonNumber: season,
      name: `Season ${season}`,
      episodeCount,
    }));
}

function episodes(seriesId: string, videos: readonly StremioVideo[], targetSeason: number): SeriesEpisode[] {
  const byEpisode = new Map<
    number,
    { item: SeriesEpisode; explicitTitle: boolean }
  >();

  for (const video of videos.slice(0, 10_000)) {
    const season = seasonNumber(video);
    const episode = episodeNumber(video);
    if (season !== targetSeason || episode === null) continue;

    const id = safeText(video.id, 512)
      ?? `${seriesId}:${season}:${episode}`;
    if (id.length > 2_048) continue;

    const explicitTitle = safeText(video.title, 500)
      ?? safeText(video.name, 500);
    const overview = safeText(video.overview, 4_000)
      ?? safeText(video.description, 4_000);
    const stillUrl = safeHttpUrl(video.thumbnail)
      ?? safeHttpUrl(video.thumbnailUrl)
      ?? safeHttpUrl(video.still)
      ?? safeHttpUrl(video.stillUrl);
    const airDate = releasedDate(video.released);
    const runtime = runtimeMinutes(video.runtime);
    const rating = numberValue(video.imdbRating);
    const incoming: SeriesEpisode = {
      id,
      seriesId,
      seasonNumber: season,
      episodeNumber: episode,
      title: explicitTitle ?? `Episode ${episode}`,
      ...(overview ? { overview } : {}),
      ...(airDate ? { airDate } : {}),
      ...(runtime !== undefined ? { runtimeMinutes: runtime } : {}),
      ...(stillUrl ? { stillUrl } : {}),
      ...(rating !== undefined ? { rating } : {}),
    };

    const existing = byEpisode.get(episode);
    if (!existing) {
      byEpisode.set(episode, {
        item: incoming,
        explicitTitle: Boolean(explicitTitle),
      });
      continue;
    }

    byEpisode.set(episode, {
      explicitTitle: existing.explicitTitle || Boolean(explicitTitle),
      item: {
        ...existing.item,
        ...(!existing.explicitTitle && explicitTitle
          ? { title: explicitTitle }
          : {}),
        ...(!existing.item.overview && incoming.overview
          ? { overview: incoming.overview }
          : {}),
        ...(!existing.item.airDate && incoming.airDate
          ? { airDate: incoming.airDate }
          : {}),
        ...(existing.item.runtimeMinutes === undefined
          && incoming.runtimeMinutes !== undefined
          ? { runtimeMinutes: incoming.runtimeMinutes }
          : {}),
        ...(!existing.item.stillUrl && incoming.stillUrl
          ? { stillUrl: incoming.stillUrl }
          : {}),
        ...(existing.item.rating === undefined && incoming.rating !== undefined
          ? { rating: incoming.rating }
          : {}),
      },
    });
  }

  return [...byEpisode.values()]
    .map(({ item }) => item)
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
    .slice(0, 1_000);
}

export class StremioCatalogGateway implements CatalogGateway {
  readonly id: string;
  private readonly baseUrl: string;
  private readonly requestQuery: string;
  private readonly catalogs: AddonCatalogDefinition[];
  private readonly sectionMap = new Map<string, CatalogSectionBinding>();
  private readonly itemCache = new Map<string, MediaDetails>();
  private readonly videoCache = new Map<string, readonly StremioVideo[]>();

  constructor(
    private readonly record: AddonStateRecord,
    private readonly fetcher: CatalogFetcher = defaultCatalogFetcher,
    baseUrlOverride?: string,
  ) {
    const descriptor = record.descriptor;
    if (!descriptor?.manifestUrl || !descriptor.catalog) {
      throw new Error('Stremio catalog provider is incomplete');
    }
    this.id = `stremio-${descriptor.id.toLowerCase()}`;
    this.baseUrl = baseUrlOverride ?? endpointBase(descriptor.manifestUrl);
    this.requestQuery = new URL(descriptor.manifestUrl).search;
    this.catalogs = descriptor.catalog.catalogs;
    for (const catalog of this.baseCatalogs()) {
      this.sectionMap.set(this.sectionId(catalog), {
        catalog,
        fixedExtras: [],
      });
    }
    for (const catalog of this.homeCatalogs()) {
      this.sectionMap.set(this.homeSectionId(catalog), {
        catalog,
        fixedExtras: [],
      });
    }
    for (const catalog of this.genreCatalogs()) {
      for (const genre of genreOptions(catalog)) {
        this.sectionMap.set(this.genreSectionId(catalog, genre), {
          catalog,
          fixedExtras: [{ name: 'genre', value: genre }],
        });
      }
    }
  }

  async getSections(): Promise<CatalogSection[]> {
    const regular = this.baseCatalogs().map((catalog) => ({
      id: this.sectionId(catalog),
      title: catalog.name,
      kinds: [catalog.type],
    }));
    const home = this.homeCatalogs().map((catalog) => ({
      id: this.homeSectionId(catalog),
      title: catalog.name,
      kinds: [catalog.type],
    }));
    const genres = this.genreCatalogs().flatMap((catalog) => (
      genreOptions(catalog).map((genre) => ({
        id: this.genreSectionId(catalog, genre),
        title: `${catalog.name} · ${genre}`,
        kinds: [catalog.type],
      }))
    ));
    return [...home, ...regular, ...genres];
  }

  async browse(
    sectionId: string,
    cursor?: string,
    options: CatalogRequestOptions = {},
  ): Promise<CatalogPage> {
    const binding = this.sectionMap.get(sectionId);
    if (!binding) return { items: [] };
    const { catalog } = binding;

    const extras = binding.fixedExtras.map(({ name, value }) => (
      `${encodeURIComponent(name)}=${encodeURIComponent(value)}`
    ));
    const skip = normalizedSkipCursor(cursor);
    const skipExtra = catalogExtra(catalog, 'skip');
    if (skipExtra && (skip !== undefined || skipExtra.isRequired)) {
      extras.push(`skip=${encodeURIComponent(skip ?? '0')}`);
    }
    const payload = await this.getJson<CatalogResponse>(
      `/catalog/${catalog.type}/${encodeURIComponent(catalog.id)}${extraPath(extras)}.json`,
      options.timeoutMs,
    );
    const items = this.normalize(payload.metas, catalog.type);
    return {
      items,
      nextCursor: skipExtra && items.length
        ? String(Number(skip ?? '0') + items.length)
        : undefined,
    };
  }

  async search(
    query: string,
    cursor?: string,
    options: CatalogRequestOptions = {},
  ): Promise<CatalogPage> {
    const normalizedQuery = safeText(query, 500);
    if (!normalizedQuery) return { items: [] };

    const searchable = this.catalogs
      .filter((catalog) => (
        hasExtra(catalog, 'search')
        && requiredExtrasSatisfied(
          catalog,
          new Set(['search', 'skip']),
        )
      ))
      .slice(0, MAX_STREMIO_SEARCH_CATALOGS);
    const skip = normalizedSkipCursor(cursor);
    const results = await mapSettledWithConcurrency(
      searchable,
      MAX_STREMIO_SEARCH_CONCURRENCY,
      async (catalog) => {
        const extras = [`search=${encodeURIComponent(normalizedQuery)}`];
        const skipExtra = catalogExtra(catalog, 'skip');
        if (skipExtra && (skip !== undefined || skipExtra.isRequired)) {
          extras.push(`skip=${encodeURIComponent(skip ?? '0')}`);
        }
        const payload = await this.getJson<CatalogResponse>(
          `/catalog/${catalog.type}/${encodeURIComponent(catalog.id)}/${extras.join('&')}.json`,
          options.timeoutMs,
        );
        return this.normalize(payload.metas, catalog.type);
      },
    );

    const canAdvance = (
      searchable.length > 0
      && searchable.every((catalog) => hasExtra(catalog, 'skip'))
      && results.every((result) => result.status === 'fulfilled')
    );
    const pageAdvance = canAdvance
      ? Math.max(
          0,
          ...results.map((result) => (
            result.status === 'fulfilled' ? result.value.length : 0
          )),
        )
      : 0;
    const nextSkip = Number(skip ?? '0') + pageAdvance;
    const nextCursor = (
      pageAdvance > 0
      && Number.isSafeInteger(nextSkip)
      && nextSkip <= MAX_STREMIO_SKIP
    )
      ? String(nextSkip)
      : undefined;

    const seen = new Set<string>();
    const items: CatalogMediaItem[] = [];
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const item of result.value) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
        if (items.length >= 1_000) {
          return {
            items,
            ...(nextCursor ? { nextCursor } : {}),
          };
        }
      }
    }
    return {
      items,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  async getDetails(
    mediaId: string,
    options: CatalogRequestOptions = {},
  ): Promise<MediaDetails | null> {
    const parsed = parseOwnedId(this.id, mediaId);
    const descriptor = this.record.descriptor;
    if (!parsed) return null;

    const cached = this.itemCache.get(mediaId);
    if (!descriptor?.catalog?.meta?.types.includes(parsed.kind)) {
      return cached ? { ...cached } : null;
    }

    let payload: MetaResponse;
    try {
      payload = await this.getJson<MetaResponse>(
        `/meta/${parsed.kind}/${encodeURIComponent(parsed.resourceId)}.json`,
        options.timeoutMs,
      );
    } catch (error) {
      if (cached) return { ...cached };
      throw error;
    }
    if (!payload.meta) return cached ? { ...cached } : null;
    const item = normalizeItem(this.id, payload.meta, parsed.kind);
    if (!item) return null;

    // A provider may list a TMDB resource but return an IMDb-shaped meta ID
    // (or the reverse). Keep the catalog-owned ID stable and retain identifiers
    // from both the requested resource and the meta response so downstream
    // stream providers can match whichever namespace they support.
    const stableItem: CatalogMediaItem = {
      ...item,
      id: mediaId,
      externalIds: {
        ...resourceExternalIds(parsed.resourceId),
        ...item.externalIds,
      },
    };
    return this.rememberDetails(stableItem, payload.meta);
  }

  async getSeason(
    seriesId: string,
    targetSeason: number,
    options: CatalogRequestOptions = {},
  ): Promise<SeriesSeason | null> {
    if (
      !Number.isSafeInteger(targetSeason)
      || targetSeason < 0
      || targetSeason > 10_000
    ) return null;

    const parsed = parseOwnedId(this.id, seriesId);
    const descriptor = this.record.descriptor;
    if (!parsed || parsed.kind !== 'series') return null;

    let videos = this.videoCache.get(seriesId) ?? [];
    if (descriptor?.catalog?.meta?.types.includes('series')) {
      try {
        const payload = await this.getJson<MetaResponse>(
          `/meta/series/${encodeURIComponent(parsed.resourceId)}.json`,
          options.timeoutMs,
        );
        if (payload.meta) {
          const normalized = normalizeItem(
            this.id,
            payload.meta,
            'series',
          );
          if (normalized) {
            const stableItem: CatalogMediaItem = {
              ...normalized,
              id: seriesId,
              externalIds: {
                ...resourceExternalIds(parsed.resourceId),
                ...normalized.externalIds,
              },
            };
            this.rememberDetails(stableItem, payload.meta);
          }
          const incomingVideos = Array.isArray(payload.meta.videos)
            ? payload.meta.videos.slice(0, 10_000)
            : [];
          videos = incomingVideos.length
            ? mergedVideoRows(incomingVideos, videos)
            : videos;
        }
      } catch (error) {
        if (!videos.length) throw error;
      }
    }

    const items = episodes(
      seriesId,
      videos,
      targetSeason,
    );
    return items.length ? {
      seriesId,
      seasonNumber: targetSeason,
      name: `Season ${targetSeason}`,
      episodes: items,
    } : null;
  }

  private baseCatalogs(): AddonCatalogDefinition[] {
    const provided = new Set(['skip']);
    return this.catalogs.filter((catalog) => (
      requiredExtrasSatisfied(catalog, provided)
    ));
  }

  private genreCatalogs(): AddonCatalogDefinition[] {
    const provided = new Set(['genre', 'skip']);
    return (['movie', 'series'] as const).flatMap((kind) => {
      const candidates = this.catalogs.filter((catalog) => (
        catalog.type === kind
        && genreOptions(catalog).length > 0
        && requiredExtrasSatisfied(catalog, provided)
      ));
      const preferred =
        candidates.find((catalog) => catalog.id.toLowerCase().includes('popular'))
        ?? candidates.find((catalog) => catalog.id.toLowerCase().includes('trending'))
        ?? candidates[0];
      return preferred ? [preferred] : [];
    });
  }

  private homeCatalogs(): AddonCatalogDefinition[] {
    const baseCatalogs = this.baseCatalogs();
    return (['movie', 'series'] as const).flatMap((kind) => {
      const candidates = baseCatalogs.filter((catalog) => catalog.type === kind);
      const preferred =
        candidates.find((catalog) => catalog.id.toLowerCase().includes('trending'))
        ?? candidates.find((catalog) => catalog.id.toLowerCase().includes('popular'))
        ?? candidates[0];
      return preferred ? [preferred] : [];
    });
  }

  private homeSectionId(catalog: AddonCatalogDefinition): string {
    return `home:${this.id}:${encodeURIComponent(catalog.id)}`;
  }

  private sectionId(catalog: AddonCatalogDefinition): string {
    const route = catalog.type === 'movie' ? 'movies' : 'series';
    return `${route}:${this.id}:${encodeURIComponent(catalog.id)}`;
  }

  private genreSectionId(
    catalog: AddonCatalogDefinition,
    genre: string,
  ): string {
    return `${this.sectionId(catalog)}:genre:${encodeURIComponent(genre)}`;
  }

  private normalize(metas: StremioMeta[] | undefined, kind: MediaKind): CatalogMediaItem[] {
    const items: CatalogMediaItem[] = [];
    for (const meta of (Array.isArray(metas) ? metas : []).slice(0, 500)) {
      const declaredKind = safeText(meta.type, 32)?.toLowerCase();
      if (
        (declaredKind === 'movie' || declaredKind === 'series')
        && declaredKind !== kind
      ) continue;

      const item = normalizeItem(this.id, meta, kind);
      if (!item) continue;
      this.rememberDetails(item, meta);
      items.push(item);
    }
    return items;
  }

  private rememberDetails(
    item: CatalogMediaItem,
    meta: StremioMeta,
  ): MediaDetails {
    const incomingVideos = Array.isArray(meta.videos)
      ? meta.videos.slice(0, 10_000)
      : [];
    const previousVideos = this.videoCache.get(item.id) ?? [];
    const videos = incomingVideos.length
      ? mergedVideoRows(incomingVideos, previousVideos)
      : previousVideos;
    const summaries = item.kind === 'series'
      ? seasons(item.id, videos)
      : [];
    const runtime = runtimeMinutes(meta.runtime);
    const releaseDate = releasedDate(meta.released);
    const cast = safeTextArray(meta.cast, 100, 256);
    const certification = safeText(meta.certification, 32);
    const previous = this.itemCache.get(item.id);
    const details: MediaDetails = {
      ...(previous ?? {}),
      ...item,
      ...(runtime !== undefined ? { runtimeMinutes: runtime } : {}),
      ...(releaseDate ? { releaseDate } : {}),
      ...(summaries.length ? {
        seasonCount: summaries.length,
        episodeCount: summaries.reduce(
          (total, season) => total + (season.episodeCount ?? 0),
          0,
        ),
        seasons: summaries,
      } : {}),
      ...(cast ? { cast } : {}),
      ...(certification ? { certification } : {}),
    };

    if (this.itemCache.has(item.id)) this.itemCache.delete(item.id);
    this.itemCache.set(item.id, details);
    if (incomingVideos.length) {
      if (this.videoCache.has(item.id)) this.videoCache.delete(item.id);
      this.videoCache.set(item.id, videos);
    }

    while (this.itemCache.size > MAX_STREMIO_ITEM_CACHE) {
      const oldest = this.itemCache.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.itemCache.delete(oldest);
      this.videoCache.delete(oldest);
    }
    return details;
  }

  private async getJson<T>(
    path: string,
    timeoutMs?: number,
  ): Promise<T> {
    return await fetchBoundedCatalogJson(
      this.fetcher,
      `${this.baseUrl}${path}${this.requestQuery}`,
      timeoutMs,
    ) as T;
  }
}
