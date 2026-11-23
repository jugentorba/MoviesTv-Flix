import {
  continueWatchingRecords,
  createProgressRecord,
  dedupeWatchProgressRecords,
  findWatchProgressRecord,
  isPlaybackCompleted,
  isPlaybackResumable,
  resolvePlaybackProgress,
  sameWatchProgressMedia,
  type WatchProgressRecord,
} from '../progress';

const movie = {
  mediaId: 'movie-1',
  kind: 'movie' as const,
  title: 'A Movie',
  year: 2026,
};

function record(overrides: Partial<WatchProgressRecord> = {}): WatchProgressRecord {
  return {
    ...movie,
    positionSeconds: 120,
    durationSeconds: 600,
    completed: false,
    updatedAt: '2026-09-18T10:00:00.000Z',
    ...overrides,
  };
}

describe('watch progress domain semantics', () => {
  it('recognizes explicit completion and the 90 percent threshold', () => {
    expect(isPlaybackCompleted(record({ positionSeconds: 539 }))).toBe(false);
    expect(isPlaybackCompleted(record({ positionSeconds: 540 }))).toBe(true);
    expect(isPlaybackCompleted(record({ completed: true, durationSeconds: 0 }))).toBe(true);
    expect(isPlaybackCompleted(record({ positionSeconds: 600, durationSeconds: Number.POSITIVE_INFINITY }))).toBe(false);
  });

  it('only resumes meaningful incomplete playback', () => {
    expect(isPlaybackResumable(record({ positionSeconds: 14 }))).toBe(false);
    expect(isPlaybackResumable(record({ positionSeconds: 15 }))).toBe(true);
    expect(isPlaybackResumable(record({ positionSeconds: 70, durationSeconds: 100 }))).toBe(true);
    expect(isPlaybackResumable(record({ positionSeconds: 71, durationSeconds: 100 }))).toBe(false);
    expect(isPlaybackResumable(record({ completed: true }))).toBe(false);
  });

  it('filters resumable records and orders them by most recent update', () => {
    const newest = record({ mediaId: 'newest', updatedAt: '2026-09-18T12:00:00.000Z' });
    const older = record({ mediaId: 'older', updatedAt: '2026-09-18T11:00:00.000Z' });
    const tooEarly = record({ mediaId: 'too-early', positionSeconds: 14 });

    expect(continueWatchingRecords([older, tooEarly, newest]).map(({ mediaId }) => mediaId)).toEqual([
      'newest',
      'older',
    ]);
  });

  it('creates a completion-normalized record from a movie snapshot', () => {
    expect(createProgressRecord(movie, 540, 600, '2026-09-18T10:00:00.000Z')).toMatchObject({
      ...movie,
      positionSeconds: 540,
      durationSeconds: 600,
      completed: true,
    });
  });

  it('prefers a newer reset epoch over an older high position', () => {
    const local = record({
      positionSeconds: 570,
      updatedAt: '2026-09-18T10:00:00.000Z',
      resetAt: '2026-09-18T09:00:00.000Z',
    });
    const remote = record({
      positionSeconds: 20,
      updatedAt: '2026-09-18T11:00:00.000Z',
      resetAt: '2026-09-18T10:30:00.000Z',
    });

    expect(resolvePlaybackProgress(local, remote)).toMatchObject({
      positionSeconds: 20,
      resetAt: '2026-09-18T10:30:00.000Z',
    });
  });

  it('normalizes completion for a threshold-complete winner of divergent reset epochs', () => {
    const local = record({
      positionSeconds: 100,
      resetAt: '2026-09-18T09:00:00.000Z',
    });
    const remote = record({
      positionSeconds: 540,
      durationSeconds: 600,
      completed: false,
      resetAt: '2026-09-18T10:30:00.000Z',
    });

    expect(resolvePlaybackProgress(local, remote)).toMatchObject({
      positionSeconds: 540,
      resetAt: '2026-09-18T10:30:00.000Z',
      completed: true,
    });
  });

  it('keeps position and completion sticky within the same reset epoch', () => {
    const local = record({
      positionSeconds: 480,
      completed: true,
      updatedAt: '2026-09-18T10:00:00.000Z',
      resetAt: '2026-09-18T09:00:00.000Z',
    });
    const remote = record({
      positionSeconds: 300,
      completed: false,
      title: 'Renamed Movie',
      updatedAt: '2026-09-18T11:00:00.000Z',
      resetAt: '2026-09-18T09:00:00.000Z',
    });

    expect(resolvePlaybackProgress(local, remote)).toMatchObject({
      positionSeconds: 480,
      completed: true,
      title: 'Renamed Movie',
    });
  });

  it('does not let legacy restart requests override a newer explicit reset', () => {
    const local = record({
      positionSeconds: 500,
      resetAt: '2026-09-18T10:30:00.000Z',
      updatedAt: '2026-09-18T11:00:00.000Z',
    });
    const remote = record({
      positionSeconds: 10,
      restartRequested: true,
      updatedAt: '2026-09-18T12:00:00.000Z',
    });

    expect(resolvePlaybackProgress(local, remote)).toMatchObject({
      positionSeconds: 500,
      resetAt: '2026-09-18T10:30:00.000Z',
    });
  });
});


