import { normalizeTmdbItems } from '../../../../supabase/functions/catalog/normalize';
import { parseCatalogRequest } from '../../../../supabase/functions/catalog/request';

describe('TMDB normalization', () => {
  it('normalizes movie results into MoviesTv-Flix catalog items', () => {
    expect(normalizeTmdbItems({ results: [{
      id: 550,
      title: 'Fight Club',
      original_title: 'Fight Club',
      overview: 'An insomniac office worker changes his life.',
      release_date: '1999-10-15',
      vote_average: 8.4,
      poster_path: '/poster.jpg',
      backdrop_path: '/backdrop.jpg',
      genre_ids: [18],
    }] }, 'movie')).toEqual([
      expect.objectContaining({
        id: 'tmdb:movie:550',
        kind: 'movie',
        title: 'Fight Club',
        year: 1999,
        providerId: 'tmdb',
        externalIds: { tmdb: '550' },
        posterUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg',
        backdropUrl: 'https://image.tmdb.org/t/p/original/backdrop.jpg',
      }),
    ]);
  });

  it('normalizes TV results as series using name and first air date', () => {
    expect(normalizeTmdbItems({ results: [{
      id: 1399,
      name: 'Game of Thrones',
      original_name: 'Game of Thrones',
      overview: 'Seven kingdoms compete for power.',
      first_air_date: '2011-04-17',
      vote_average: 8.5,
      poster_path: null,
      backdrop_path: null,
    }] }, 'series')).toEqual([
      expect.objectContaining({
        id: 'tmdb:series:1399',
        kind: 'series',
        title: 'Game of Thrones',
        year: 2011,
        providerId: 'tmdb',
        externalIds: { tmdb: '1399' },
      }),
    ]);
  });

  it('skips malformed upstream entries instead of failing the whole page', () => {
    expect(normalizeTmdbItems({ results: [null, {}, { id: 1 }, { id: 2, title: 'Valid' }] }, 'movie')).toEqual([
      expect.objectContaining({ id: 'tmdb:movie:2', title: 'Valid' }),
    ]);
  });
});

describe('catalog proxy request allowlist', () => {
  it('accepts and normalizes supported search requests', () => {
    expect(parseCatalogRequest({ action: 'search', query: '  Dune  ' })).toEqual({ action: 'search', query: 'Dune' });
  });

  it('accepts supported browse sections', () => {
    expect(parseCatalogRequest({ action: 'browse', sectionId: 'movies:popular' })).toEqual({
      action: 'browse',
      sectionId: 'movies:popular',
    });
  });

  it('rejects arbitrary actions and arbitrary upstream paths', () => {
    expect(() => parseCatalogRequest({ action: 'proxy', path: '/3/account' })).toThrow('Unsupported catalog action');
    expect(() => parseCatalogRequest({ action: 'browse', sectionId: '../../admin' })).toThrow('Unsupported catalog section');
  });
});
