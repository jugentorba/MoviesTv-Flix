import type { UserPreferences } from '../../../core/src';
import { MemoryStore } from '../../../storage/src';
import { chooseLatest, mergeProgress } from '../conflicts';
import { PreferenceSyncService } from '../PreferenceSyncService';

test('chooses the value with the newest valid timestamp', () => {
  expect(chooseLatest(
    { value: 'fr', updatedAt: '2026-09-06T10:00:00Z' },
    { value: 'en', updatedAt: '2026-09-06T09:00:00Z' },
  ).value).toBe('fr');
});

test('does not move playback backwards unless explicitly restarted', () => {
  const local = { value: { positionMs: 90, durationMs: 100 }, updatedAt: '2026-09-06T09:00:00Z' };
  const remote = { value: { positionMs: 20, durationMs: 100 }, updatedAt: '2026-09-06T10:00:00Z' };
  expect(mergeProgress(local, remote, false).value.positionMs).toBe(90);
  expect(mergeProgress(local, remote, true).value.positionMs).toBe(20);
});

test('loads cache first and writes only a changed merged state', async () => {
  const cached = {
    appLocale: { value: 'system', updatedAt: '2026-09-06T10:00:00Z' },
    preferredAudioLanguages: { value: ['en', 'fr', 'de'], updatedAt: '2026-09-06T10:00:00Z' },
    preferredSubtitleLanguages: { value: ['fr'], updatedAt: '2026-09-06T10:00:00Z' },
    subtitlesEnabled: { value: true, updatedAt: '2026-09-06T10:00:00Z' },
    autoplay: { value: true, updatedAt: '2026-09-06T10:00:00Z' },
    favoriteChannelIds: { value: [], updatedAt: '2026-09-06T10:00:00Z' },
    myListItems: { value: [], updatedAt: '2026-09-06T10:00:00Z' },
  };
  let written: unknown;
  const cache = new MemoryStore();
  await cache.set('user-preferences', cached);
  const remote = { read: async () => null, write: async (_userId: string, value: unknown) => { written = value; } };
  const service = new PreferenceSyncService(cache, remote);
  const seen: UserPreferences[] = [];
  const merged = await service.sync('u1', (preferences) => seen.push(preferences));
  expect(seen[0].preferredSubtitleLanguages).toEqual(['fr']);
  expect(merged.preferredSubtitleLanguages.value).toEqual(['fr']);
  expect(written).toEqual(merged);
});


test('preference sync converges to remote state when timestamps tie', async () => {
  const timestamp = '2026-09-22T10:00:00.000Z';
  const cached = {
    appLocale: { value: 'fr', updatedAt: timestamp },
    preferredAudioLanguages: { value: ['fr'], updatedAt: timestamp },
    preferredSubtitleLanguages: { value: [], updatedAt: timestamp },
    subtitlesEnabled: { value: true, updatedAt: timestamp },
    autoplay: { value: true, updatedAt: timestamp },
    favoriteChannelIds: { value: ['local-channel'], updatedAt: timestamp },
    myListItems: { value: [], updatedAt: timestamp },
  };
  const remote = {
    ...cached,
    favoriteChannelIds: {
      value: ['remote-channel'],
      updatedAt: timestamp,
    },
  };
  const cache = new MemoryStore();
  await cache.set('user-preferences', cached);
  const write = jest.fn(async () => undefined);
  const service = new PreferenceSyncService(cache, {
    read: async () => remote,
    write,
  });

  const merged = await service.sync('u1');

  expect(merged.favoriteChannelIds.value).toEqual(['remote-channel']);
  expect(await cache.get('user-preferences')).toEqual(merged);
  expect(write).not.toHaveBeenCalled();
});

