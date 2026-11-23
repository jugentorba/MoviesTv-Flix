import type { WatchProgressRecord } from '@moviestv/sync';
import { SupabaseWatchProgressGateway } from '../SupabaseWatchProgressGateway';

const selectedFields =
  'media_id,kind,title,poster_url,release_year,imdb_id,tmdb_id,series_id,season_number,episode_number,position_seconds,duration_seconds,completed,reset_at,updated_at';

const record: WatchProgressRecord = {
  mediaId: 'movie-42',
  kind: 'movie',
  title: 'A Movie',
  posterUrl: 'https://image.example/poster.jpg',
  year: 2024,
  positionSeconds: 120,
  durationSeconds: 7200,
  completed: false,
  resetAt: '2026-09-18T11:00:00.000Z',
  updatedAt: '2026-09-18T12:00:00.000Z',
};

function mockListOrder(load: () => Promise<{ data: unknown; error: unknown }>) {
  const order: jest.Mock = jest.fn(() => ({
    order,
    range: async (from: number, to: number) => {
      const response = await load();
      return {
        ...response,
        data: Array.isArray(response.data)
          ? response.data.slice(from, to + 1)
          : response.data,
      };
    },
  }));
  return order;
}

describe('SupabaseWatchProgressGateway', () => {
  it('selects an explicit whitelist scoped to the current user and maps valid movie rows', async () => {
    const order = mockListOrder(async () => ({ data: [{
      media_id: 'movie-42',
      kind: 'movie',
      title: 'A Movie',
      poster_url: 'https://image.example/poster.jpg',
      release_year: 2024,
      imdb_id: null,
      tmdb_id: null,
      series_id: null,
      season_number: null,
      episode_number: null,
      position_seconds: 120,
      duration_seconds: 7200,
      completed: false,
      reset_at: '2026-09-18T11:00:00.000Z',
      updated_at: '2026-09-18T12:00:00.000Z',
    }], error: null }));
    const eq = jest.fn(() => ({ order }));
    const select = jest.fn(() => ({ eq }));
    const client = { from: jest.fn(() => ({ select })) };
    const gateway = new SupabaseWatchProgressGateway(client as never);

    await expect(gateway.list('user-1')).resolves.toEqual([record]);

    expect(client.from).toHaveBeenCalledWith('user_watch_progress');
    expect(select).toHaveBeenCalledWith(selectedFields);
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(order).toHaveBeenCalledWith('updated_at', { ascending: false });
  });

  it('canonicalizes uppercase IMDb IDs while reading synchronized progress', async () => {
    const order = mockListOrder(async () => ({ data: [{
      media_id: 'movie-44',
      kind: 'movie',
      title: 'Fight Club',
      poster_url: null,
      release_year: 1999,
      imdb_id: ' TT0137523 ',
      tmdb_id: '550',
      series_id: null,
      season_number: null,
      episode_number: null,
      position_seconds: 120,
      duration_seconds: 7200,
      completed: false,
      reset_at: null,
      updated_at: '2026-09-23T09:00:00.000Z',
    }], error: null }));
    const client = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({ order })),
        })),
      })),
    };
    const gateway = new SupabaseWatchProgressGateway(client as never);

    await expect(gateway.list('user-1')).resolves.toEqual([
      expect.objectContaining({
        mediaId: 'movie-44',
        externalIds: {
          imdb: 'tt0137523',
          tmdb: '550',
        },
      }),
    ]);
  });

  it('maps database nulls to omitted optional domain properties', async () => {
    const order = mockListOrder(async () => ({ data: [{
      media_id: 'movie-43',
      kind: 'movie',
      title: 'No optional metadata',
      poster_url: null,
      release_year: null,
      imdb_id: null,
      tmdb_id: null,
      series_id: null,
      season_number: null,
      episode_number: null,
      position_seconds: 1,
      duration_seconds: 2,
      completed: false,
      reset_at: null,
      updated_at: '2026-09-18T12:01:00.000Z',
    }], error: null }));
    const client = { from: jest.fn(() => ({ select: jest.fn(() => ({ eq: jest.fn(() => ({ order })) })) })) };
    const gateway = new SupabaseWatchProgressGateway(client as never);

    await expect(gateway.list('user-1')).resolves.toEqual([{
      mediaId: 'movie-43',
      kind: 'movie',
      title: 'No optional metadata',
      positionSeconds: 1,
      durationSeconds: 2,
      completed: false,
      updatedAt: '2026-09-18T12:01:00.000Z',
    }]);
  });

  it('accepts movie and episode rows while ignoring malformed kinds', async () => {
    const good = {
      media_id: 'movie-44', kind: 'movie', title: 'Good', poster_url: null, release_year: null,
      position_seconds: 1, duration_seconds: 2, completed: false, reset_at: null, updated_at: '2026-09-18T12:01:00.000Z',
    };
    const order = mockListOrder(async () => ({ data: [
      { ...good, media_id: '  ' },
      { ...good, kind: 'series' },
      { ...good, media_id: 'episode-1', kind: 'episode', title: 'Episode 1' },
      { ...good, title: '  ' },
      { ...good, poster_url: '  ' },
      { ...good, release_year: 1887 },
      { ...good, release_year: 3001 },
      { ...good, release_year: 2024.5 },
      { ...good, reset_at: 'not-a-date' },
      { ...good, updated_at: 'not-a-date' },
      { ...good, position_seconds: -1 },
      good,
    ], error: null }));
    const client = { from: jest.fn(() => ({ select: jest.fn(() => ({ eq: jest.fn(() => ({ order })) })) })) };
    const gateway = new SupabaseWatchProgressGateway(client as never);

    await expect(gateway.list('user-1')).resolves.toEqual([
      {
        mediaId: 'episode-1',
        kind: 'episode',
        title: 'Episode 1',
        positionSeconds: 1,
        durationSeconds: 2,
        completed: false,
        updatedAt: '2026-09-18T12:01:00.000Z',
      },
      {
        mediaId: 'movie-44',
        kind: 'movie',
        title: 'Good',
        positionSeconds: 1,
        durationSeconds: 2,
        completed: false,
        updatedAt: '2026-09-18T12:01:00.000Z',
      },
    ]);
  });

  it('upserts only whitelisted fields using the composite conflict target', async () => {
    const upsert = jest.fn(async (_payload: unknown, _options: unknown) => ({ error: null }));
    const client = { from: jest.fn(() => ({ upsert })) };
    const gateway = new SupabaseWatchProgressGateway(client as never);

    await gateway.upsert('user-1', {
      ...record,
      providerId: 'do-not-sync',
      url: 'https://provider.example/stream',
      headers: { Authorization: 'secret' },
      restartRequested: true,
    } as WatchProgressRecord);

    expect(upsert).toHaveBeenCalledWith({
      user_id: 'user-1',
      media_id: 'movie-42',
      kind: 'movie',
      title: 'A Movie',
      poster_url: 'https://image.example/poster.jpg',
      release_year: 2024,
      imdb_id: null,
      tmdb_id: null,
      series_id: null,
      season_number: null,
      episode_number: null,
      position_seconds: 120,
      duration_seconds: 7200,
      completed: false,
      reset_at: '2026-09-18T11:00:00.000Z',
      updated_at: '2026-09-18T12:00:00.000Z',
    }, { onConflict: 'user_id,media_id' });
    expect(JSON.stringify(upsert.mock.calls[0]?.[0])).not.toMatch(/do-not-sync|provider|Authorization|restartRequested/);
  });

  it('writes missing optional domain fields as database nulls', async () => {
    const upsert = jest.fn(async (_payload: unknown) => ({ error: null }));
    const gateway = new SupabaseWatchProgressGateway({ from: jest.fn(() => ({ upsert })) } as never);

    await gateway.upsert('user-1', {
      mediaId: 'movie-43',
      kind: 'movie',
      title: 'No optional metadata',
      positionSeconds: 0,
      durationSeconds: 2,
      completed: false,
      updatedAt: '2026-09-18T12:01:00.000Z',
    });

    expect(upsert.mock.calls[0]?.[0]).toMatchObject({
      poster_url: null,
      release_year: null,
      series_id: null,
      reset_at: null,
    });
  });

  it('conditionally removes an old watch-progress alias by fetched timestamp', async () => {
    const select = jest.fn(async () => ({
      data: [{ media_id: 'provider-b:movie:550' }],
      error: null,
    }));
    const lte = jest.fn(() => ({ select }));
    const secondEq = jest.fn(() => ({ lte }));
    const firstEq = jest.fn(() => ({ eq: secondEq }));
    const remove = jest.fn(() => ({ eq: firstEq }));
    const gateway = new SupabaseWatchProgressGateway({
      from: jest.fn(() => ({ delete: remove })),
    } as never);

    await expect(gateway.remove(
      'user-1',
      'provider-b:movie:550',
      '2026-09-18T13:00:00.000Z',
    )).resolves.toBe(true);

    expect(firstEq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(secondEq).toHaveBeenCalledWith(
      'media_id',
      'provider-b:movie:550',
    );
    expect(lte).toHaveBeenCalledWith(
      'updated_at',
      '2026-09-18T13:00:00.000Z',
    );
    expect(select).toHaveBeenCalledWith('media_id');
  });

  it('preserves a watch-progress alias when another device updated it after fetch', async () => {
    const select = jest.fn(async () => ({
      data: [],
      error: null,
    }));
    const lte = jest.fn(() => ({ select }));
    const secondEq = jest.fn(() => ({ lte }));
    const firstEq = jest.fn(() => ({ eq: secondEq }));
    const remove = jest.fn(() => ({ eq: firstEq }));
    const gateway = new SupabaseWatchProgressGateway({
      from: jest.fn(() => ({ delete: remove })),
    } as never);

    await expect(gateway.remove(
      'user-1',
      'provider-b:movie:550',
      '2026-09-18T13:00:00.000Z',
    )).resolves.toBe(false);
  });

  it('throws Supabase errors', async () => {
    const listClient = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            order: mockListOrder(async () => ({ data: null, error: { message: 'cannot read' } })),
          })),
        })),
      })),
    };
    const upsertClient = { from: jest.fn(() => ({ upsert: jest.fn(async () => ({ error: { message: 'cannot write' } })) })) };

    await expect(new SupabaseWatchProgressGateway(listClient as never).list('user-1')).rejects.toThrow('cannot read');
    await expect(new SupabaseWatchProgressGateway(upsertClient as never).upsert('user-1', record)).rejects.toThrow('cannot write');
  });

  it('rejects an empty user id before querying Supabase', async () => {
    const client = { from: jest.fn() };
    const gateway = new SupabaseWatchProgressGateway(client as never);

    await expect(gateway.list('')).rejects.toThrow('userId is invalid');
    await expect(gateway.upsert('  ', record)).rejects.toThrow('userId is invalid');
    expect(client.from).not.toHaveBeenCalled();
  });
});


  it('round-trips parent series identity for episode progress', async () => {
    const order = mockListOrder(async () => ({ data: [{
      media_id: 'episode-2',
      kind: 'episode',
      title: 'Series · S1E2 · Episode 2',
      poster_url: null,
      release_year: 2026,
      imdb_id: 'tt1234567',
      tmdb_id: '100',
      series_id: 'cinemeta:series:tt1234567',
      season_number: 1,
      episode_number: 2,
      position_seconds: 300,
      duration_seconds: 1800,
      completed: false,
      reset_at: null,
      updated_at: '2026-09-19T18:10:00.000Z',
    }], error: null }));
    const client = { from: jest.fn(() => ({ select: jest.fn(() => ({ eq: jest.fn(() => ({ order })) })) })) };
    const gateway = new SupabaseWatchProgressGateway(client as never);

    await expect(gateway.list('user-1')).resolves.toEqual([{
      mediaId: 'episode-2',
      kind: 'episode',
      title: 'Series · S1E2 · Episode 2',
      year: 2026,
      externalIds: { imdb: 'tt1234567', tmdb: '100' },
      seriesId: 'cinemeta:series:tt1234567',
      seasonNumber: 1,
      episodeNumber: 2,
      positionSeconds: 300,
      durationSeconds: 1800,
      completed: false,
      updatedAt: '2026-09-19T18:10:00.000Z',
    }]);
  });


