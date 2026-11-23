import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * How much the player buffers before showing a frame.
 *
 * The right value depends on the connection, not on the app: 1.2 s is
 * conservative on fibre and too little on a congested mobile link. A single
 * hard-coded number is a compromise someone always loses on, so it is a
 * device-local setting with three points on the curve.
 *
 * Kept in local storage rather than the synced preference payload: the phone on
 * mobile data and the TV on ethernet want different answers.
 */
export type BufferMode = 'fast' | 'balanced' | 'stable';

export const BUFFER_MODES: readonly BufferMode[] = ['fast', 'balanced', 'stable'];

const STORAGE_KEY = 'moviestv:buffer-mode:v1';
const DEFAULT_MODE: BufferMode = 'balanced';

const VLC_CACHING_MS: Record<BufferMode, number> = {
  fast: 600,
  balanced: 1200,
  stable: 3000,
};

const EXPO_FORWARD_BUFFER_S: Record<BufferMode, number> = {
  fast: 2,
  balanced: 8,
  stable: 30,
};

export function vlcCachingMs(mode: BufferMode): number {
  return VLC_CACHING_MS[mode];
}

export function expoForwardBufferSeconds(mode: BufferMode): number {
  return EXPO_FORWARD_BUFFER_S[mode];
}

export function isBufferMode(value: unknown): value is BufferMode {
  return typeof value === 'string' && (BUFFER_MODES as readonly string[]).includes(value);
}

export function nextBufferMode(mode: BufferMode): BufferMode {
  const index = BUFFER_MODES.indexOf(mode);
  return BUFFER_MODES[(index + 1) % BUFFER_MODES.length];
}

export async function readBufferMode(): Promise<BufferMode> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    return isBufferMode(stored) ? stored : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

export async function writeBufferMode(mode: BufferMode): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Best effort: the session keeps the value it already applied.
  }
}
