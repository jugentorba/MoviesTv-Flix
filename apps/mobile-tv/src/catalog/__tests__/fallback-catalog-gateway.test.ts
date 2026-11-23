import {
  CatalogRegistry,
  CatalogService,
  type CatalogGateway,
  type CatalogPage,
  type CatalogSection,
  type MediaDetails,
  type SeriesSeason,
} from '@moviestv/catalog';
import { FallbackCatalogGateway } from '../FallbackCatalogGateway';

function gateway(
  id: string,
  overrides: Partial<CatalogGateway> = {},
): CatalogGateway {
  return {
    id,
    getSections: async () => [],
    browse: async () => ({ items: [] }),
    search: async () => ({ items: [] }),
    getDetails: async () => null,
    getSeason: async () => null,
    ...overrides,
  };
}

const fallbackSections: CatalogSection[] = [{
  id: 'home:popular-movies',
  title: 'Popular Movies',
  kinds: ['movie'],
}];

const fallbackPage: CatalogPage = {
  items: [{
    id: 'cinemeta:movie:tt0137523',
    kind: 'movie',
    title: 'Fight Club',
    providerId: 'cinemeta',
    externalIds: { imdb: 'tt0137523' },
  }],
};

test('falls back to Cinemeta sections and remembers their browse owner', async () => {
  const primaryBrowse = jest.fn(async () => ({ items: [] }));
  const fallbackBrowse = jest.fn(async () => fallbackPage);
  const primary = gateway('tmdb', {
    getSections: async () => {
      throw new Error('remote catalog unavailable');
    },
    browse: primaryBrowse,
  });
  const fallback = gateway('cinemeta', {
    getSections: async () => fallbackSections,
    browse: fallbackBrowse,
  });
  const gatewayWithFallback = new FallbackCatalogGateway(
    primary,
    fallback,
  );

  await expect(gatewayWithFallback.getSections())
    .resolves.toEqual(fallbackSections);
  await expect(
    gatewayWithFallback.browse('home:popular-movies'),
  ).resolves.toEqual(fallbackPage);

  expect(primaryBrowse).not.toHaveBeenCalled();
  expect(fallbackBrowse).toHaveBeenCalledWith(
    'home:popular-movies',
    undefined,
    expect.any(Object),
  );
});

test('keeps the configured remote catalog primary while it is healthy', async () => {
  const primarySections: CatalogSection[] = [{
    id: 'home:remote',
    title: 'Remote',
    kinds: ['movie'],
  }];
  const primaryPage: CatalogPage = { items: [] };
  const fallbackGetSections = jest.fn(async () => fallbackSections);
  const fallbackBrowse = jest.fn(async () => fallbackPage);
  const primary = gateway('tmdb', {
    getSections: async () => primarySections,
    browse: async () => primaryPage,
  });
  const fallback = gateway('cinemeta', {
    getSections: fallbackGetSections,
    browse: fallbackBrowse,
  });
  const gatewayWithFallback = new FallbackCatalogGateway(
    primary,
    fallback,
  );

  await expect(gatewayWithFallback.getSections())
    .resolves.toEqual(primarySections);
  await expect(gatewayWithFallback.browse('home:remote'))
    .resolves.toEqual(primaryPage);

  expect(fallbackGetSections).not.toHaveBeenCalled();
  expect(fallbackBrowse).not.toHaveBeenCalled();
});

test('falls back for search failures and invalid primary page roots', async () => {
  const fallbackSearch = jest.fn(async () => fallbackPage);
  const fallback = gateway('cinemeta', {
    search: fallbackSearch,
  });

  const failed = new FallbackCatalogGateway(
    gateway('tmdb', {
      search: async () => {
        throw new Error('remote search unavailable');
      },
    }),
    fallback,
  );
  await expect(failed.search('Dune')).resolves.toEqual(fallbackPage);

  const malformed = new FallbackCatalogGateway(
    gateway('tmdb', {
      search: async () => ({ items: null } as unknown as CatalogPage),
    }),
    fallback,
  );
  await expect(malformed.search('Dune')).resolves.toEqual(fallbackPage);

  expect(fallbackSearch).toHaveBeenCalledTimes(2);
});

