import * as catalog from '../index';

type Item = {
  id: string;
  kind: 'movie' | 'series';
  title: string;
  providerId: string;
  externalIds: Record<string, string | undefined>;
};

const season = {
  seriesId: 'tmdb:series:1399',
  seasonNumber: 1,
  name: 'Season 1',
  episodes: [{
    id: 'tmdb:episode:63056',
    seriesId: 'tmdb:series:1399',
    seasonNumber: 1,
    episodeNumber: 1,
    title: 'Winter Is Coming',
  }],
};

function gateway(id: string, items: Item[] = [], shouldFail = false) {
  return {
    id,
    async getSections() { return []; },
    async browse() { return { items }; },
    async search() {
      if (shouldFail) throw new Error(`${id} unavailable`);
      return { items };
    },
    async getDetails() { return null; },
    async getSeason() { return null; },
  };
}

describe('catalog service', () => {
  it('normalizes valid search and rejects queries shorter than two characters', () => {
    const normalizeSearchQuery = (catalog as any).normalizeSearchQuery as undefined | ((query: string) => string | null);
    expect(normalizeSearchQuery).toBeDefined();
    expect(normalizeSearchQuery?.(' a ')).toBeNull();
    expect(normalizeSearchQuery?.('  Dune  ')).toBe('Dune');
    expect(normalizeSearchQuery?.('x'.repeat(201))).toBeNull();
    expect(normalizeSearchQuery?.('Dune\u0000Part Two')).toBeNull();
  });

  it('orders enabled providers by descending priority', () => {
    const CatalogRegistry = (catalog as any).CatalogRegistry;
    expect(CatalogRegistry).toBeDefined();
    const registry = new CatalogRegistry([
      { gateway: gateway('low'), enabled: true, priority: 10 },
      { gateway: gateway('high'), enabled: true, priority: 100 },
      { gateway: gateway('off'), enabled: false, priority: 999 },
    ]);
    expect(registry.enabled().map((entry: any) => entry.gateway.id)).toEqual(['high', 'low']);
  });

  it('uses locale-independent provider ordering for equal priorities', () => {
    const CatalogRegistry = (catalog as any).CatalogRegistry;
    const localeCompare = jest.spyOn(
      String.prototype,
      'localeCompare',
    ).mockImplementation(() => 99);

    try {
      const registry = new CatalogRegistry([
        { gateway: gateway('é-provider'), enabled: true, priority: 100 },
        { gateway: gateway('a-provider'), enabled: true, priority: 100 },
      ]);

      expect(
        registry.enabled().map((entry: any) => entry.gateway.id),
      ).toEqual(['a-provider', 'é-provider']);
      expect(localeCompare).not.toHaveBeenCalled();
    } finally {
      localeCompare.mockRestore();
    }
  });

  it('bounds merged catalog sections while preserving provider priority', async () => {
    const CatalogRegistry = (catalog as any).CatalogRegistry;
    const CatalogService = (catalog as any).CatalogService;
    const sections = (prefix: string, count: number) => (
      Array.from({ length: count }, (_, index) => ({
        id: `${prefix}:${index}`,
        title: `${prefix} ${index}`,
        kinds: ['movie' as const],
      }))
    );
    const high = {
      ...gateway('high'),
      async getSections() { return sections('high', 150); },
    };
    const low = {
      ...gateway('low'),
      async getSections() { return sections('low', 150); },
    };
    const service = new CatalogService(new CatalogRegistry([
      { gateway: high, enabled: true, priority: 100 },
      { gateway: low, enabled: true, priority: 50 },
    ]));

    const result = await service.getSections();

    expect(result).toHaveLength(200);
    expect(result.filter((section: any) => section.id.startsWith('high:')))
      .toHaveLength(150);
    expect(result.filter((section: any) => section.id.startsWith('low:')))
      .toHaveLength(50);
  });

  it('caps enabled catalog providers after priority ordering', () => {
    const CatalogRegistry = (catalog as any).CatalogRegistry;
    const registry = new CatalogRegistry(
      Array.from({ length: 105 }, (_, index) => ({
        gateway: gateway(`provider-${index}`),
        enabled: true,
        priority: index,
      })),
    );

    const enabled = registry.enabled();

    expect(enabled).toHaveLength(100);
    expect(enabled[0]?.gateway.id).toBe('provider-104');
    expect(
      enabled.some((entry: any) => entry.gateway.id === 'provider-0'),
    ).toBe(false);
  });

  it('routes a known catalog section only to the provider that owns it', async () => {
    const CatalogRegistry = (catalog as any).CatalogRegistry;
    const CatalogService = (catalog as any).CatalogService;
    const ownerBrowse = jest.fn(async () => ({ items: [] }));
    const otherBrowse = jest.fn(async () => ({ items: [] }));

    const owner = {
      ...gateway('owner'),
      async getSections() {
        return [{ id: 'home:owner:trending', title: 'Trending', kinds: ['movie'] }];
      },
      browse: ownerBrowse,
    };
    const other = {
      ...gateway('other'),
      async getSections() {
        return [{ id: 'movies:other:popular', title: 'Popular', kinds: ['movie'] }];
      },
      browse: otherBrowse,
    };

    const service = new CatalogService(new CatalogRegistry([
      { gateway: other, enabled: true, priority: 100 },
      { gateway: owner, enabled: true, priority: 50 },
    ]));

    await service.getSections();
    await service.browse('home:owner:trending');

    expect(ownerBrowse).toHaveBeenCalledWith(
      'home:owner:trending',
      undefined,
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(otherBrowse).not.toHaveBeenCalled();
  });

  it('canonicalizes IMDb IDs returned by catalog providers', async () => {
    const CatalogRegistry = (catalog as any).CatalogRegistry;
    const CatalogService = (catalog as any).CatalogService;
    const item: Item = {
      id: 'upper:movie:1',
      kind: 'movie',
      title: 'Fight Club',
      providerId: 'upper',
      externalIds: { imdb: ' TT0137523 ' },
    };
    const service = new CatalogService(new CatalogRegistry([
      {
        gateway: gateway('upper', [item]),
        enabled: true,
        priority: 1,
      },
    ]));

    await expect(service.search('Fight Club')).resolves.toEqual({
      items: [{
        ...item,
        externalIds: { imdb: 'tt0137523' },
      }],
    });
  });

  it('merges stale complete search data with partial live provider results', async () => {
    const CatalogRegistry = (catalog as any).CatalogRegistry;
    const CatalogService = (catalog as any).CatalogService;
    const MemoryCatalogCache = (catalog as any).MemoryCatalogCache;
    const stableItem: Item = {
      id: 'stable:movie:1',
      kind: 'movie',
      title: 'Fresh Stable Movie',
      providerId: 'stable',
      externalIds: {},
    };
    const staleRecoveringItem: Item = {
      id: 'recovering:movie:1',
      kind: 'movie',
      title: 'Cached Recovering Movie',
      providerId: 'recovering',
      externalIds: {},
    };
    const cache = new MemoryCatalogCache();
    await cache.set(
      '["search","Movie",null]',
      { items: [staleRecoveringItem] },
      1,
      0,
    );
    const service = new CatalogService(
      new CatalogRegistry([
        {
          gateway: gateway('stable', [stableItem]),
          enabled: true,
          priority: 100,
        },
        {
          gateway: gateway('recovering', [], true),
          enabled: true,
          priority: 50,
        },
      ]),
      cache,
    );

    await expect(service.search('Movie')).resolves.toEqual({
      items: [stableItem, staleRecoveringItem],
    });
  });

  it('does not cache a partial search page when a provider fails', async () => {
    const CatalogRegistry = (catalog as any).CatalogRegistry;
    const CatalogService = (catalog as any).CatalogService;
    const MemoryCatalogCache = (catalog as any).MemoryCatalogCache;

    const stableItem: Item = {
      id: 'stable:movie:1',
      kind: 'movie',
      title: 'Stable Movie',
      providerId: 'stable',
      externalIds: {},
    };
    const recoveredItem: Item = {
      id: 'recovering:movie:1',
      kind: 'movie',
      title: 'Recovered Movie',
      providerId: 'recovering',
      externalIds: {},
    };
    let recoveringFails = true;
    const recoveringSearch = jest.fn(async () => {
      if (recoveringFails) throw new Error('temporary outage');
      return { items: [recoveredItem] };
    });
    const service = new CatalogService(
      new CatalogRegistry([
        {
          gateway: gateway('stable', [stableItem]),
          enabled: true,
          priority: 100,
        },
        {
          gateway: {
            ...gateway('recovering'),
            search: recoveringSearch,
          },
          enabled: true,
          priority: 50,
        },
      ]),
      new MemoryCatalogCache(),
    );

    await expect(service.search('Movie')).resolves.toEqual({
      items: [stableItem],
    });

    recoveringFails = false;

    await expect(service.search('Movie')).resolves.toEqual({
      items: [stableItem, recoveredItem],
    });
    expect(recoveringSearch).toHaveBeenCalledTimes(2);
  });

  it('passes bounded provider budgets into concurrent catalog searches', async () => {
    const CatalogRegistry = (catalog as any).CatalogRegistry;
    const CatalogService = (catalog as any).CatalogService;
    const highSearch = jest.fn<ReturnType<catalog.CatalogGateway['search']>, Parameters<catalog.CatalogGateway['search']>>(async () => ({ items: [] }));
    const lowSearch = jest.fn<ReturnType<catalog.CatalogGateway['search']>, Parameters<catalog.CatalogGateway['search']>>(async () => ({ items: [] }));

    const service = new CatalogService(new CatalogRegistry([
      {
        gateway: { ...gateway('high'), search: highSearch },
        enabled: true,
        priority: 100,
      },
      {
        gateway: { ...gateway('low'), search: lowSearch },
        enabled: true,
        priority: 50,
      },
    ]));

    await service.search('Dune');

    for (const search of [highSearch, lowSearch]) {
      expect(search).toHaveBeenCalledWith(
        'Dune',
        undefined,
        expect.objectContaining({
          timeoutMs: expect.any(Number),
        }),
      );
      expect(search.mock.calls[0]?.[2]?.timeoutMs).toBeGreaterThan(0);
      expect(search.mock.calls[0]?.[2]?.timeoutMs).toBeLessThanOrEqual(8_000);
    }
  });

  it('preserves an agreed next cursor across catalog providers', async () => {
    const CatalogRegistry = (catalog as any).CatalogRegistry;
    const CatalogService = (catalog as any).CatalogService;
    const first: Item = {
      id: 'one:movie:1',
      kind: 'movie',
      title: 'One',
      providerId: 'one',
      externalIds: {},
    };
    const second: Item = {
      id: 'two:movie:2',
      kind: 'movie',
      title: 'Two',
      providerId: 'two',
      externalIds: {},
    };
    const withCursor = (id: string, item: Item) => ({
      ...gateway(id),
      async search() {
        return { items: [item], nextCursor: '20' };
      },
    });
    const service = new CatalogService(new CatalogRegistry([
      { gateway: withCursor('one', first), enabled: true, priority: 100 },
      { gateway: withCursor('two', second), enabled: true, priority: 50 },
    ]));

    await expect(service.search('movie')).resolves.toEqual({
      items: [first, second],
      nextCursor: '20',
    });
  });

  it('drops ambiguous next cursors across catalog providers', async () => {
    const CatalogRegistry = (catalog as any).CatalogRegistry;
    const CatalogService = (catalog as any).CatalogService;
    const item = (id: string): Item => ({
      id: `${id}:movie:1`,
      kind: 'movie',
      title: id,
      providerId: id,
      externalIds: {},
    });
    const withCursor = (id: string, nextCursor: string) => ({
      ...gateway(id),
      async search() {
        return { items: [item(id)], nextCursor };
      },
    });
    const service = new CatalogService(new CatalogRegistry([
      { gateway: withCursor('one', '20'), enabled: true, priority: 100 },
      { gateway: withCursor('two', '2'), enabled: true, priority: 50 },
    ]));

    const page = await service.search('movie');

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeUndefined();
  });

  it('does not advance a merged search cursor when one provider fails', async () => {
    const CatalogRegistry = (catalog as any).CatalogRegistry;
    const CatalogService = (catalog as any).CatalogService;
    const healthyItem: Item = {
      id: 'good:movie:1',
      kind: 'movie',
      title: 'Good result',
      providerId: 'good',
      externalIds: {},
    };
    const healthy = {
      ...gateway('good'),
      async search() {
        return { items: [healthyItem], nextCursor: '20' };
      },
    };
    const failing = {
      ...gateway('bad'),
      async search() {
        throw new Error('temporarily unavailable');
      },
    };
    const service = new CatalogService(new CatalogRegistry([
      { gateway: failing, enabled: true, priority: 100 },
      { gateway: healthy, enabled: true, priority: 50 },
    ]));

    await expect(service.search('movie')).resolves.toEqual({
      items: [healthyItem],
    });
  });

  it('returns successful provider results when another provider fails', async () => {
    const CatalogRegistry = (catalog as any).CatalogRegistry;
    const CatalogService = (catalog as any).CatalogService;
    expect(CatalogService).toBeDefined();
    const good: Item = { id: 'good:movie:1', kind: 'movie', title: 'Dune', providerId: 'good', externalIds: { tmdb: '438631' } };
    const registry = new CatalogRegistry([
      { gateway: gateway('bad', [], true), enabled: true, priority: 100 },
      { gateway: gateway('good', [good]), enabled: true, priority: 50 },
    ]);
    const service = new CatalogService(registry);
    await expect(service.search('Dune')).resolves.toEqual({ items: [good] });
  });

  it('bounds merged search results across multiple providers', async () => {
    const CatalogRegistry = (catalog as any).CatalogRegistry;
    const CatalogService = (catalog as any).CatalogService;
    const items = (providerId: string, count: number): Item[] => (
      Array.from({ length: count }, (_, index) => ({
        id: `${providerId}:movie:${index}`,
        kind: 'movie' as const,
        title: `${providerId} ${index}`,
        providerId,
        externalIds: {},
      }))
    );
    const service = new CatalogService(
      new CatalogRegistry([
        {
          gateway: gateway('one', items('one', 1_500)),
          enabled: true,
          priority: 100,
        },
        {
          gateway: gateway('two', items('two', 1_500)),
          enabled: true,
          priority: 50,
        },
        {
          gateway: gateway('three', items('three', 1_500)),
          enabled: true,
          priority: 25,
        },
      ]),
    );

    const page = await service.search('movie');

    expect(page.items).toHaveLength(2_000);
    expect(page.items.filter((item: Item) => item.providerId === 'one'))
      .toHaveLength(1_000);
    expect(page.items.filter((item: Item) => item.providerId === 'two'))
      .toHaveLength(1_000);
    expect(page.items.some((item: Item) => item.providerId === 'three'))
      .toBe(false);
  });

  it('does not call providers for an invalid short search query', async () => {
    const CatalogRegistry = (catalog as any).CatalogRegistry;
    const CatalogService = (catalog as any).CatalogService;
    let calls = 0;
    const g = gateway('one');
    g.search = async () => { calls += 1; return { items: [] }; };
    const service = new CatalogService(new CatalogRegistry([{ gateway: g, enabled: true, priority: 1 }]));
    await expect(service.search(' x ')).resolves.toEqual({ items: [] });
    expect(calls).toBe(0);
  });

  it('returns stale cached search data when every provider fails', async () => {
    const CatalogRegistry = (catalog as any).CatalogRegistry;
    const CatalogService = (catalog as any).CatalogService;
    const MemoryCatalogCache = (catalog as any).MemoryCatalogCache;
    expect(MemoryCatalogCache).toBeDefined();
    const cached: Item = { id: 'cache:movie:1', kind: 'movie', title: 'Cached Dune', providerId: 'cache', externalIds: {} };
    const cache = new MemoryCatalogCache();
    await cache.set('["search","Dune",null]', { items: [cached] }, 1, 0);
    const service = new CatalogService(
      new CatalogRegistry([{ gateway: gateway('bad', [], true), enabled: true, priority: 1 }]),
      cache,
    );
    await expect(service.search('Dune')).resolves.toEqual({ items: [cached] });
  });

  it('loads a season from the catalog owner and caches it', async () => {
    const CatalogRegistry = (catalog as any).CatalogRegistry;
    const CatalogService = (catalog as any).CatalogService;
    const MemoryCatalogCache = (catalog as any).MemoryCatalogCache;
    const calls: string[] = [];
    const owner = {
      ...gateway('tmdb'),
      async getSeason(seriesId: string, seasonNumber: number) {
        calls.push(`tmdb:${seriesId}:${seasonNumber}`);
        return season;
      },
    };
    const higherPriorityOther = {
      ...gateway('other'),
      async getSeason(seriesId: string, seasonNumber: number) {
        calls.push(`other:${seriesId}:${seasonNumber}`);
        return { ...season, name: 'Wrong provider season' };
      },
    };
    const service = new CatalogService(
      new CatalogRegistry([
        { gateway: higherPriorityOther, enabled: true, priority: 100 },
        { gateway: owner, enabled: true, priority: 1 },
      ]),
      new MemoryCatalogCache(),
    );

    await expect(service.getSeason('tmdb:series:1399', 1)).resolves.toEqual(season);
    await expect(service.getSeason('tmdb:series:1399', 1)).resolves.toEqual(season);
    expect(calls).toEqual(['tmdb:tmdb:series:1399:1']);
  });

  it('uses the catalog item as movie details fallback when its provider has no meta resource', async () => {
    const CatalogRegistry = (catalog as any).CatalogRegistry;
    const CatalogService = (catalog as any).CatalogService;
    const item: Item = {
      id: 'catalog-only:movie:tmdb%3A550',
      kind: 'movie',
      title: 'Fight Club',
      providerId: 'catalog-only',
      externalIds: { tmdb: '550', imdb: 'tt0137523' },
    };
    const provider = {
      ...gateway('catalog-only'),
      async getSections() {
        return [{
          id: 'home:catalog-only:movies',
          title: 'Movies',
          kinds: ['movie'],
        }];
      },
      async browse() {
        return { items: [item] };
      },
      async getDetails() {
        return null;
      },
    };
    const service = new CatalogService(
      new CatalogRegistry([
        { gateway: provider, enabled: true, priority: 100 },
      ]),
    );

    await service.getSections();
    await service.browse('home:catalog-only:movies');

    await expect(service.getDetails(item.id)).resolves.toEqual(item);
  });

  it('returns stale cached season data when live providers fail', async () => {
    const CatalogRegistry = (catalog as any).CatalogRegistry;
    const CatalogService = (catalog as any).CatalogService;
    const MemoryCatalogCache = (catalog as any).MemoryCatalogCache;
    const cache = new MemoryCatalogCache();
    await cache.set('season:tmdb:series:1399:1', season, 1, 0);
    const failing = {
      ...gateway('tmdb'),
      async getSeason() { throw new Error('catalog unavailable'); },
    };
    const service = new CatalogService(
      new CatalogRegistry([{ gateway: failing, enabled: true, priority: 1 }]),
      cache,
    );

    await expect(service.getSeason('tmdb:series:1399', 1)).resolves.toEqual(season);
  });

  it('accepts season zero and rejects truly invalid season numbers', async () => {
    const CatalogRegistry = (catalog as any).CatalogRegistry;
    const CatalogService = (catalog as any).CatalogService;
    const calls: number[] = [];
    const provider = {
      ...gateway('tmdb'),
      async getSeason(_seriesId: string, seasonNumber: number) {
        calls.push(seasonNumber);
        return { ...season, seasonNumber };
      },
    };
    const service = new CatalogService(
      new CatalogRegistry([{ gateway: provider, enabled: true, priority: 1 }]),
    );

    await expect(service.getSeason('tmdb:series:1399', 0)).resolves.toEqual(
      expect.objectContaining({ seasonNumber: 0 }),
    );
    await expect(service.getSeason('tmdb:series:1399', -1)).resolves.toBeNull();
    await expect(service.getSeason('tmdb:series:1399', 1.5)).resolves.toBeNull();
    expect(calls).toEqual([0]);
  });
});


it('uses a new cache namespace when the active catalog provider set changes', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const MemoryCatalogCache = (catalog as any).MemoryCatalogCache;
  const cache = new MemoryCatalogCache();
  const oldItem: Item = {
    id: 'old:movie:1',
    kind: 'movie',
    title: 'Old result',
    providerId: 'old',
    externalIds: {},
  };
  const newItem: Item = {
    id: 'new:movie:1',
    kind: 'movie',
    title: 'New provider result',
    providerId: 'new',
    externalIds: {},
  };

  await cache.set('providers-old:search:Dune', { items: [oldItem] }, 60_000);

  const service = new CatalogService(
    new CatalogRegistry([
      { gateway: gateway('new', [newItem]), enabled: true, priority: 100 },
    ]),
    cache,
    'providers-new',
  );

  await expect(service.search('Dune')).resolves.toEqual({ items: [newItem] });
});


