import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabasePreferenceRemoteStore } from '../SupabasePreferenceRemoteStore';

const row = {
  user_id: 'u1',
  app_locale: 'fr',
  app_locale_updated_at: '2026-09-15T08:00:00.000Z',
  preferred_audio_languages: ['sq', 'fr', 'en'],
  preferred_audio_languages_updated_at: '2026-09-15T09:00:00.000Z',
  preferred_subtitle_languages: ['en', 'fr'],
  preferred_subtitle_languages_updated_at: '2026-09-15T08:30:00.000Z',
  subtitles_enabled: true,
  subtitles_enabled_updated_at: '2026-09-15T08:00:00.000Z',
  autoplay: false,
  autoplay_updated_at: '2026-09-15T08:00:00.000Z',
  favorite_channel_ids: ['provider-a:channel:top'],
  favorite_channel_ids_updated_at: '2026-09-15T08:40:00.000Z',
  my_list_items: [{
    mediaId: 'movie:550',
    kind: 'movie',
    title: 'Fight Club',
    providerId: 'cinemeta',
    externalIds: { imdb: 'tt0137523', tmdb: '550' },
    year: 1999,
  }],
  my_list_items_updated_at: '2026-09-15T08:50:00.000Z',
};

test('reads Supabase preference rows into timestamped preferences', async () => {
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
      }),
    }),
  } as unknown as SupabaseClient;

  const store = new SupabasePreferenceRemoteStore(client);
  await expect(store.read('u1')).resolves.toEqual({
    appLocale: { value: 'fr', updatedAt: row.app_locale_updated_at },
    preferredAudioLanguages: { value: ['sq', 'fr', 'en'], updatedAt: row.preferred_audio_languages_updated_at },
    preferredSubtitleLanguages: { value: ['en', 'fr'], updatedAt: row.preferred_subtitle_languages_updated_at },
    subtitlesEnabled: { value: true, updatedAt: row.subtitles_enabled_updated_at },
    autoplay: { value: false, updatedAt: row.autoplay_updated_at },
    favoriteChannelIds: { value: ['provider-a:channel:top'], updatedAt: row.favorite_channel_ids_updated_at },
    myListItems: { value: row.my_list_items, updatedAt: row.my_list_items_updated_at },
  });
});

