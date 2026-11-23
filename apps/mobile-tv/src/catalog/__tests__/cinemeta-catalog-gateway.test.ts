import { CinemetaCatalogGateway } from '../CinemetaCatalogGateway';

function response(body: unknown) {
  const serialized = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get(name: string) {
        if (name.toLowerCase() === 'content-type') {
          return 'application/json';
        }
        if (name.toLowerCase() === 'content-length') {
          return String(Buffer.byteLength(serialized));
        }
        return null;
      },
    },
    text: async () => serialized,
  };
}

function expectCatalogRequest(
  fetcher: jest.Mock,
  url: string,
) {
  expect(fetcher).toHaveBeenCalledWith(
    url,
    expect.objectContaining({
      method: 'GET',
      redirect: 'follow',
    }),
  );
}

test('honors a shorter CatalogService timeout for Cinemeta requests', async () => {
  jest.useFakeTimers();
  try {
    let signal: AbortSignal | undefined;
    const fetcher = jest.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<any>(() => undefined);
    });
    const gateway = new CinemetaCatalogGateway(
      'https://cinemeta.example',
      fetcher as never,
    );

    const pending = gateway.browse(
      'movies:popular',
      undefined,
      { timeoutMs: 25 },
    );
    const rejection = expect(pending).rejects.toThrow(
      'Catalog request timed out',
    );
    await jest.advanceTimersByTimeAsync(26);

    await rejection;
    expect(signal?.aborted).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test('normalizes Cinemeta catalog items with IMDb identity and artwork', async () => {
  const fetcher = jest.fn(async () => response({
    metas: [{
      id: 'tt0137523',
      type: 'movie',
      name: 'Fight Club',
      poster: 'https://images.example/fight-club.jpg',
      background: 'https://images.example/fight-club-bg.jpg',
      description: 'An insomniac meets a soap maker.',
      releaseInfo: '1999',
      imdbRating: '8.8',
      genres: ['Drama'],
    }],
  }));

  const gateway = new CinemetaCatalogGateway('https://cinemeta.example', fetcher);
  const page = await gateway.browse('movies:popular');

  expectCatalogRequest(
    fetcher,
    'https://cinemeta.example/catalog/movie/top.json',
  );
  expect(page.items).toEqual([expect.objectContaining({
    id: 'cinemeta:movie:tt0137523',
    providerId: 'cinemeta',
    kind: 'movie',
    title: 'Fight Club',
    year: 1999,
    rating: 8.8,
    posterUrl: 'https://images.example/fight-club.jpg',
    backdropUrl: 'https://images.example/fight-club-bg.jpg',
    externalIds: { imdb: 'tt0137523' },
  })]);
});

test('searches movie and series catalogs together', async () => {
  const fetcher = jest.fn(async (url: string) => response({
    metas: url.includes('/movie/')
      ? [{ id: 'tt1160419', type: 'movie', name: 'Dune', releaseInfo: '2021' }]
      : [{ id: 'tt1520211', type: 'series', name: 'The Walking Dead', releaseInfo: '2010-2022' }],
  }));

  const gateway = new CinemetaCatalogGateway('https://cinemeta.example', fetcher);
  const page = await gateway.search('dune');

  expect(page.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'movie', externalIds: { imdb: 'tt1160419' } }),
    expect.objectContaining({ kind: 'series', externalIds: { imdb: 'tt1520211' } }),
  ]));
  expectCatalogRequest(
    fetcher,
    'https://cinemeta.example/catalog/movie/top/search=dune.json',
  );
  expectCatalogRequest(
    fetcher,
    'https://cinemeta.example/catalog/series/top/search=dune.json',
  );
});

test('deduplicates repeated Cinemeta episodes in season summaries and rows', async () => {
  const fetcher = jest.fn(async () => response({
    meta: {
      id: 'tt0944947',
      type: 'series',
      name: 'Game of Thrones',
      videos: [
        { id: 'a:1:1', season: 1, episode: 1, title: 'Episode 1' },
        { id: 'b:1:1', season: 1, episode: 1, title: 'Duplicate' },
        { id: 'a:1:2', season: 1, episode: 2, title: 'Episode 2' },
      ],
    },
  }));
  const gateway = new CinemetaCatalogGateway(
    'https://cinemeta.example',
    fetcher,
  );
  const seriesId = 'cinemeta:series:tt0944947';

  const details = await gateway.getDetails(seriesId);
  const season = await gateway.getSeason(seriesId, 1);

  expect(details?.seasons).toEqual([
    expect.objectContaining({ seasonNumber: 1, episodeCount: 2 }),
  ]);
  expect(season?.episodes.map((episode) => episode.episodeNumber))
    .toEqual([1, 2]);
  expect(season?.episodes[0]?.title).toBe('Episode 1');
});