test('rejects oversized catalog navigation inputs before provider access', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const calls = {
    search: 0,
    browse: 0,
    details: 0,
    season: 0,
  };
  const provider = {
    ...gateway('bounded'),
    async search() {
      calls.search += 1;
      return { items: [] };
    },
    async browse() {
      calls.browse += 1;
      return { items: [] };
    },
    async getDetails() {
      calls.details += 1;
      return null;
    },
    async getSeason() {
      calls.season += 1;
      return null;
    },
  };
  const service = new CatalogService(new CatalogRegistry([
    { gateway: provider, enabled: true, priority: 1 },
  ]));

  await expect(
    service.search('Dune', 'x'.repeat(129)),
  ).resolves.toEqual({ items: [] });
  await expect(
    service.browse('x'.repeat(2_049)),
  ).resolves.toEqual({ items: [] });
  await expect(
    service.browse('movies:popular', 'x'.repeat(129)),
  ).resolves.toEqual({ items: [] });
  await expect(
    service.getDetails('x'.repeat(2_049)),
  ).resolves.toBeNull();
  await expect(
    service.getSeason('tmdb:series:1399', 10_001),
  ).resolves.toBeNull();

  expect(calls).toEqual({
    search: 0,
    browse: 0,
    details: 0,
    season: 0,
  });
});

