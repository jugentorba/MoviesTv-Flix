import { parseCatalogRequest } from '../../../../supabase/functions/catalog/request';

describe('catalog season request parsing', () => {
  it('accepts a positive numbered season for a TMDB series', () => {
    expect(parseCatalogRequest({
      action: 'season',
      mediaId: 'tmdb:series:1399',
      seasonNumber: 1,
    })).toEqual({
      action: 'season',
      mediaId: 'tmdb:series:1399',
      seasonNumber: 1,
    });
  });

  it('rejects season requests for movies', () => {
    expect(() => parseCatalogRequest({
      action: 'season',
      mediaId: 'tmdb:movie:550',
      seasonNumber: 1,
    })).toThrow('Season requests require a series ID');
  });

  it('accepts season zero specials', () => {
    expect(parseCatalogRequest({
      action: 'season',
      mediaId: 'tmdb:series:1399',
      seasonNumber: 0,
    })).toEqual({
      action: 'season',
      mediaId: 'tmdb:series:1399',
      seasonNumber: 0,
    });
  });

  it.each([-1, 1.5, '1', null])('rejects invalid season number %p', (seasonNumber) => {
    expect(() => parseCatalogRequest({
      action: 'season',
      mediaId: 'tmdb:series:1399',
      seasonNumber,
    })).toThrow('Invalid season number');
  });
});


describe('catalog search request bounds', () => {
  it('accepts ordinary normalized queries', () => {
    expect(parseCatalogRequest({
      action: 'search',
      query: '  Dune   Part Two  ',
    })).toEqual({
      action: 'search',
      query: 'Dune Part Two',
    });
  });

  it('rejects oversized or control-character queries', () => {
    expect(() => parseCatalogRequest({
      action: 'search',
      query: 'x'.repeat(201),
    })).toThrow('invalid or too long');
    expect(() => parseCatalogRequest({
      action: 'search',
      query: 'Dune\u0000Part Two',
    })).toThrow('invalid or too long');
  });
});
