import { useCallback, useEffect, useState } from 'react';
import { loadScreenOrientation } from './nativeModules';

export type PlayerOrientation = 'landscape' | 'portrait';

/**
 * iOS applies an orientation lock to the *active view controller*, and that
 * controller is not always ready on the exact tick the player mounts. A single
 * `lockAsync` call therefore sometimes did nothing and the film stayed portrait
 * until the user rotated the phone by hand. Re-applying the same lock a few
 * times is idempotent and covers that window.
 */
const RETRY_DELAYS_MS = [150, 450, 1_200];

type OrientationModule = NonNullable<ReturnType<typeof loadScreenOrientation>>;

function lockFor(
  orientation: PlayerOrientation,
  module: OrientationModule,
) {
  return orientation === 'landscape'
    ? module.OrientationLock.LANDSCAPE
    : module.OrientationLock.PORTRAIT_UP;
}

function applyLock(orientation: PlayerOrientation): void {
  // Loaded lazily: importing expo-screen-orientation on a TV throws, because the
  // pod is not linked there.
  const module = loadScreenOrientation();
  if (!module) return;
  try {
    const result = module.lockAsync(lockFor(orientation, module));
    // A rotation-locked phone rejects: that is normal, never an error state.
    if (result && typeof (result as Promise<void>).catch === 'function') {
      void (result as Promise<void>).catch(() => undefined);
    }
  } catch {
    // Unsupported or locked: stay as we are.
  }
}

function releaseLock(): void {
  const module = loadScreenOrientation();
  if (!module) return;
  try {
    const result = module.unlockAsync();
    if (result && typeof (result as Promise<void>).catch === 'function') {
      void (result as Promise<void>).catch(() => undefined);
    }
  } catch {
    // Nothing to restore; the device keeps its own setting.
  }
}

function useOrientationLock(
  enabled: boolean,
  orientation: PlayerOrientation,
): void {
  const supported = enabled && loadScreenOrientation() !== null;

  useEffect(() => {
    if (!supported) return undefined;
    // Queued synchronously so the rotation starts in the same frame as mount.
    applyLock(orientation);
    const timers = RETRY_DELAYS_MS.map((delay) => (
      setTimeout(() => applyLock(orientation), delay)
    ));
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [supported, orientation]);

  // Released only when playback ends, never when the user flips orientation
  // from the player menu: unlocking there would flash the portrait layout.
  useEffect(() => {
    if (!supported) return undefined;
    return () => releaseLock();
  }, [supported]);
}

/**
 * Holds the device in landscape while a video is on screen.
 *
 * A 16:9 film on a 19.5:9 phone in portrait is mostly black bars. Every modern
 * player rotates instead of letterboxing, so playback does the same here and
 * restores the device orientation when the player closes.
 */
export function useLandscapeWhilePlaying(enabled: boolean): void {
  useOrientationLock(enabled, 'landscape');
}

/**
 * The same lock, plus a manual `Rotate` action for the player menu. Landscape
 * stays the default; the toggle exists because a user sometimes wants portrait
 * (vertical videos, one-handed watching) without fighting the lock.
 */
export function usePlayerOrientation(enabled: boolean): {
  orientation: PlayerOrientation;
  toggleOrientation: () => void;
} {
  const [orientation, setOrientation] = useState<PlayerOrientation>('landscape');
  useOrientationLock(enabled, orientation);

  const toggleOrientation = useCallback(() => {
    setOrientation((current) => (
      current === 'landscape' ? 'portrait' : 'landscape'
    ));
  }, []);

  return { orientation, toggleOrientation };
}