test('trims safe catalog ids and cursors before provider calls', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const browse = jest.fn(async () => ({ items: [] }));
  const details = jest.fn(async () => null);
  const provider = {
    ...gateway('trimmed'),
    browse,
    getDetails: details,
  };
  const service = new CatalogService(new CatalogRegistry([
    { gateway: provider, enabled: true, priority: 1 },
  ]));

  await service.browse('  movies:popular  ', '  50  ');
  await service.getDetails('  trimmed:movie:1  ');

  expect(browse).toHaveBeenCalledWith(
    'movies:popular',
    '50',
    expect.objectContaining({ timeoutMs: expect.any(Number) }),
  );
  expect(details).toHaveBeenCalledWith(
    'trimmed:movie:1',
    expect.objectContaining({ timeoutMs: expect.any(Number) }),
  );
});

test('bounds remembered catalog fallback metadata by recency', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const provider = {
    ...gateway('memory'),
    async browse(_sectionId: string, cursor?: string) {
      const page = Number(cursor ?? '0');
      return {
        items: Array.from({ length: 1_000 }, (_, index) => ({
          id: `memory:movie:${page * 1_000 + index}`,
          kind: 'movie' as const,
          title: `Movie ${page * 1_000 + index}`,
          providerId: 'memory',
          externalIds: {},
        })),
      };
    },
    async getDetails() {
      return null;
    },
  };
  const service = new CatalogService(new CatalogRegistry([
    { gateway: provider, enabled: true, priority: 1 },
  ]));

  await service.browse('movies:memory', '0');
  await service.browse('movies:memory', '1');
  await service.browse('movies:memory', '2');
  await service.browse('movies:memory', '3');
  await service.browse('movies:memory', '4');
  await service.browse('movies:memory', '5');

  await expect(
    service.getDetails('memory:movie:0'),
  ).resolves.toBeNull();
  await expect(
    service.getDetails('memory:movie:5999'),
  ).resolves.toEqual(expect.objectContaining({
    title: 'Movie 5999',
  }));
});


