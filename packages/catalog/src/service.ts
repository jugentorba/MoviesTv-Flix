import { dedupeCatalogItems } from './dedupe';
import { normalizeSearchQuery } from './query';
import type { CatalogCache } from './cache';
import type { CatalogRegistry } from './registry';
import type {
  CatalogMediaItem,
  CatalogPage,
  CatalogRequestOptions,
  CatalogSection,
  MediaDetails,
  SeriesSeason,
} from './types';

const SEARCH_TTL_MS = 10 * 60 * 1000;
const BROWSE_TTL_MS = 15 * 60 * 1000;
const DETAILS_TTL_MS = 24 * 60 * 60 * 1000;
const SEASON_TTL_MS = 24 * 60 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 8_000;
const MAX_CONCURRENT_CATALOG_PROVIDERS = 8;
const MAX_CURSOR_LENGTH = 128;
const MAX_CATALOG_ID_LENGTH = 2_048;
const MAX_SEASON_NUMBER = 10_000;
const MAX_KNOWN_CATALOG_ITEMS = 5_000;

function boundedCatalogInput(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > maxLength
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) return null;
  return normalized;
}

function boundedCursor(value: string | undefined): string | undefined | null {
  if (value === undefined) return undefined;
  return boundedCatalogInput(value, MAX_CURSOR_LENGTH);
}

function catalogCacheKey(
  operation: 'search' | 'browse',
  primary: string,
  cursor?: string,
): string {
  return JSON.stringify([operation, primary, cursor ?? null]);
}


