import type { AddonStateRecord } from '@moviestv/addons';
import { StremioCatalogGateway } from '../StremioCatalogGateway';

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

const record: AddonStateRecord = {
  installed: {
    addonId: 'com.nuvio.tmdb.catalogs',
    manifestUrl: 'https://catalog.nuvio.tv/manifest.json',
    sourceType: 'stremio-manifest',
    enabled: true,
    priority: 100,
    installedAt: '2026-09-19T09:00:00.000Z',
    updatedAt: '2026-09-19T09:00:00.000Z',
    setupIncomplete: false,
  },
  safeConfig: { language: 'en-US', region: 'US' },
  descriptor: {
    id: 'com.nuvio.tmdb.catalogs',
    name: 'Nuvio Catalog Addon',
    version: '1.2.0',
    sourceType: 'stremio-manifest',
    capabilities: ['catalog'],
    requiresConfiguration: false,
    configurationFields: [],
    supportedMediaKinds: ['movie', 'series'],
    manifestUrl: 'https://catalog.nuvio.tv/manifest.json',
    catalog: {
      catalogs: [
        {
          type: 'movie',
          id: 'trending-movies',
          name: 'Trending Movies',
          extra: [{ name: 'skip', isRequired: false }],
        },
        {
          type: 'series',
          id: 'trending-series',
          name: 'Trending Series',
          extra: [{ name: 'skip', isRequired: false }],
        },
        {
          type: 'movie',
          id: 'popular-movies',
          name: 'Popular Movies',
          extra: [{ name: 'search', isRequired: false }],
        },
      ],
      meta: {
        types: ['movie', 'series'],
        idPrefixes: ['tt', 'tmdb:'],
      },
    },
  },
};

test('exposes installed movie and series catalog sections', async () => {
  const gateway = new StremioCatalogGateway(record, async () => response({ metas: [] }));
  await expect(gateway.getSections()).resolves.toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'movies:stremio-com.nuvio.tmdb.catalogs:trending-movies',
      title: 'Trending Movies',
      kinds: ['movie'],
    }),
    expect.objectContaining({
      id: 'series:stremio-com.nuvio.tmdb.catalogs:trending-series',
      title: 'Trending Series',
      kinds: ['series'],
    }),
    expect.objectContaining({
      id: 'home:stremio-com.nuvio.tmdb.catalogs:trending-movies',
      title: 'Trending Movies',
      kinds: ['movie'],
    }),
    expect.objectContaining({
      id: 'home:stremio-com.nuvio.tmdb.catalogs:trending-series',
      title: 'Trending Series',
      kinds: ['series'],
    }),
  ]));
});