test('recovers Cinemeta episode coordinates from numeric strings and video IDs', async () => {
  const fetcher = jest.fn(async () => response({
    meta: {
      id: 'tt0944947',
      type: 'series',
      name: 'Game of Thrones',
      videos: [
        { id: 'tt0944947:1:1', title: 'Winter Is Coming' },
        {
          id: 'tt0944947:1:2',
          title: 'The Kingsroad',
          season: '1',
          episode: '2',
        },
        {
          id: 'tt0944947:1:3',
          title: 'Lord Snow',
          number: '3',
        },
      ],
    },
  }));

  const gateway = new CinemetaCatalogGateway(
    'https://cinemeta.example',
    fetcher,
  );
  const details = await gateway.getDetails(
    'cinemeta:series:tt0944947',
  );
  const season = await gateway.getSeason(
    'cinemeta:series:tt0944947',
    1,
  );

  expect(details?.seasons).toEqual([
    expect.objectContaining({
      seasonNumber: 1,
      episodeCount: 3,
    }),
  ]);
  expect(season?.episodes.map((episode) => episode.episodeNumber))
    .toEqual([1, 2, 3]);
});

test('derives series seasons and episodes from Cinemeta videos', async () => {
  const fetcher = jest.fn(async () => response({
    meta: {
      id: 'tt0944947',
      type: 'series',
      name: 'Game of Thrones',
      poster: 'https://images.example/got.jpg',
      background: 'https://images.example/got-bg.jpg',
      releaseInfo: '2011-2019',
      imdbRating: '9.2',
      videos: [
        {
          id: 'tt0944947:1:1',
          title: 'Winter Is Coming',
          season: 1,
          episode: 1,
          released: '2011-04-17T00:00:00.000Z',
          thumbnail: 'https://images.example/s1e1.jpg',
          overview: 'The first episode.',
        },
        {
          id: 'tt0944947:1:2',
          title: 'The Kingsroad',
          season: 1,
          number: 2,
          released: '2011-04-24T00:00:00.000Z',
        },
        {
          id: 'tt0944947:2:1',
          title: 'The North Remembers',
          season: 2,
          episode: 1,
        },
      ],
    },
  }));

  const gateway = new CinemetaCatalogGateway('https://cinemeta.example', fetcher);
  const details = await gateway.getDetails('cinemeta:series:tt0944947');

  expect(details).toEqual(expect.objectContaining({
    id: 'cinemeta:series:tt0944947',
    seasonCount: 2,
    episodeCount: 3,
    seasons: [
      expect.objectContaining({ seasonNumber: 1, episodeCount: 2 }),
      expect.objectContaining({ seasonNumber: 2, episodeCount: 1 }),
    ],
  }));

  const season = await gateway.getSeason('cinemeta:series:tt0944947', 1);
  expect(season?.episodes).toEqual([
    expect.objectContaining({
      id: 'tt0944947:1:1',
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Winter Is Coming',
      stillUrl: 'https://images.example/s1e1.jpg',
    }),
    expect.objectContaining({
      seasonNumber: 1,
      episodeNumber: 2,
      title: 'The Kingsroad',
    }),
  ]);
});


test('exposes Cinemeta season zero specials', async () => {
  const fetcher = jest.fn(async () => response({
    meta: {
      id: 'tt0944947',
      type: 'series',
      name: 'Game of Thrones',
      videos: [{
        id: 'tt0944947:0:1',
        title: 'Special One',
        season: 0,
        episode: 1,
      }],
    },
  }));

  const gateway = new CinemetaCatalogGateway(
    'https://cinemeta.example',
    fetcher,
  );
  const seriesId = 'cinemeta:series:tt0944947';
  const details = await gateway.getDetails(seriesId);
  const specials = await gateway.getSeason(seriesId, 0);

  expect(details?.seasons).toEqual([
    expect.objectContaining({
      seasonNumber: 0,
      episodeCount: 1,
    }),
  ]);
  expect(specials?.episodes).toEqual([
    expect.objectContaining({
      seasonNumber: 0,
      episodeNumber: 1,
      title: 'Special One',
    }),
  ]);
});


