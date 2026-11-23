import { Platform } from 'react-native';

/**
 * Native modules that exist on phones but not on TVs.
 *
 * `expo-screen-orientation` calls `requireNativeModule('ExpoScreenOrientation')`
 * the moment its module is imported, so a TV build — where the pod is not
 * linked at all — throws before React can render anything. Importing it lazily
 * keeps the phone behaviour identical and lets the TV build boot.
 *
 * `expo-brightness` is treated the same way: it has no tvOS pod either.
 */
type BrightnessModule = typeof import('expo-brightness');
type OrientationModule = typeof import('expo-screen-orientation');

let brightnessModule: BrightnessModule | null | undefined;
let orientationModule: OrientationModule | null | undefined;

export function loadBrightness(): BrightnessModule | null {
  if (Platform.OS === 'web' || Platform.isTV) return null;
  if (brightnessModule !== undefined) return brightnessModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    brightnessModule = require('expo-brightness') as BrightnessModule;
  } catch {
    brightnessModule = null;
  }
  return brightnessModule;
}

export function loadScreenOrientation(): OrientationModule | null {
  if (Platform.OS === 'web' || Platform.isTV) return null;
  if (orientationModule !== undefined) return orientationModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    orientationModule = require('expo-screen-orientation') as OrientationModule;
  } catch {
    orientationModule = null;
  }
  return orientationModule;
}

/** Test seam: forget the cached modules. */
export function resetNativeModuleCacheForTests(): void {
  brightnessModule = undefined;
  orientationModule = undefined;
}
