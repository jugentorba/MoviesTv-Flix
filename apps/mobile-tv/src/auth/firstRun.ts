import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Whether to open the account screen on launch.
 *
 * The app is usable without an account, so the first launch should offer the
 * choice once — create an account, sign in, or continue as a guest — and then
 * never block again. The flag is device-local: an account created on another
 * device should not silence this one's welcome.
 */
const STORAGE_KEY = 'moviestv:welcome-seen:v1';

export async function hasSeenWelcome(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(STORAGE_KEY)) === '1';
  } catch {
    // A failed read means we show the welcome; that is the safe direction.
    return false;
  }
}

export async function markWelcomeSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Best effort: the prompt may appear once more.
  }
}

/**
 * True only on the very first launch, and only while signed out.
 * `userId` is the account identity; signing in earlier suppresses the prompt.
 */
export function useFirstRunWelcome(userId: string | null, ready: boolean): boolean {
  const [seen, setSeen] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void hasSeenWelcome().then((value) => {
      if (!active) return;
      setSeen(value);
      setLoaded(true);
    });
    return () => { active = false; };
  }, []);

  return useCallback(
    () => loaded && ready && !seen && !userId,
    [loaded, ready, seen, userId],
  )();
}