test('uses fallback details and seasons when primary cannot answer', async () => {
  const details: MediaDetails = {
    ...fallbackPage.items[0]!,
    runtimeMinutes: 139,
  };
  const season: SeriesSeason = {
    seriesId: 'cinemeta:series:tt0944947',
    seasonNumber: 1,
    episodes: [{
      id: 'tt0944947:1:1',
      seriesId: 'cinemeta:series:tt0944947',
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Winter Is Coming',
    }],
  };
  const fallback = gateway('cinemeta', {
    getDetails: async () => details,
    getSeason: async () => season,
  });
  const gatewayWithFallback = new FallbackCatalogGateway(
    gateway('tmdb', {
      getDetails: async () => null,
      getSeason: async () => {
        throw new Error('remote season unavailable');
      },
    }),
    fallback,
  );

  await expect(
    gatewayWithFallback.getDetails('cinemeta:movie:tt0137523'),
  ).resolves.toEqual(details);
  await expect(
    gatewayWithFallback.getSeason(
      'cinemeta:series:tt0944947',
      1,
    ),
  ).resolves.toEqual(season);
});

test('uses fallback when the primary section list is empty or malformed', async () => {
  const fallback = gateway('cinemeta', {
    getSections: async () => fallbackSections,
  });

  await expect(new FallbackCatalogGateway(
    gateway('tmdb', { getSections: async () => [] }),
    fallback,
  ).getSections()).resolves.toEqual(fallbackSections);

  await expect(new FallbackCatalogGateway(
    gateway('tmdb', {
      getSections: async () => [{
        id: '',
        title: '',
        kinds: [],
      }],
    }),
    fallback,
  ).getSections()).resolves.toEqual(fallbackSections);
});


test('fallback results keep working through CatalogService provider routing', async () => {
  const details: MediaDetails = {
    ...fallbackPage.items[0]!,
    runtimeMinutes: 139,
  };
  const fallback = gateway('cinemeta', {
    getSections: async () => fallbackSections,
    browse: async () => fallbackPage,
    getDetails: async (mediaId) => (
      mediaId === 'cinemeta:movie:tt0137523'
        ? details
        : null
    ),
  });
  const resilient = new FallbackCatalogGateway(
    gateway('tmdb', {
      getSections: async () => {
        throw new Error('remote unavailable');
      },
      getDetails: async () => null,
    }),
    fallback,
  );
  const service = new CatalogService(new CatalogRegistry([
    { gateway: resilient, enabled: true, priority: 0 },
  ]));

  await expect(service.getSections()).resolves.toEqual(
    fallbackSections,
  );
  await expect(
    service.browse('home:popular-movies'),
  ).resolves.toEqual(fallbackPage);
  await expect(
    service.getDetails('cinemeta:movie:tt0137523'),
  ).resolves.toEqual(details);
});


test('falls back when primary pages contain no usable catalog item roots', async () => {
  const fallback = gateway('cinemeta', {
    search: async () => fallbackPage,
    browse: async () => fallbackPage,
  });
  const malformed = new FallbackCatalogGateway(
    gateway('tmdb', {
      search: async () => ({
        items: [{
          id: 'broken',
          kind: 'movie',
          title: null,
          providerId: 'tmdb',
        }],
      } as unknown as CatalogPage),
      browse: async () => ({
        items: [{ nonsense: true }],
      } as unknown as CatalogPage),
    }),
    fallback,
  );

  await expect(malformed.search('Dune'))
    .resolves.toEqual(fallbackPage);
  await expect(malformed.browse('movies:popular'))
    .resolves.toEqual(fallbackPage);
});