test('malformed catalog section results do not block healthy providers', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const malformed = {
    ...gateway('malformed-sections'),
    getSections: async () => null as any,
  };
  const healthy = {
    ...gateway('healthy-sections'),
    getSections: async () => [{
      id: ' movies:top ',
      title: ' Top Movies ',
      kinds: ['movie'],
    }],
  };
  const service = new CatalogService(new CatalogRegistry([
    { gateway: malformed, enabled: true, priority: 100 },
    { gateway: healthy, enabled: true, priority: 50 },
  ]));

  await expect(service.getSections()).resolves.toEqual([{
    id: 'movies:top',
    title: 'Top Movies',
    kinds: ['movie'],
  }]);
});

test('malformed catalog pages do not block healthy search results', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const malformed = {
    ...gateway('malformed-page'),
    search: async () => ({ items: null }) as any,
  };
  const healthy = {
    ...gateway('healthy-page'),
    search: async () => ({
      items: [{
        id: ' healthy:movie:1 ',
        kind: 'movie',
        title: ' Healthy Movie ',
        providerId: ' healthy-page ',
        externalIds: { imdb: 'tt1234567' },
        posterUrl: 'https://user:pass@images.example/poster.jpg',
        genres: [' Drama ', 'Drama'],
      }],
      nextCursor: ' 50 ',
    }),
  };
  const service = new CatalogService(new CatalogRegistry([
    { gateway: malformed, enabled: true, priority: 100 },
    { gateway: healthy, enabled: true, priority: 50 },
  ]));

  const result = await service.search('Healthy');

  expect(result.items).toEqual([{
    id: 'healthy:movie:1',
    kind: 'movie',
    title: 'Healthy Movie',
    providerId: 'healthy-page',
    externalIds: { imdb: 'tt1234567' },
    genres: ['Drama'],
  }]);
});

test('catalog service drops malformed runtime items before dedupe', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const provider = {
    ...gateway('runtime-shape'),
    search: async () => ({
      items: [
        null,
        {
          id: 'missing-external',
          kind: 'movie',
          title: 'Safe Without External IDs',
          providerId: 'runtime-shape',
        },
        {
          id: 'bad-kind',
          kind: 'episode',
          title: 'Bad',
          providerId: 'runtime-shape',
          externalIds: {},
        },
        {
          id: 'bad-control',
          kind: 'movie',
          title: 'Bad\u0000Title',
          providerId: 'runtime-shape',
          externalIds: {},
        },
      ],
    }),
  };
  const service = new CatalogService(new CatalogRegistry([
    { gateway: provider, enabled: true, priority: 1 },
  ]));

  const result = await service.search('Safe');

  expect(result.items).toEqual([expect.objectContaining({
    id: 'missing-external',
    title: 'Safe Without External IDs',
    externalIds: {},
  })]);
});


test('drops credential-bearing catalog artwork before caching or display', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const provider = {
    ...gateway('artwork'),
    async search() {
      return {
        items: [{
          id: 'artwork:series:1',
          kind: 'series',
          title: 'Private Artwork',
          providerId: 'artwork',
          externalIds: {},
          posterUrl:
            'https://images.example/token=fixture-value/poster.jpg',
          backdropUrl:
            'https://images.example/backdrop.jpg#signature=LOCAL-SECRET',
        }],
      };
    },
    async getDetails() {
      return {
        id: 'artwork:series:1',
        kind: 'series',
        title: 'Private Artwork',
        providerId: 'artwork',
        externalIds: {},
        posterUrl:
          'https://images.example/poster.jpg?key=LOCAL-SECRET',
        seasons: [{
          id: 'season-1',
          seasonNumber: 1,
          name: 'Season 1',
          posterUrl:
            'https://images.example/season.jpg?auth=LOCAL-SECRET',
        }],
      };
    },
    async getSeason() {
      return {
        seriesId: 'artwork:series:1',
        seasonNumber: 1,
        episodes: [{
          id: 'episode-1',
          seriesId: 'artwork:series:1',
          seasonNumber: 1,
          episodeNumber: 1,
          title: 'Episode 1',
          stillUrl:
            'https://images.example/still.jpg?session=LOCAL-SECRET',
        }],
      };
    },
  };
  const service = new CatalogService(new CatalogRegistry([
    { gateway: provider, enabled: true, priority: 1 },
  ]));

  await expect(service.search('Private')).resolves.toEqual({
    items: [expect.not.objectContaining({
      posterUrl: expect.anything(),
      backdropUrl: expect.anything(),
    })],
  });

  const details = await service.getDetails('artwork:series:1');
  expect(details?.posterUrl).toBeUndefined();
  expect(details?.seasons?.[0]?.posterUrl).toBeUndefined();

  const loadedSeason = await service.getSeason('artwork:series:1', 1);
  expect(loadedSeason?.episodes[0]?.stillUrl).toBeUndefined();

  expect(JSON.stringify({
    search: await service.search('Private'),
    details,
    season: loadedSeason,
  })).not.toContain('LOCAL-SECRET');
});