test('round-trips catalog-native episode progress without external IDs', async () => {
  const order = mockListOrder(async () => ({ data: [{
    media_id: 'custom:episode:1',
    kind: 'episode',
    title: 'Native Series · S1E1 · Pilot',
    poster_url: null,
    release_year: null,
    imdb_id: null,
    tmdb_id: null,
    series_id: 'stremio-custom:series:custom%3Ashow-42',
    season_number: 1,
    episode_number: 1,
    position_seconds: 300,
    duration_seconds: 1800,
    completed: false,
    reset_at: null,
    updated_at: '2026-09-23T08:00:00.000Z',
  }], error: null }));
  const listGateway = new SupabaseWatchProgressGateway({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ order })),
      })),
    })),
  } as never);

  await expect(listGateway.list('user-1')).resolves.toEqual([{
    mediaId: 'custom:episode:1',
    kind: 'episode',
    title: 'Native Series · S1E1 · Pilot',
    seriesId: 'stremio-custom:series:custom%3Ashow-42',
    seasonNumber: 1,
    episodeNumber: 1,
    positionSeconds: 300,
    durationSeconds: 1800,
    completed: false,
    updatedAt: '2026-09-23T08:00:00.000Z',
  }]);

  const upsert = jest.fn(async () => ({ error: null }));
  const writeGateway = new SupabaseWatchProgressGateway({
    from: jest.fn(() => ({ upsert })),
  } as never);

  await writeGateway.upsert('user-1', {
    mediaId: 'custom:episode:1',
    kind: 'episode',
    title: 'Native Series · S1E1 · Pilot',
    externalIds: {},
    seriesId: 'stremio-custom:series:custom%3Ashow-42',
    seasonNumber: 1,
    episodeNumber: 1,
    positionSeconds: 300,
    durationSeconds: 1800,
    completed: false,
    updatedAt: '2026-09-23T08:00:00.000Z',
  });

  expect(upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      imdb_id: null,
      tmdb_id: null,
      series_id: 'stremio-custom:series:custom%3Ashow-42',
      season_number: 1,
      episode_number: 1,
    }),
    { onConflict: 'user_id,media_id' },
  );
});