test('preference sync adopts fields preserved by the server after a concurrent write', async () => {
  const cached = {
    appLocale: { value: 'system', updatedAt: '2026-09-20T10:00:00Z' },
    preferredAudioLanguages: {
      value: ['fr', 'en'],
      updatedAt: '2026-09-20T10:05:00Z',
    },
    preferredSubtitleLanguages: {
      value: ['fr'],
      updatedAt: '2026-09-20T10:00:00Z',
    },
    subtitlesEnabled: {
      value: true,
      updatedAt: '2026-09-20T10:00:00Z',
    },
    autoplay: {
      value: true,
      updatedAt: '2026-09-20T10:00:00Z',
    },
    favoriteChannelIds: {
      value: [],
      updatedAt: '2026-09-20T10:00:00Z',
    },
    myListItems: {
      value: [],
      updatedAt: '2026-09-20T10:00:00Z',
    },
  };
  const remoteBefore = {
    ...cached,
    preferredAudioLanguages: {
      value: ['en'],
      updatedAt: '2026-09-20T10:00:00Z',
    },
  };
  const remoteAfter = {
    ...cached,
    favoriteChannelIds: {
      value: ['live-tv-favorite:FR:france%202'],
      updatedAt: '2026-09-20T10:06:00Z',
    },
  };

  let reads = 0;
  const cache = new MemoryStore();
  await cache.set('user-preferences', cached);
  const service = new PreferenceSyncService(cache, {
    read: async () => {
      reads += 1;
      return reads === 1 ? remoteBefore : remoteAfter;
    },
    write: async () => undefined,
  });

  const merged = await service.sync('u1');

  expect(merged.preferredAudioLanguages.value).toEqual(['fr', 'en']);
  expect(merged.favoriteChannelIds.value).toEqual([
    'live-tv-favorite:FR:france%202',
  ]);
  expect(await cache.get('user-preferences')).toEqual(merged);
});

test('preference sync can use an identity-scoped cache key', async () => {
  const cached = {
    appLocale: { value: 'fr', updatedAt: '2026-09-06T10:00:00Z' },
    preferredAudioLanguages: { value: ['fr', 'en'], updatedAt: '2026-09-06T10:00:00Z' },
    preferredSubtitleLanguages: { value: ['fr'], updatedAt: '2026-09-06T10:00:00Z' },
    subtitlesEnabled: { value: true, updatedAt: '2026-09-06T10:00:00Z' },
    autoplay: { value: true, updatedAt: '2026-09-06T10:00:00Z' },
    favoriteChannelIds: { value: ['channel-a'], updatedAt: '2026-09-06T10:00:00Z' },
    myListItems: { value: [], updatedAt: '2026-09-06T10:00:00Z' },
  };
  const cache = new MemoryStore();
  const scopedKey = 'user-preferences:user:u1';
  await cache.set(scopedKey, cached);
  const service = new PreferenceSyncService(
    cache,
    {
      read: async () => null,
      write: async () => undefined,
    },
    scopedKey,
  );

  const merged = await service.sync('u1');

  expect(merged.favoriteChannelIds.value).toEqual(['channel-a']);
  expect(await cache.get('user-preferences')).toBeNull();
  expect(await cache.get(scopedKey)).toEqual(merged);
});


test('preference sync normalizes corrupted cached values before merging', async () => {
  const cache = new MemoryStore();
  await cache.set('user-preferences', {
    appLocale: {
      value: 'fr',
      updatedAt: 'not-a-date',
    },
    preferredAudioLanguages: {
      value: Array.from({ length: 25 }, () => 'fr'),
      updatedAt: '2026-09-21T18:00:00Z',
    },
    preferredSubtitleLanguages: {
      value: [],
      updatedAt: '2026-09-21T18:00:00Z',
    },
    subtitlesEnabled: {
      value: true,
      updatedAt: '2026-09-21T18:00:00Z',
    },
    autoplay: {
      value: true,
      updatedAt: '2026-09-21T18:00:00Z',
    },
    favoriteChannelIds: {
      value: Array.from(
        { length: 1_005 },
        (_, index) => `channel-${index}`,
      ),
      updatedAt: '2026-09-21T18:00:00Z',
    },
    myListItems: {
      value: [],
      updatedAt: '2026-09-21T18:00:00Z',
    },
  });

  const writes: unknown[] = [];
  const service = new PreferenceSyncService(cache, {
    read: async () => null,
    write: async (_userId, value) => {
      writes.push(value);
    },
  });

  const merged = await service.sync('u1');

  expect(merged.appLocale.updatedAt)
    .toBe('1970-01-01T00:00:00.000Z');
  expect(merged.preferredAudioLanguages.value).toEqual(['fr']);
  expect(merged.favoriteChannelIds.value).toHaveLength(1_000);
  expect(writes).toEqual([merged]);
  expect(await cache.get('user-preferences')).toEqual(merged);
});

