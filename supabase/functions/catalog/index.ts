import { normalizeTmdbDetails, normalizeTmdbItems, normalizeTmdbSeason } from './normalize.ts';
import { parseCatalogMediaId, parseCatalogRequest, sectionDefinitions } from './request.ts';
import { fetchTmdbJson, TmdbUpstreamError } from './tmdb.ts';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function pageNumber(cursor?: string): number {
  return cursor ? Number(cursor) : 1;
}

function nextCursor(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  const page = typeof record.page === 'number' ? record.page : undefined;
  const totalPages = typeof record.total_pages === 'number' ? record.total_pages : undefined;
  return page && totalPages && page < totalPages ? String(page + 1) : undefined;
}

async function searchBoth(query: string, page: number, token: string) {
  const requests = [
    fetchTmdbJson('/search/movie', token, { query, page, include_adult: false, language: 'en-US' }),
    fetchTmdbJson('/search/tv', token, { query, page, include_adult: false, language: 'en-US' }),
  ];
  const [movies, series] = await Promise.allSettled(requests);
  const successful: { payload: unknown; kind: 'movie' | 'series' }[] = [];
  if (movies.status === 'fulfilled') successful.push({ payload: movies.value, kind: 'movie' });
  if (series.status === 'fulfilled') successful.push({ payload: series.value, kind: 'series' });
  if (!successful.length) {
    const reason = movies.status === 'rejected' ? movies.reason : series.status === 'rejected' ? series.reason : new Error('Catalog search failed');
    throw reason;
  }
  const items = successful.flatMap(({ payload, kind }) => normalizeTmdbItems(payload, kind));
  const cursorValues = successful.map(({ payload }) => nextCursor(payload)).filter(Boolean) as string[];
  return { items, ...(cursorValues.length ? { nextCursor: cursorValues.sort((a, b) => Number(a) - Number(b))[0] } : {}) };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: jsonHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const parsed = parseCatalogRequest(await request.json());

    if (parsed.action === 'sections') {
      return json(Object.values(sectionDefinitions).map(({ id, title, kinds }) => ({ id, title, kinds })));
    }

    const token = Deno.env.get('TMDB_READ_ACCESS_TOKEN');
    if (!token) return json({ error: 'Catalog backend is not configured' }, 503);

    if (parsed.action === 'browse') {
      const section = sectionDefinitions[parsed.sectionId];
      const payload = await fetchTmdbJson(section.path, token, { page: pageNumber(parsed.cursor), language: 'en-US' });
      return json({
        items: normalizeTmdbItems(payload, section.kind),
        ...(nextCursor(payload) ? { nextCursor: nextCursor(payload) } : {}),
      });
    }

    if (parsed.action === 'search') {
      return json(await searchBoth(parsed.query, pageNumber(parsed.cursor), token));
    }

    if (parsed.action === 'season') {
      const { tmdbId } = parseCatalogMediaId(parsed.mediaId);
      const payload = await fetchTmdbJson(
        `/tv/${tmdbId}/season/${parsed.seasonNumber}`,
        token,
        { language: 'en-US' },
      );
      return json(normalizeTmdbSeason(payload, parsed.mediaId, parsed.seasonNumber));
    }

    const { kind, tmdbId } = parseCatalogMediaId(parsed.mediaId);
    const append = kind === 'movie'
      ? 'credits,external_ids,release_dates'
      : 'credits,external_ids,content_ratings';
    const payload = await fetchTmdbJson(
      kind === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`,
      token,
      { language: 'en-US', append_to_response: append },
    );
    return json(normalizeTmdbDetails(payload, kind));
  } catch (error) {
    if (error instanceof TmdbUpstreamError) {
      return json({ error: error.message, retryable: error.retryable }, error.status);
    }
    return json({ error: 'Invalid catalog request' }, 400);
  }
});
