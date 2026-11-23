import React from 'react';
import { renderHook } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useSafeVideoFrame } from '../useSafeVideoFrame';

function wrapperWith(insets: { top: number; right: number; bottom: number; left: number }) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <SafeAreaInsetsContext.Provider value={insets}>
        {children}
      </SafeAreaInsetsContext.Provider>
    );
  };
}

describe('useSafeVideoFrame', () => {
  it('reports every edge the OS says is blocked', () => {
    const { result } = renderHook(() => useSafeVideoFrame(), {
      // A notched iPhone in landscape: the island is a side inset.
      wrapper: wrapperWith({ top: 0, right: 0, bottom: 21, left: 59 }),
    });
    expect(result.current).toEqual({ top: 0, right: 0, bottom: 21, left: 59 });
  });

  it('reports top and bottom insets in portrait, where the island sits above the picture', () => {
    const { result } = renderHook(() => useSafeVideoFrame(), {
      wrapper: wrapperWith({ top: 62, right: 0, bottom: 34, left: 0 }),
    });
    expect(result.current).toEqual({ top: 62, right: 0, bottom: 34, left: 0 });
  });

  it('returns no padding when there is no provider', () => {
    const { result } = renderHook(() => useSafeVideoFrame());
    expect(result.current).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('never lets a malformed inset collapse or overflow the frame', () => {
    const { result } = renderHook(() => useSafeVideoFrame(), {
      wrapper: wrapperWith({
        top: Number.NaN,
        right: -40,
        bottom: Number.POSITIVE_INFINITY,
        left: 9_999,
      }),
    });
    expect(result.current).toEqual({ top: 0, right: 0, bottom: 0, left: 240 });
  });
});