test('drops signed Cinemeta poster, backdrop and episode still URLs', async () => {
  const fetcher = jest.fn(async () => response({
    meta: {
      id: 'tt0944947',
      type: 'series',
      name: 'Private Artwork Series',
      poster: 'https://img.example/poster.jpg?token=LOCAL-SECRET',
      background:
        'https://img.example/backdrop.jpg#signature=LOCAL-SECRET',
      videos: [{
        id: 'tt0944947:1:1',
        season: 1,
        episode: 1,
        title: 'Pilot',
        thumbnail:
          'https://img.example/still.jpg?session=LOCAL-SECRET',
      }],
    },
  }));
  const gateway = new CinemetaCatalogGateway(
    'https://cinemeta.example',
    fetcher,
  );
  const seriesId = 'cinemeta:series:tt0944947';

  const details = await gateway.getDetails(seriesId);
  const season = await gateway.getSeason(seriesId, 1);

  expect(details?.posterUrl).toBeUndefined();
  expect(details?.backdropUrl).toBeUndefined();
  expect(season?.episodes[0]?.stillUrl).toBeUndefined();
  expect(JSON.stringify({ details, season })).not.toContain('LOCAL-SECRET');
});

test('drops credentialized Cinemeta artwork path segments', async () => {
  const fetcher = jest.fn(async () => response({
    meta: {
      id: 'tt0944947',
      type: 'series',
      name: 'Private Artwork Series',
      poster: 'https://img.example/token=fixture-value/poster.jpg',
      background: 'https://img.example/backdrop.jpg',
      videos: [{
        id: 'tt0944947:1:1',
        season: 1,
        episode: 1,
        title: 'Pilot',
        thumbnail: 'https://img.example/session=fixture-value/still.jpg',
      }],
    },
  }));
  const gateway = new CinemetaCatalogGateway(
    'https://cinemeta.example',
    fetcher,
  );
  const seriesId = 'cinemeta:series:tt0944947';

  const details = await gateway.getDetails(seriesId);
  const season = await gateway.getSeason(seriesId, 1);

  expect(details?.posterUrl).toBeUndefined();
  expect(details?.backdropUrl).toBe('https://img.example/backdrop.jpg');
  expect(season?.episodes[0]?.stillUrl).toBeUndefined();
});

test('bounds and sanitizes remote Cinemeta catalog payloads', async () => {
  const metas = Array.from({ length: 550 }, (_, index) => ({
    id: `tt${String(index + 1).padStart(7, '0')}`,
    type: 'movie',
    name: `Movie ${index}`,
    poster: 'javascript:alert(1)',
    genres: Array.from({ length: 150 }, (_, genre) => `Genre ${genre}`),
  }));
  const fetcher = jest.fn(async () => response({ metas }));
  const gateway = new CinemetaCatalogGateway(
    'https://cinemeta.example',
    fetcher,
  );

  const page = await gateway.browse('movies:popular');

  expect(page.items).toHaveLength(500);
  expect(page.items[0]?.posterUrl).toBeUndefined();
  expect(page.items[0]?.genres).toHaveLength(100);
});

test('bounds Cinemeta series episode payloads', async () => {
  const videos = Array.from({ length: 1_100 }, (_, index) => ({
    id: `tt0944947:1:${index + 1}`,
    season: 1,
    episode: index + 1,
    title: index === 0 ? 'x'.repeat(501) : `Episode ${index + 1}`,
    thumbnail: index === 1
      ? 'https://user:pass@example.com/e2.jpg'
      : undefined,
  }));
  const fetcher = jest.fn(async () => response({
    meta: {
      id: 'tt0944947',
      type: 'series',
      name: 'Game of Thrones',
      videos,
    },
  }));
  const gateway = new CinemetaCatalogGateway(
    'https://cinemeta.example',
    fetcher,
  );
  const seriesId = 'cinemeta:series:tt0944947';

  const season = await gateway.getSeason(seriesId, 1);

  expect(season?.episodes).toHaveLength(1_000);
  expect(season?.episodes.some((episode) => (
    episode.title.length > 500
  ))).toBe(false);
  expect(season?.episodes[0]?.stillUrl).toBeUndefined();
});
