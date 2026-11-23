import { act, renderHook } from '@testing-library/react-native';

const mockLockAsync = jest.fn(async (_lock?: unknown) => undefined);
const mockUnlockAsync = jest.fn(async () => undefined);

jest.mock('expo-screen-orientation', () => ({
  lockAsync: (lock: unknown) => mockLockAsync(lock),
  unlockAsync: () => mockUnlockAsync(),
  OrientationLock: { LANDSCAPE: 'LANDSCAPE', PORTRAIT_UP: 'PORTRAIT_UP' },
}));

// Required after the mock so the hook picks up the mocked module.
const { useLandscapeWhilePlaying, usePlayerOrientation } = require('../usePlaybackOrientation');

describe('useLandscapeWhilePlaying', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLockAsync.mockResolvedValue(undefined);
    mockUnlockAsync.mockResolvedValue(undefined);
  });

  it('locks to landscape while playback is on screen', () => {
    renderHook(() => useLandscapeWhilePlaying(true));
    expect(mockLockAsync).toHaveBeenCalledWith('LANDSCAPE');
  });

  it('releases the lock when the player closes', () => {
    const { unmount } = renderHook(() => useLandscapeWhilePlaying(true));
    unmount();
    expect(mockUnlockAsync).toHaveBeenCalled();
  });

  it('does nothing when disabled', () => {
    renderHook(() => useLandscapeWhilePlaying(false));
    expect(mockLockAsync).not.toHaveBeenCalled();
    expect(mockUnlockAsync).not.toHaveBeenCalled();
  });

  it('never surfaces a rejection, because a rotation-locked phone is normal', async () => {
    mockLockAsync.mockRejectedValueOnce(new Error('orientation locked'));
    const { unmount } = renderHook(() => useLandscapeWhilePlaying(true));
    await Promise.resolve();
    expect(() => unmount()).not.toThrow();
    // The unlock still runs so the device is never left in a stale state.
    expect(mockUnlockAsync).toHaveBeenCalled();
  });
});

describe('usePlayerOrientation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLockAsync.mockResolvedValue(undefined);
    mockUnlockAsync.mockResolvedValue(undefined);
  });

  it('starts in landscape so a 16:9 film fills the screen', () => {
    const { result } = renderHook(() => usePlayerOrientation(true));
    expect(result.current.orientation).toBe('landscape');
    expect(mockLockAsync).toHaveBeenCalledWith('LANDSCAPE');
  });

  it('flips to portrait and re-locks without releasing the lock', () => {
    const { result } = renderHook(() => usePlayerOrientation(true));
    act(() => result.current.toggleOrientation());
    expect(result.current.orientation).toBe('portrait');
    expect(mockLockAsync).toHaveBeenLastCalledWith('PORTRAIT_UP');
    // Flipping from the menu must not flash the unlocked layout.
    expect(mockUnlockAsync).not.toHaveBeenCalled();
  });

  it('flips back to landscape from portrait', () => {
    const { result } = renderHook(() => usePlayerOrientation(true));
    act(() => result.current.toggleOrientation());
    act(() => result.current.toggleOrientation());
    expect(result.current.orientation).toBe('landscape');
    expect(mockLockAsync).toHaveBeenLastCalledWith('LANDSCAPE');
  });

  it('re-applies the lock after mounting, in case the view controller was late', () => {
    jest.useFakeTimers();
    try {
      renderHook(() => usePlayerOrientation(true));
      expect(mockLockAsync).toHaveBeenCalledTimes(1);
      act(() => { jest.advanceTimersByTime(1_500); });
      expect(mockLockAsync.mock.calls.length).toBeGreaterThan(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('releases the lock when playback ends', () => {
    const { unmount } = renderHook(() => usePlayerOrientation(true));
    unmount();
    expect(mockUnlockAsync).toHaveBeenCalled();
  });

  it('never touches orientation on a TV or web target', () => {
    const reactNative = require('react-native');
    const original = reactNative.Platform.OS;
    reactNative.Platform.OS = 'web';
    try {
      renderHook(() => usePlayerOrientation(true));
      expect(mockLockAsync).not.toHaveBeenCalled();
    } finally {
      reactNative.Platform.OS = original;
    }
  });
});