test('honors a shorter CatalogService timeout budget', async () => {
  jest.useFakeTimers();
  try {
    let signal: { aborted?: boolean } | undefined;
    const fetcher = jest.fn((_url: string, init: any) => {
      signal = init.signal;
      return new Promise<any>(() => undefined);
    });
    const gateway = new StremioCatalogGateway(record, fetcher);

    const pending = gateway.browse(
      'movies:stremio-com.nuvio.tmdb.catalogs:trending-movies',
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

test('normalizes Nuvio catalog items and uses the protocol catalog route', async () => {
  const fetcher = jest.fn(async () => response({
    metas: [{
      id: 'tt0137523',
      type: 'movie',
      name: 'Fight Club',
      poster: 'https://images.example/fight-club.jpg',
      background: 'https://images.example/fight-club-bg.jpg',
      description: 'Overview',
      releaseInfo: '1999',
      imdbRating: '8.8',
    }],
  }));
  const gateway = new StremioCatalogGateway(record, fetcher);

  const page = await gateway.browse('movies:stremio-com.nuvio.tmdb.catalogs:trending-movies');

  expectCatalogRequest(
    fetcher,
    'https://catalog.nuvio.tv/catalog/movie/trending-movies.json',
  );
  expect(page.items).toEqual([
    expect.objectContaining({
      kind: 'movie',
      title: 'Fight Club',
      providerId: 'stremio-com.nuvio.tmdb.catalogs',
      externalIds: { imdb: 'tt0137523' },
      posterUrl: 'https://images.example/fight-club.jpg',
    }),
  ]);
});

test('keeps the catalog resource ID stable when meta returns a different ID namespace', async () => {
  const fetcher = jest.fn(async (url: string) => {
    if (url.includes('/meta/movie/')) {
      return response({
        meta: {
          id: 'tt0137523',
          imdb_id: 'tt0137523',
          type: 'movie',
          name: 'Fight Club',
        },
      });
    }
    return response({ metas: [] });
  });
  const gateway = new StremioCatalogGateway(record, fetcher);
  const mediaId =
    'stremio-com.nuvio.tmdb.catalogs:movie:tmdb%3Amovie%3A550';

  const details = await gateway.getDetails(mediaId);

  expect(details).toEqual(expect.objectContaining({
    id: mediaId,
    externalIds: {
      tmdb: '550',
      imdb: 'tt0137523',
    },
  }));
  expectCatalogRequest(
    fetcher,
    'https://catalog.nuvio.tv/meta/movie/tmdb%3Amovie%3A550.json',
  );
});

test('keeps resource external IDs authoritative over conflicting metadata fields', async () => {
  const fetcher = jest.fn(async () => response({
    meta: {
      id: 'tmdb:movie:550',
      type: 'movie',
      name: 'Fight Club',
      imdb_id: 'tt0137523',
      tmdb_id: 999,
    },
  }));
  const gateway = new StremioCatalogGateway(record, fetcher);
  const mediaId =
    'stremio-com.nuvio.tmdb.catalogs:movie:tmdb%3Amovie%3A550';

  const details = await gateway.getDetails(mediaId);

  expect(details?.externalIds).toEqual({
    tmdb: '550',
    imdb: 'tt0137523',
  });
});

test('series seasons keep using the original catalog resource after meta changes namespace', async () => {
  const calls: string[] = [];
  const fetcher = jest.fn(async (url: string) => {
    calls.push(url);
    return response({
      meta: {
        id: 'tt0944947',
        imdb_id: 'tt0944947',
        type: 'series',
        name: 'Game of Thrones',
        videos: [{
          id: 'tt0944947:1:1',
          season: 1,
          episode: 1,
          title: 'Winter Is Coming',
        }],
      },
    });
  });
  const gateway = new StremioCatalogGateway(record, fetcher);
  const mediaId =
    'stremio-com.nuvio.tmdb.catalogs:series:tmdb%3Aseries%3A1399';

  const details = await gateway.getDetails(mediaId);
  expect(details?.id).toBe(mediaId);
  expect(details?.externalIds).toEqual({
    tmdb: '1399',
    imdb: 'tt0944947',
  });

  const season = await gateway.getSeason(details!.id, 1);

  expect(season?.episodes[0]?.title).toBe('Winter Is Coming');
  expect(calls).toEqual([
    'https://catalog.nuvio.tv/meta/series/tmdb%3Aseries%3A1399.json',
    'https://catalog.nuvio.tv/meta/series/tmdb%3Aseries%3A1399.json',
  ]);
});

test('infers uppercase TMDB resource IDs from catalog metadata', async () => {
  const fetcher = jest.fn(async () => response({
    meta: {
      id: 'TMDB:MOVIE:550',
      type: 'movie',
      name: 'Fight Club',
    },
  }));
  const gateway = new StremioCatalogGateway(record, fetcher);
  const mediaId =
    'stremio-com.nuvio.tmdb.catalogs:movie:TMDB%3AMOVIE%3A550';

  const details = await gateway.getDetails(mediaId);

  expect(details?.externalIds).toEqual({ tmdb: '550' });
});

test('accepts common alternate IMDb and TMDB identifier fields', async () => {
  const fetcher = jest.fn(async () => response({
    meta: {
      id: 'provider:movie:550',
      type: 'movie',
      name: 'Fight Club',
      imdbId: 'tt0137523',
      tmdbId: 550,
    },
  }));
  const gateway = new StremioCatalogGateway(record, fetcher);
  const mediaId =
    'stremio-com.nuvio.tmdb.catalogs:movie:provider%3Amovie%3A550';

  const details = await gateway.getDetails(mediaId);

  expect(details?.externalIds).toEqual({
    imdb: 'tt0137523',
    tmdb: '550',
  });
});

test('accepts numeric movie and episode runtime metadata', async () => {
  const fetcher = jest.fn(async () => response({
    meta: {
      id: 'tmdb:series:1399',
      type: 'series',
      name: 'Game of Thrones',
      runtime: 58,
      videos: [{
        id: 'tmdb:series:1399:1:1',
        season: 1,
        episode: 1,
        title: 'Episode 1',
        runtime: 55,
      }],
    },
  }));
  const gateway = new StremioCatalogGateway(record, fetcher);
  const seriesId =
    'stremio-com.nuvio.tmdb.catalogs:series:tmdb%3Aseries%3A1399';

  const details = await gateway.getDetails(seriesId);
  const season = await gateway.getSeason(seriesId, 1);

  expect(details?.runtimeMinutes).toBe(58);
  expect(season?.episodes[0]?.runtimeMinutes).toBe(55);
});

test('accepts alternate poster backdrop year and episode still fields', async () => {
  const fetcher = jest.fn(async () => response({
    meta: {
      id: 'tmdb:series:1399',
      type: 'series',
      name: 'Game of Thrones',
      posterUrl: 'https://img.example/poster.jpg',
      backdropUrl: 'https://img.example/backdrop.jpg',
      year: '2011',
      videos: [{
        id: 'tmdb:series:1399:1:1',
        season: 1,
        episode: 1,
        title: 'Winter Is Coming',
        stillUrl: 'https://img.example/episode.jpg',
      }],
    },
  }));
  const gateway = new StremioCatalogGateway(record, fetcher);
  const seriesId =
    'stremio-com.nuvio.tmdb.catalogs:series:tmdb%3Aseries%3A1399';

  const details = await gateway.getDetails(seriesId);
  const season = await gateway.getSeason(seriesId, 1);

  expect(details).toEqual(expect.objectContaining({
    posterUrl: 'https://img.example/poster.jpg',
    backdropUrl: 'https://img.example/backdrop.jpg',
    year: 2011,
  }));
  expect(season?.episodes[0]).toEqual(expect.objectContaining({
    stillUrl: 'https://img.example/episode.jpg',
  }));
});

test('treats malformed catalog meta arrays as empty instead of crashing', async () => {
  const fetcher = jest.fn(async () => response({
    metas: { id: 'not-an-array' },
  }));
  const gateway = new StremioCatalogGateway(record, fetcher);

  await expect(gateway.browse(
    'movies:stremio-com.nuvio.tmdb.catalogs:trending-movies',
  )).resolves.toEqual({ items: [] });
});

test('treats malformed series video arrays as having no episodes', async () => {
  const fetcher = jest.fn(async () => response({
    meta: {
      id: 'tmdb:series:1399',
      type: 'series',
      name: 'Game of Thrones',
      videos: { malformed: true },
    },
  }));
  const gateway = new StremioCatalogGateway(record, fetcher);
  const seriesId =
    'stremio-com.nuvio.tmdb.catalogs:series:tmdb%3Aseries%3A1399';

  const details = await gateway.getDetails(seriesId);
  const season = await gateway.getSeason(seriesId, 1);

  expect(details?.seasons).toBeUndefined();
  expect(details?.episodeCount).toBeUndefined();
  expect(season).toBeNull();
});

test('deduplicates repeated Stremio episodes in season summaries and rows', async () => {
  const fetcher = jest.fn(async () => response({
    meta: {
      id: 'tmdb:series:1399',
      type: 'series',
      name: 'Game of Thrones',
      videos: [
        { id: 'a:1:1', season: 1, episode: 1, title: 'Episode 1' },
        { id: 'b:1:1', season: 1, episode: 1, title: 'Episode 1 duplicate' },
        { id: 'a:1:2', season: 1, episode: 2, title: 'Episode 2' },
      ],
    },
  }));
  const gateway = new StremioCatalogGateway(record, fetcher);
  const seriesId =
    'stremio-com.nuvio.tmdb.catalogs:series:tmdb%3Aseries%3A1399';

  const details = await gateway.getDetails(seriesId);
  const season = await gateway.getSeason(seriesId, 1);

  expect(details?.seasons).toEqual([
    expect.objectContaining({ seasonNumber: 1, episodeCount: 2 }),
  ]);
  expect(season?.episodes.map((episode) => episode.episodeNumber))
    .toEqual([1, 2]);
  expect(season?.episodes[0]?.title).toBe('Episode 1');
});

test('enriches sparse duplicate episode rows without changing the first identity', async () => {
  const fetcher = jest.fn(async () => response({
    meta: {
      id: 'tmdb:series:1399',
      type: 'series',
      name: 'Game of Thrones',
      videos: [
        {
          id: 'first:1:1',
          season: 1,
          episode: 1,
        },
        {
          id: 'later:1:1',
          season: 1,
          episode: 1,
          title: 'Winter Is Coming',
          description: 'The Stark family is introduced.',
          released: '2011-04-17T00:00:00.000Z',
          runtime: '58 min',
          thumbnail: 'https://img.example/winter.jpg',
          imdbRating: '9.0',
        },
      ],
    },
  }));
  const gateway = new StremioCatalogGateway(record, fetcher);
  const seriesId =
    'stremio-com.nuvio.tmdb.catalogs:series:tmdb%3Aseries%3A1399';

  await gateway.getDetails(seriesId);
  const season = await gateway.getSeason(seriesId, 1);

  expect(season?.episodes).toEqual([
    expect.objectContaining({
      id: 'first:1:1',
      episodeNumber: 1,
      title: 'Winter Is Coming',
      overview: 'The Stark family is introduced.',
      airDate: '2011-04-17',
      runtimeMinutes: 58,
      stillUrl: 'https://img.example/winter.jpg',
      rating: 9,
    }),
  ]);
});

test('recovers valid episode coordinates from strings and Stremio video IDs', async () => {
  const fetcher = jest.fn(async () => response({
    meta: {
      id: 'tmdb:series:1399',
      type: 'series',
      name: 'Game of Thrones',
      videos: [
        {
          id: 'tt0944947:1:1',
          title: 'Winter Is Coming',
        },
        {
          id: 'tt0944947:1:2',
          title: 'The Kingsroad',
          season: '1',
          episode: '2',
        },
        {
          id: 'tt0944947:1:3',
          title: 'Lord Snow',
          season: 'not-a-season',
        },
      ],
    },
  }));
  const gateway = new StremioCatalogGateway(record, fetcher);
  const seriesId =
    'stremio-com.nuvio.tmdb.catalogs:series:tmdb%3Aseries%3A1399';

  const details = await gateway.getDetails(seriesId);
  const season = await gateway.getSeason(seriesId, 1);

  expect(details?.seasons).toEqual([
    expect.objectContaining({
      seasonNumber: 1,
      episodeCount: 3,
    }),
  ]);
  expect(season?.episodes.map((episode) => episode.episodeNumber))
    .toEqual([1, 2, 3]);
});

test('preserves a standard configured manifest path on catalog and meta requests', async () => {
  const configuredPath =
    '%7B%22language%22%3A%22fr-FR%22%2C%22region%22%3A%22FR%22%7D';
  const configured: AddonStateRecord = {
    ...record,
    descriptor: {
      ...record.descriptor!,
      manifestUrl:
        `https://catalog.nuvio.tv/${configuredPath}/manifest.json`,
    },
  };
  const fetcher = jest.fn(async (url: string) => (
    response(url.includes('/meta/')
      ? {
          meta: {
            id: 'tt0137523',
            type: 'movie',
            name: 'Fight Club',
          },
        }
      : {
          metas: [{
            id: 'tt0137523',
            type: 'movie',
            name: 'Fight Club',
          }],
        })
  ));
  const gateway = new StremioCatalogGateway(configured, fetcher);

  const page = await gateway.browse(
    'movies:stremio-com.nuvio.tmdb.catalogs:trending-movies',
  );
  await gateway.getDetails(page.items[0]!.id);

  expectCatalogRequest(
    fetcher,
    `https://catalog.nuvio.tv/${configuredPath}/catalog/movie/trending-movies.json`,
  );
  expectCatalogRequest(
    fetcher,
    `https://catalog.nuvio.tv/${configuredPath}/meta/movie/tt0137523.json`,
  );
});

test('preserves secure manifest query configuration on catalog requests', async () => {
  const configured: AddonStateRecord = {
    ...record,
    installed: {
      ...record.installed,
      manifestUrl: 'https://catalog.nuvio.tv/manifest.json?token=LOCAL-ONLY',
    },
    descriptor: {
      ...record.descriptor!,
      manifestUrl: 'https://catalog.nuvio.tv/manifest.json?token=LOCAL-ONLY',
    },
  };
  const fetcher = jest.fn(async () => response({ metas: [] }));
  const gateway = new StremioCatalogGateway(
    configured,
    fetcher,
    '/api/nuvio-catalog',
  );

  await gateway.browse(
    'movies:stremio-com.nuvio.tmdb.catalogs:trending-movies',
  );

  expectCatalogRequest(
    fetcher,
    '/api/nuvio-catalog/catalog/movie/trending-movies.json?token=LOCAL-ONLY',
  );
});

test('rejects malformed catalog-owned IDs and out-of-range seasons without fetching', async () => {
  const fetcher = jest.fn(async () => response({ meta: null }));
  const gateway = new StremioCatalogGateway(record, fetcher);

  await expect(gateway.getDetails(
    'stremio-com.nuvio.tmdb.catalogs:movie:%00bad',
  )).resolves.toBeNull();
  await expect(gateway.getDetails(
    `stremio-com.nuvio.tmdb.catalogs:movie:${'x'.repeat(513)}`,
  )).resolves.toBeNull();
  await expect(gateway.getSeason(
    'stremio-com.nuvio.tmdb.catalogs:series:tt0944947',
    -1,
  )).resolves.toBeNull();
  await expect(gateway.getSeason(
    'stremio-com.nuvio.tmdb.catalogs:series:tt0944947',
    10_001,
  )).resolves.toBeNull();

  expect(fetcher).not.toHaveBeenCalled();
});

test('rejects insecure non-loopback catalog endpoints before loading', () => {
  const insecure: AddonStateRecord = {
    ...record,
    installed: {
      ...record.installed,
      manifestUrl: 'http://example.com/manifest.json',
    },
    descriptor: {
      ...record.descriptor!,
      manifestUrl: 'http://example.com/manifest.json',
    },
  };

  expect(() => new StremioCatalogGateway(
    insecure,
    async () => response({ metas: [] }),
  )).toThrow('secure HTTPS');
});

test('keeps loopback HTTP catalog endpoints available for development', async () => {
  const local: AddonStateRecord = {
    ...record,
    installed: {
      ...record.installed,
      manifestUrl: 'http://127.0.0.1:7000/manifest.json',
    },
    descriptor: {
      ...record.descriptor!,
      manifestUrl: 'http://127.0.0.1:7000/manifest.json',
    },
  };
  const fetcher = jest.fn(async () => response({ metas: [] }));
  const gateway = new StremioCatalogGateway(local, fetcher);

  await gateway.browse(
    'movies:stremio-com.nuvio.tmdb.catalogs:trending-movies',
  );

  expectCatalogRequest(
    fetcher,
    'http://127.0.0.1:7000/catalog/movie/trending-movies.json',
  );
});

test('normalizes IMDb catalog identifiers to lowercase', async () => {
  const fetcher = jest.fn(async () => response({
    metas: [{
      id: 'TT0137523',
      type: 'movie',
      name: 'Fight Club',
      imdb_id: 'TT0137523',
    }],
  }));
  const gateway = new StremioCatalogGateway(record, fetcher);

  const page = await gateway.browse(
    'movies:stremio-com.nuvio.tmdb.catalogs:trending-movies',
  );

  expect(page.items[0]?.externalIds).toEqual({
    imdb: 'tt0137523',
  });
});

test('keeps cached episode metadata when a later catalog row is sparse', async () => {
  const catalogOnly: AddonStateRecord = {
    ...record,
    descriptor: {
      ...record.descriptor!,
      catalog: {
        catalogs: [{
          type: 'series',
          id: 'series',
          name: 'Series',
          extra: [],
        }],
      },
    },
  };
  let request = 0;
  const fetcher = jest.fn(async () => {
    request += 1;
    return response({
      metas: [{
        id: 'custom:show-42',
        type: 'series',
        name: 'Catalog-only Series',
        ...(request === 1 ? {
          videos: [{
            id: 'custom:show-42:1:1',
            season: 1,
            episode: 1,
            title: 'Pilot',
          }],
        } : {}),
      }],
    });
  });
  const gateway = new StremioCatalogGateway(catalogOnly, fetcher);

  const first = await gateway.browse(
    'series:stremio-com.nuvio.tmdb.catalogs:series',
  );
  const seriesId = first.items[0]!.id;
  await gateway.browse(
    'series:stremio-com.nuvio.tmdb.catalogs:series',
  );

  await expect(gateway.getDetails(seriesId)).resolves.toEqual(
    expect.objectContaining({
      seasonCount: 1,
      episodeCount: 1,
    }),
  );
  await expect(gateway.getSeason(seriesId, 1)).resolves.toEqual(
    expect.objectContaining({
      episodes: [
        expect.objectContaining({
          episodeNumber: 1,
          title: 'Pilot',
        }),
      ],
    }),
  );
});

test('keeps cached episodes when a later catalog row has only a partial video list', async () => {
  const catalogOnly: AddonStateRecord = {
    ...record,
    descriptor: {
      ...record.descriptor!,
      catalog: {
        catalogs: [{
          type: 'series',
          id: 'series',
          name: 'Series',
          extra: [],
        }],
      },
    },
  };
  let request = 0;
  const fetcher = jest.fn(async () => {
    request += 1;
    return response({
      metas: [{
        id: 'custom:show-42',
        type: 'series',
        name: 'Catalog-only Series',
        videos: request === 1
          ? [
            {
              id: 'custom:show-42:1:1',
              season: 1,
              episode: 1,
              title: 'Pilot',
              description: 'Original overview',
            },
            {
              id: 'custom:show-42:1:2',
              season: 1,
              episode: 2,
              title: 'Second',
            },
          ]
          : [
            {
              id: 'custom:show-42:1:1',
              season: 1,
              episode: 1,
              title: 'Pilot Updated',
            },
          ],
      }],
    });
  });
  const gateway = new StremioCatalogGateway(catalogOnly, fetcher);

  const first = await gateway.browse(
    'series:stremio-com.nuvio.tmdb.catalogs:series',
  );
  const seriesId = first.items[0]!.id;
  await gateway.browse(
    'series:stremio-com.nuvio.tmdb.catalogs:series',
  );

  await expect(gateway.getDetails(seriesId)).resolves.toEqual(
    expect.objectContaining({
      seasonCount: 1,
      episodeCount: 2,
    }),
  );
  await expect(gateway.getSeason(seriesId, 1)).resolves.toEqual(
    expect.objectContaining({
      episodes: [
        expect.objectContaining({
          id: 'custom:show-42:1:1',
          episodeNumber: 1,
          title: 'Pilot Updated',
          overview: 'Original overview',
        }),
        expect.objectContaining({
          id: 'custom:show-42:1:2',
          episodeNumber: 2,
          title: 'Second',
        }),
      ],
    }),
  );
});

test('keeps cached episodes when a later meta response is partial', async () => {
  let metaRequest = 0;
  const fetcher = jest.fn(async (url: string) => {
    if (!url.includes('/meta/series/')) {
      return response({ metas: [] });
    }
    metaRequest += 1;
    return response({
      meta: {
        id: 'tt0944947',
        type: 'series',
        name: 'Example Series',
        videos: metaRequest === 1
          ? [
            {
              id: 'tt0944947:1:1',
              season: 1,
              episode: 1,
              title: 'Pilot',
              description: 'Original overview',
            },
            {
              id: 'tt0944947:1:2',
              season: 1,
              episode: 2,
              title: 'Second',
            },
          ]
          : [
            {
              id: 'tt0944947:1:1',
              season: 1,
              episode: 1,
              title: 'Pilot Updated',
            },
          ],
      },
    });
  });
  const gateway = new StremioCatalogGateway(record, fetcher);
  const seriesId =
    'stremio-com.nuvio.tmdb.catalogs:series:tt0944947';

  await expect(gateway.getSeason(seriesId, 1)).resolves.toEqual(
    expect.objectContaining({
      episodes: [
        expect.objectContaining({
          episodeNumber: 1,
          title: 'Pilot',
        }),
        expect.objectContaining({
          episodeNumber: 2,
          title: 'Second',
        }),
      ],
    }),
  );

  await expect(gateway.getSeason(seriesId, 1)).resolves.toEqual(
    expect.objectContaining({
      episodes: [
        expect.objectContaining({
          episodeNumber: 1,
          title: 'Pilot Updated',
          overview: 'Original overview',
        }),
        expect.objectContaining({
          episodeNumber: 2,
          title: 'Second',
        }),
      ],
    }),
  );
});

test('uses catalog-provided videos for series browsing without a meta endpoint', async () => {
  const catalogOnly: AddonStateRecord = {
    ...record,
    descriptor: {
      ...record.descriptor!,
      catalog: {
        catalogs: [{
          type: 'series',
          id: 'series',
          name: 'Series',
          extra: [],
        }],
      },
    },
  };
  const fetcher = jest.fn(async () => response({
    metas: [{
      id: 'custom:show-42',
      type: 'series',
      name: 'Catalog-only Series',
      videos: [
        {
          id: 'custom:show-42:1:1',
          season: 1,
          episode: 1,
          title: 'Pilot',
        },
        {
          id: 'custom:show-42:1:2',
          season: 1,
          episode: 2,
          title: 'Second',
        },
      ],
    }],
  }));
  const gateway = new StremioCatalogGateway(
    catalogOnly,
    fetcher,
  );

  const page = await gateway.browse(
    'series:stremio-com.nuvio.tmdb.catalogs:series',
  );
  const seriesId = page.items[0]!.id;

  await expect(gateway.getDetails(seriesId)).resolves.toEqual(
    expect.objectContaining({
      id: seriesId,
      title: 'Catalog-only Series',
      seasonCount: 1,
      episodeCount: 2,
      seasons: [
        expect.objectContaining({
          seasonNumber: 1,
          episodeCount: 2,
        }),
      ],
    }),
  );
  await expect(gateway.getSeason(seriesId, 1)).resolves.toEqual(
    expect.objectContaining({
      seriesId,
      seasonNumber: 1,
      episodes: [
        expect.objectContaining({
          episodeNumber: 1,
          title: 'Pilot',
        }),
        expect.objectContaining({
          episodeNumber: 2,
          title: 'Second',
        }),
      ],
    }),
  );

  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('uses cached browse metadata when a catalog has no meta resource', async () => {
  const catalogOnly: AddonStateRecord = {
    ...record,
    descriptor: {
      ...record.descriptor!,
      catalog: {
        catalogs: [{
          type: 'movie',
          id: 'popular',
          name: 'Popular',
          extra: [],
        }],
      },
    },
  };
  const fetcher = jest.fn(async (url: string) => {
    if (url.includes('/catalog/')) {
      return response({
        metas: [{
          id: 'custom:42',
          type: 'movie',
          name: 'Catalog-only Movie',
          description: 'Cached description',
        }],
      });
    }
    throw new Error('meta endpoint should not be called');
  });
  const gateway = new StremioCatalogGateway(
    catalogOnly,
    fetcher,
  );

  const page = await gateway.browse(
    'movies:stremio-com.nuvio.tmdb.catalogs:popular',
  );
  const mediaId = page.items[0]?.id;
  expect(mediaId).toBeTruthy();

  await expect(gateway.getDetails(mediaId!)).resolves.toEqual(
    expect.objectContaining({
      id: mediaId,
      kind: 'movie',
      title: 'Catalog-only Movie',
      overview: 'Cached description',
    }),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('falls back to cached catalog metadata when the meta request fails', async () => {
  let metaRequests = 0;
  const fetcher = jest.fn(async (url: string) => {
    if (url.includes('/catalog/')) {
      return response({
        metas: [{
          id: 'tt0137523',
          type: 'movie',
          name: 'Fight Club',
        }],
      });
    }
    metaRequests += 1;
    throw new Error('provider temporarily unavailable');
  });
  const gateway = new StremioCatalogGateway(record, fetcher);

  const page = await gateway.browse(
    'movies:stremio-com.nuvio.tmdb.catalogs:trending-movies',
  );
  const mediaId = page.items[0]!.id;

  await expect(gateway.getDetails(mediaId)).resolves.toEqual(
    expect.objectContaining({
      id: mediaId,
      title: 'Fight Club',
      externalIds: { imdb: 'tt0137523' },
    }),
  );
  expect(metaRequests).toBe(1);
});

test('uses the web proxy override when supplied', async () => {
  const fetcher = jest.fn(async () => response({ metas: [] }));
  const gateway = new StremioCatalogGateway(record, fetcher, '/api/nuvio-catalog');

  await gateway.browse('movies:stremio-com.nuvio.tmdb.catalogs:trending-movies');

  expectCatalogRequest(
    fetcher,
    '/api/nuvio-catalog/catalog/movie/trending-movies.json',
  );
});


test('normalizes type-qualified TMDB catalog IDs to numeric external IDs', async () => {
  const fetcher = jest.fn(async () => response({
    metas: [
      {
        id: 'tmdb:movie:550',
        type: 'movie',
        name: 'Fight Club',
      },
      {
        id: 'tmdb:series:1399',
        type: 'series',
        name: 'Game of Thrones',
      },
    ],
  }));
  const gateway = new StremioCatalogGateway(record, fetcher);

  const movies = await gateway.browse(
    'movies:stremio-com.nuvio.tmdb.catalogs:trending-movies',
  );
  expect(movies.items[0]?.externalIds.tmdb).toBe('550');

  const series = await gateway.browse(
    'series:stremio-com.nuvio.tmdb.catalogs:trending-series',
  );
  expect(series.items[0]?.externalIds.tmdb).toBe('1399');
});


test('exposes Stremio season zero specials', async () => {
  const fetcher = jest.fn(async () => response({
    meta: {
      id: 'tmdb:series:1399',
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
  const gateway = new StremioCatalogGateway(record, fetcher);
  const seriesId =
    'stremio-com.nuvio.tmdb.catalogs:series:tmdb%3Aseries%3A1399';

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


test('drops signed Stremio poster, backdrop and episode still URLs', async () => {
  const fetcher = jest.fn(async () => response({
    meta: {
      id: 'tmdb:series:1399',
      type: 'series',
      name: 'Private Artwork Series',
      poster: 'https://img.example/poster.jpg?token=LOCAL-SECRET',
      background:
        'https://img.example/backdrop.jpg#signature=LOCAL-SECRET',
      videos: [{
        id: 'tmdb:series:1399:1:1',
        season: 1,
        episode: 1,
        title: 'Pilot',
        thumbnail:
          'https://img.example/still.jpg?session=LOCAL-SECRET',
      }],
    },
  }));
  const gateway = new StremioCatalogGateway(record, fetcher);
  const seriesId =
    'stremio-com.nuvio.tmdb.catalogs:series:tmdb%3Aseries%3A1399';

  const details = await gateway.getDetails(seriesId);
  const season = await gateway.getSeason(seriesId, 1);

  expect(details?.posterUrl).toBeUndefined();
  expect(details?.backdropUrl).toBeUndefined();
  expect(season?.episodes[0]?.stillUrl).toBeUndefined();
  expect(JSON.stringify({ details, season })).not.toContain('LOCAL-SECRET');
});

test('drops credentialized Stremio artwork path segments', async () => {
  const fetcher = jest.fn(async () => response({
    meta: {
      id: 'tmdb:series:1399',
      type: 'series',
      name: 'Path Credential Artwork',
      poster: 'https://img.example/token=LOCAL-SECRET/poster.jpg',
      background: 'https://img.example/api-key:LOCAL-SECRET/backdrop.jpg',
      videos: [{
        id: 'tmdb:series:1399:1:1',
        season: 1,
        episode: 1,
        title: 'Pilot',
        thumbnail: 'https://img.example/session=LOCAL-SECRET/still.jpg',
      }],
    },
  }));
  const gateway = new StremioCatalogGateway(record, fetcher);
  const seriesId =
    'stremio-com.nuvio.tmdb.catalogs:series:tmdb%3Aseries%3A1399';

  const details = await gateway.getDetails(seriesId);
  const season = await gateway.getSeason(seriesId, 1);

  expect(details?.posterUrl).toBeUndefined();
  expect(details?.backdropUrl).toBeUndefined();
  expect(season?.episodes[0]?.stillUrl).toBeUndefined();
  expect(JSON.stringify({ details, season })).not.toContain('LOCAL-SECRET');
});

test('bounds and sanitizes untrusted Stremio catalog payloads', async () => {
  const metas = Array.from({ length: 550 }, (_, index) => ({
    id: `tt${String(index + 1).padStart(7, '0')}`,
    type: 'movie',
    name: `Movie ${index}`,
    poster: 'javascript:alert(1)',
    genres: Array.from({ length: 150 }, (_, genre) => `Genre ${genre}`),
  }));
  const fetcher = jest.fn(async () => response({ metas }));
  const gateway = new StremioCatalogGateway(record, fetcher);

  const page = await gateway.browse(
    'movies:stremio-com.nuvio.tmdb.catalogs:trending-movies',
  );

  expect(page.items).toHaveLength(500);
  expect(page.items[0]?.posterUrl).toBeUndefined();
  expect(page.items[0]?.genres).toHaveLength(100);
});

test('bounds Stremio series videos and drops oversized episode fields', async () => {
  const videos = Array.from({ length: 1_100 }, (_, index) => ({
    id: `tt0944947:1:${index + 1}`,
    season: 1,
    episode: index + 1,
    title: index === 0 ? 'x'.repeat(501) : `Episode ${index + 1}`,
    thumbnail: index === 1 ? 'https://user:pass@example.com/e2.jpg' : undefined,
  }));
  const fetcher = jest.fn(async () => response({
    meta: {
      id: 'tmdb:series:1399',
      type: 'series',
      name: 'Game of Thrones',
      videos,
    },
  }));
  const gateway = new StremioCatalogGateway(record, fetcher);
  const seriesId =
    'stremio-com.nuvio.tmdb.catalogs:series:tmdb%3Aseries%3A1399';

  const season = await gateway.getSeason(seriesId, 1);

  expect(season?.episodes).toHaveLength(1_000);
  expect(season?.episodes.some((episode) => (
    episode.title.length > 500
  ))).toBe(false);
  expect(season?.episodes[0]?.stillUrl).toBeUndefined();
});


test('treats standard catalog extras case-insensitively', async () => {
  const looseExtraRecord: AddonStateRecord = {
    ...record,
    descriptor: {
      ...record.descriptor!,
      catalog: {
        ...record.descriptor!.catalog!,
        catalogs: [{
          type: 'movie',
          id: 'searchable',
          name: 'Searchable',
          extra: [
            { name: ' Search ', isRequired: false },
            { name: ' SKIP ', isRequired: false },
          ],
        }],
      },
    },
  };
  const fetcher = jest.fn(async () => response({ metas: [] }));
  const gateway = new StremioCatalogGateway(
    looseExtraRecord,
    fetcher,
  );

  await gateway.search(' Fight Club ', '25');

  expectCatalogRequest(
    fetcher,
    'https://catalog.nuvio.tv/catalog/movie/searchable/search=Fight%20Club&skip=25.json',
  );
});

test('drops blank or oversized direct catalog search queries', async () => {
  const fetcher = jest.fn(async () => response({ metas: [] }));
  const gateway = new StremioCatalogGateway(record, fetcher);

  await expect(gateway.search('   ')).resolves.toEqual({ items: [] });
  await expect(gateway.search('x'.repeat(501))).resolves.toEqual({
    items: [],
  });
  expect(fetcher).not.toHaveBeenCalled();
});

test('limits concurrent Stremio catalog search requests', async () => {
  const catalogs = Array.from({ length: 24 }, (_, index) => ({
    type: 'movie' as const,
    id: `search-${index}`,
    name: `Search ${index}`,
    extra: [{ name: 'search', isRequired: false }],
  }));
  const multiCatalogRecord: AddonStateRecord = {
    ...record,
    descriptor: {
      ...record.descriptor!,
      catalog: {
        ...record.descriptor!.catalog!,
        catalogs,
      },
    },
  };
  let active = 0;
  let maxActive = 0;
  const fetcher = jest.fn(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active -= 1;
    return response({ metas: [] });
  });
  const gateway = new StremioCatalogGateway(
    multiCatalogRecord,
    fetcher,
  );

  await gateway.search('movie');

  expect(fetcher).toHaveBeenCalledTimes(24);
  expect(maxActive).toBeLessThanOrEqual(8);
});

test('ignores malformed or oversized Stremio skip cursors', async () => {
  const fetcher = jest.fn(async (_url: string, _init: { method: 'GET'; redirect: 'follow'; cache: 'no-store'; signal?: unknown }) => response({ metas: [{
    id: 'tt0137523',
    type: 'movie',
    name: 'Fight Club',
  }] }));
  const gateway = new StremioCatalogGateway(record, fetcher);

  await gateway.browse(
    'movies:stremio-com.nuvio.tmdb.catalogs:trending-movies',
    '../secret',
  );
  expectCatalogRequest(
    fetcher,
    'https://catalog.nuvio.tv/catalog/movie/trending-movies.json',
  );

  fetcher.mockClear();
  await gateway.search('Fight Club', '9'.repeat(40));
  expect(fetcher.mock.calls.every(([url]) => (
    typeof url === 'string' && !url.includes('skip=')
  ))).toBe(true);
});

test('bounds Stremio multi-catalog search fanout and merged results', async () => {
  const catalogs = Array.from({ length: 60 }, (_, index) => ({
    type: 'movie' as const,
    id: `search-${index}`,
    name: `Search ${index}`,
    extra: [{ name: 'search', isRequired: false }],
  }));
  const multiCatalogRecord: AddonStateRecord = {
    ...record,
    descriptor: {
      ...record.descriptor!,
      catalog: {
        ...record.descriptor!.catalog!,
        catalogs,
      },
    },
  };
  const fetcher = jest.fn(async (url: string) => {
    const match = /\/catalog\/movie\/search-(\d+)\//.exec(url);
    const catalogIndex = Number(match?.[1] ?? 0);
    return response({
      metas: Array.from({ length: 30 }, (_, itemIndex) => ({
        id: `catalog-${catalogIndex}-item-${itemIndex}`,
        type: 'movie',
        name: `Movie ${catalogIndex}-${itemIndex}`,
      })),
    });
  });
  const gateway = new StremioCatalogGateway(
    multiCatalogRecord,
    fetcher,
  );

  const page = await gateway.search('movie');

  expect(fetcher).toHaveBeenCalledTimes(50);
  expect(page.items).toHaveLength(1_000);
});


test('returns a per-catalog next cursor for paged Stremio search', async () => {
  const pagedRecord: AddonStateRecord = {
    ...record,
    descriptor: {
      ...record.descriptor!,
      catalog: {
        ...record.descriptor!.catalog!,
        catalogs: [
          {
            type: 'movie',
            id: 'popular-movies',
            name: 'Popular Movies',
            extra: [
              { name: 'search', isRequired: false },
              { name: 'skip', isRequired: false },
            ],
          },
          {
            type: 'series',
            id: 'popular-series',
            name: 'Popular Series',
            extra: [
              { name: 'search', isRequired: false },
              { name: 'skip', isRequired: false },
            ],
          },
        ],
      },
    },
  };
  const fetcher = jest.fn(async (url: string) => (
    response({
      metas: url.includes('/movie/')
        ? [
          { id: 'movie-1', type: 'movie', name: 'Movie 1' },
          { id: 'movie-2', type: 'movie', name: 'Movie 2' },
        ]
        : [
          { id: 'series-1', type: 'series', name: 'Series 1' },
        ],
    })
  ));
  const gateway = new StremioCatalogGateway(pagedRecord, fetcher);

  const page = await gateway.search('popular', '20');

  expect(page.items).toHaveLength(3);
  expect(page.nextCursor).toBe('22');
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    'https://catalog.nuvio.tv/catalog/movie/popular-movies/search=popular&skip=20.json',
    'https://catalog.nuvio.tv/catalog/series/popular-series/search=popular&skip=20.json',
  ]);
});


test('exposes provider-declared genre options as browseable sections', async () => {
  const genreRecord: AddonStateRecord = {
    ...record,
    descriptor: {
      ...record.descriptor!,
      catalog: {
        ...record.descriptor!.catalog!,
        catalogs: record.descriptor!.catalog!.catalogs.map((catalog) => (
          catalog.id === 'trending-movies'
            ? {
                ...catalog,
                extra: [
                  ...catalog.extra,
                  {
                    name: 'genre',
                    isRequired: false,
                    options: ['Action', 'Comedy'],
                  },
                ],
              }
            : catalog
        )),
      },
    },
  };
  const fetcher = jest.fn(async () => response({
    metas: [{
      id: 'tt0137523',
      type: 'movie',
      name: 'Fight Club',
    }],
  }));
  const gateway = new StremioCatalogGateway(genreRecord, fetcher);

  const sections = await gateway.getSections();
  expect(sections).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'movies:stremio-com.nuvio.tmdb.catalogs:trending-movies:genre:Action',
      title: 'Trending Movies · Action',
      kinds: ['movie'],
    }),
    expect.objectContaining({
      id: 'movies:stremio-com.nuvio.tmdb.catalogs:trending-movies:genre:Comedy',
      title: 'Trending Movies · Comedy',
      kinds: ['movie'],
    }),
  ]));

  const page = await gateway.browse(
    'movies:stremio-com.nuvio.tmdb.catalogs:trending-movies:genre:Action',
    '20',
  );

  expect(page.items[0]?.title).toBe('Fight Club');
  expectCatalogRequest(
    fetcher,
    'https://catalog.nuvio.tv/catalog/movie/trending-movies/genre=Action&skip=20.json',
  );
  expect(page.nextCursor).toBe('21');
});

test('does not expose an invalid base row when genre is required', async () => {
  const requiredGenreRecord: AddonStateRecord = {
    ...record,
    descriptor: {
      ...record.descriptor!,
      catalog: {
        ...record.descriptor!.catalog!,
        catalogs: [{
          type: 'movie',
          id: 'genre-only',
          name: 'Genre Movies',
          extra: [
            {
              name: 'genre',
              isRequired: true,
              options: ['Action', 'Drama'],
            },
            { name: 'skip', isRequired: false },
          ],
        }],
      },
    },
  };
  const gateway = new StremioCatalogGateway(
    requiredGenreRecord,
    async () => response({ metas: [] }),
  );

  const sections = await gateway.getSections();

  expect(sections).not.toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'movies:stremio-com.nuvio.tmdb.catalogs:genre-only',
    }),
  ]));
  expect(sections).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'movies:stremio-com.nuvio.tmdb.catalogs:genre-only:genre:Action',
      title: 'Genre Movies · Action',
    }),
  ]));
});
