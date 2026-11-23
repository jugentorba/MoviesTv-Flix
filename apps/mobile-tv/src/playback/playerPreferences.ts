import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Player options that depend on the person, not the account.
 *
 * Device-local, like the buffer mode: the same viewer may want skip-intro on a
 * phone and off on a TV where someone else is watching, and these never belong
 * in the synced preference payload.
 */
export type UpNextSeconds = 5 | 10 | 15;

export interface PlayerPreferences {
  skipIntroEnabled: boolean;
  upNextSeconds: UpNextSeconds;
}

export const DEFAULT_PLAYER_PREFERENCES: PlayerPreferences = {
  skipIntroEnabled: true,
  upNextSeconds: 10,
};

const STORAGE_KEY = 'moviestv:player-prefs:v1';
const COUNTDOWN_CHOICES: readonly UpNextSeconds[] = [5, 10, 15];

export function normalizePlayerPreferences(value: unknown): PlayerPreferences {
  if (!value || typeof value !== 'object') return DEFAULT_PLAYER_PREFERENCES;
  const record = value as Partial<PlayerPreferences>;
  return {
    skipIntroEnabled: typeof record.skipIntroEnabled === 'boolean'
      ? record.skipIntroEnabled
      : DEFAULT_PLAYER_PREFERENCES.skipIntroEnabled,
    upNextSeconds: COUNTDOWN_CHOICES.includes(record.upNextSeconds as UpNextSeconds)
      ? record.upNextSeconds as UpNextSeconds
      : DEFAULT_PLAYER_PREFERENCES.upNextSeconds,
  };
}

export function nextUpNextSeconds(current: UpNextSeconds): UpNextSeconds {
  const index = COUNTDOWN_CHOICES.indexOf(current);
  return COUNTDOWN_CHOICES[(index + 1) % COUNTDOWN_CHOICES.length];
}

export async function readPlayerPreferences(): Promise<PlayerPreferences> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PLAYER_PREFERENCES;
    return normalizePlayerPreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_PLAYER_PREFERENCES;
  }
}

export async function writePlayerPreferences(preferences: PlayerPreferences): Promise<void> {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(normalizePlayerPreferences(preferences)),
    );
  } catch {
    // Best effort; the session keeps the values it was given.
  }
}

/** Small subscription so the player reacts without a re-mount. */
const listeners = new Set<() => void>();
let cachedValue: PlayerPreferences = DEFAULT_PLAYER_PREFERENCES;
let loaded = false;

export function subscribePlayerPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function playerPreferencesSnapshot(): PlayerPreferences {
  return cachedValue;
}

export async function loadPlayerPreferences(): Promise<PlayerPreferences> {
  if (!loaded) {
    cachedValue = await readPlayerPreferences();
    loaded = true;
  }
  return cachedValue;
}

export function setPlayerPreferences(next: PlayerPreferences): void {
  cachedValue = normalizePlayerPreferences(next);
  loaded = true;
  void writePlayerPreferences(cachedValue);
  for (const listener of listeners) listener();
}

export const PLAYER_PREFERENCES_STORAGE_KEY = STORAGE_KEY;
