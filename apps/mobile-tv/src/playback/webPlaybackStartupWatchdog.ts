export const WEB_PLAYBACK_START_TIMEOUT_MS = 15_000;
export const WEB_PLAYBACK_START_MAX_MS = 45_000;

export interface WebPlaybackStartupWatchdog {
  start(): void;
  progress(): void;
  pause(): void;
  resume(): void;
  ready(): void;
  dispose(): void;
}

export function createWebPlaybackStartupWatchdog(
  onTimeout: () => void,
  timeoutMs = WEB_PLAYBACK_START_TIMEOUT_MS,
  maxStartupMs = WEB_PLAYBACK_START_MAX_MS,
): WebPlaybackStartupWatchdog {
  if (
    !Number.isFinite(timeoutMs)
    || timeoutMs <= 0
    || !Number.isFinite(maxStartupMs)
    || maxStartupMs <= 0
  ) {
    throw new Error('Invalid web playback startup limits');
  }

  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  let absoluteTimer: ReturnType<typeof setTimeout> | null = null;
  let started = false;
  let finished = false;
  let paused = false;
  let activeStartedAt: number | null = null;
  let absoluteRemainingMs = maxStartupMs;

  const clearInactivity = () => {
    if (inactivityTimer !== null) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  };

  const clearAbsolute = () => {
    if (absoluteTimer !== null) {
      clearTimeout(absoluteTimer);
      absoluteTimer = null;
    }
  };

  const clear = () => {
    clearInactivity();
    clearAbsolute();
  };

  const recordActiveTime = () => {
    if (!started || paused || activeStartedAt === null) return;
    const now = Date.now();
    absoluteRemainingMs = Math.max(
      0,
      absoluteRemainingMs - Math.max(0, now - activeStartedAt),
    );
    activeStartedAt = now;
  };

  const timeout = () => {
    if (finished) return;
    finished = true;
    clear();
    onTimeout();
  };

  const armInactivity = () => {
    if (finished || paused) return;
    clearInactivity();
    inactivityTimer = setTimeout(() => {
      inactivityTimer = null;
      timeout();
    }, timeoutMs);
  };

  const armAbsolute = () => {
    if (finished || paused || !started) return;
    clearAbsolute();
    if (absoluteRemainingMs <= 0) {
      timeout();
      return;
    }
    activeStartedAt = Date.now();
    absoluteTimer = setTimeout(() => {
      absoluteTimer = null;
      recordActiveTime();
      timeout();
    }, absoluteRemainingMs);
  };

  const start = () => {
    if (finished) return;
    if (!started) {
      started = true;
      absoluteRemainingMs = maxStartupMs;
    }
    if (paused) return;
    armAbsolute();
    armInactivity();
  };

  const progress = () => {
    if (finished || paused) return;
    if (!started) {
      start();
      return;
    }
    armInactivity();
  };

  const pause = () => {
    if (finished || paused) return;
    recordActiveTime();
    paused = true;
    clear();
  };

  const resume = () => {
    if (finished || !paused) return;
    paused = false;
    if (!started) return;
    armAbsolute();
    armInactivity();
  };

  const ready = () => {
    if (finished) return;
    finished = true;
    clear();
  };

  const dispose = () => {
    finished = true;
    clear();
  };

  return {
    start,
    progress,
    pause,
    resume,
    ready,
    dispose,
  };
}