test('malformed details from one provider do not block a healthy fallback', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const malformed = {
    ...gateway('owner'),
    getDetails: async () => ({
      id: 'owner:movie:1',
      kind: 'movie',
      title: null,
      providerId: 'owner',
      externalIds: {},
    }) as any,
  };
  const healthy = {
    ...gateway('fallback'),
    getDetails: async () => ({
      id: 'owner:movie:1',
      kind: 'movie',
      title: ' Healthy Details ',
      providerId: 'fallback',
      externalIds: { imdb: 'tt1234567' },
      posterUrl: 'https://user:pass@images.example/poster.jpg',
      cast: [' Actor ', 'Actor', 'x'.repeat(300)],
      runtimeMinutes: 120,
    }),
  };
  const service = new CatalogService(new CatalogRegistry([
    { gateway: malformed, enabled: true, priority: 100 },
    { gateway: healthy, enabled: true, priority: 50 },
  ]));

  const details = await service.getDetails('owner:movie:1');

  expect(details).toEqual(expect.objectContaining({
    id: 'owner:movie:1',
    title: 'Healthy Details',
    providerId: 'fallback',
    externalIds: { imdb: 'tt1234567' },
    cast: ['Actor'],
    runtimeMinutes: 120,
  }));
  expect(details?.posterUrl).toBeUndefined();
});

test('falls back to another catalog when the owner returns a known-partial season', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const calls: string[] = [];
  const secondEpisode = {
    id: 'tmdb:episode:63057',
    seriesId: 'tmdb:series:1399',
    seasonNumber: 1,
    episodeNumber: 2,
    title: 'The Kingsroad',
  };
  const owner = {
    ...gateway('tmdb'),
    async getDetails() {
      return {
        id: 'tmdb:series:1399',
        kind: 'series',
        title: 'Game of Thrones',
        providerId: 'tmdb',
        externalIds: { tmdb: '1399', imdb: 'tt0944947' },
        seasons: [{
          id: 'season-1',
          seasonNumber: 1,
          name: 'Season 1',
          episodeCount: 2,
        }],
      };
    },
    async getSeason() {
      calls.push('tmdb');
      return season;
    },
  };
  const fallback = {
    ...gateway('fallback'),
    async getSeason() {
      calls.push('fallback');
      return {
        ...season,
        episodes: [...season.episodes, secondEpisode],
      };
    },
  };
  const service = new CatalogService(new CatalogRegistry([
    { gateway: owner, enabled: true, priority: 100 },
    { gateway: fallback, enabled: true, priority: 1 },
  ]));

  await service.getDetails('tmdb:series:1399');

  await expect(
    service.getSeason('tmdb:series:1399', 1),
  ).resolves.toEqual({
    ...season,
    episodes: [...season.episodes, secondEpisode],
  });
  expect(calls).toEqual(['tmdb', 'fallback']);
});

test('does not mistake a gapped season for complete just because the episode count matches', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const calls: string[] = [];
  const episodeTwo = {
    id: 'tmdb:episode:63057',
    seriesId: 'tmdb:series:1399',
    seasonNumber: 1,
    episodeNumber: 2,
    title: 'The Kingsroad',
  };
  const episodeThree = {
    id: 'tmdb:episode:63058',
    seriesId: 'tmdb:series:1399',
    seasonNumber: 1,
    episodeNumber: 3,
    title: 'Lord Snow',
  };
  const owner = {
    ...gateway('tmdb'),
    async getDetails() {
      return {
        id: 'tmdb:series:1399',
        kind: 'series',
        title: 'Game of Thrones',
        providerId: 'tmdb',
        externalIds: { tmdb: '1399', imdb: 'tt0944947' },
        seasons: [{
          id: 'season-1',
          seasonNumber: 1,
          name: 'Season 1',
          episodeCount: 2,
        }],
      };
    },
    async getSeason() {
      calls.push('tmdb');
      return {
        ...season,
        episodes: [season.episodes[0], episodeThree],
      };
    },
  };
  const fallback = {
    ...gateway('fallback'),
    async getSeason() {
      calls.push('fallback');
      return {
        ...season,
        episodes: [season.episodes[0], episodeTwo],
      };
    },
  };
  const service = new CatalogService(new CatalogRegistry([
    { gateway: owner, enabled: true, priority: 100 },
    { gateway: fallback, enabled: true, priority: 1 },
  ]));

  await service.getDetails('tmdb:series:1399');
  const loaded = await service.getSeason('tmdb:series:1399', 1);

  expect(loaded?.episodes.map((episode: any) => episode.episodeNumber))
    .toEqual([1, 2]);
  expect(calls).toEqual(['tmdb', 'fallback']);
});

test('merges complementary partial seasons from multiple catalog providers', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const calls: string[] = [];
  const episodeTwo = {
    id: 'tmdb:episode:63057',
    seriesId: 'tmdb:series:1399',
    seasonNumber: 1,
    episodeNumber: 2,
    title: 'The Kingsroad',
  };
  const episodeThree = {
    id: 'tmdb:episode:63058',
    seriesId: 'tmdb:series:1399',
    seasonNumber: 1,
    episodeNumber: 3,
    title: 'Lord Snow',
  };
  const owner = {
    ...gateway('tmdb'),
    async getDetails() {
      return {
        id: 'tmdb:series:1399',
        kind: 'series',
        title: 'Game of Thrones',
        providerId: 'tmdb',
        externalIds: { tmdb: '1399', imdb: 'tt0944947' },
        seasons: [{
          id: 'season-1',
          seasonNumber: 1,
          name: 'Season 1',
          episodeCount: 3,
        }],
      };
    },
    async getSeason() {
      calls.push('tmdb');
      return {
        ...season,
        episodes: [season.episodes[0], episodeThree],
      };
    },
  };
  const fallback = {
    ...gateway('fallback'),
    async getSeason() {
      calls.push('fallback');
      return {
        ...season,
        episodes: [episodeTwo],
      };
    },
  };
  const service = new CatalogService(new CatalogRegistry([
    { gateway: owner, enabled: true, priority: 100 },
    { gateway: fallback, enabled: true, priority: 1 },
  ]));

  await service.getDetails('tmdb:series:1399');
  const loaded = await service.getSeason('tmdb:series:1399', 1);

  expect(loaded?.episodes.map((episode: any) => episode.episodeNumber))
    .toEqual([1, 2, 3]);
  expect(calls).toEqual(['tmdb', 'fallback']);
});

