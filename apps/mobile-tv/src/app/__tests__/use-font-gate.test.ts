import { act, renderHook } from '@testing-library/react-native';

import { FONT_GATE_GRACE_MS, useFontGate } from '../useFontGate';

describe('useFontGate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stays closed while fonts are pending', () => {
    const { result } = renderHook(() => useFontGate(false, null));
    expect(result.current).toBe(false);
  });

  it('opens when the fonts load', () => {
    const { result } = renderHook(() => useFontGate(true, null));
    expect(result.current).toBe(true);
  });

  it('opens when the fonts fail instead of hiding the app', () => {
    const { result } = renderHook(() => useFontGate(false, new Error('missing')));
    expect(result.current).toBe(true);
  });

  it('opens after the grace period when the observer never settles', () => {
    const { result } = renderHook(() => useFontGate(false, null));
    expect(result.current).toBe(false);

    act(() => {
      jest.advanceTimersByTime(FONT_GATE_GRACE_MS - 1);
    });
    expect(result.current).toBe(false);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);
  });

  it('cancels the timer once the fonts arrive', () => {
    const { result, rerender } = renderHook(
      ({ loaded }: { loaded: boolean }) => useFontGate(loaded, null),
      { initialProps: { loaded: false } },
    );

    rerender({ loaded: true });
    expect(result.current).toBe(true);

    act(() => {
      jest.advanceTimersByTime(FONT_GATE_GRACE_MS * 2);
    });
    expect(result.current).toBe(true);
  });
});