test('round-trips season zero special watch progress through Supabase', async () => {
  const order = mockListOrder(async () => ({ data: [{
    media_id: 'episode-special-1',
    kind: 'episode',
    title: 'Series · S0E1 · Special One',
    poster_url: null,
    release_year: null,
    imdb_id: 'tt1234567',
    tmdb_id: null,
    series_id: 'cinemeta:series:tt1234567',
    season_number: 0,
    episode_number: 1,
    position_seconds: 120,
    duration_seconds: 1800,
    completed: false,
    reset_at: null,
    updated_at: '2026-09-21T16:30:00.000Z',
  }], error: null }));
  const listClient = {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ order })),
      })),
    })),
  };
  const gateway = new SupabaseWatchProgressGateway(listClient as never);

  await expect(gateway.list('user-1')).resolves.toEqual([{
    mediaId: 'episode-special-1',
    kind: 'episode',
    title: 'Series · S0E1 · Special One',
    externalIds: { imdb: 'tt1234567' },
    seriesId: 'cinemeta:series:tt1234567',
    seasonNumber: 0,
    episodeNumber: 1,
    positionSeconds: 120,
    durationSeconds: 1800,
    completed: false,
    updatedAt: '2026-09-21T16:30:00.000Z',
  }]);

  const upsert = jest.fn(async () => ({ error: null }));
  const writeGateway = new SupabaseWatchProgressGateway({
    from: jest.fn(() => ({ upsert })),
  } as never);
  await writeGateway.upsert('user-1', {
    mediaId: 'episode-special-1',
    kind: 'episode',
    title: 'Series · S0E1 · Special One',
    externalIds: { imdb: 'tt1234567' },
    seriesId: 'cinemeta:series:tt1234567',
    seasonNumber: 0,
    episodeNumber: 1,
    positionSeconds: 120,
    durationSeconds: 1800,
    completed: false,
    updatedAt: '2026-09-21T16:30:00.000Z',
  });

  expect(upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      season_number: 0,
      episode_number: 1,
    }),
    { onConflict: 'user_id,media_id' },
  );
});


