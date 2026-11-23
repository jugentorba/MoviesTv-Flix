import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_PLAYER_PREFERENCES,
  loadPlayerPreferences,
  nextUpNextSeconds,
  normalizePlayerPreferences,
  readPlayerPreferences,
  setPlayerPreferences,
  writePlayerPreferences,
} from '../playerPreferences';

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('the defaults are skip-intro on and a ten second countdown', () => {
  expect(DEFAULT_PLAYER_PREFERENCES).toEqual({
    skipIntroEnabled: true,
    upNextSeconds: 10,
  });
});

test('an unreadable stored value falls back instead of breaking the player', () => {
  expect(normalizePlayerPreferences(null)).toEqual(DEFAULT_PLAYER_PREFERENCES);
  expect(normalizePlayerPreferences({ upNextSeconds: 99 })).toEqual(DEFAULT_PLAYER_PREFERENCES);
  expect(normalizePlayerPreferences({ skipIntroEnabled: 'yes' })).toEqual(DEFAULT_PLAYER_PREFERENCES);
});

test('valid values survive', () => {
  expect(normalizePlayerPreferences({ skipIntroEnabled: false, upNextSeconds: 15 }))
    .toEqual({ skipIntroEnabled: false, upNextSeconds: 15 });
});

test('the countdown cycles through 5, 10 and 15 seconds', () => {
  expect(nextUpNextSeconds(5)).toBe(10);
  expect(nextUpNextSeconds(10)).toBe(15);
  expect(nextUpNextSeconds(15)).toBe(5);
});

test('preferences round-trip through storage', async () => {
  await writePlayerPreferences({ skipIntroEnabled: false, upNextSeconds: 5 });
  expect(await readPlayerPreferences()).toEqual({ skipIntroEnabled: false, upNextSeconds: 5 });
});

test('the in-memory snapshot follows setPlayerPreferences', async () => {
  await loadPlayerPreferences();
  setPlayerPreferences({ skipIntroEnabled: false, upNextSeconds: 15 });

  const stored = JSON.parse((await AsyncStorage.getItem('moviestv:player-prefs:v1')) ?? '{}');
  expect(stored).toEqual({ skipIntroEnabled: false, upNextSeconds: 15 });

  // Restore the shared cache for other tests in this file.
  setPlayerPreferences(DEFAULT_PLAYER_PREFERENCES);
});