function objectRecord(
  value: unknown,
): Record<string, unknown> | null {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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

function safeHttpUrl(value: unknown): string | undefined {
  const normalized = boundedCatalogInput(value, 2_048);
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
    const hasSensitiveFragment = sensitive.test(
      decodeURIComponent(url.hash.slice(1)),
    );
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:')
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

function normalizeExternalIds(
  value: unknown,
): CatalogMediaItem['externalIds'] {
  const source = objectRecord(value);
  if (!source) return {};
  const imdb = boundedCatalogInput(source.imdb, 32);
  const tmdb = boundedCatalogInput(source.tmdb, 32);
  return {
    ...(imdb && /^tt\d+$/i.test(imdb)
      ? { imdb: imdb.toLowerCase() }
      : {}),
    ...(tmdb && /^\d+$/.test(tmdb) ? { tmdb } : {}),
  };
}

function normalizeCatalogItem(
  value: unknown,
): CatalogMediaItem | null {
  const item = objectRecord(value);
  if (!item) return null;

  const id = boundedCatalogInput(item.id, MAX_CATALOG_ID_LENGTH);
  const title = boundedCatalogInput(item.title, 500);
  const providerId = boundedCatalogInput(item.providerId, 512);
  const kind = item.kind === 'movie' || item.kind === 'series'
    ? item.kind
    : null;
  if (!id || !title || !providerId || !kind) return null;

  const originalTitle = boundedCatalogInput(item.originalTitle, 500);
  const overview = boundedCatalogInput(item.overview, 4_000);
  const posterUrl = safeHttpUrl(item.posterUrl);
  const backdropUrl = safeHttpUrl(item.backdropUrl);
  const year = (
    typeof item.year === 'number'
    && Number.isInteger(item.year)
    && item.year >= 1888
    && item.year <= 3000
  ) ? item.year : undefined;
  const releaseYear = (
    typeof item.releaseYear === 'number'
    && Number.isInteger(item.releaseYear)
    && item.releaseYear >= 1888
    && item.releaseYear <= 3000
  ) ? item.releaseYear : undefined;
  const rating = (
    typeof item.rating === 'number'
    && Number.isFinite(item.rating)
    && item.rating >= 0
    && item.rating <= 10
  ) ? item.rating : undefined;
  const genres = Array.isArray(item.genres)
    ? [...new Set(
      item.genres
        .slice(0, 100)
        .flatMap((genre) => {
          const normalized = boundedCatalogInput(genre, 128);
          return normalized ? [normalized] : [];
        }),
    )]
    : [];

  return {
    id,
    kind,
    title,
    providerId,
    externalIds: normalizeExternalIds(item.externalIds),
    ...(originalTitle ? { originalTitle } : {}),
    ...(overview ? { overview } : {}),
    ...(year !== undefined ? { year } : {}),
    ...(releaseYear !== undefined ? { releaseYear } : {}),
    ...(posterUrl ? { posterUrl } : {}),
    ...(backdropUrl ? { backdropUrl } : {}),
    ...(rating !== undefined ? { rating } : {}),
    ...(genres.length ? { genres } : {}),
  };
}

function normalizeCatalogPage(
  value: unknown,
  maxItems = 1_000,
): CatalogPage | null {
  const page = objectRecord(value);
  if (!page || !Array.isArray(page.items)) return null;

  const items = page.items
    .slice(0, maxItems)
    .flatMap((item) => {
      const normalized = normalizeCatalogItem(item);
      return normalized ? [normalized] : [];
    });
  const nextCursor = page.nextCursor === undefined
    ? undefined
    : boundedCatalogInput(page.nextCursor, MAX_CURSOR_LENGTH);

  return {
    items,
    ...(nextCursor ? { nextCursor } : {}),
  };
}

function normalizeCatalogSection(
  value: unknown,
): CatalogSection | null {
  const section = objectRecord(value);
  if (!section) return null;

  const id = boundedCatalogInput(section.id, MAX_CATALOG_ID_LENGTH);
  const title = boundedCatalogInput(section.title, 500);
  if (!id || !title || !Array.isArray(section.kinds)) return null;

  const kinds = [...new Set(
    section.kinds
      .slice(0, 4)
      .filter((kind): kind is 'movie' | 'series' => (
        kind === 'movie' || kind === 'series'
      )),
  )];
  if (!kinds.length) return null;

  return { id, title, kinds };
}

function safeOptionalText(
  value: unknown,
  maxLength: number,
): string | undefined {
  return boundedCatalogInput(value, maxLength) ?? undefined;
}

function safeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : undefined;
}

function normalizeSeasonSummary(
  value: unknown,
): NonNullable<MediaDetails['seasons']>[number] | null {
  const season = objectRecord(value);
  if (!season) return null;
  const id = boundedCatalogInput(season.id, 512);
  const seasonNumber = safeInteger(
    season.seasonNumber,
    0,
    MAX_SEASON_NUMBER,
  );
  const name = boundedCatalogInput(season.name, 500);
  if (!id || seasonNumber === undefined || !name) return null;

  const episodeCount = safeInteger(
    season.episodeCount,
    0,
    100_000,
  );
  const airDate = safeOptionalText(season.airDate, 64);
  const posterUrl = safeHttpUrl(season.posterUrl);
  return {
    id,
    seasonNumber,
    name,
    ...(episodeCount !== undefined ? { episodeCount } : {}),
    ...(airDate ? { airDate } : {}),
    ...(posterUrl ? { posterUrl } : {}),
  };
}

function normalizeMediaDetails(
  value: unknown,
): MediaDetails | null {
  const base = normalizeCatalogItem(value);
  const details = objectRecord(value);
  if (!base || !details) return null;

  const runtimeMinutes = (
    typeof details.runtimeMinutes === 'number'
    && Number.isFinite(details.runtimeMinutes)
    && details.runtimeMinutes > 0
    && details.runtimeMinutes <= 100_000
  ) ? details.runtimeMinutes : undefined;
  const releaseDate = safeOptionalText(details.releaseDate, 64);
  const seasonCount = safeInteger(
    details.seasonCount,
    0,
    MAX_SEASON_NUMBER,
  );
  const episodeCount = safeInteger(
    details.episodeCount,
    0,
    1_000_000,
  );
  const seasons = Array.isArray(details.seasons)
    ? details.seasons
      .slice(0, MAX_SEASON_NUMBER + 1)
      .flatMap((season) => {
        const normalized = normalizeSeasonSummary(season);
        return normalized ? [normalized] : [];
      })
      .filter((season, index, list) => (
        list.findIndex((candidate) => (
          candidate.seasonNumber === season.seasonNumber
        )) === index
      ))
      .sort((left, right) => left.seasonNumber - right.seasonNumber)
    : [];
  const cast = Array.isArray(details.cast)
    ? [...new Set(
      details.cast
        .slice(0, 100)
        .flatMap((name) => {
          const normalized = boundedCatalogInput(name, 256);
          return normalized ? [normalized] : [];
        }),
    )]
    : [];
  const certification = safeOptionalText(
    details.certification,
    32,
  );

  return {
    ...base,
    ...(runtimeMinutes !== undefined ? { runtimeMinutes } : {}),
    ...(releaseDate ? { releaseDate } : {}),
    ...(seasonCount !== undefined ? { seasonCount } : {}),
    ...(episodeCount !== undefined ? { episodeCount } : {}),
    ...(seasons.length ? { seasons } : {}),
    ...(cast.length ? { cast } : {}),
    ...(certification ? { certification } : {}),
  };
}

function normalizeSeriesEpisode(
  value: unknown,
  expectedSeriesId: string,
  expectedSeasonNumber: number,
): SeriesSeason['episodes'][number] | null {
  const episode = objectRecord(value);
  if (!episode) return null;

  const id = boundedCatalogInput(episode.id, MAX_CATALOG_ID_LENGTH);
  const seriesId = boundedCatalogInput(
    episode.seriesId,
    MAX_CATALOG_ID_LENGTH,
  );
  const seasonNumber = safeInteger(
    episode.seasonNumber,
    0,
    MAX_SEASON_NUMBER,
  );
  const episodeNumber = safeInteger(
    episode.episodeNumber,
    1,
    100_000,
  );
  const title = boundedCatalogInput(episode.title, 500);
  if (
    !id
    || !seriesId
    || seriesId !== expectedSeriesId
    || seasonNumber !== expectedSeasonNumber
    || episodeNumber === undefined
    || !title
  ) return null;

  const overview = safeOptionalText(episode.overview, 4_000);
  const airDate = safeOptionalText(episode.airDate, 64);
  const runtimeMinutes = (
    typeof episode.runtimeMinutes === 'number'
    && Number.isFinite(episode.runtimeMinutes)
    && episode.runtimeMinutes > 0
    && episode.runtimeMinutes <= 100_000
  ) ? episode.runtimeMinutes : undefined;
  const stillUrl = safeHttpUrl(episode.stillUrl);
  const rating = (
    typeof episode.rating === 'number'
    && Number.isFinite(episode.rating)
    && episode.rating >= 0
    && episode.rating <= 10
  ) ? episode.rating : undefined;

  return {
    id,
    seriesId,
    seasonNumber: expectedSeasonNumber,
    episodeNumber,
    title,
    ...(overview ? { overview } : {}),
    ...(airDate ? { airDate } : {}),
    ...(runtimeMinutes !== undefined ? { runtimeMinutes } : {}),
    ...(stillUrl ? { stillUrl } : {}),
    ...(rating !== undefined ? { rating } : {}),
  };
}

function normalizeSeriesSeason(
  value: unknown,
  expectedSeriesId: string,
  expectedSeasonNumber: number,
): SeriesSeason | null {
  const season = objectRecord(value);
  if (!season || !Array.isArray(season.episodes)) return null;

  const seriesId = boundedCatalogInput(
    season.seriesId,
    MAX_CATALOG_ID_LENGTH,
  );
  if (
    seriesId !== expectedSeriesId
    || season.seasonNumber !== expectedSeasonNumber
  ) return null;

  const episodes = season.episodes
    .slice(0, 1_000)
    .flatMap((episode) => {
      const normalized = normalizeSeriesEpisode(
        episode,
        expectedSeriesId,
        expectedSeasonNumber,
      );
      return normalized ? [normalized] : [];
    })
    .filter((episode, index, list) => (
      list.findIndex((candidate) => (
        candidate.episodeNumber === episode.episodeNumber
      )) === index
    ))
    .sort((left, right) => (
      left.episodeNumber - right.episodeNumber
    ));

  const name = safeOptionalText(season.name, 500);
  const airDate = safeOptionalText(season.airDate, 64);
  const posterUrl = safeHttpUrl(season.posterUrl);

  return {
    seriesId: expectedSeriesId,
    seasonNumber: expectedSeasonNumber,
    ...(name ? { name } : {}),
    ...(airDate ? { airDate } : {}),
    ...(posterUrl ? { posterUrl } : {}),
    episodes,
  };
}


function hasExpectedSeasonEpisodes(
  season: SeriesSeason,
  expectedEpisodeCount: number | undefined,
): boolean {
  if (expectedEpisodeCount === undefined) return true;
  if (expectedEpisodeCount === 0) return season.episodes.length === 0;

  const episodeNumbers = new Set(
    season.episodes.map((episode) => episode.episodeNumber),
  );
  for (
    let episodeNumber = 1;
    episodeNumber <= expectedEpisodeCount;
    episodeNumber += 1
  ) {
    if (!episodeNumbers.has(episodeNumber)) return false;
  }
  return true;
}

function mergePartialSeasons(
  preferred: SeriesSeason,
  fallback: SeriesSeason,
): SeriesSeason {
  const byEpisodeNumber = new Map(
    preferred.episodes.map((episode) => [
      episode.episodeNumber,
      episode,
    ] as const),
  );
  for (const episode of fallback.episodes) {
    if (!byEpisodeNumber.has(episode.episodeNumber)) {
      byEpisodeNumber.set(episode.episodeNumber, episode);
    }
  }

  return {
    ...preferred,
    ...(preferred.name ? {} : fallback.name ? { name: fallback.name } : {}),
    ...(preferred.airDate ? {} : fallback.airDate ? { airDate: fallback.airDate } : {}),
    ...(preferred.posterUrl ? {} : fallback.posterUrl ? { posterUrl: fallback.posterUrl } : {}),
    episodes: [...byEpisodeNumber.values()].sort(
      (left, right) => left.episodeNumber - right.episodeNumber,
    ),
  };
}


function chainAttemptTimeoutMs(
  deadline: number,
  remainingProviders: number,
): number {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return 0;
  return Math.max(
    1,
    Math.floor(remainingMs / Math.max(1, remainingProviders)),
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Catalog provider timed out')), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}


async function allSettledWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (
    item: T,
    index: number,
    options: CatalogRequestOptions,
  ) => Promise<R>,
  totalBudgetMs = PROVIDER_TIMEOUT_MS,
): Promise<PromiseSettledResult<R>[]> {
  if (!items.length) return [];

  const results = new Array<PromiseSettledResult<R>>(items.length);
  const workerCount = Math.min(concurrency, items.length);
  const budgetMs = Number.isFinite(totalBudgetMs) && totalBudgetMs > 0
    ? totalBudgetMs
    : 1;
  const waves = Math.max(1, Math.ceil(items.length / workerCount));
  const attemptBudgetMs = Math.max(1, Math.floor(budgetMs / waves));
  const deadline = Date.now() + budgetMs;
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        results[index] = {
          status: 'rejected',
          reason: new Error('Catalog provider timed out'),
        };
        continue;
      }

      try {
        results[index] = {
          status: 'fulfilled',
          value: await withTimeout(
            mapper(
              items[index]!,
              index,
              {
                timeoutMs: Math.max(
                  1,
                  Math.min(attemptBudgetMs, remainingMs),
                ),
              },
            ),
            Math.max(1, Math.min(attemptBudgetMs, remainingMs)),
          ),
        };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: workerCount },
      () => worker(),
    ),
  );
  return results;
}

