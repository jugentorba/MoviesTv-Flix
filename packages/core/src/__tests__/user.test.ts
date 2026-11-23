import {
  completedFromProgress,
  defaultUserPreferences,
  MAX_MY_LIST_ITEMS,
  migrateUserPreferences,
  sameMyListMedia,
} from '../user';

test('defaults to independent system, audio, and subtitle preferences', () => {
  expect(defaultUserPreferences()).toEqual({
    appLocale: 'system',
    preferredAudioLanguages: ['en', 'fr', 'de'],
    preferredSubtitleLanguages: [],
    subtitlesEnabled: true,
    autoplay: true,
    favoriteChannelIds: [],
    myListItems: [],
  });
});

test('migrates the legacy language preference shape', () => {
  expect(migrateUserPreferences({
    audioLanguages: ['en', 'fr', 'de'],
    subtitleLanguage: 'auto',
    autoplay: false,
  })).toEqual({
    appLocale: 'system',
    preferredAudioLanguages: ['en', 'fr', 'de'],
    preferredSubtitleLanguages: [],
    subtitlesEnabled: true,
    autoplay: false,
    favoriteChannelIds: [],
    myListItems: [],
  });
});

test('normalizes and deduplicates ordered language preferences', () => {
  expect(migrateUserPreferences({
    appLocale: 'fr-CA',
    preferredAudioLanguages: ['FRE', 'en', 'fra', 'sq'],
    preferredSubtitleLanguages: ['alb', 'EN', 'sqi'],
    subtitlesEnabled: false,
    autoplay: true,
  })).toEqual({
    appLocale: 'fr-CA',
    preferredAudioLanguages: ['fr', 'en', 'sq'],
    preferredSubtitleLanguages: ['sq', 'en'],
    subtitlesEnabled: false,
    autoplay: true,
    favoriteChannelIds: [],
    myListItems: [],
  });
});

test('malformed persisted preferences safely fall back to defaults', () => {
  expect(migrateUserPreferences(null)).toEqual(defaultUserPreferences());
  expect(migrateUserPreferences({ preferredAudioLanguages: [null, 1] })).toEqual(defaultUserPreferences());
});

test('My List identity normalizes IMDb case and surrounding whitespace', () => {
  expect(sameMyListMedia(
    {
      mediaId: 'provider-a:movie:550',
      kind: 'movie',
      externalIds: { imdb: ' TT0137523 ' },
    },
    {
      mediaId: 'provider-b:movie:550',
      kind: 'movie',
      externalIds: { imdb: 'tt0137523' },
    },
  )).toBe(true);
});

test('My List identity matches the same title across catalog providers', () => {
  expect(sameMyListMedia(
    {
      mediaId: 'provider-a:movie:550',
      kind: 'movie',
      externalIds: { imdb: 'tt0137523', tmdb: '550' },
    },
    {
      mediaId: 'provider-b:movie:550',
      kind: 'movie',
      externalIds: { imdb: 'tt0137523', tmdb: '550' },
    },
  )).toBe(true);
});

test('My List identity rejects conflicting TMDB ids even when IMDb matches', () => {
  expect(sameMyListMedia(
    {
      mediaId: 'provider-a:movie:first',
      kind: 'movie',
      externalIds: { imdb: 'tt0137523', tmdb: '550' },
    },
    {
      mediaId: 'provider-b:movie:second',
      kind: 'movie',
      externalIds: { imdb: 'tt0137523', tmdb: '999' },
    },
  )).toBe(false);
});

test('My List migration collapses cross-provider duplicates while preserving the first snapshot', () => {
  expect(migrateUserPreferences({
    myListItems: [
      {
        mediaId: 'provider-a:movie:550',
        kind: 'movie',
        title: 'Fight Club',
        providerId: 'provider-a',
        externalIds: { imdb: 'tt0137523' },
        year: 1999,
      },
      {
        mediaId: 'provider-b:movie:550',
        kind: 'movie',
        title: 'Fight Club (alternate catalog)',
        providerId: 'provider-b',
        externalIds: { imdb: 'tt0137523', tmdb: '550' },
        posterUrl: 'https://image.example/fight-club.jpg',
      },
    ],
  }).myListItems).toEqual([
    expect.objectContaining({
      mediaId: 'provider-a:movie:550',
      title: 'Fight Club',
      providerId: 'provider-a',
      externalIds: { imdb: 'tt0137523', tmdb: '550' },
      posterUrl: 'https://image.example/fight-club.jpg',
      year: 1999,
    }),
  ]);
});

