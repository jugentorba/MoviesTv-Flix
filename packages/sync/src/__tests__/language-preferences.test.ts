import { MemoryStore } from '../../../storage/src';
import { PreferenceSyncService, type TimestampedPreferences } from '../PreferenceSyncService';

function timestampedPreferences(): TimestampedPreferences {
  return {
    appLocale: { value: 'system', updatedAt: '2026-09-15T08:00:00Z' },
    preferredAudioLanguages: { value: ['fr', 'en', 'sq'], updatedAt: '2026-09-15T08:00:00Z' },
    preferredSubtitleLanguages: { value: ['sq', 'en'], updatedAt: '2026-09-15T08:00:00Z' },
    subtitlesEnabled: { value: true, updatedAt: '2026-09-15T08:00:00Z' },
    autoplay: { value: true, updatedAt: '2026-09-15T08:00:00Z' },
    favoriteChannelIds: { value: [], updatedAt: '2026-09-15T08:00:00Z' },
    myListItems: { value: [], updatedAt: '2026-09-15T08:00:00Z' },
  };
}

test('preserves explicit language order through synchronization', async () => {
  const local = timestampedPreferences();
  const remote: TimestampedPreferences = {
    ...local,
    appLocale: { value: 'fr', updatedAt: '2026-09-15T08:30:00Z' },
    preferredAudioLanguages: { value: ['sq', 'fr', 'en'], updatedAt: '2026-09-15T09:00:00Z' },
  };

  const cache = new MemoryStore();
  await cache.set('user-preferences', local);
  const service = new PreferenceSyncService(cache, {
    read: async () => remote,
    write: async () => undefined,
  });

  const merged = await service.sync('u1');
  expect(merged.preferredAudioLanguages.value).toEqual(['sq', 'fr', 'en']);
  expect(merged.appLocale.value).toBe('fr');
  expect(merged.preferredSubtitleLanguages.value).toEqual(['sq', 'en']);
});

test('cached callback exposes the independent language preferences', async () => {
  const local = timestampedPreferences();
  const cache = new MemoryStore();
  await cache.set('user-preferences', local);
  const service = new PreferenceSyncService(cache, {
    read: async () => null,
    write: async () => undefined,
  });

  let seen: unknown;
  await service.sync('u1', (preferences) => { seen = preferences; });
  expect(seen).toEqual({
    appLocale: 'system',
    preferredAudioLanguages: ['fr', 'en', 'sq'],
    preferredSubtitleLanguages: ['sq', 'en'],
    subtitlesEnabled: true,
    autoplay: true,
    favoriteChannelIds: [],
    myListItems: [],
  });
});