function successfulPages(
  results: PromiseSettledResult<CatalogPage>[],
): CatalogPage[] {
  return results.flatMap((result) => {
    if (result.status !== 'fulfilled') return [];
    const page = normalizeCatalogPage(result.value);
    return page ? [page] : [];
  });
}

export class CatalogService {
  private readonly sectionOwners = new Map<string, string>();
  private readonly knownSectionsByProvider = new Map<string, CatalogSection[]>();
  private readonly knownItems = new Map<string, CatalogMediaItem>();
  private readonly knownSeasonEpisodeCounts = new Map<string, number>();

  constructor(
    private readonly registry: CatalogRegistry,
    private readonly cache?: CatalogCache,
    private readonly cacheNamespace = '',
  ) {}

  private cacheKey(key: string): string {
    return this.cacheNamespace ? `${this.cacheNamespace}:${key}` : key;
  }


  private seasonExpectationKey(
    seriesId: string,
    seasonNumber: number,
  ): string {
    return `${seriesId}\u0000${seasonNumber}`;
  }

  private rememberSeasonExpectations(
    details: MediaDetails,
  ): MediaDetails {
    for (const season of details.seasons ?? []) {
      if (
        typeof season.episodeCount !== 'number'
        || !Number.isInteger(season.episodeCount)
        || season.episodeCount < 0
      ) continue;
      const key = this.seasonExpectationKey(
        details.id,
        season.seasonNumber,
      );
      this.knownSeasonEpisodeCounts.delete(key);
      this.knownSeasonEpisodeCounts.set(
        key,
        season.episodeCount,
      );
    }

    while (
      this.knownSeasonEpisodeCounts.size
      > MAX_KNOWN_CATALOG_ITEMS
    ) {
      const oldest = this.knownSeasonEpisodeCounts.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.knownSeasonEpisodeCounts.delete(oldest);
    }
    return details;
  }