test('stale complete season cache is not promoted by a partial live response', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const MemoryCatalogCache = (catalog as any).MemoryCatalogCache;
  const episodeTwo = {
    id: 'tmdb:episode:63057',
    seriesId: 'tmdb:series:1399',
    seasonNumber: 1,
    episodeNumber: 2,
    title: 'The Kingsroad',
  };
  const cachedComplete = {
    ...season,
    episodes: [...season.episodes, episodeTwo],
  };
  const cache = new MemoryCatalogCache();
  await cache.set(
    'season:tmdb:series:1399:1',
    cachedComplete,
    1,
    0,
  );
  let seasonCalls = 0;
  const owner = {
    ...gateway('tmdb'),
    async getDetails() {
      return {
        id: 'tmdb:series:1399',
        kind: 'series',
        title: 'Game of Thrones',
        providerId: 'tmdb',
        externalIds: { tmdb: '1399', imdb: 'tt0944947' },
        seasons: [{
          id: 'season-1',
          seasonNumber: 1,
          name: 'Season 1',
          episodeCount: 2,
        }],
      };
    },
    async getSeason() {
      seasonCalls += 1;
      return season;
    },
  };
  const service = new CatalogService(
    new CatalogRegistry([
      { gateway: owner, enabled: true, priority: 100 },
    ]),
    cache,
  );

  await service.getDetails('tmdb:series:1399');
  const setSpy = jest.spyOn(cache, 'set');

  await expect(
    service.getSeason('tmdb:series:1399', 1),
  ).resolves.toEqual(cachedComplete);
  await expect(
    service.getSeason('tmdb:series:1399', 1),
  ).resolves.toEqual(cachedComplete);

  expect(seasonCalls).toBe(2);
  expect(
    setSpy.mock.calls.some(([key]) => key === 'season:tmdb:series:1399:1'),
  ).toBe(false);
});

test('season normalization keeps S0 specials and drops wrong-series or invalid episodes', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const provider = {
    ...gateway('series'),
    getSeason: async () => ({
      seriesId: 'series:show',
      seasonNumber: 0,
      name: ' Specials ',
      episodes: [
        {
          id: 'special-1',
          seriesId: 'series:show',
          seasonNumber: 0,
          episodeNumber: 1,
          title: ' Special One ',
        },
        {
          id: 'duplicate-special-1',
          seriesId: 'series:show',
          seasonNumber: 0,
          episodeNumber: 1,
          title: 'Duplicate',
        },
        {
          id: 'episode-zero',
          seriesId: 'series:show',
          seasonNumber: 0,
          episodeNumber: 0,
          title: 'Invalid Zero',
        },
        {
          id: 'wrong-series',
          seriesId: 'series:other',
          seasonNumber: 0,
          episodeNumber: 2,
          title: 'Wrong Series',
        },
        {
          id: 'wrong-season',
          seriesId: 'series:show',
          seasonNumber: 1,
          episodeNumber: 2,
          title: 'Wrong Season',
        },
      ],
    }),
  };
  const service = new CatalogService(new CatalogRegistry([
    { gateway: provider, enabled: true, priority: 1 },
  ]));

  await expect(
    service.getSeason('series:show', 0),
  ).resolves.toEqual({
    seriesId: 'series:show',
    seasonNumber: 0,
    name: 'Specials',
    episodes: [{
      id: 'special-1',
      seriesId: 'series:show',
      seasonNumber: 0,
      episodeNumber: 1,
      title: 'Special One',
    }],
  });
});

test('wrong-media details response is skipped in favor of a healthy provider', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const wrong = {
    ...gateway('owner'),
    getDetails: async () => ({
      id: 'owner:movie:other',
      kind: 'movie',
      title: 'Wrong Movie',
      providerId: 'owner',
      externalIds: {},
    }),
  };
  const correctDetails = {
    id: 'owner:movie:1',
    kind: 'movie' as const,
    title: 'Correct Movie',
    providerId: 'fallback',
    externalIds: {},
  };
  const healthy = {
    ...gateway('fallback'),
    getDetails: async () => correctDetails,
  };
  const service = new CatalogService(new CatalogRegistry([
    { gateway: wrong, enabled: true, priority: 100 },
    { gateway: healthy, enabled: true, priority: 50 },
  ]));

  await expect(service.getDetails('owner:movie:1'))
    .resolves.toEqual(correctDetails);
});

test('wrong-root season response is skipped in favor of a healthy provider', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const malformed = {
    ...gateway('series'),
    getSeason: async () => ({
      seriesId: 'series:other',
      seasonNumber: 2,
      episodes: [],
    }),
  };
  const healthy = {
    ...gateway('backup'),
    getSeason: async () => ({
      seriesId: 'series:show',
      seasonNumber: 2,
      episodes: [{
        id: 's2e1',
        seriesId: 'series:show',
        seasonNumber: 2,
        episodeNumber: 1,
        title: 'Season Two',
      }],
    }),
  };
  const service = new CatalogService(new CatalogRegistry([
    { gateway: malformed, enabled: true, priority: 100 },
    { gateway: healthy, enabled: true, priority: 50 },
  ]));

  const season = await service.getSeason('series:show', 2);

  expect(season?.episodes.map((episode: any) => episode.id))
    .toEqual(['s2e1']);
});


test('fresh corrupted details cache is ignored and refetched', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const MemoryCatalogCache = (catalog as any).MemoryCatalogCache;
  const cache = new MemoryCatalogCache();
  await cache.set('details:owner:movie:1', {
    id: 'owner:movie:1',
    kind: 'movie',
    title: null,
  }, 60_000);

  const getDetails = jest.fn(async () => ({
    id: 'owner:movie:1',
    kind: 'movie',
    title: 'Recovered',
    providerId: 'owner',
    externalIds: {},
  }));
  const provider = {
    ...gateway('owner'),
    getDetails,
  };
  const service = new CatalogService(
    new CatalogRegistry([
      { gateway: provider, enabled: true, priority: 1 },
    ]),
    cache,
  );

  await expect(service.getDetails('owner:movie:1'))
    .resolves.toEqual(expect.objectContaining({
      title: 'Recovered',
    }));
  expect(getDetails).toHaveBeenCalledTimes(1);
});

test('fresh corrupted season cache is ignored and refetched', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const MemoryCatalogCache = (catalog as any).MemoryCatalogCache;
  const cache = new MemoryCatalogCache();
  await cache.set('season:series:show:1', {
    seriesId: 'series:other',
    seasonNumber: 1,
    episodes: [],
  }, 60_000);

  const getSeason = jest.fn(async () => ({
    seriesId: 'series:show',
    seasonNumber: 1,
    episodes: [{
      id: 's1e1',
      seriesId: 'series:show',
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Recovered',
    }],
  }));
  const provider = {
    ...gateway('series'),
    getSeason,
  };
  const service = new CatalogService(
    new CatalogRegistry([
      { gateway: provider, enabled: true, priority: 1 },
    ]),
    cache,
  );

  await expect(service.getSeason('series:show', 1))
    .resolves.toEqual(expect.objectContaining({
      episodes: [
        expect.objectContaining({ id: 's1e1' }),
      ],
    }));
  expect(getSeason).toHaveBeenCalledTimes(1);
});


