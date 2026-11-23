export type CatalogKind = 'movie' | 'series';

export interface SectionDefinition {
  id: string;
  title: string;
  kinds: CatalogKind[];
  path: string;
  kind: CatalogKind;
}

export const sectionDefinitions: Record<string, SectionDefinition> = {
  'home:trending-movies': { id: 'home:trending-movies', title: 'Trending Movies', kinds: ['movie'], path: '/trending/movie/day', kind: 'movie' },
  'home:trending-series': { id: 'home:trending-series', title: 'Trending Series', kinds: ['series'], path: '/trending/tv/day', kind: 'series' },
  'home:popular-movies': { id: 'home:popular-movies', title: 'Popular Movies', kinds: ['movie'], path: '/movie/popular', kind: 'movie' },
  'home:popular-series': { id: 'home:popular-series', title: 'Popular Series', kinds: ['series'], path: '/tv/popular', kind: 'series' },
  'home:top-rated-movies': { id: 'home:top-rated-movies', title: 'Top Rated Movies', kinds: ['movie'], path: '/movie/top_rated', kind: 'movie' },
  'home:top-rated-series': { id: 'home:top-rated-series', title: 'Top Rated Series', kinds: ['series'], path: '/tv/top_rated', kind: 'series' },
  'movies:trending': { id: 'movies:trending', title: 'Trending', kinds: ['movie'], path: '/trending/movie/day', kind: 'movie' },
  'movies:popular': { id: 'movies:popular', title: 'Popular', kinds: ['movie'], path: '/movie/popular', kind: 'movie' },
  'movies:top-rated': { id: 'movies:top-rated', title: 'Top Rated', kinds: ['movie'], path: '/movie/top_rated', kind: 'movie' },
  'movies:now-playing': { id: 'movies:now-playing', title: 'Now Playing', kinds: ['movie'], path: '/movie/now_playing', kind: 'movie' },
  'series:trending': { id: 'series:trending', title: 'Trending', kinds: ['series'], path: '/trending/tv/day', kind: 'series' },
  'series:popular': { id: 'series:popular', title: 'Popular', kinds: ['series'], path: '/tv/popular', kind: 'series' },
  'series:top-rated': { id: 'series:top-rated', title: 'Top Rated', kinds: ['series'], path: '/tv/top_rated', kind: 'series' },
  'series:on-the-air': { id: 'series:on-the-air', title: 'On The Air', kinds: ['series'], path: '/tv/on_the_air', kind: 'series' },
};

export type CatalogRequest =
  | { action: 'sections' }
  | { action: 'browse'; sectionId: string; cursor?: string }
  | { action: 'search'; query: string; cursor?: string }
  | { action: 'details'; mediaId: string }
  | { action: 'season'; mediaId: string; seasonNumber: number };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalCursor(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const page = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(page) || page < 1 || page > 500) throw new Error('Invalid catalog cursor');
  return String(page);
}

export function parseCatalogMediaId(mediaId: string): { kind: CatalogKind; tmdbId: string } {
  const match = /^tmdb:(movie|series):(\d+)$/.exec(mediaId.trim());
  if (!match) throw new Error('Unsupported catalog media ID');
  return { kind: match[1] as CatalogKind, tmdbId: match[2] };
}

export function parseCatalogRequest(input: unknown): CatalogRequest {
  const record = asRecord(input);
  const action = typeof record?.action === 'string' ? record.action : '';

  if (action === 'sections') return { action: 'sections' };

  if (action === 'browse') {
    const sectionId = typeof record?.sectionId === 'string' ? record.sectionId.trim() : '';
    if (!sectionDefinitions[sectionId]) throw new Error('Unsupported catalog section');
    const cursor = optionalCursor(record?.cursor);
    return { action: 'browse', sectionId, ...(cursor ? { cursor } : {}) };
  }

  if (action === 'search') {
    const query = typeof record?.query === 'string'
      ? record.query.trim().replace(/\s+/g, ' ')
      : '';
    if (query.length < 2) {
      throw new Error('Search query must contain at least two characters');
    }
    if (query.length > 200 || /[\u0000-\u001f\u007f]/.test(query)) {
      throw new Error('Search query is invalid or too long');
    }
    const cursor = optionalCursor(record?.cursor);
    return { action: 'search', query, ...(cursor ? { cursor } : {}) };
  }

  if (action === 'details') {
    const mediaId = typeof record?.mediaId === 'string' ? record.mediaId.trim() : '';
    parseCatalogMediaId(mediaId);
    return { action: 'details', mediaId };
  }

  if (action === 'season') {
    const mediaId = typeof record?.mediaId === 'string' ? record.mediaId.trim() : '';
    const { kind } = parseCatalogMediaId(mediaId);
    if (kind !== 'series') throw new Error('Season requests require a series ID');
    const seasonNumber = record?.seasonNumber;
    if (typeof seasonNumber !== 'number' || !Number.isInteger(seasonNumber) || seasonNumber < 0) {
      throw new Error('Invalid season number');
    }
    return { action: 'season', mediaId, seasonNumber };
  }

  throw new Error('Unsupported catalog action');
}