it('creates resumable episode progress with the same completion semantics', () => {
  const episode = {
    mediaId: 'episode-1',
    kind: 'episode' as const,
    title: 'Series · S1E1 · Pilot',
    year: 2026,
  };
  const record = createProgressRecord(
    episode,
    120,
    1800,
    '2026-09-18T13:00:00.000Z',
  );

  expect(record).toMatchObject({
    ...episode,
    positionSeconds: 120,
    durationSeconds: 1800,
    completed: false,
  });
  expect(isPlaybackResumable(record)).toBe(true);
});


it('finds movie progress by stable external id when catalog media ids differ', () => {
  const record: WatchProgressRecord = {
    mediaId: 'cinemeta:movie:tt0137523',
    kind: 'movie',
    title: 'Fight Club',
    externalIds: { imdb: 'tt0137523', tmdb: '550' },
    positionSeconds: 1200,
    durationSeconds: 3600,
    completed: false,
    updatedAt: '2026-09-19T14:00:00.000Z',
  };

  expect(findWatchProgressRecord([record], {
    mediaId: 'stremio-provider:movie:tt0137523',
    kind: 'movie',
    title: 'Fight Club',
    externalIds: { imdb: 'tt0137523' },
  })).toBe(record);
});

it('matches catalog-native episode progress by series ID without external IDs', () => {
  const saved: WatchProgressRecord = {
    mediaId: 'custom:old-episode-id',
    kind: 'episode',
    title: 'Native Series · S1E2 · Episode',
    externalIds: {},
    seriesId: 'stremio-custom:series:custom%3Ashow-42',
    seasonNumber: 1,
    episodeNumber: 2,
    positionSeconds: 600,
    durationSeconds: 1800,
    completed: false,
    updatedAt: '2026-09-23T08:00:00.000Z',
  };

  expect(findWatchProgressRecord([saved], {
    mediaId: 'custom:new-episode-id',
    kind: 'episode',
    title: 'Episode',
    externalIds: {},
    seriesId: 'stremio-custom:series:custom%3Ashow-42',
    seasonNumber: 1,
    episodeNumber: 2,
  })).toBe(saved);

  expect(findWatchProgressRecord([saved], {
    mediaId: 'custom:other-episode-id',
    kind: 'episode',
    title: 'Other',
    externalIds: {},
    seriesId: 'stremio-custom:series:custom%3Ashow-42',
    seasonNumber: 1,
    episodeNumber: 3,
  })).toBeUndefined();

  expect(findWatchProgressRecord([saved], {
    mediaId: 'custom:new-episode-id',
    kind: 'episode',
    title: 'Wrong series',
    externalIds: {},
    seriesId: 'stremio-custom:series:custom%3Aother-show',
    seasonNumber: 1,
    episodeNumber: 2,
  })).toBeUndefined();
});

it('matches episode progress by series identity plus season and episode', () => {
  const record: WatchProgressRecord = {
    mediaId: 'provider-a:episode:old-id',
    kind: 'episode',
    title: 'Series · S2E3 · Episode',
    externalIds: { tmdb: '1399' },
    seasonNumber: 2,
    episodeNumber: 3,
    positionSeconds: 600,
    durationSeconds: 3000,
    completed: false,
    updatedAt: '2026-09-19T14:00:00.000Z',
  };

  expect(findWatchProgressRecord([record], {
    mediaId: 'provider-b:episode:new-id',
    kind: 'episode',
    title: 'Episode',
    externalIds: { tmdb: '1399' },
    seasonNumber: 2,
    episodeNumber: 3,
  })).toBe(record);

  expect(findWatchProgressRecord([record], {
    mediaId: 'provider-b:episode:other',
    kind: 'episode',
    title: 'Other episode',
    externalIds: { tmdb: '1399' },
    seasonNumber: 2,
    episodeNumber: 4,
  })).toBeUndefined();
});