test('preference sync repairs malformed remote state without losing newer local fields', async () => {
  const cached = {
    appLocale: {
      value: 'fr',
      updatedAt: '2026-09-21T18:00:00Z',
    },
    preferredAudioLanguages: {
      value: ['fr'],
      updatedAt: '2026-09-21T18:00:00Z',
    },
    preferredSubtitleLanguages: {
      value: [],
      updatedAt: '2026-09-21T18:00:00Z',
    },
    subtitlesEnabled: {
      value: true,
      updatedAt: '2026-09-21T18:00:00Z',
    },
    autoplay: {
      value: true,
      updatedAt: '2026-09-21T18:00:00Z',
    },
    favoriteChannelIds: {
      value: [],
      updatedAt: '2026-09-21T18:00:00Z',
    },
    myListItems: {
      value: [],
      updatedAt: '2026-09-21T18:00:00Z',
    },
  };
  const cache = new MemoryStore();
  await cache.set('user-preferences', cached);
  const writes: unknown[] = [];
  let reads = 0;
  const service = new PreferenceSyncService(cache, {
    read: async () => {
      reads += 1;
      return reads === 1
        ? ({
          ...cached,
          appLocale: {
            value: 'sq',
            updatedAt: 'invalid',
          },
          favoriteChannelIds: {
            value: ['bad\u0000channel'],
            updatedAt: 'invalid',
          },
        } as any)
        : cached;
    },
    write: async (_userId, value) => {
      writes.push(value);
    },
  });

  const merged = await service.sync('u1');

  expect(merged.appLocale.value).toBe('fr');
  expect(merged.favoriteChannelIds.value).toEqual([]);
  expect(writes).toHaveLength(1);
});

test('preference sync rejects invalid account identities before remote access', async () => {
  const cache = new MemoryStore();
  const read = jest.fn();
  const write = jest.fn();
  const service = new PreferenceSyncService(cache, { read, write });

  await expect(service.sync('bad\u0000user'))
    .rejects.toThrow('Preference user id is invalid');
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});


test('repairs the remote row after confirmation reveals a concurrent field edit', async () => {
  const cached = {
    appLocale: { value: 'system', updatedAt: '2026-09-20T10:00:00Z' },
    preferredAudioLanguages: {
      value: ['fr', 'en'],
      updatedAt: '2026-09-20T10:05:00Z',
    },
    preferredSubtitleLanguages: {
      value: ['fr'],
      updatedAt: '2026-09-20T10:00:00Z',
    },
    subtitlesEnabled: {
      value: true,
      updatedAt: '2026-09-20T10:00:00Z',
    },
    autoplay: {
      value: true,
      updatedAt: '2026-09-20T10:00:00Z',
    },
    favoriteChannelIds: {
      value: [],
      updatedAt: '2026-09-20T10:00:00Z',
    },
    myListItems: {
      value: [],
      updatedAt: '2026-09-20T10:00:00Z',
    },
  };
  const remoteBefore = {
    ...cached,
    preferredAudioLanguages: {
      value: ['en'],
      updatedAt: '2026-09-20T10:00:00Z',
    },
  };
  const remoteAfterFirstWrite = {
    ...cached,
    preferredAudioLanguages: remoteBefore.preferredAudioLanguages,
    favoriteChannelIds: {
      value: ['live-tv-favorite:FR:france%202'],
      updatedAt: '2026-09-20T10:06:00Z',
    },
  };

  const cache = new MemoryStore();
  await cache.set('user-preferences', cached);
  const writes: any[] = [];
  let reads = 0;
  const service = new PreferenceSyncService(cache, {
    read: async () => {
      reads += 1;
      return reads === 1 ? remoteBefore : remoteAfterFirstWrite;
    },
    write: async (_userId, value) => {
      writes.push(value);
    },
  });

  const merged = await service.sync('u1');

  expect(merged.preferredAudioLanguages.value).toEqual(['fr', 'en']);
  expect(merged.favoriteChannelIds.value).toEqual([
    'live-tv-favorite:FR:france%202',
  ]);
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(merged);
});
