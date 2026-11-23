import {
  createWebPlaybackStallWatchdog,
} from '../webPlaybackStallWatchdog';

describe('web playback stall watchdog', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('reports a playback stall after the configured timeout', () => {
    const onTimeout = jest.fn();
    const watchdog = createWebPlaybackStallWatchdog(onTimeout, 100);

    watchdog.stall();
    jest.advanceTimersByTime(99);
    expect(onTimeout).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  test('buffer progress extends an active stall window', () => {
    const onTimeout = jest.fn();
    const watchdog = createWebPlaybackStallWatchdog(onTimeout, 100);

    watchdog.stall();
    jest.advanceTimersByTime(80);
    watchdog.progress();
    jest.advanceTimersByTime(80);
    expect(onTimeout).not.toHaveBeenCalled();

    jest.advanceTimersByTime(20);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  test('playing again clears a pending stall timeout', () => {
    const onTimeout = jest.fn();
    const watchdog = createWebPlaybackStallWatchdog(onTimeout, 100);

    watchdog.stall();
    jest.advanceTimersByTime(50);
    watchdog.ready();
    jest.advanceTimersByTime(100);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  test('dispose prevents late callbacks', () => {
    const onTimeout = jest.fn();
    const watchdog = createWebPlaybackStallWatchdog(onTimeout, 100);

    watchdog.stall();
    watchdog.dispose();
    jest.advanceTimersByTime(100);

    expect(onTimeout).not.toHaveBeenCalled();
  });
});