test('ignores malformed cloud history rows and bounds the result set', async () => {
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  const rows = Array.from({ length: 2005 }, (_, index) => ({
    media_id: `movie-${index}`,
    kind: 'movie',
    title: `Movie ${index}`,
    poster_url: null,
    release_year: 2026,
    imdb_id: null,
    tmdb_id: null,
    series_id: null,
    season_number: null,
    episode_number: null,
    position_seconds: index,
    duration_seconds: 7200,
    completed: false,
    reset_at: null,
    updated_at: new Date(base + index * 1000).toISOString(),
  }));
  rows[0] = null as any;

  const order = mockListOrder(async () => ({ data: rows, error: null }));
  const gateway = new SupabaseWatchProgressGateway({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ order })),
      })),
    })),
  } as never);

  const result = await gateway.list('user-1');

  expect(result).toHaveLength(1999);
  expect(result.some((item) => item.mediaId === 'movie-1999'))
    .toBe(true);
  expect(result.some((item) => item.mediaId === 'movie-2000'))
    .toBe(false);
});

test('drops malformed percent-encoded poster fragments without throwing', async () => {
  const order = mockListOrder(async () => ({ data: [{
    media_id: 'movie-bad-poster',
    kind: 'movie',
    title: 'Bad Poster',
    poster_url: 'https://image.example/poster.jpg#token=%E0%A4%A',
    release_year: 2026,
    imdb_id: null,
    tmdb_id: null,
    series_id: null,
    season_number: null,
    episode_number: null,
    position_seconds: 120,
    duration_seconds: 7200,
    completed: false,
    reset_at: null,
    updated_at: '2026-09-23T08:00:00.000Z',
  }], error: null }));
  const gateway = new SupabaseWatchProgressGateway({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ order })),
      })),
    })),
  } as never);

  await expect(gateway.list('user-1')).resolves.toEqual([]);
});