  private async readCache<T>(
    key: string,
  ): Promise<{ value: T; stale: boolean } | null> {
    if (!this.cache) return null;
    try {
      return await this.cache.get<T>(this.cacheKey(key));
    } catch {
      return null;
    }
  }

  private async writeCache<T>(
    key: string,
    value: T,
    ttlMs: number,
  ): Promise<void> {
    if (!this.cache) return;
    try {
      await this.cache.set(this.cacheKey(key), value, ttlMs);
    } catch {
      // Provider data is already usable in memory. Cache persistence is
      // best-effort and must not make the catalog unavailable.
    }
  }

  private rememberPage(page: CatalogPage): CatalogPage {
    const normalizedPage = normalizeCatalogPage(page, 2_000) ?? { items: [] };
    for (const item of normalizedPage.items) {
      const itemId = boundedCatalogInput(
        item.id,
        MAX_CATALOG_ID_LENGTH,
      );
      if (!itemId) continue;
      const existing = this.knownItems.get(itemId);
      const remembered = existing
        ? {
            ...existing,
            ...item,
            id: itemId,
            originalTitle: item.originalTitle ?? existing.originalTitle,
            overview: item.overview ?? existing.overview,
            year: item.year ?? existing.year,
            releaseYear: item.releaseYear ?? existing.releaseYear,
            posterUrl: item.posterUrl ?? existing.posterUrl,
            backdropUrl: item.backdropUrl ?? existing.backdropUrl,
            rating: item.rating ?? existing.rating,
            genres: item.genres?.length ? item.genres : existing.genres,
            externalIds: {
              ...existing.externalIds,
              ...item.externalIds,
            },
          }
        : { ...item, id: itemId };
      this.knownItems.delete(itemId);
      this.knownItems.set(itemId, remembered);
      while (this.knownItems.size > MAX_KNOWN_CATALOG_ITEMS) {
        const oldest = this.knownItems.keys().next().value;
        if (typeof oldest !== 'string') break;
        this.knownItems.delete(oldest);
      }
    }
    return normalizedPage;
  }