test('My List migration merges transitive external-id duplicates regardless of order', () => {
  expect(migrateUserPreferences({
    myListItems: [
      {
        mediaId: 'provider-imdb:movie:1',
        kind: 'movie',
        title: 'Fight Club',
        providerId: 'provider-imdb',
        externalIds: { imdb: 'tt0137523' },
      },
      {
        mediaId: 'provider-tmdb:movie:550',
        kind: 'movie',
        title: 'Fight Club',
        providerId: 'provider-tmdb',
        externalIds: { tmdb: '550' },
      },
      {
        mediaId: 'provider-bridge:movie:550',
        kind: 'movie',
        title: 'Fight Club',
        providerId: 'provider-bridge',
        externalIds: { imdb: 'tt0137523', tmdb: '550' },
      },
    ],
  }).myListItems).toEqual([
    expect.objectContaining({
      mediaId: 'provider-imdb:movie:1',
      providerId: 'provider-imdb',
      externalIds: {
        imdb: 'tt0137523',
        tmdb: '550',
      },
    }),
  ]);
});

test('progress at the completion threshold is complete', () => {
  expect(
    completedFromProgress({ positionMs: 9_000, durationMs: 10_000 }, 0.9),
  ).toBe(true);
});

test('invalid or empty duration is not complete', () => {
  expect(completedFromProgress({ positionMs: 1, durationMs: 0 })).toBe(false);
});


test('preserves an explicitly empty preferred audio list', () => {
  expect(migrateUserPreferences({
    preferredAudioLanguages: [],
  }).preferredAudioLanguages).toEqual([]);
});


test('normalizes My List snapshots, removes duplicates, and drops malformed items', () => {
  expect(migrateUserPreferences({
    myListItems: [
      {
        mediaId: 'movie:550',
        kind: 'movie',
        title: ' Fight Club ',
        providerId: ' cinemeta ',
        externalIds: { imdb: 'tt0137523', tmdb: '550' },
        year: 1999,
      },
      {
        mediaId: 'movie:550',
        kind: 'movie',
        title: 'Duplicate',
        providerId: 'cinemeta',
        externalIds: {},
      },
      {
        mediaId: '',
        kind: 'movie',
        title: 'Invalid',
        providerId: 'cinemeta',
        externalIds: {},
      },
    ],
  }).myListItems).toEqual([
    {
      mediaId: 'movie:550',
      kind: 'movie',
      title: 'Fight Club',
      providerId: 'cinemeta',
      externalIds: { imdb: 'tt0137523', tmdb: '550' },
      year: 1999,
    },
  ]);
});


test('caps My List at the same exported persistence limit', () => {
  const preferences = migrateUserPreferences({
    myListItems: Array.from(
      { length: MAX_MY_LIST_ITEMS + 5 },
      (_, index) => ({
        mediaId: `provider:movie:${index}`,
        kind: 'movie',
        title: `Movie ${index}`,
        providerId: 'provider',
        externalIds: { tmdb: String(index + 1) },
      }),
    ),
  });

  expect(preferences.myListItems).toHaveLength(MAX_MY_LIST_ITEMS);
  expect(preferences.myListItems.at(-1)?.mediaId)
    .toBe(`provider:movie:${MAX_MY_LIST_ITEMS - 1}`);
});