test('rejects unsafe watch history writes before querying Supabase', async () => {
  const from = jest.fn();
  const gateway = new SupabaseWatchProgressGateway({ from } as never);

  await expect(gateway.upsert('user-1', {
    ...record,
    title: 'x'.repeat(501),
  })).rejects.toThrow('Invalid watch progress record');

  await expect(gateway.upsert('user-1', {
    ...record,
    posterUrl: 'http://images.example/poster.jpg',
  })).rejects.toThrow('Invalid watch progress record');

  await expect(gateway.upsert('user-1', {
    ...record,
    durationSeconds: 31_536_001,
  })).rejects.toThrow('Invalid watch progress record');

  expect(from).not.toHaveBeenCalled();
});

test('validates watch history removal identity and timestamp before delete', async () => {
  const from = jest.fn();
  const gateway = new SupabaseWatchProgressGateway({ from } as never);

  await expect(gateway.remove(
    'user-1',
    'x'.repeat(513),
  )).rejects.toThrow('mediaId is invalid');

  await expect(gateway.remove(
    'user-1',
    'movie-42',
    'not-a-date',
  )).rejects.toThrow('removal timestamp is invalid');

  expect(from).not.toHaveBeenCalled();
});


test('times out stalled watch progress cloud list requests', async () => {
  const order = mockListOrder(() => new Promise(() => undefined));
  const gateway = new SupabaseWatchProgressGateway({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ order })),
      })),
    })),
  } as never, 2);

  await expect(gateway.list('user-1'))
    .rejects.toThrow('Watch progress synchronization timed out');
});

test('times out stalled watch progress cloud upserts', async () => {
  const upsert = jest.fn(() => new Promise(() => undefined));
  const gateway = new SupabaseWatchProgressGateway({
    from: jest.fn(() => ({ upsert })),
  } as never, 2);

  await expect(
    gateway.upsert('user-1', record),
  ).rejects.toThrow('Watch progress synchronization timed out');
});

test('times out stalled watch progress cloud removals', async () => {
  const secondEq = jest.fn(() => new Promise(() => undefined));
  const firstEq = jest.fn(() => ({ eq: secondEq }));
  const remove = jest.fn(() => ({ eq: firstEq }));
  const gateway = new SupabaseWatchProgressGateway({
    from: jest.fn(() => ({ delete: remove })),
  } as never, 2);

  await expect(
    gateway.remove('user-1', record.mediaId),
  ).rejects.toThrow('Watch progress synchronization timed out');
});