test('browse cache keys do not collide between section ids and cursors', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const MemoryCatalogCache = (catalog as any).MemoryCatalogCache;
  const cache = new MemoryCatalogCache();
  const calls: Array<[string, string | undefined]> = [];
  const provider = {
    ...gateway('provider'),
    async browse(sectionId: string, cursor?: string) {
      calls.push([sectionId, cursor]);
      return {
        items: [{
          id: `provider:movie:${calls.length}`,
          kind: 'movie' as const,
          title: `${sectionId}|${cursor ?? ''}`,
          providerId: 'provider',
          externalIds: {},
        }],
      };
    },
  };
  const service = new CatalogService(
    new CatalogRegistry([
      { gateway: provider, enabled: true, priority: 1 },
    ]),
    cache,
  );

  const cursorPage = await service.browse('movies:provider', '20');
  const sectionPage = await service.browse('movies:provider:20');

  expect(cursorPage.items[0]?.title).toBe('movies:provider|20');
  expect(sectionPage.items[0]?.title).toBe('movies:provider:20|');
  expect(calls).toEqual([
    ['movies:provider', '20'],
    ['movies:provider:20', undefined],
  ]);
});

test('search cache keys do not collide between query text and cursors', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const MemoryCatalogCache = (catalog as any).MemoryCatalogCache;
  const cache = new MemoryCatalogCache();
  const calls: Array<[string, string | undefined]> = [];
  const provider = {
    ...gateway('provider'),
    async search(query: string, cursor?: string) {
      calls.push([query, cursor]);
      return {
        items: [{
          id: `provider:movie:${calls.length}`,
          kind: 'movie' as const,
          title: `${query}|${cursor ?? ''}`,
          providerId: 'provider',
          externalIds: {},
        }],
      };
    },
  };
  const service = new CatalogService(
    new CatalogRegistry([
      { gateway: provider, enabled: true, priority: 1 },
    ]),
    cache,
  );

  const cursorPage = await service.search('movie', '20');
  const queryPage = await service.search('movie:20');

  expect(cursorPage.items[0]?.title).toBe('movie|20');
  expect(queryPage.items[0]?.title).toBe('movie:20|');
  expect(calls).toEqual([
    ['movie', '20'],
    ['movie:20', undefined],
  ]);
});

test('new catalog metadata refreshes remembered sparse items', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  let generation = 1;
  const provider = {
    ...gateway('provider'),
    async search() {
      return {
        items: [{
          id: 'provider:movie:1',
          kind: 'movie' as const,
          title: generation === 1 ? 'Old title' : 'New title',
          providerId: 'provider',
          externalIds: {},
          ...(generation === 2 ? { rating: 9 } : {}),
        }],
      };
    },
  };
  const service = new CatalogService(new CatalogRegistry([
    { gateway: provider, enabled: true, priority: 1 },
  ]));

  await expect(service.search('movie')).resolves.toEqual({
    items: [expect.objectContaining({ title: 'Old title' })],
  });

  generation = 2;
  await expect(service.search('movie', 'next')).resolves.toEqual({
    items: [expect.objectContaining({
      title: 'New title',
      rating: 9,
    })],
  });

  await expect(service.getDetails('provider:movie:1')).resolves.toEqual(
    expect.objectContaining({
      title: 'New title',
      rating: 9,
    }),
  );
});

test('catalog provider results survive cache read failures', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const item: Item = {
    id: 'provider:movie:1',
    kind: 'movie',
    title: 'Available Movie',
    providerId: 'provider',
    externalIds: {},
  };
  const cache = {
    get: jest.fn(async () => {
      throw new Error('storage unavailable');
    }),
    set: jest.fn(async () => undefined),
  };
  const service = new CatalogService(
    new CatalogRegistry([
      {
        gateway: gateway('provider', [item]),
        enabled: true,
        priority: 1,
      },
    ]),
    cache,
  );

  await expect(service.search('Available')).resolves.toEqual({
    items: [item],
  });
});

test('catalog provider results survive cache write failures', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const item: Item = {
    id: 'provider:movie:1',
    kind: 'movie',
    title: 'Available Movie',
    providerId: 'provider',
    externalIds: {},
  };
  const provider = {
    ...gateway('provider', [item]),
    async getDetails() {
      return {
        ...item,
        runtimeMinutes: 120,
      };
    },
    async getSeason() {
      return season;
    },
  };
  const cache = {
    get: jest.fn(async () => null),
    set: jest.fn(async () => {
      throw new Error('storage quota exceeded');
    }),
  };
  const service = new CatalogService(
    new CatalogRegistry([
      { gateway: provider, enabled: true, priority: 1 },
    ]),
    cache,
  );

  await expect(service.search('Available')).resolves.toEqual({
    items: [item],
  });
  await expect(service.getDetails(item.id)).resolves.toEqual(
    expect.objectContaining({
      id: item.id,
      runtimeMinutes: 120,
    }),
  );
  await expect(
    service.getSeason(season.seriesId, season.seasonNumber),
  ).resolves.toEqual(season);
});

test('owned catalog browse survives a cache write failure', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const item: Item = {
    id: 'owner:movie:1',
    kind: 'movie',
    title: 'Owned Movie',
    providerId: 'owner',
    externalIds: {},
  };
  const owner = {
    ...gateway('owner', [item]),
    async getSections() {
      return [{
        id: 'home:owner',
        title: 'Owner',
        kinds: ['movie'],
      }];
    },
  };
  const cache = {
    get: jest.fn(async () => null),
    set: jest.fn(async () => {
      throw new Error('storage quota exceeded');
    }),
  };
  const service = new CatalogService(
    new CatalogRegistry([
      { gateway: owner, enabled: true, priority: 1 },
    ]),
    cache,
  );

  await service.getSections();
  await expect(service.browse('home:owner')).resolves.toEqual({
    items: [item],
  });
});


test('known season episode counts invalidate a fresh partial season cache', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const MemoryCatalogCache = (catalog as any).MemoryCatalogCache;
  const cache = new MemoryCatalogCache();

  await cache.set('season:series:show:1', {
    seriesId: 'series:show',
    seasonNumber: 1,
    episodes: [{
      id: 'cached-e1',
      seriesId: 'series:show',
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Cached Episode 1',
    }],
  }, 60_000);

  const getSeason = jest.fn(async () => ({
    seriesId: 'series:show',
    seasonNumber: 1,
    episodes: [1, 2, 3].map((episodeNumber) => ({
      id: `fresh-e${episodeNumber}`,
      seriesId: 'series:show',
      seasonNumber: 1,
      episodeNumber,
      title: `Episode ${episodeNumber}`,
    })),
  }));
  const provider = {
    ...gateway('series'),
    getDetails: async () => ({
      id: 'series:show',
      kind: 'series',
      title: 'Show',
      providerId: 'series',
      externalIds: { imdb: 'tt1234567' },
      seasons: [{
        id: 'series:show:season:1',
        seasonNumber: 1,
        name: 'Season 1',
        episodeCount: 3,
      }],
    }),
    getSeason,
  };
  const service = new CatalogService(
    new CatalogRegistry([
      { gateway: provider, enabled: true, priority: 1 },
    ]),
    cache,
  );

  await service.getDetails('series:show');
  const loaded = await service.getSeason('series:show', 1);

  expect(getSeason).toHaveBeenCalledTimes(1);
  expect(loaded?.episodes.map((episode: any) => episode.episodeNumber))
    .toEqual([1, 2, 3]);
});

