import type { WatchProgressRecord } from '@moviestv/sync';
import {
  AsyncStorageWatchProgressRepository,
  type KeyValueStorage,
} from '../AsyncStorageWatchProgressRepository';

class FakeStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();
  readonly getItemCalls: string[] = [];
  readonly setItemCalls: Array<{ key: string; value: string }> = [];

  async getItem(key: string): Promise<string | null> {
    this.getItemCalls.push(key);
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.setItemCalls.push({ key, value });
    this.values.set(key, value);
  }
}

function record(mediaId: string, updatedAt: string): WatchProgressRecord {
  return {
    mediaId,
    kind: 'movie',
    title: `Title ${mediaId}`,
    posterUrl: `https://images.example/${mediaId}.jpg`,
    year: 2026,
    positionSeconds: 120,
    durationSeconds: 3600,
    completed: false,
    updatedAt,
  };
}

describe('AsyncStorageWatchProgressRepository', () => {
  it('keeps guest progress isolated from each signed-in user', async () => {
    const repository = new AsyncStorageWatchProgressRepository(new FakeStorage());

    await repository.put({ type: 'guest' }, record('guest', '2026-09-18T10:00:00.000Z'));
    await repository.put({ type: 'user', userId: 'user-a' }, record('a', '2026-09-18T10:01:00.000Z'));
    await repository.put({ type: 'user', userId: 'user-b' }, record('b', '2026-09-18T10:02:00.000Z'));

    await expect(repository.list({ type: 'guest' })).resolves.toEqual([
      record('guest', '2026-09-18T10:00:00.000Z'),
    ]);
    await expect(repository.list({ type: 'user', userId: 'user-a' })).resolves.toEqual([
      record('a', '2026-09-18T10:01:00.000Z'),
    ]);
    await expect(repository.list({ type: 'user', userId: 'user-b' })).resolves.toEqual([
      record('b', '2026-09-18T10:02:00.000Z'),
    ]);
  });

  it('rejects empty user scopes before any storage call', async () => {
    for (const scope of [
      { type: 'user', userId: '' },
      { type: 'user', userId: '   ' },
    ] as const) {
      const storage = new FakeStorage();
      const repository = new AsyncStorageWatchProgressRepository(storage);
      const progress = record('movie', '2026-09-18T10:00:00.000Z');

      await expect(repository.list(scope)).rejects.toThrow('Invalid watch progress scope');
      await expect(repository.put(scope, progress)).rejects.toThrow('Invalid watch progress scope');
      await expect(repository.replaceAll(scope, [progress])).rejects.toThrow(
        'Invalid watch progress scope',
      );

      expect(storage.getItemCalls).toEqual([]);
      expect(storage.setItemCalls).toEqual([]);
    }
  });

  it('updates one media record while preserving the others', async () => {
    const repository = new AsyncStorageWatchProgressRepository(new FakeStorage());
    const scope = { type: 'guest' } as const;
    const first = record('first', '2026-09-18T10:00:00.000Z');
    const second = record('second', '2026-09-18T10:01:00.000Z');
    const updated = { ...first, positionSeconds: 240, updatedAt: '2026-09-18T10:02:00.000Z' };

    await repository.put(scope, first);
    await repository.put(scope, second);
    await repository.put(scope, updated);

    await expect(repository.list(scope)).resolves.toEqual([updated, second]);
  });

  it('collapses the same movie saved through different catalog media ids', async () => {
    const repository = new AsyncStorageWatchProgressRepository(
      new FakeStorage(),
    );
    const scope = { type: 'guest' } as const;
    const first: WatchProgressRecord = {
      ...record(
        'provider-a:movie:550',
        '2026-09-18T10:00:00.000Z',
      ),
      externalIds: { imdb: 'tt0137523', tmdb: '550' },
      positionSeconds: 600,
    };
    const second: WatchProgressRecord = {
      ...first,
      mediaId: 'provider-b:movie:550',
      title: 'Fight Club',
      positionSeconds: 1800,
      updatedAt: '2026-09-18T11:00:00.000Z',
    };

    await repository.put(scope, first);
    await repository.put(scope, second);

    await expect(repository.list(scope)).resolves.toEqual([
      expect.objectContaining({
        mediaId: 'provider-b:movie:550',
        title: 'Fight Club',
        positionSeconds: 1800,
        externalIds: {
          imdb: 'tt0137523',
          tmdb: '550',
        },
      }),
    ]);
  });

  it('lists records newest first', async () => {
    const repository = new AsyncStorageWatchProgressRepository(new FakeStorage());
    const scope = { type: 'guest' } as const;

    await repository.replaceAll(scope, [
      record('old', '2026-09-18T09:00:00.000Z'),
      record('new', '2026-09-18T11:00:00.000Z'),
    ]);

    await expect(repository.list(scope)).resolves.toEqual([
      record('new', '2026-09-18T11:00:00.000Z'),
      record('old', '2026-09-18T09:00:00.000Z'),
    ]);
  });

  it('treats corrupt stored JSON as an empty list', async () => {
    const storage = new FakeStorage();
    storage.values.set('watch-progress:guest', '{not json');
    const repository = new AsyncStorageWatchProgressRepository(storage);

    await expect(repository.list({ type: 'guest' })).resolves.toEqual([]);
  });

  it('drops oversized persisted watch history before JSON parsing', async () => {
    const storage = new FakeStorage();
    storage.values.set(
      'watch-progress:guest',
      'x'.repeat(16_777_217),
    );
    const repository = new AsyncStorageWatchProgressRepository(storage);

    await expect(repository.list({ type: 'guest' })).resolves.toEqual([]);
    expect(storage.values.get('watch-progress:guest')).toBe('[]');
  });

  it('filters invalid stored records individually', async () => {
    const storage = new FakeStorage();
    storage.values.set('watch-progress:guest', JSON.stringify([
      record('valid', '2026-09-18T10:00:00.000Z'),
      { ...record('bad-kind', '2026-09-18T10:01:00.000Z'), kind: 'series' },
      { ...record('bad-position', '2026-09-18T10:02:00.000Z'), positionSeconds: -1 },
      { ...record('bad-date', 'not a date'), updatedAt: 'not a date' },
    ]));
    const repository = new AsyncStorageWatchProgressRepository(storage);

    await expect(repository.list({ type: 'guest' })).resolves.toEqual([
      record('valid', '2026-09-18T10:00:00.000Z'),
    ]);
  });

  it('persists only the local progress whitelist', async () => {
    const storage = new FakeStorage();
    const repository = new AsyncStorageWatchProgressRepository(storage);
    const unsafeRecord = {
      ...record('movie', '2026-09-18T10:00:00.000Z'),
      url: 'https://stream.example/video.m3u8',
      headers: { Authorization: 'Bearer secret' },
      providerId: 'provider-a',
      restartRequested: true,
    };

    await repository.put({ type: 'guest' }, unsafeRecord);

    expect(JSON.parse(storage.values.get('watch-progress:guest') ?? '[]')).toEqual([
      record('movie', '2026-09-18T10:00:00.000Z'),
    ]);
  });
});