it('resolves equal-timestamp progress ties deterministically regardless of argument order', () => {
  const first = record({
    mediaId: 'provider-a:movie:550',
    title: 'A title',
    externalIds: { tmdb: '550' },
    positionSeconds: 300,
  });
  const second = record({
    mediaId: 'provider-b:movie:550',
    title: 'B title',
    externalIds: { tmdb: '550' },
    positionSeconds: 900,
  });

  const leftFirst = resolvePlaybackProgress(first, second);
  const rightFirst = resolvePlaybackProgress(second, first);

  expect(leftFirst).toEqual(rightFirst);
  expect(leftFirst).toMatchObject({
    mediaId: 'provider-b:movie:550',
    title: 'B title',
    positionSeconds: 900,
  });
});

it('finds the same equal-timestamp canonical progress regardless of input order', () => {
  const first = record({
    mediaId: 'provider-a:movie:550',
    externalIds: { tmdb: '550' },
  });
  const second = record({
    mediaId: 'provider-b:movie:550',
    externalIds: { tmdb: '550' },
  });
  const media = {
    mediaId: 'provider-c:movie:550',
    kind: 'movie' as const,
    title: 'Movie',
    externalIds: { tmdb: '550' },
  };

  expect(findWatchProgressRecord([first, second], media)?.mediaId)
    .toBe('provider-b:movie:550');
  expect(findWatchProgressRecord([second, first], media)?.mediaId)
    .toBe('provider-b:movie:550');
});

it('deduplicates equal-timestamp aliases deterministically regardless of input order', () => {
  const first = record({
    mediaId: 'provider-a:movie:550',
    externalIds: { tmdb: '550' },
    positionSeconds: 300,
  });
  const second = record({
    mediaId: 'provider-b:movie:550',
    externalIds: { tmdb: '550' },
    positionSeconds: 900,
  });

  const forward = dedupeWatchProgressRecords([first, second]);
  const reverse = dedupeWatchProgressRecords([second, first]);

  expect(forward).toEqual(reverse);
  expect(forward[0]).toMatchObject({
    mediaId: 'provider-b:movie:550',
    positionSeconds: 900,
  });
});

it('deduplicates the same movie across catalog provider media ids', () => {
  const older: WatchProgressRecord = {
    mediaId: 'provider-a:movie:550',
    kind: 'movie',
    title: 'Fight Club',
    externalIds: { imdb: 'tt0137523', tmdb: '550' },
    positionSeconds: 600,
    durationSeconds: 3600,
    completed: false,
    updatedAt: '2026-09-19T12:00:00.000Z',
  };
  const newer: WatchProgressRecord = {
    ...older,
    mediaId: 'provider-b:movie:550',
    title: 'Fight Club (new metadata)',
    positionSeconds: 1800,
    updatedAt: '2026-09-19T14:00:00.000Z',
  };

  expect(dedupeWatchProgressRecords([older, newer])).toEqual([
    expect.objectContaining({
      mediaId: 'provider-b:movie:550',
      title: 'Fight Club (new metadata)',
      positionSeconds: 1800,
      externalIds: { imdb: 'tt0137523', tmdb: '550' },
    }),
  ]);
});

it('deduplicates transitively across imdb-only, bridge, and tmdb-only records', () => {
  const imdbOnly: WatchProgressRecord = {
    mediaId: 'provider-a:movie:fight-club',
    kind: 'movie',
    title: 'Fight Club',
    externalIds: { imdb: 'tt0137523' },
    positionSeconds: 600,
    durationSeconds: 3600,
    completed: false,
    updatedAt: '2026-09-19T12:00:00.000Z',
  };
  const bridge: WatchProgressRecord = {
    ...imdbOnly,
    mediaId: 'provider-b:movie:550',
    externalIds: { imdb: 'tt0137523', tmdb: '550' },
    positionSeconds: 1200,
    updatedAt: '2026-09-19T13:00:00.000Z',
  };
  const tmdbOnly: WatchProgressRecord = {
    ...imdbOnly,
    mediaId: 'provider-c:movie:550',
    externalIds: { tmdb: '550' },
    positionSeconds: 1800,
    updatedAt: '2026-09-19T14:00:00.000Z',
  };

  expect(dedupeWatchProgressRecords([
    imdbOnly,
    bridge,
    tmdbOnly,
  ])).toEqual([
    expect.objectContaining({
      mediaId: 'provider-c:movie:550',
      positionSeconds: 1800,
      externalIds: { imdb: 'tt0137523', tmdb: '550' },
    }),
  ]);
});

