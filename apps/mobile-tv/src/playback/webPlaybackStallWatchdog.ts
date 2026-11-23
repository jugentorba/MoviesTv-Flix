export const WEB_PLAYBACK_STALL_TIMEOUT_MS = 20_000;

export interface WebPlaybackStallWatchdog {
  stall(): void;
  progress(): void;
  ready(): void;
  dispose(): void;
}

export function createWebPlaybackStallWatchdog(
  onTimeout: () => void,
  timeoutMs = WEB_PLAYBACK_STALL_TIMEOUT_MS,
): WebPlaybackStallWatchdog {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Invalid web playback stall limit');
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stalled = false;
  let disposed = false;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const arm = () => {
    if (disposed || !stalled) return;
    clear();
    timer = setTimeout(() => {
      timer = null;
      if (disposed || !stalled) return;
      stalled = false;
      onTimeout();
    }, timeoutMs);
  };

  const stall = () => {
    if (disposed) return;
    stalled = true;
    arm();
  };

  const progress = () => {
    if (disposed || !stalled) return;
    arm();
  };

  const ready = () => {
    stalled = false;
    clear();
  };

  const dispose = () => {
    disposed = true;
    stalled = false;
    clear();
  };

  return { stall, progress, ready, dispose };
}
