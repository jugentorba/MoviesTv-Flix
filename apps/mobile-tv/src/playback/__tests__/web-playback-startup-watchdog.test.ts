import {
  WEB_PLAYBACK_START_MAX_MS,
  WEB_PLAYBACK_START_TIMEOUT_MS,
  createWebPlaybackStartupWatchdog,
} from '../webPlaybackStartupWatchdog';

describe('web playback startup watchdog', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports a source that never becomes ready', () => {
    const onTimeout = jest.fn();
    const watchdog = createWebPlaybackStartupWatchdog(onTimeout);

    watchdog.start();
    jest.advanceTimersByTime(WEB_PLAYBACK_START_TIMEOUT_MS - 1);
    expect(onTimeout).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('extends the startup window while useful loading progress continues', () => {
    const onTimeout = jest.fn();
    const watchdog = createWebPlaybackStartupWatchdog(onTimeout, 1_000);

    watchdog.start();
    jest.advanceTimersByTime(800);
    watchdog.progress();
    jest.advanceTimersByTime(800);

    expect(onTimeout).not.toHaveBeenCalled();

    jest.advanceTimersByTime(200);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not fail a source after the browser reports it ready', () => {
    const onTimeout = jest.fn();
    const watchdog = createWebPlaybackStartupWatchdog(onTimeout, 1_000);

    watchdog.start();
    jest.advanceTimersByTime(500);
    watchdog.ready();
    jest.advanceTimersByTime(2_000);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('pauses startup timing while the PWA is backgrounded', () => {
    const onTimeout = jest.fn();
    const watchdog = createWebPlaybackStartupWatchdog(
      onTimeout,
      1_000,
      2_500,
    );

    watchdog.start();
    jest.advanceTimersByTime(700);
    watchdog.pause();
    jest.advanceTimersByTime(10_000);

    expect(onTimeout).not.toHaveBeenCalled();

    watchdog.resume();
    jest.advanceTimersByTime(999);
    expect(onTimeout).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not reset the absolute startup budget across background pauses', () => {
    const onTimeout = jest.fn();
    const watchdog = createWebPlaybackStartupWatchdog(
      onTimeout,
      1_500,
      2_000,
    );

    watchdog.start();
    jest.advanceTimersByTime(1_200);
    watchdog.progress();
    watchdog.pause();
    jest.advanceTimersByTime(5_000);
    watchdog.resume();
    jest.advanceTimersByTime(799);

    expect(onTimeout).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not fire after the player is disposed', () => {
    const onTimeout = jest.fn();
    const watchdog = createWebPlaybackStartupWatchdog(onTimeout, 1_000);

    watchdog.start();
    watchdog.dispose();
    jest.advanceTimersByTime(2_000);

    expect(onTimeout).not.toHaveBeenCalled();
  });
});


it('fails a source at the absolute startup ceiling despite continued progress', () => {
  jest.useFakeTimers();
  try {
    const onTimeout = jest.fn();
    const watchdog = createWebPlaybackStartupWatchdog(
      onTimeout,
      1_000,
      2_500,
    );

    watchdog.start();
    jest.advanceTimersByTime(800);
    watchdog.progress();
    jest.advanceTimersByTime(800);
    watchdog.progress();
    jest.advanceTimersByTime(800);
    watchdog.progress();

    expect(onTimeout).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);

    expect(onTimeout).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

it('uses a longer default absolute ceiling than the inactivity window', () => {
  expect(WEB_PLAYBACK_START_MAX_MS)
    .toBeGreaterThan(WEB_PLAYBACK_START_TIMEOUT_MS);
});

it('rejects invalid web playback startup timing limits', () => {
  expect(() => createWebPlaybackStartupWatchdog(
    jest.fn(),
    0,
    1_000,
  )).toThrow('Invalid web playback startup limits');

  expect(() => createWebPlaybackStartupWatchdog(
    jest.fn(),
    1_000,
    Number.NaN,
  )).toThrow('Invalid web playback startup limits');
});
