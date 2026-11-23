import * as catalog from '../index';

type CatalogMediaItem = {
  id: string;
  kind: 'movie' | 'series';
  title: string;
  year?: number;
  releaseYear?: number;
  overview?: string;
  posterUrl?: string;
  providerId: string;
  externalIds: { tmdb?: string; imdb?: string };
};

describe('catalog identity and deduplication', () => {
  it('creates stable provider-scoped canonical IDs', () => {
    const canonicalMediaId = (catalog as any).canonicalMediaId as undefined | ((providerId: string, kind: string, externalId: string) => string);
    expect(canonicalMediaId).toBeDefined();
    expect(canonicalMediaId?.('tmdb', 'movie', '550')).toBe('tmdb:movie:550');
  });

  it('deduplicates fallback title identities without device-locale casing', () => {
    const dedupeCatalogItems = (catalog as any).dedupeCatalogItems as
      | undefined
      | ((groups: CatalogMediaItem[][]) => CatalogMediaItem[]);
    const localeLower = jest.spyOn(
      String.prototype,
      'toLocaleLowerCase',
    ).mockImplementation(() => 'locale-dependent');

    try {
      const primary: CatalogMediaItem = {
        id: 'a:movie:1',
        kind: 'movie',
        title: 'INDIGO',
        year: 2026,
        providerId: 'a',
        externalIds: {},
      };
      const duplicate: CatalogMediaItem = {
        id: 'b:movie:1',
        kind: 'movie',
        title: 'indigo',
        year: 2026,
        providerId: 'b',
        externalIds: {},
      };

      expect(dedupeCatalogItems?.([[primary], [duplicate]])).toHaveLength(1);
      expect(localeLower).not.toHaveBeenCalled();
    } finally {
      localeLower.mockRestore();
    }
  });

  it('collapses rows when a later provider bridges TMDB and IMDb identities', () => {
    const dedupeCatalogItems = (catalog as any).dedupeCatalogItems as
      | undefined
      | ((groups: CatalogMediaItem[][]) => CatalogMediaItem[]);
    const tmdbOnly: CatalogMediaItem = {
      id: 'a:movie:1',
      kind: 'movie',
      title: 'Bridge Movie',
      providerId: 'a',
      externalIds: { tmdb: '42' },
    };
    const imdbOnly: CatalogMediaItem = {
      id: 'b:movie:1',
      kind: 'movie',
      title: 'Bridge Movie',
      providerId: 'b',
      externalIds: { imdb: 'tt0000042' },
    };
    const bridge: CatalogMediaItem = {
      id: 'c:movie:1',
      kind: 'movie',
      title: 'Bridge Movie',
      providerId: 'c',
      externalIds: { tmdb: '42', imdb: 'tt0000042' },
    };

    expect(dedupeCatalogItems?.([
      [tmdbOnly],
      [imdbOnly],
      [bridge],
    ])).toEqual([
      expect.objectContaining({
        id: 'a:movie:1',
        providerId: 'a',
        externalIds: {
          tmdb: '42',
          imdb: 'tt0000042',
        },
      }),
    ]);
  });

  it('deduplicates exact external IDs and fills missing metadata from lower priority providers', () => {
    const dedupeCatalogItems = (catalog as any).dedupeCatalogItems as undefined | ((groups: CatalogMediaItem[][]) => CatalogMediaItem[]);
    const primary: CatalogMediaItem = {
      id: 'a:movie:1',
      kind: 'movie',
      title: 'Fight Club',
      year: 1999,
      overview: 'primary',
      providerId: 'a',
      externalIds: { tmdb: '550' },
    };
    const secondary: CatalogMediaItem = {
      id: 'b:movie:9',
      kind: 'movie',
      title: 'Fight Club',
      year: 1999,
      posterUrl: 'poster.jpg',
      providerId: 'b',
      externalIds: { tmdb: '550' },
    };

    expect(dedupeCatalogItems).toBeDefined();
    expect(dedupeCatalogItems?.([[primary], [secondary]])).toEqual([
      { ...primary, posterUrl: 'poster.jpg' },
    ]);
  });

  it('fills missing release year from a duplicate external identity', () => {
    const dedupeCatalogItems = (catalog as any).dedupeCatalogItems as undefined | ((groups: CatalogMediaItem[][]) => CatalogMediaItem[]);
    const primary: CatalogMediaItem = {
      id: 'a:movie:1',
      kind: 'movie',
      title: 'Example',
      providerId: 'a',
      externalIds: { tmdb: '42' },
    };
    const secondary: CatalogMediaItem = {
      id: 'b:movie:1',
      kind: 'movie',
      title: 'Example',
      releaseYear: 2026,
      providerId: 'b',
      externalIds: { tmdb: '42' },
    };

    expect(dedupeCatalogItems?.([[primary], [secondary]])).toEqual([
      expect.objectContaining({
        id: 'a:movie:1',
        releaseYear: 2026,
      }),
    ]);
  });

  it('still merges complementary external identities through a fallback match', () => {
    const dedupeCatalogItems = (catalog as any).dedupeCatalogItems as undefined | ((groups: CatalogMediaItem[][]) => CatalogMediaItem[]);
    const tmdbOnly: CatalogMediaItem = {
      id: 'a:movie:1',
      kind: 'movie',
      title: 'Shared Movie',
      year: 2026,
      providerId: 'a',
      externalIds: { tmdb: '100' },
    };
    const imdbOnly: CatalogMediaItem = {
      id: 'b:movie:1',
      kind: 'movie',
      title: 'Shared Movie',
      year: 2026,
      providerId: 'b',
      externalIds: { imdb: 'tt0000100' },
    };

    expect(dedupeCatalogItems?.([[tmdbOnly], [imdbOnly]])).toEqual([
      expect.objectContaining({
        id: 'a:movie:1',
        externalIds: {
          tmdb: '100',
          imdb: 'tt0000100',
        },
      }),
    ]);
  });

  it('does not merge fallback title matches with conflicting external IDs', () => {
    const dedupeCatalogItems = (catalog as any).dedupeCatalogItems as undefined | ((groups: CatalogMediaItem[][]) => CatalogMediaItem[]);
    const first: CatalogMediaItem = {
      id: 'a:movie:1',
      kind: 'movie',
      title: 'Shared Title',
      year: 2026,
      providerId: 'a',
      externalIds: { tmdb: '100', imdb: 'tt0000100' },
    };
    const second: CatalogMediaItem = {
      id: 'b:movie:1',
      kind: 'movie',
      title: 'Shared Title',
      year: 2026,
      providerId: 'b',
      externalIds: { tmdb: '200', imdb: 'tt0000200' },
    };

    expect(dedupeCatalogItems?.([[first], [second]])).toEqual([
      first,
      second,
    ]);
  });

  it('does not let an ambiguous fallback key attach a later external identity arbitrarily', () => {
    const dedupeCatalogItems = (catalog as any).dedupeCatalogItems as undefined | ((groups: CatalogMediaItem[][]) => CatalogMediaItem[]);
    const first: CatalogMediaItem = {
      id: 'a:movie:1',
      kind: 'movie',
      title: 'Shared Title',
      year: 2026,
      providerId: 'a',
      externalIds: { tmdb: '100' },
    };
    const second: CatalogMediaItem = {
      id: 'b:movie:1',
      kind: 'movie',
      title: 'Shared Title',
      year: 2026,
      providerId: 'b',
      externalIds: { tmdb: '200' },
    };
    const third: CatalogMediaItem = {
      id: 'c:movie:1',
      kind: 'movie',
      title: 'Shared Title',
      year: 2026,
      providerId: 'c',
      externalIds: { imdb: 'tt0000300' },
    };

    expect(dedupeCatalogItems?.([[first], [second], [third]])).toEqual([
      first,
      second,
      third,
    ]);
  });

  it('does not merge same-title releases from different years', () => {
    const dedupeCatalogItems = (catalog as any).dedupeCatalogItems as undefined | ((groups: CatalogMediaItem[][]) => CatalogMediaItem[]);
    const oldMovie: CatalogMediaItem = {
      id: 'a:movie:1', kind: 'movie', title: 'Dune', year: 1984, providerId: 'a', externalIds: {},
    };
    const newMovie: CatalogMediaItem = {
      id: 'b:movie:2', kind: 'movie', title: 'Dune', year: 2021, providerId: 'b', externalIds: {},
    };

    expect(dedupeCatalogItems).toBeDefined();
    expect(dedupeCatalogItems?.([[oldMovie], [newMovie]])).toHaveLength(2);
  });

  it('does not merge movie and series rows that share an external ID', () => {
    const dedupeCatalogItems = (catalog as any).dedupeCatalogItems as undefined | ((groups: CatalogMediaItem[][]) => CatalogMediaItem[]);
    const movie: CatalogMediaItem = {
      id: 'a:movie:1',
      kind: 'movie',
      title: 'Example',
      year: 2026,
      providerId: 'a',
      externalIds: { tmdb: '42' },
    };
    const series: CatalogMediaItem = {
      id: 'b:series:1',
      kind: 'series',
      title: 'Example',
      year: 2026,
      providerId: 'b',
      externalIds: { tmdb: '42' },
    };

    expect(dedupeCatalogItems?.([[movie], [series]])).toEqual([
      movie,
      series,
    ]);
  });


  it('deduplicates fallback identities using releaseYear when year is unavailable', () => {
    const dedupeCatalogItems = (catalog as any).dedupeCatalogItems as undefined | ((groups: CatalogMediaItem[][]) => CatalogMediaItem[]);
    const primary: CatalogMediaItem = {
      id: 'a:movie:1',
      kind: 'movie',
      title: 'Release Year Movie',
      releaseYear: 2026,
      providerId: 'a',
      externalIds: {},
    };
    const secondary: CatalogMediaItem = {
      id: 'b:movie:1',
      kind: 'movie',
      title: 'release year movie',
      releaseYear: 2026,
      providerId: 'b',
      externalIds: {},
    };

    expect(dedupeCatalogItems?.([[primary], [secondary]])).toHaveLength(1);
  });

  it('deduplicates by IMDb ID when TMDB IDs are unavailable', () => {
    const dedupeCatalogItems = (catalog as any).dedupeCatalogItems as undefined | ((groups: CatalogMediaItem[][]) => CatalogMediaItem[]);
    const a: CatalogMediaItem = {
      id: 'a:series:1', kind: 'series', title: 'Example', year: 2024, providerId: 'a', externalIds: { imdb: 'tt123' },
    };
    const b: CatalogMediaItem = {
      id: 'b:series:2', kind: 'series', title: 'Example', year: 2024, providerId: 'b', externalIds: { imdb: 'tt123' },
    };

    expect(dedupeCatalogItems).toBeDefined();
    expect(dedupeCatalogItems?.([[a], [b]])).toHaveLength(1);
  });
});