test('falls back when primary details or season roots are malformed', async () => {
  const details: MediaDetails = {
    ...fallbackPage.items[0]!,
    runtimeMinutes: 139,
  };
  const season: SeriesSeason = {
    seriesId: 'cinemeta:series:tt0944947',
    seasonNumber: 1,
    episodes: [{
      id: 'episode-1',
      seriesId: 'cinemeta:series:tt0944947',
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Winter Is Coming',
    }],
  };
  const fallback = gateway('cinemeta', {
    getDetails: async () => details,
    getSeason: async () => season,
  });
  const malformed = new FallbackCatalogGateway(
    gateway('tmdb', {
      getDetails: async () => ({
        id: 'broken',
        kind: 'movie',
        title: null,
        providerId: 'tmdb',
      } as unknown as MediaDetails),
      getSeason: async () => ({
        seriesId: 'wrong-series',
        seasonNumber: 1,
        episodes: [],
      }),
    }),
    fallback,
  );

  await expect(
    malformed.getDetails('cinemeta:movie:tt0137523'),
  ).resolves.toEqual(details);
  await expect(
    malformed.getSeason('cinemeta:series:tt0944947', 1),
  ).resolves.toEqual(season);
});


test('starts fallback before the outer catalog provider budget is exhausted', async () => {
  jest.useFakeTimers();
  try {
    const fallbackSearch = jest.fn(async () => fallbackPage);
    const primary = gateway('tmdb', {
      search: () => new Promise<CatalogPage>(() => undefined),
    });
    const resilient = new FallbackCatalogGateway(
      primary,
      gateway('cinemeta', { search: fallbackSearch }),
      50,
    );

    const pending = resilient.search('Dune');
    await Promise.resolve();
    jest.advanceTimersByTime(51);

    await expect(pending).resolves.toEqual(fallbackPage);
    expect(fallbackSearch).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test('shares a caller timeout budget between primary and fallback', async () => {
  jest.useFakeTimers();
  try {
    const fallbackSearch = jest.fn(async (
      _query: string,
      _cursor?: string,
      options?: { timeoutMs?: number },
    ) => ({
      ...fallbackPage,
      budget: options?.timeoutMs,
    } as CatalogPage & { budget?: number }));

    const resilient = new FallbackCatalogGateway(
      gateway('tmdb', {
        search: () => new Promise<CatalogPage>(() => undefined),
      }),
      gateway('cinemeta', {
        search: fallbackSearch as CatalogGateway['search'],
      }),
      50,
    );

    const pending = resilient.search(
      'Dune',
      undefined,
      { timeoutMs: 80 },
    );
    await Promise.resolve();
    jest.advanceTimersByTime(51);

    await expect(pending).resolves.toEqual(
      expect.objectContaining({
        items: fallbackPage.items,
      }),
    );
    expect(fallbackSearch).toHaveBeenCalledTimes(1);

    const remaining = fallbackSearch.mock.calls[0]?.[2]?.timeoutMs;
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(30);
  } finally {
    jest.useRealTimers();
  }
});

test('rejects invalid primary failover timeout configuration', () => {
  expect(() => new FallbackCatalogGateway(
    gateway('tmdb'),
    gateway('cinemeta'),
    0,
  )).toThrow('Invalid catalog primary failover timeout');
});


test('an older fallback section load cannot overwrite newer primary ownership', async () => {
  let resolveFirst!: (value: CatalogSection[]) => void;
  const first = new Promise<CatalogSection[]>((resolve) => {
    resolveFirst = resolve;
  });
  let calls = 0;
  const primaryBrowse = jest.fn(async () => ({ items: [] }));
  const fallbackBrowse = jest.fn(async () => fallbackPage);
  const primary = gateway('tmdb', {
    getSections: async () => {
      calls += 1;
      if (calls === 1) return first;
      return fallbackSections;
    },
    browse: primaryBrowse,
  });
  const fallback = gateway('cinemeta', {
    getSections: async () => fallbackSections,
    browse: fallbackBrowse,
  });
  const resilient = new FallbackCatalogGateway(
    primary,
    fallback,
    5_000,
  );

  const older = resilient.getSections();
  const newer = resilient.getSections();

  await expect(newer).resolves.toEqual(fallbackSections);

  resolveFirst([]);
  await expect(older).resolves.toEqual(fallbackSections);

  await resilient.browse('home:popular-movies');

  expect(primaryBrowse).toHaveBeenCalledWith(
    'home:popular-movies',
    undefined,
    expect.objectContaining({ timeoutMs: 5_000 }),
  );
  expect(fallbackBrowse).not.toHaveBeenCalled();
});