it('does not merge conflicting imdb identities even when tmdb happens to match', () => {
  const first: WatchProgressRecord = {
    mediaId: 'provider-a:movie:550',
    kind: 'movie',
    title: 'First',
    externalIds: { imdb: 'tt0000001', tmdb: '550' },
    positionSeconds: 600,
    durationSeconds: 3600,
    completed: false,
    updatedAt: '2026-09-19T12:00:00.000Z',
  };
  const second: WatchProgressRecord = {
    ...first,
    mediaId: 'provider-b:movie:550',
    title: 'Second',
    externalIds: { imdb: 'tt0000002', tmdb: '550' },
    updatedAt: '2026-09-19T13:00:00.000Z',
  };

  expect(dedupeWatchProgressRecords([first, second])).toHaveLength(2);
});

it('does not merge conflicting tmdb identities even when imdb happens to match', () => {
  const first: WatchProgressRecord = {
    mediaId: 'provider-a:movie:first',
    kind: 'movie',
    title: 'First',
    externalIds: { imdb: 'tt0137523', tmdb: '550' },
    positionSeconds: 600,
    durationSeconds: 3600,
    completed: false,
    updatedAt: '2026-09-19T12:00:00.000Z',
  };
  const second: WatchProgressRecord = {
    ...first,
    mediaId: 'provider-b:movie:second',
    title: 'Second',
    externalIds: { imdb: 'tt0137523', tmdb: '999' },
    updatedAt: '2026-09-19T13:00:00.000Z',
  };

  expect(dedupeWatchProgressRecords([first, second])).toHaveLength(2);
});

it('keeps different episodes separate even when they share series external ids', () => {
  const episodeOne: WatchProgressRecord = {
    mediaId: 'provider-a:episode:1',
    kind: 'episode',
    title: 'Series · S1E1',
    externalIds: { tmdb: '1399' },
    seasonNumber: 1,
    episodeNumber: 1,
    positionSeconds: 600,
    durationSeconds: 3000,
    completed: false,
    updatedAt: '2026-09-19T12:00:00.000Z',
  };
  const episodeTwo: WatchProgressRecord = {
    ...episodeOne,
    mediaId: 'provider-b:episode:2',
    title: 'Series · S1E2',
    episodeNumber: 2,
    updatedAt: '2026-09-19T13:00:00.000Z',
  };

  expect(dedupeWatchProgressRecords([
    episodeOne,
    episodeTwo,
  ])).toHaveLength(2);
});

it('continue watching shows one row for cross-provider duplicates', () => {
  const first: WatchProgressRecord = {
    mediaId: 'provider-a:movie:550',
    kind: 'movie',
    title: 'Fight Club',
    externalIds: { tmdb: '550' },
    positionSeconds: 600,
    durationSeconds: 3600,
    completed: false,
    updatedAt: '2026-09-19T12:00:00.000Z',
  };
  const second: WatchProgressRecord = {
    ...first,
    mediaId: 'provider-b:movie:550',
    positionSeconds: 1800,
    updatedAt: '2026-09-19T14:00:00.000Z',
  };

  expect(continueWatchingRecords([first, second])).toEqual([
    expect.objectContaining({
      mediaId: 'provider-b:movie:550',
      positionSeconds: 1800,
    }),
  ]);
});


it('prefers the newest matching progress record across catalog providers', () => {
  const older: WatchProgressRecord = {
    mediaId: 'provider-a:movie:550',
    kind: 'movie',
    title: 'Fight Club',
    externalIds: { tmdb: '550' },
    positionSeconds: 600,
    durationSeconds: 3600,
    completed: false,
    updatedAt: '2026-09-19T12:00:00.000Z',
  };
  const newer: WatchProgressRecord = {
    ...older,
    mediaId: 'provider-b:movie:550',
    positionSeconds: 1800,
    updatedAt: '2026-09-19T14:00:00.000Z',
  };

  expect(findWatchProgressRecord([older, newer], {
    mediaId: 'provider-c:movie:550',
    kind: 'movie',
    title: 'Fight Club',
    externalIds: { tmdb: '550' },
  })).toBe(newer);
});


test('normalizes media and external ids when matching progress', () => {
  const left = record({ mediaId: ' movie:1 ', externalIds: { imdb: ' TT123 ' } });
  const right = record({ mediaId: 'movie:1', externalIds: { imdb: 'tt123' } });
  expect(sameWatchProgressMedia(left, right)).toBe(true);
});

test('createProgressRecord normalizes invalid measurements', () => {
  const created = createProgressRecord(
    { mediaId: 'movie:1', kind: 'movie', title: 'Movie' },
    Number.NaN,
    -20,
    '2026-09-21T08:00:00.000Z',
  );
  expect(created.positionSeconds).toBe(0);
  expect(created.durationSeconds).toBe(0);
});