test('bounds language and favorite preference arrays', () => {
  const preferences = migrateUserPreferences({
    preferredAudioLanguages: Array.from(
      { length: 25 },
      (_, index) => index % 2 === 0 ? 'en' : `x-${index}`,
    ),
    favoriteChannelIds: Array.from(
      { length: 1_005 },
      (_, index) => `channel-${index}`,
    ),
  });

  expect(preferences.preferredAudioLanguages.length)
    .toBeLessThanOrEqual(20);
  expect(preferences.favoriteChannelIds).toHaveLength(1_000);
  expect(preferences.favoriteChannelIds.at(-1)).toBe('channel-999');
});

test('drops unsafe My List artwork and malformed text metadata', () => {
  const preferences = migrateUserPreferences({
    myListItems: [
      {
        mediaId: 'movie:550',
        kind: 'movie',
        title: 'Fight Club',
        providerId: 'cinemeta',
        externalIds: { imdb: 'tt0137523' },
        posterUrl: 'javascript:alert(1)',
        backdropUrl: 'https://user:pass@images.example/backdrop.jpg',
      },
      {
        mediaId: 'movie:bad',
        kind: 'movie',
        title: 'Bad\u0000Title',
        providerId: 'cinemeta',
        externalIds: {},
      },
    ],
  });

  expect(preferences.myListItems).toEqual([
    {
      mediaId: 'movie:550',
      kind: 'movie',
      title: 'Fight Club',
      providerId: 'cinemeta',
      externalIds: { imdb: 'tt0137523' },
    },
  ]);
});

test('caps My List snapshots at 200 items', () => {
  const preferences = migrateUserPreferences({
    myListItems: Array.from({ length: 250 }, (_, index) => ({
      mediaId: `movie:${index}`,
      kind: 'movie',
      title: `Movie ${index}`,
      providerId: 'catalog',
      externalIds: { tmdb: String(index + 1) },
    })),
  });

  expect(preferences.myListItems).toHaveLength(200);
  expect(preferences.myListItems.at(-1)?.mediaId).toBe('movie:199');
});


test('My List drops credential-bearing artwork URL fragments', () => {
  const preferences = migrateUserPreferences({
    myListItems: [{
      mediaId: 'movie:1',
      kind: 'movie',
      title: 'Movie',
      providerId: 'catalog',
      externalIds: { tmdb: '1' },
      posterUrl:
        'https://images.example/poster.jpg#signature=LOCAL-SECRET',
      backdropUrl:
        'https://images.example/backdrop.jpg#auth=LOCAL-SECRET',
    }],
  });

  expect(preferences.myListItems).toEqual([{
    mediaId: 'movie:1',
    kind: 'movie',
    title: 'Movie',
    providerId: 'catalog',
    externalIds: { tmdb: '1' },
  }]);
});

test('My List drops credential-bearing artwork path segments', () => {
  const preferences = migrateUserPreferences({
    myListItems: [
      {
        mediaId: 'movie:1',
        kind: 'movie',
        title: 'Movie',
        providerId: 'catalog',
        externalIds: { tmdb: '1' },
        posterUrl:
          'https://images.example/token=LOCAL-SECRET/poster.jpg',
        backdropUrl:
          'https://images.example/secret-garden/backdrop.jpg',
      },
    ],
  });

  expect(preferences.myListItems[0]?.posterUrl).toBeUndefined();
  expect(preferences.myListItems[0]?.backdropUrl).toBe(
    'https://images.example/secret-garden/backdrop.jpg',
  );
});

test('My List never persists credential-bearing or normalization-expanded artwork URLs', () => {
  const preferences = migrateUserPreferences({
    myListItems: [
      {
        mediaId: 'movie:1',
        kind: 'movie',
        title: 'Movie',
        providerId: 'catalog',
        externalIds: { tmdb: '1' },
        posterUrl: 'https://images.example/poster.jpg?token=LOCAL-SECRET',
        backdropUrl: `https://images.example/${'é'.repeat(700)}.jpg`,
      },
    ],
  });

  expect(preferences.myListItems).toEqual([
    {
      mediaId: 'movie:1',
      kind: 'movie',
      title: 'Movie',
      providerId: 'catalog',
      externalIds: { tmdb: '1' },
    },
  ]);
});