test('persists safe parent series identity for episode progress', async () => {
  const storage = new FakeStorage();
  const repository = new AsyncStorageWatchProgressRepository(storage);

  await repository.put({ type: 'guest' }, {
    mediaId: 'episode-2',
    kind: 'episode',
    title: 'Series · S1E2 · Episode 2',
    externalIds: { imdb: 'tt1234567' },
    seriesId: 'cinemeta:series:tt1234567',
    seasonNumber: 1,
    episodeNumber: 2,
    positionSeconds: 300,
    durationSeconds: 1800,
    completed: false,
    updatedAt: '2026-09-19T18:10:00.000Z',
  });

  await expect(repository.list({ type: 'guest' })).resolves.toEqual([
    expect.objectContaining({
      mediaId: 'episode-2',
      seriesId: 'cinemeta:series:tt1234567',
      seasonNumber: 1,
      episodeNumber: 2,
    }),
  ]);
});


test('normalizes stored watch progress strings and rejects unsafe artwork', async () => {
  const storage = new FakeStorage();
  const repository = new AsyncStorageWatchProgressRepository(storage);
  await repository.put({ type: 'guest' }, {
    mediaId: ' movie:1 ', kind: 'movie', title: ' Movie ', posterUrl: 'https://example.com/poster.jpg',
    positionSeconds: 20, durationSeconds: 100, completed: false, updatedAt: '2026-09-21T08:00:00.000Z',
  });
  expect((await repository.list({ type: 'guest' }))[0]).toMatchObject({ mediaId: 'movie:1', title: 'Movie' });
  await expect(repository.put({ type: 'guest' }, {
    mediaId: 'movie:2', kind: 'movie', title: 'Bad', posterUrl: 'http://example.com/poster.jpg',
    positionSeconds: 1, durationSeconds: 2, completed: false, updatedAt: '2026-09-21T08:00:00.000Z',
  })).rejects.toThrow();
});