test('known partial provider seasons are returned but not pinned for 24 hours', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const set = jest.fn<Promise<void>, Parameters<catalog.CatalogCache['set']>>(async () => undefined);
  const cache = {
    get: jest.fn(async () => null),
    set,
  };
  const provider = {
    ...gateway('series'),
    getDetails: async () => ({
      id: 'series:show',
      kind: 'series',
      title: 'Show',
      providerId: 'series',
      externalIds: { imdb: 'tt1234567' },
      seasons: [{
        id: 'series:show:season:1',
        seasonNumber: 1,
        name: 'Season 1',
        episodeCount: 3,
      }],
    }),
    getSeason: async () => ({
      seriesId: 'series:show',
      seasonNumber: 1,
      episodes: [{
        id: 'partial-e1',
        seriesId: 'series:show',
        seasonNumber: 1,
        episodeNumber: 1,
        title: 'Episode 1',
      }],
    }),
  };
  const service = new CatalogService(
    new CatalogRegistry([
      { gateway: provider, enabled: true, priority: 1 },
    ]),
    cache,
  );

  await service.getDetails('series:show');
  const loaded = await service.getSeason('series:show', 1);

  expect(loaded?.episodes).toHaveLength(1);
  expect(
    set.mock.calls.some(([key]) => key === 'season:series:show:1'),
  ).toBe(false);
});


test('bounds concurrent catalog provider discovery and search', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;

  let sectionActive = 0;
  let sectionMaxActive = 0;
  let searchActive = 0;
  let searchMaxActive = 0;
  const entries = Array.from({ length: 20 }, (_, index) => {
    const id = `provider-${index}`;
    return {
      gateway: {
        ...gateway(id),
        async getSections() {
          sectionActive += 1;
          sectionMaxActive = Math.max(sectionMaxActive, sectionActive);
          await Promise.resolve();
          sectionActive -= 1;
          return [{
            id: `movies:${id}`,
            title: id,
            kinds: ['movie' as const],
          }];
        },
        async search() {
          searchActive += 1;
          searchMaxActive = Math.max(searchMaxActive, searchActive);
          await Promise.resolve();
          searchActive -= 1;
          return {
            items: [{
              id: `${id}:movie:1`,
              kind: 'movie' as const,
              title: id,
              providerId: id,
              externalIds: {},
            }],
          };
        },
      },
      enabled: true,
      priority: 100 - index,
    };
  });

  const service = new CatalogService(new CatalogRegistry(entries));

  const sections = await service.getSections();
  const page = await service.search('movie');

  expect(sections).toHaveLength(20);
  expect(page.items).toHaveLength(20);
  expect(sectionMaxActive).toBeLessThanOrEqual(8);
  expect(searchMaxActive).toBeLessThanOrEqual(8);
});


test('keeps previously discovered sections during a transient provider failure', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  let failSections = false;
  const provider = {
    ...gateway('provider'),
    async getSections() {
      if (failSections) throw new Error('temporary outage');
      return [{
        id: 'movies:provider',
        title: 'Movies',
        kinds: ['movie' as const],
      }];
    },
  };
  const service = new CatalogService(new CatalogRegistry([
    { gateway: provider, enabled: true, priority: 1 },
  ]));

  await expect(service.getSections()).resolves.toEqual([{
    id: 'movies:provider',
    title: 'Movies',
    kinds: ['movie'],
  }]);

  failSections = true;

  await expect(service.getSections()).resolves.toEqual([{
    id: 'movies:provider',
    title: 'Movies',
    kinds: ['movie'],
  }]);
});

test('clears remembered sections after a successful empty provider refresh', async () => {
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  let sectionsEnabled = true;
  const provider = {
    ...gateway('provider'),
    async getSections() {
      return sectionsEnabled
        ? [{
            id: 'movies:provider',
            title: 'Movies',
            kinds: ['movie' as const],
          }]
        : [];
    },
  };
  const service = new CatalogService(new CatalogRegistry([
    { gateway: provider, enabled: true, priority: 1 },
  ]));

  await expect(service.getSections()).resolves.toHaveLength(1);
  sectionsEnabled = false;
  await expect(service.getSections()).resolves.toEqual([]);
});

test('does not starve a queued healthy catalog provider behind slow providers', async () => {
  jest.useFakeTimers();
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const never = () => new Promise<never>(() => {});
  const healthyGetSections = jest.fn(async () => [{
    id: 'movies:healthy',
    title: 'Healthy',
    kinds: ['movie' as const],
  }]);
  const slow = Array.from({ length: 8 }, (_, index) => ({
    gateway: {
      ...gateway(`slow-${index}`),
      getSections: never,
    },
    enabled: true,
    priority: 100 - index,
  }));
  const healthy = {
    gateway: {
      ...gateway('healthy'),
      getSections: healthyGetSections,
    },
    enabled: true,
    priority: 1,
  };

  const service = new CatalogService(
    new CatalogRegistry([...slow, healthy]),
  );

  try {
    const pending = service.getSections();
    await Promise.resolve();

    jest.advanceTimersByTime(4_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(healthyGetSections).toHaveBeenCalledTimes(1);
    await expect(pending).resolves.toEqual([
      {
        id: 'movies:healthy',
        title: 'Healthy',
        kinds: ['movie'],
      },
    ]);
  } finally {
    jest.useRealTimers();
  }
});


test('hung details owner yields to a healthy fallback within one provider budget', async () => {
  jest.useFakeTimers();
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const fallbackDetails = {
    id: 'owner:movie:1',
    kind: 'movie' as const,
    title: 'Recovered details',
    providerId: 'fallback',
    externalIds: {},
  };
  const fallbackGetDetails = jest.fn(async () => fallbackDetails);
  const owner = {
    ...gateway('owner'),
    getDetails: () => new Promise<never>(() => {}),
  };
  const fallback = {
    ...gateway('fallback'),
    getDetails: fallbackGetDetails,
  };
  const service = new CatalogService(new CatalogRegistry([
    { gateway: fallback, enabled: true, priority: 100 },
    { gateway: owner, enabled: true, priority: 1 },
  ]));

  try {
    const pending = service.getDetails('owner:movie:1');
    await Promise.resolve();

    jest.advanceTimersByTime(4_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(fallbackGetDetails).toHaveBeenCalledTimes(1);
    await expect(pending).resolves.toEqual(fallbackDetails);
  } finally {
    jest.useRealTimers();
  }
});

test('hung season owner yields to a healthy fallback within one provider budget', async () => {
  jest.useFakeTimers();
  const CatalogRegistry = (catalog as any).CatalogRegistry;
  const CatalogService = (catalog as any).CatalogService;
  const fallbackGetSeason = jest.fn(async () => season);
  const owner = {
    ...gateway('tmdb'),
    getSeason: () => new Promise<never>(() => {}),
  };
  const fallback = {
    ...gateway('fallback'),
    getSeason: fallbackGetSeason,
  };
  const service = new CatalogService(new CatalogRegistry([
    { gateway: fallback, enabled: true, priority: 100 },
    { gateway: owner, enabled: true, priority: 1 },
  ]));

  try {
    const pending = service.getSeason('tmdb:series:1399', 1);
    await Promise.resolve();

    jest.advanceTimersByTime(4_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(fallbackGetSeason).toHaveBeenCalledTimes(1);
    await expect(pending).resolves.toEqual(season);
  } finally {
    jest.useRealTimers();
  }
});
