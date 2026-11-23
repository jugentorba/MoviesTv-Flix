import {
  createWebPlaybackStartupWatchdog,
  type WebPlaybackStartupWatchdog,
} from '../playback/webPlaybackStartupWatchdog';
import {
  createWebPlaybackStallWatchdog,
  type WebPlaybackStallWatchdog,
} from '../playback/webPlaybackStallWatchdog';

export const LIVE_TV_START_TIMEOUT_MS = 12_000;
export const LIVE_TV_START_MAX_MS = 30_000;
export const LIVE_TV_STALL_TIMEOUT_MS = 10_000;

export function createLiveTvStartupWatchdog(
  onTimeout: () => void,
): WebPlaybackStartupWatchdog {
  return createWebPlaybackStartupWatchdog(
    onTimeout,
    LIVE_TV_START_TIMEOUT_MS,
    LIVE_TV_START_MAX_MS,
  );
}

export function createLiveTvStallWatchdog(
  onTimeout: () => void,
): WebPlaybackStallWatchdog {
  return createWebPlaybackStallWatchdog(
    onTimeout,
    LIVE_TV_STALL_TIMEOUT_MS,
  );
}