test('persists season zero special watch progress locally', async () => {
  const storage = new FakeStorage();
  const repository = new AsyncStorageWatchProgressRepository(storage);
  const special: WatchProgressRecord = {
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
  };

  await repository.put({ type: 'guest' }, special);

  await expect(repository.list({ type: 'guest' })).resolves.toEqual([
    special,
  ]);
});


test('bounds persisted watch history to the newest 2000 valid records', async () => {
  const storage = new FakeStorage();
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  const records = Array.from({ length: 2005 }, (_, index) => (
    record(
      `movie-${index}`,
      new Date(base + index * 1000).toISOString(),
    )
  ));
  storage.values.set(
    'watch-progress:guest',
    JSON.stringify(records),
  );
  const repository = new AsyncStorageWatchProgressRepository(storage);

  const result = await repository.list({ type: 'guest' });

  expect(result).toHaveLength(2000);
  expect(result[0]?.mediaId).toBe('movie-2004');
  expect(result.some((item) => item.mediaId === 'movie-0')).toBe(false);
  expect(
    JSON.parse(storage.values.get('watch-progress:guest') ?? '[]'),
  ).toHaveLength(2000);
});

test('rejects watch progress metadata outside shared safety bounds', async () => {
  const repository = new AsyncStorageWatchProgressRepository(
    new FakeStorage(),
  );
  const scope = { type: 'guest' } as const;
  const valid = record(
    'movie',
    '2026-09-21T18:30:00.000Z',
  );

  await expect(repository.put(scope, {
    ...valid,
    mediaId: 'x'.repeat(513),
  })).rejects.toThrow(TypeError);

  await expect(repository.put(scope, {
    ...valid,
    title: 'x'.repeat(501),
  })).rejects.toThrow(TypeError);

  await expect(repository.put(scope, {
    ...valid,
    year: 1887,
  })).rejects.toThrow(TypeError);

  await expect(repository.put(scope, {
    ...valid,
    durationSeconds: 31_536_001,
  })).rejects.toThrow(TypeError);
});

test('normalizes whitespace around persisted watch timestamps', async () => {
  const storage = new FakeStorage();
  const repository = new AsyncStorageWatchProgressRepository(storage);

  await repository.put({ type: 'guest' }, {
    ...record('movie', '2026-09-21T18:30:00.000Z'),
    updatedAt: ' 2026-09-21T18:30:00.000Z ',
    resetAt: ' 2026-09-21T18:00:00.000Z ',
  });

  await expect(repository.list({ type: 'guest' })).resolves.toEqual([
    expect.objectContaining({
      updatedAt: '2026-09-21T18:30:00.000Z',
      resetAt: '2026-09-21T18:00:00.000Z',
    }),
  ]);
});


test('watch progress never persists credential-bearing or expanded artwork URLs', async () => {
  const repository = new AsyncStorageWatchProgressRepository(
    new FakeStorage(),
  );
  const scope = { type: 'guest' } as const;
  const valid = record(
    'movie',
    '2026-09-22T10:00:00.000Z',
  );

  await expect(repository.put(scope, {
    ...valid,
    posterUrl: 'https://images.example/poster.jpg?token=LOCAL-SECRET',
  })).rejects.toThrow(TypeError);

  await expect(repository.put(scope, {
    ...valid,
    posterUrl:
      'https://images.example/poster.jpg#signature=LOCAL-SECRET',
  })).rejects.toThrow(TypeError);

  await expect(repository.put(scope, {
    ...valid,
    posterUrl:
      'https://images.example/token=LOCAL-SECRET/poster.jpg',
  })).rejects.toThrow(TypeError);

  await expect(repository.put(scope, {
    ...valid,
    posterUrl: `https://images.example/${'é'.repeat(700)}.jpg`,
  })).rejects.toThrow(TypeError);
});