test('writes timestamped preferences as one user-owned Supabase row', async () => {
  let written: unknown;
  const client = {
    from: () => ({
      upsert: async (value: unknown) => {
        written = value;
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;

  const store = new SupabasePreferenceRemoteStore(client);
  await store.write('u1', {
    appLocale: { value: 'sq', updatedAt: '2026-09-15T10:00:00.000Z' },
    preferredAudioLanguages: { value: ['sq', 'fr'], updatedAt: '2026-09-15T10:01:00.000Z' },
    preferredSubtitleLanguages: { value: ['en'], updatedAt: '2026-09-15T10:02:00.000Z' },
    subtitlesEnabled: { value: false, updatedAt: '2026-09-15T10:03:00.000Z' },
    autoplay: { value: true, updatedAt: '2026-09-15T10:04:00.000Z' },
    favoriteChannelIds: { value: ['provider-a:channel:top'], updatedAt: '2026-09-15T10:05:00.000Z' },
    myListItems: {
      value: [{
        mediaId: 'movie:550',
        kind: 'movie',
        title: 'Fight Club',
        providerId: 'cinemeta',
        externalIds: { imdb: 'tt0137523', tmdb: '550' },
      }],
      updatedAt: '2026-09-15T10:06:00.000Z',
    },
  });

  expect(written).toMatchObject({
    user_id: 'u1',
    app_locale: 'sq',
    preferred_audio_languages: ['sq', 'fr'],
    preferred_subtitle_languages: ['en'],
    subtitles_enabled: false,
    autoplay: true,
    favorite_channel_ids: ['provider-a:channel:top'],
    my_list_items: [expect.objectContaining({
      mediaId: 'movie:550',
      title: 'Fight Club',
    })],
  });
});


test('bounds and sanitizes preference metadata read from Supabase', async () => {
  const data = {
    ...row,
    preferred_audio_languages: Array.from(
      { length: 25 },
      (_, index) => index % 2 ? 'fr' : 'en',
    ),
    favorite_channel_ids: Array.from(
      { length: 1_005 },
      (_, index) => `channel-${index}`,
    ),
    my_list_items: Array.from(
      { length: 250 },
      (_, index) => ({
        mediaId: `movie:${index}`,
        kind: 'movie',
        title: `Movie ${index}`,
        providerId: 'catalog',
        externalIds: { tmdb: String(index + 1) },
        posterUrl: index === 0
          ? 'javascript:alert(1)'
          : 'https://images.example/poster.jpg',
      }),
    ),
  };
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data, error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;

  const result = await new SupabasePreferenceRemoteStore(
    client,
  ).read('u1');

  expect(result?.preferredAudioLanguages.value.length)
    .toBeLessThanOrEqual(20);
  expect(result?.favoriteChannelIds.value).toHaveLength(1_000);
  expect(result?.myListItems.value).toHaveLength(200);
  expect(result?.myListItems.value[0]?.posterUrl).toBeUndefined();
});

test('rejects malformed preference rows without dereferencing them', async () => {
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: [] as unknown,
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;

  await expect(
    new SupabasePreferenceRemoteStore(client).read('u1'),
  ).rejects.toThrow('Preference row is invalid');
});

test('validates preference user identity before querying Supabase', async () => {
  const from = jest.fn();
  const store = new SupabasePreferenceRemoteStore({
    from,
  } as unknown as SupabaseClient);

  await expect(store.read('bad\u0000user'))
    .rejects.toThrow('Preference user id is invalid');
  await expect(store.write(' ', {
    appLocale: { value: 'system', updatedAt: '2026-09-21T18:00:00Z' },
    preferredAudioLanguages: { value: [], updatedAt: '2026-09-21T18:00:00Z' },
    preferredSubtitleLanguages: { value: [], updatedAt: '2026-09-21T18:00:00Z' },
    subtitlesEnabled: { value: true, updatedAt: '2026-09-21T18:00:00Z' },
    autoplay: { value: true, updatedAt: '2026-09-21T18:00:00Z' },
    favoriteChannelIds: { value: [], updatedAt: '2026-09-21T18:00:00Z' },
    myListItems: { value: [], updatedAt: '2026-09-21T18:00:00Z' },
  })).rejects.toThrow('Preference user id is invalid');

  expect(from).not.toHaveBeenCalled();
});

test('sanitizes direct preference writes and rejects invalid timestamps', async () => {
  let written: any;
  const upsert = jest.fn(async (value: unknown) => {
    written = value;
    return { error: null };
  });
  const store = new SupabasePreferenceRemoteStore({
    from: jest.fn(() => ({ upsert })),
  } as unknown as SupabaseClient);
  const timestamp = '2026-09-21T18:00:00.000Z';

  await store.write('u1', {
    appLocale: { value: 'fr', updatedAt: timestamp },
    preferredAudioLanguages: {
      value: Array.from({ length: 25 }, () => 'fr'),
      updatedAt: timestamp,
    },
    preferredSubtitleLanguages: { value: [], updatedAt: timestamp },
    subtitlesEnabled: { value: true, updatedAt: timestamp },
    autoplay: { value: true, updatedAt: timestamp },
    favoriteChannelIds: {
      value: Array.from(
        { length: 1_005 },
        (_, index) => `channel-${index}`,
      ),
      updatedAt: timestamp,
    },
    myListItems: {
      value: [{
        mediaId: 'movie:550',
        kind: 'movie',
        title: 'Fight Club',
        providerId: 'cinemeta',
        externalIds: { imdb: 'tt0137523' },
        posterUrl: 'javascript:alert(1)',
      }],
      updatedAt: timestamp,
    },
  });

  expect(written.favorite_channel_ids).toHaveLength(1_000);
  expect(written.my_list_items[0].posterUrl).toBeUndefined();

  await expect(store.write('u1', {
    appLocale: { value: 'fr', updatedAt: 'not-a-date' },
    preferredAudioLanguages: { value: [], updatedAt: timestamp },
    preferredSubtitleLanguages: { value: [], updatedAt: timestamp },
    subtitlesEnabled: { value: true, updatedAt: timestamp },
    autoplay: { value: true, updatedAt: timestamp },
    favoriteChannelIds: { value: [], updatedAt: timestamp },
    myListItems: { value: [], updatedAt: timestamp },
  })).rejects.toThrow('invalid timestamp');
});


test('times out stalled preference cloud reads', async () => {
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => new Promise(() => undefined),
        }),
      }),
    }),
  } as unknown as SupabaseClient;

  const store = new SupabasePreferenceRemoteStore(client, 2);

  await expect(store.read('u1'))
    .rejects.toThrow('Preference synchronization timed out');
});

test('times out stalled preference cloud writes', async () => {
  const client = {
    from: () => ({
      upsert: () => new Promise(() => undefined),
    }),
  } as unknown as SupabaseClient;
  const store = new SupabasePreferenceRemoteStore(client, 2);
  const timestamp = '2026-09-22T10:00:00.000Z';

  await expect(store.write('u1', {
    appLocale: { value: 'fr', updatedAt: timestamp },
    preferredAudioLanguages: { value: ['fr'], updatedAt: timestamp },
    preferredSubtitleLanguages: { value: [], updatedAt: timestamp },
    subtitlesEnabled: { value: true, updatedAt: timestamp },
    autoplay: { value: true, updatedAt: timestamp },
    favoriteChannelIds: { value: [], updatedAt: timestamp },
    myListItems: { value: [], updatedAt: timestamp },
  })).rejects.toThrow('Preference synchronization timed out');
});