  async getSections(): Promise<CatalogSection[]> {
    const entries = this.registry.enabled();
    const enabledProviderIds = new Set(
      entries.map((entry) => entry.gateway.id),
    );
    for (const providerId of this.knownSectionsByProvider.keys()) {
      if (!enabledProviderIds.has(providerId)) {
        this.knownSectionsByProvider.delete(providerId);
      }
    }

    const results = await allSettledWithConcurrency(
      entries,
      MAX_CONCURRENT_CATALOG_PROVIDERS,
      (entry, _index, options) => entry.gateway.getSections(options),
    );

    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') return;
      const providerId = entries[index]?.gateway.id;
      if (!providerId || !Array.isArray(result.value)) return;
      const normalized = result.value
        .slice(0, 200)
        .flatMap((candidate) => {
          const section = normalizeCatalogSection(candidate);
          return section ? [section] : [];
        });
      this.knownSectionsByProvider.set(providerId, normalized);
    });

    const seen = new Set<string>();
    const sections: CatalogSection[] = [];
    this.sectionOwners.clear();

    for (const entry of entries) {
      const providerId = entry.gateway.id;
      for (const section of this.knownSectionsByProvider.get(providerId) ?? []) {
        if (sections.length >= 200) break;
        if (seen.has(section.id)) continue;
        seen.add(section.id);
        this.sectionOwners.set(section.id, providerId);
        sections.push(section);
      }
      if (sections.length >= 200) break;
    }

    return sections;
  }

  async search(query: string, cursor?: string): Promise<CatalogPage> {
    const normalized = normalizeSearchQuery(query);
    const safeCursor = boundedCursor(cursor);
    if (!normalized || safeCursor === null) return { items: [] };
    const key = catalogCacheKey('search', normalized, safeCursor);
    return this.aggregatePage(
      key,
      SEARCH_TTL_MS,
      (entry, options) => entry.gateway.search(
        normalized,
        safeCursor,
        options,
      ),
    );
  }

  async browse(sectionId: string, cursor?: string): Promise<CatalogPage> {
    const safeSectionId = boundedCatalogInput(
      sectionId,
      MAX_CATALOG_ID_LENGTH,
    );
    const safeCursor = boundedCursor(cursor);
    if (!safeSectionId || safeCursor === null) return { items: [] };

    const key = catalogCacheKey('browse', safeSectionId, safeCursor);
    const cached = await this.readCache<CatalogPage>(key);
    if (cached && !cached.stale) return this.rememberPage(cached.value);

    const ownerId = this.sectionOwners.get(safeSectionId);
    if (ownerId) {
      const owner = this.registry.find(ownerId);
      if (owner) {
        try {
          const rawPage = await withTimeout(
            owner.gateway.browse(
              safeSectionId,
              safeCursor,
              { timeoutMs: PROVIDER_TIMEOUT_MS },
            ),
          );
          const page = normalizeCatalogPage(rawPage);
          if (!page) throw new Error('Catalog provider returned an invalid page');
          await this.writeCache(key, page, BROWSE_TTL_MS);
          return this.rememberPage(page);
        } catch (error) {
          if (cached) return this.rememberPage(cached.value);
          throw error;
        }
      }
    }

    return this.aggregatePage(
      key,
      BROWSE_TTL_MS,
      (entry, options) => entry.gateway.browse(
        safeSectionId,
        safeCursor,
        options,
      ),
    );
  }

  async getDetails(mediaId: string): Promise<MediaDetails | null> {
    const safeMediaId = boundedCatalogInput(
      mediaId,
      MAX_CATALOG_ID_LENGTH,
    );
    if (!safeMediaId) return null;

    const key = `details:${safeMediaId}`;
    const cached = await this.readCache<MediaDetails | null>(key);
    const normalizedCachedDetails = cached?.value
      ? normalizeMediaDetails(cached.value)
      : null;
    const cachedDetails = (
      normalizedCachedDetails?.id === safeMediaId
    )
      ? normalizedCachedDetails
      : null;
    if (cached && !cached.stale) {
      if (cached.value === null) return null;
      if (cachedDetails) {
        return this.rememberSeasonExpectations(cachedDetails);
      }
    }

    const providerId = safeMediaId.split(':', 1)[0];
    const owner = this.registry.find(providerId);
    const ordered = owner
      ? [owner, ...this.registry.enabled().filter((entry) => entry !== owner)]
      : this.registry.enabled();

    const detailsDeadline = Date.now() + PROVIDER_TIMEOUT_MS;
    for (let index = 0; index < ordered.length; index += 1) {
      const entry = ordered[index]!;
      const attemptTimeoutMs = chainAttemptTimeoutMs(
        detailsDeadline,
        ordered.length - index,
      );
      if (attemptTimeoutMs <= 0) break;

      try {
        const rawDetails = await withTimeout(
          entry.gateway.getDetails(
            safeMediaId,
            { timeoutMs: attemptTimeoutMs },
          ),
          attemptTimeoutMs,
        );
        const details = normalizeMediaDetails(rawDetails);
        if (details?.id === safeMediaId) {
          this.rememberSeasonExpectations(details);
          await this.writeCache(
            key,
            details,
            DETAILS_TTL_MS,
          );
          return details;
        }
      } catch {
        continue;
      }
    }
    if (cachedDetails) {
      return this.rememberSeasonExpectations(cachedDetails);
    }
    return this.knownItems.get(safeMediaId) ?? null;
  }

  async getSeason(seriesId: string, seasonNumber: number): Promise<SeriesSeason | null> {
    const safeSeriesId = boundedCatalogInput(
      seriesId,
      MAX_CATALOG_ID_LENGTH,
    );
    if (
      !safeSeriesId
      || !Number.isInteger(seasonNumber)
      || seasonNumber < 0
      || seasonNumber > MAX_SEASON_NUMBER
    ) return null;

    const key = `season:${safeSeriesId}:${seasonNumber}`;
    const expectedEpisodeCount = this.knownSeasonEpisodeCounts.get(
      this.seasonExpectationKey(safeSeriesId, seasonNumber),
    );
    const cached = await this.readCache<SeriesSeason | null>(key);
    const cachedSeason = cached?.value
      ? normalizeSeriesSeason(
          cached.value,
          safeSeriesId,
          seasonNumber,
        )
      : null;
    if (cached && !cached.stale) {
      if (
        cached.value === null
        && !(expectedEpisodeCount && expectedEpisodeCount > 0)
      ) return null;
      if (
        cachedSeason
        && (
          expectedEpisodeCount === undefined
          || cachedSeason.episodes.length >= expectedEpisodeCount
        )
      ) return cachedSeason;
    }

    const providerId = safeSeriesId.split(':', 1)[0];
    const owner = this.registry.find(providerId);
    const ordered = owner
      ? [owner, ...this.registry.enabled().filter((entry) => entry !== owner)]
      : this.registry.enabled();

    let bestPartialSeason: SeriesSeason | null = null;

    const seasonDeadline = Date.now() + PROVIDER_TIMEOUT_MS;
    for (let index = 0; index < ordered.length; index += 1) {
      const entry = ordered[index]!;
      const attemptTimeoutMs = chainAttemptTimeoutMs(
        seasonDeadline,
        ordered.length - index,
      );
      if (attemptTimeoutMs <= 0) break;

      try {
        const rawSeason = await withTimeout(
          entry.gateway.getSeason(
            safeSeriesId,
            seasonNumber,
            { timeoutMs: attemptTimeoutMs },
          ),
          attemptTimeoutMs,
        );
        const season = normalizeSeriesSeason(
          rawSeason,
          safeSeriesId,
          seasonNumber,
        );
        if (season) {
          const partial = !hasExpectedSeasonEpisodes(
            season,
            expectedEpisodeCount,
          );
          if (partial) {
            bestPartialSeason = bestPartialSeason
              ? mergePartialSeasons(bestPartialSeason, season)
              : season;
            if (
              hasExpectedSeasonEpisodes(
                bestPartialSeason,
                expectedEpisodeCount,
              )
            ) {
              await this.writeCache(
                key,
                bestPartialSeason,
                SEASON_TTL_MS,
              );
              return bestPartialSeason;
            }
            // Keep looking: another enabled catalog provider may have the
            // missing episodes even when no single provider exposes a complete
            // season by itself.
            continue;
          }
          await this.writeCache(
            key,
            season,
            SEASON_TTL_MS,
          );
          return season;
        }
      } catch {
        continue;
      }
    }
    // Known-partial seasons are deliberately not cached for the full TTL.
    // A stale cache can still fill gaps for this request, but it must not be
    // promoted to a fresh long-lived cache unless live providers supplied all
    // expected episodes themselves.
    if (bestPartialSeason && cachedSeason) {
      return mergePartialSeasons(bestPartialSeason, cachedSeason);
    }
    return bestPartialSeason ?? cachedSeason ?? null;
  }

  private async aggregatePage(
    key: string,
    ttlMs: number,
    request: (
      entry: ReturnType<CatalogRegistry['enabled']>[number],
      options: CatalogRequestOptions,
    ) => Promise<CatalogPage>,
  ): Promise<CatalogPage> {
    const cached = await this.readCache<CatalogPage>(key);
    if (cached && !cached.stale) return this.rememberPage(cached.value);

    const entries = this.registry.enabled();
    if (entries.length === 0) {
      return this.rememberPage(cached?.value ?? { items: [] });
    }

    const results = await allSettledWithConcurrency(
      entries,
      MAX_CONCURRENT_CATALOG_PROVIDERS,
      (entry, _index, options) => request(entry, options),
    );
    const pages = successfulPages(results);
    if (pages.length === 0) {
      return this.rememberPage(cached?.value ?? { items: [] });
    }

    const allProvidersSucceeded = (
      pages.length === results.length
      && results.every((result) => result.status === 'fulfilled')
    );
    const itemPages = (
      !allProvidersSucceeded && cached
        ? [
            ...pages.map((page) => page.items.slice(0, 1_000)),
            cached.value.items.slice(0, 1_000),
          ]
        : pages.map((page) => page.items.slice(0, 1_000))
    );
    const items: CatalogMediaItem[] = dedupeCatalogItems(
      itemPages,
    ).slice(0, 2_000);
    const contributingPages = pages.filter(
      (candidate) => candidate.items.length > 0,
    );
    const agreedNextCursor = (
      allProvidersSucceeded
      && contributingPages.length > 0
      && contributingPages.every((candidate) => Boolean(candidate.nextCursor))
      && new Set(
        contributingPages.map((candidate) => candidate.nextCursor),
      ).size === 1
    )
      ? contributingPages[0]?.nextCursor
      : undefined;
    const page: CatalogPage = {
      items,
      ...(agreedNextCursor ? { nextCursor: agreedNextCursor } : {}),
    };
    if (allProvidersSucceeded) {
      await this.writeCache(key, page, ttlMs);
    }
    return this.rememberPage(page);
  }
}
