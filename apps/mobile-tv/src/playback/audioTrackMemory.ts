import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Remembers which audio track you picked for a given source.
 *
 * Providers frequently mislabel audio: a file declares `eng` while it actually
 * plays Italian, and every future playback picks the wrong track again because
 * the preference order matches the (wrong) declared language. Remembering the
 * user's explicit choice fixes that once instead of on every open.
 *
 * Keyed by the source fingerprint, so it survives re-resolving the same URL but
 * never leaks between different sources.
 */
const KEY_PREFIX = 'moviestv:audio-track:v1:';

export async function readRememberedAudioTrack(
  fingerprint: string,
): Promise<string | null> {
  if (!fingerprint) return null;
  try {
    const value = await AsyncStorage.getItem(`${KEY_PREFIX}${fingerprint}`);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export async function rememberAudioTrack(
  fingerprint: string,
  trackId: string | null,
): Promise<void> {
  if (!fingerprint) return;
  try {
    const key = `${KEY_PREFIX}${fingerprint}`;
    if (!trackId) {
      await AsyncStorage.removeItem(key);
      return;
    }
    await AsyncStorage.setItem(key, trackId);
  } catch {
    // Best effort: losing the memory only means the automatic pick returns.
  }
}
