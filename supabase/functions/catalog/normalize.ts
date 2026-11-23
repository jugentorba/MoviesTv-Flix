export type CatalogKind = 'movie' | 'series';

interface UnknownRecord {
  [key: string]: unknown;
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const number = asNumber(value);
  return number !== undefined && Number.isInteger(number) && number > 0 ? number : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const number = asNumber(value);
  return number !== undefined && Number.isInteger(number) && number >= 0 ? number : undefined;
}

function yearFromDate(value: unknown): number | undefined {
  const date = asString(value);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) ? year : undefined;
}

function imageUrl(path: unknown, size: 'w500' | 'original'): string | undefined {
  const value = asString(path);
  if (!value) return undefined;
  return `https://image.tmdb.org/t/p/${size}${value}`;
}

function normalizeOne(value: unknown, kind: CatalogKind) {
  const record = asRecord(value);
  if (!record) return null;

  const numericId = asNumber(record.id);
  if (numericId === undefined) return null;

  const title = kind === 'movie' ? asString(record.title) : asString(record.name);
  if (!title) return null;

  const originalTitle = kind === 'movie'
    ? asString(record.original_title)
    : asString(record.original_name);
  const date = kind === 'movie' ? record.release_date : record.first_air_date;

  return {
    id: `tmdb:${kind}:${numericId}`,
    kind,
    title,
    originalTitle,
    overview: asString(record.overview),
    year: yearFromDate(date),
    posterUrl: imageUrl(record.poster_path, 'w500'),
    backdropUrl: imageUrl(record.backdrop_path, 'original'),
    rating: asNumber(record.vote_average),
    providerId: 'tmdb',
    externalIds: { tmdb: String(numericId) },
  };
}

export function normalizeTmdbItems(payload: unknown, kind: CatalogKind) {
  const record = asRecord(payload);
  const results = Array.isArray(record?.results) ? record.results : [];
  return results
    .map((value) => normalizeOne(value, kind))
    .filter((value): value is NonNullable<typeof value> => value !== null);
}

function extractImdbId(record: UnknownRecord): string | undefined {
  const direct = asString(record.imdb_id);
  if (direct) return direct;
  const external = asRecord(record.external_ids);
  return external ? asString(external.imdb_id) : undefined;
}

function extractCast(record: UnknownRecord): string[] | undefined {
  const credits = asRecord(record.credits);
  const cast = Array.isArray(credits?.cast) ? credits.cast : [];
  const names = cast
    .map((entry) => asRecord(entry))
    .map((entry) => entry ? asString(entry.name) : undefined)
    .filter((name): name is string => Boolean(name))
    .slice(0, 12);
  return names.length ? names : undefined;
}

function extractCertification(record: UnknownRecord, kind: CatalogKind): string | undefined {
  const source = kind === 'movie'
    ? asRecord(record.release_dates)?.results
    : asRecord(record.content_ratings)?.results;
  if (!Array.isArray(source)) return undefined;

  const preferred = source
    .map((entry) => asRecord(entry))
    .filter((entry): entry is UnknownRecord => entry !== null)
    .find((entry) => entry.iso_3166_1 === 'US')
    ?? source.map((entry) => asRecord(entry)).find((entry) => entry !== null);
  if (!preferred) return undefined;

  if (kind === 'series') return asString(preferred.rating);
  const releases = Array.isArray(preferred.release_dates) ? preferred.release_dates : [];
  for (const release of releases) {
    const certification = asString(asRecord(release)?.certification);
    if (certification) return certification;
  }
  return undefined;
}

function normalizeSeasonSummaries(record: UnknownRecord) {
  const seasons = Array.isArray(record.seasons) ? record.seasons : [];
  return seasons
    .map((value) => {
      const season = asRecord(value);
      if (!season) return null;
      const tmdbId = positiveInteger(season.id);
      const seasonNumber = nonNegativeInteger(season.season_number);
      const name = asString(season.name);
      if (!tmdbId || seasonNumber === undefined || !name) return null;
      const episodeCount = asNumber(season.episode_count);
      const airDate = asString(season.air_date);
      const posterUrl = imageUrl(season.poster_path, 'w500');
      return {
        id: `tmdb:season:${tmdbId}`,
        seasonNumber,
        name,
        ...(episodeCount !== undefined ? { episodeCount } : {}),
        ...(airDate ? { airDate } : {}),
        ...(posterUrl ? { posterUrl } : {}),
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);
}

export function normalizeTmdbSeason(payload: unknown, seriesId: string, seasonNumber: number) {
  const record = asRecord(payload);
  if (!record || !Number.isInteger(seasonNumber) || seasonNumber < 0) return null;

  const episodes = Array.isArray(record.episodes) ? record.episodes : [];
  const normalizedEpisodes = episodes
    .map((value) => {
      const episode = asRecord(value);
      if (!episode) return null;
      const tmdbId = positiveInteger(episode.id);
      const episodeNumber = positiveInteger(episode.episode_number);
      const title = asString(episode.name);
      if (!tmdbId || !episodeNumber || !title) return null;
      const overview = asString(episode.overview);
      const airDate = asString(episode.air_date);
      const runtimeMinutes = asNumber(episode.runtime);
      const stillUrl = imageUrl(episode.still_path, 'w500');
      const rating = asNumber(episode.vote_average);
      return {
        id: `tmdb:episode:${tmdbId}`,
        seriesId,
        seasonNumber,
        episodeNumber,
        title,
        ...(overview ? { overview } : {}),
        ...(airDate ? { airDate } : {}),
        ...(runtimeMinutes !== undefined ? { runtimeMinutes } : {}),
        ...(stillUrl ? { stillUrl } : {}),
        ...(rating !== undefined ? { rating } : {}),
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  const name = asString(record.name);
  const airDate = asString(record.air_date);
  const posterUrl = imageUrl(record.poster_path, 'w500');
  return {
    seriesId,
    seasonNumber,
    ...(name ? { name } : {}),
    ...(airDate ? { airDate } : {}),
    ...(posterUrl ? { posterUrl } : {}),
    episodes: normalizedEpisodes,
  };
}

export function normalizeTmdbDetails(payload: unknown, kind: CatalogKind) {
  const record = asRecord(payload);
  if (!record) return null;
  const item = normalizeOne(record, kind);
  if (!item) return null;

  const imdbId = extractImdbId(record);
  const genres = Array.isArray(record.genres)
    ? record.genres
      .map((entry) => asRecord(entry))
      .map((entry) => entry ? asString(entry.name) : undefined)
      .filter((name): name is string => Boolean(name))
    : [];
  const seasons = kind === 'series' ? normalizeSeasonSummaries(record) : [];

  return {
    ...item,
    genres: genres.length ? genres : undefined,
    externalIds: {
      ...item.externalIds,
      ...(imdbId ? { imdb: imdbId } : {}),
    },
    runtimeMinutes: kind === 'movie' ? asNumber(record.runtime) : undefined,
    releaseDate: asString(kind === 'movie' ? record.release_date : record.first_air_date),
    seasonCount: kind === 'series' ? asNumber(record.number_of_seasons) : undefined,
    episodeCount: kind === 'series' ? asNumber(record.number_of_episodes) : undefined,
    ...(seasons.length ? { seasons } : {}),
    cast: extractCast(record),
    certification: extractCertification(record, kind),
  };
}
