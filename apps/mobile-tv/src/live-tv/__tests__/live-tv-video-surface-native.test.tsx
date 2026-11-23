import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { LiveTvVideoSurface } from '../LiveTvVideoSurface.native';
import {
  LIVE_TV_STALL_TIMEOUT_MS,
  LIVE_TV_START_TIMEOUT_MS,
} from '../liveTvPlaybackHealth';

const mockListeners = new Map<string, (...args: any[]) => void>();
const listenerSets = new Map<string, Array<(...args: any[]) => void>>();
let mockVideoSource: unknown;
const mockPlayer: any = {
  play: jest.fn(),
  pause: jest.fn(),
  replaceAsync: jest.fn(async () => undefined),
  availableAudioTracks: [],
  audioTrack: null,
  addListener: jest.fn((event: string, listener: (...args: any[]) => void) => {
    mockListeners.set(event, listener);
    const set = listenerSets.get(event) ?? [];
    set.push(listener);
    listenerSets.set(event, set);
    return {
      remove: jest.fn(() => {
        if (mockListeners.get(event) === listener) {
          mockListeners.delete(event);
        }
      }),
    };
  }),
};

jest.mock('expo-video', () => ({
  useVideoPlayer: (source: unknown, setup?: (player: any) => void) => {
    mockVideoSource = source;
    setup?.(mockPlayer);
    return mockPlayer;
  },
  VideoView: () => null,
}));

beforeEach(() => {
  // mockRestore on an already mocked RN method clears its implementation.
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  mockVideoSource = undefined;
  mockListeners.clear();
  listenerSets.clear();
  mockPlayer.play.mockClear();
  mockPlayer.pause.mockClear();
  mockPlayer.replaceAsync.mockClear();
  mockPlayer.addListener.mockClear();
  mockPlayer.availableAudioTracks = [];
  mockPlayer.audioTrack = null;
});

test('native Live TV video surface is focusable and opens the channel list on OK/press', () => {
  const onPress = jest.fn();
  const view = render(
    <LiveTvVideoSurface
      source={{
        id: 'live',
        url: 'https://stream.example/live.m3u8',
      }}
      testID="live-tv-player"
      onPress={onPress}
    />,
  );

  const surface = view.getByTestId('live-tv-player-tap-surface');
  expect(surface.props.focusable).toBe(true);

  fireEvent.press(surface);

  expect(onPress).toHaveBeenCalledTimes(1);
});

test('selects the preferred embedded Live TV audio track after source load', () => {
  render(
    <LiveTvVideoSurface
      source={{
        id: 'live',
        url: 'https://stream.example/live.m3u8',
      }}
      preferredAudioLanguages={['fr', 'en', 'de']}
    />,
  );

  const english = { id: 'en', language: 'eng', label: 'English' };
  const french = { id: 'fr', language: 'fra', label: 'French' };
  mockPlayer.availableAudioTracks = [english, french];

  act(() => {
    mockListeners.get('sourceLoad')?.();
  });

  expect(mockPlayer.audioTrack).toBe(french);
  expect(mockVideoSource).toEqual({
    uri: 'https://stream.example/live.m3u8',
    contentType: 'hls',
  });
});

test('selects the preferred Live TV audio track that only appears after readyToPlay', () => {
  render(
    <LiveTvVideoSurface
      source={{
        id: 'live',
        url: 'https://stream.example/live.m3u8',
      }}
      preferredAudioLanguages={['fr']}
    />,
  );

  // AVPlayer resolves its audio selection group after the item loads, so the
  // sourceLoad payload can be empty.
  act(() => {
    mockListeners.get('sourceLoad')?.({ availableAudioTracks: [] });
  });
  expect(mockPlayer.audioTrack).toBeNull();

  const english = { id: 'en', language: 'eng', label: 'English' };
  const french = { id: 'fr', language: 'fra', label: 'French' };
  mockPlayer.availableAudioTracks = [english, french];
  act(() => {
    // The surface registers two status listeners; both must see the event.
    for (const listener of listenerSets.get('statusChange') ?? []) {
      listener({ status: 'readyToPlay' });
    }
  });

  expect(mockPlayer.audioTrack).toBe(french);
});

test('honors German when it is first in the Live TV audio preference order', () => {
  render(
    <LiveTvVideoSurface
      source={{
        id: 'live',
        url: 'https://stream.example/live.m3u8',
      }}
      preferredAudioLanguages={['de', 'fr', 'en']}
    />,
  );

  const french = { id: 'fr', language: 'fr', label: 'French' };
  const german = { id: 'de', language: 'ger', label: 'German' };
  mockPlayer.availableAudioTracks = [french, german];

  act(() => {
    mockListeners.get('sourceLoad')?.();
  });

  expect(mockPlayer.audioTrack).toBe(german);
});


test('same-URL native fallback with different headers gets its own failure attempt', () => {
  const onPlaybackError = jest.fn();
  const rendered = render(
    <LiveTvVideoSurface
      source={{
        id: 'live',
        url: 'https://stream.example/live.m3u8',
        headers: { Referer: 'https://first.example/' },
      }}
      onPlaybackError={onPlaybackError}
    />,
  );

  act(() => {
    mockListeners.get('statusChange')?.({
      status: 'error',
      error: { message: 'first failed' },
    });
  });
  expect(onPlaybackError).toHaveBeenCalledTimes(1);

  rendered.rerender(
    <LiveTvVideoSurface
      source={{
        id: 'live',
        url: 'https://stream.example/live.m3u8',
        headers: { Referer: 'https://second.example/' },
      }}
      onPlaybackError={onPlaybackError}
    />,
  );

  act(() => {
    mockListeners.get('statusChange')?.({
      status: 'error',
      error: { message: 'second failed' },
    });
  });

  expect(onPlaybackError).toHaveBeenCalledTimes(2);
  expect(onPlaybackError).toHaveBeenLastCalledWith('second failed');
});


test('reports native Live TV that never starts', () => {
  jest.useFakeTimers();
  const onPlaybackError = jest.fn();
  const rendered = render(
    <LiveTvVideoSurface
      source={{
        id: 'startup-stall',
        url: 'https://stream.example/startup.m3u8',
      }}
      onPlaybackError={onPlaybackError}
    />,
  );

  try {
    act(() => {
      jest.advanceTimersByTime(LIVE_TV_START_TIMEOUT_MS - 1);
    });
    expect(onPlaybackError).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onPlaybackError).toHaveBeenCalledWith(
      'Live TV source did not start in time',
    );
  } finally {
    rendered.unmount();
    jest.useRealTimers();
  }
});

test('reports native Live TV that stalls after playback began', () => {
  jest.useFakeTimers();
  const onPlaybackError = jest.fn();
  const rendered = render(
    <LiveTvVideoSurface
      source={{
        id: 'midstream-stall',
        url: 'https://stream.example/live.m3u8',
      }}
      onPlaybackError={onPlaybackError}
    />,
  );

  try {
    act(() => {
      mockListeners.get('playingChange')?.({ isPlaying: true });
      mockListeners.get('playingChange')?.({ isPlaying: false });
      jest.advanceTimersByTime(LIVE_TV_STALL_TIMEOUT_MS);
    });

    expect(onPlaybackError).toHaveBeenCalledWith(
      'Live TV source stalled for too long',
    );
  } finally {
    rendered.unmount();
    jest.useRealTimers();
  }
});

test('native Live TV stall recovery is cancelled when playback resumes', () => {
  jest.useFakeTimers();
  const onPlaybackError = jest.fn();
  const rendered = render(
    <LiveTvVideoSurface
      source={{
        id: 'recovered-stall',
        url: 'https://stream.example/live.m3u8',
      }}
      onPlaybackError={onPlaybackError}
    />,
  );

  try {
    act(() => {
      mockListeners.get('playingChange')?.({ isPlaying: true });
      mockListeners.get('playingChange')?.({ isPlaying: false });
      jest.advanceTimersByTime(Math.floor(LIVE_TV_STALL_TIMEOUT_MS / 2));
      mockListeners.get('playingChange')?.({ isPlaying: true });
      jest.advanceTimersByTime(LIVE_TV_STALL_TIMEOUT_MS);
    });

    expect(onPlaybackError).not.toHaveBeenCalled();
  } finally {
    rendered.unmount();
    jest.useRealTimers();
  }
});


test('selects preferred audio when native HLS tracks arrive after source load', () => {
  render(
    <LiveTvVideoSurface
      source={{
        id: 'late-tracks',
        url: 'https://stream.example/play/opaque',
        contentType: 'application/vnd.apple.mpegurl',
      }}
      preferredAudioLanguages={['fr', 'en', 'de']}
    />,
  );

  const english = { id: 'en', language: 'en', label: 'English' };
  const french = { id: 'fr', language: 'fr', label: 'French' };
  mockPlayer.availableAudioTracks = [english, french];

  act(() => {
    mockListeners.get('availableAudioTracksChange')?.({
      availableAudioTracks: [english, french],
    });
  });

  expect(mockPlayer.audioTrack).toBe(french);
});


test('redacts signed provider details from native Live TV errors', () => {
  const onPlaybackError = jest.fn();

  render(
    <LiveTvVideoSurface
      source={{
        id: 'signed-error',
        url: 'https://stream.example/live.m3u8',
      }}
      onPlaybackError={onPlaybackError}
    />,
  );

  act(() => {
    mockListeners.get('statusChange')?.({
      status: 'error',
      error: {
        message: 'Failed https://cdn.example/live.m3u8?token=LOCAL-SECRET',
      },
    });
  });

  expect(onPlaybackError).toHaveBeenCalledWith('Live TV source failed');
  expect(onPlaybackError.mock.calls.flat().join(' '))
    .not.toContain('LOCAL-SECRET');
});


test('replaces native Live TV source when signed transport metadata changes', async () => {
  const rendered = render(
    <LiveTvVideoSurface
      source={{
        id: 'live',
        url: 'https://stream.example/opaque',
        headers: { Referer: 'https://first.example/' },
      }}
    />,
  );

  rendered.rerender(
    <LiveTvVideoSurface
      source={{
        id: 'live',
        url: 'https://stream.example/opaque',
        headers: { Referer: 'https://second.example/' },
        contentType: 'application/vnd.apple.mpegurl',
      }}
    />,
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockPlayer.replaceAsync).toHaveBeenCalledWith({
    uri: 'https://stream.example/opaque',
    headers: { Referer: 'https://second.example/' },
    contentType: 'hls',
  });
  expect(mockPlayer.play).toHaveBeenCalled();
});


test('ignores a stale Live TV native error after source replacement', async () => {
  const onPlaybackError = jest.fn();
  const rendered = render(
    <LiveTvVideoSurface
      source={{
        id: 'live',
        url: 'https://stream.example/old.m3u8',
      }}
      onPlaybackError={onPlaybackError}
    />,
  );

  const staleStatusChange = listenerSets.get('statusChange')?.[0];
  expect(staleStatusChange).toBeDefined();

  rendered.rerender(
    <LiveTvVideoSurface
      source={{
        id: 'live',
        url: 'https://stream.example/new.m3u8',
      }}
      onPlaybackError={onPlaybackError}
    />,
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  act(() => {
    staleStatusChange?.({
      status: 'error',
      error: { message: 'old live source failed late' },
    });
  });

  expect(onPlaybackError).not.toHaveBeenCalled();
});


test('defers refreshed native Live TV playback until foreground', async () => {
  let appStateListener: ((state: string) => void) | undefined;
  const addEventListenerSpy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(((_event: string, listener: (state: string) => void) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    }) as typeof AppState.addEventListener);
  const originalState = AppState.currentState;
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });

  const rendered = render(
    <LiveTvVideoSurface
      source={{
        id: 'live',
        url: 'https://stream.example/old.m3u8',
      }}
    />,
  );

  mockPlayer.play.mockClear();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'background',
  });

  rendered.rerender(
    <LiveTvVideoSurface
      source={{
        id: 'live',
        url: 'https://stream.example/new.m3u8',
      }}
    />,
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockPlayer.replaceAsync).toHaveBeenCalled();
  expect(mockPlayer.play).not.toHaveBeenCalled();

  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  act(() => {
    appStateListener?.('active');
  });

  expect(mockPlayer.play).toHaveBeenCalledTimes(1);

  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: originalState,
  });
  addEventListenerSpy.mockRestore();
});


test('does not start native Live TV from sourceLoad while backgrounded', () => {
  let appStateListener: ((state: string) => void) | undefined;
  const addEventListenerSpy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(((_event: string, listener: (state: string) => void) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    }) as typeof AppState.addEventListener);
  const originalState = AppState.currentState;
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'background',
  });

  render(
    <LiveTvVideoSurface
      source={{
        id: 'background-load',
        url: 'https://stream.example/live.m3u8',
      }}
    />,
  );
  mockPlayer.play.mockClear();

  act(() => {
    mockListeners.get('sourceLoad')?.();
  });

  expect(mockPlayer.play).not.toHaveBeenCalled();

  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  act(() => {
    appStateListener?.('active');
  });

  expect(mockPlayer.play).toHaveBeenCalledTimes(1);

  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: originalState,
  });
  addEventListenerSpy.mockRestore();
});


test('starts Live TV on foreground after mounting while backgrounded', () => {
  let appStateListener: ((state: string) => void) | undefined;
  const addEventListenerSpy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(((_event: string, listener: (state: string) => void) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    }) as typeof AppState.addEventListener);
  const originalState = AppState.currentState;
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'background',
  });

  render(
    <LiveTvVideoSurface
      source={{
        id: 'background-mount',
        url: 'https://stream.example/live.m3u8',
      }}
    />,
  );

  expect(mockPlayer.play).not.toHaveBeenCalled();

  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  act(() => {
    appStateListener?.('active');
  });

  expect(mockPlayer.play).toHaveBeenCalledTimes(1);

  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: originalState,
  });
  addEventListenerSpy.mockRestore();
});


test('pauses active native Live TV while backgrounded and resumes once', () => {
  let appStateListener: ((state: string) => void) | undefined;
  const addEventListenerSpy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(((_event: string, listener: (state: string) => void) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    }) as typeof AppState.addEventListener);
  const originalState = AppState.currentState;
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });

  try {
    render(
      <LiveTvVideoSurface
        source={{
          id: 'background-pause',
          url: 'https://stream.example/live.m3u8',
        }}
      />,
    );

    act(() => {
      mockListeners.get('playingChange')?.({ isPlaying: true });
    });
    mockPlayer.play.mockClear();

    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'background',
    });
    act(() => {
      appStateListener?.('background');
    });

    expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
    expect(mockPlayer.play).not.toHaveBeenCalled();

    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    act(() => {
      appStateListener?.('active');
    });

    expect(mockPlayer.play).toHaveBeenCalledTimes(1);

    act(() => {
      appStateListener?.('active');
    });
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  } finally {
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: originalState,
    });
    addEventListenerSpy.mockRestore();
  }
});


test('does not treat an intentional background pause as a Live TV stall', () => {
  jest.useFakeTimers();
  let appStateListener: ((state: string) => void) | undefined;
  const addEventListenerSpy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(((_event: string, listener: (state: string) => void) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    }) as typeof AppState.addEventListener);
  const originalState = AppState.currentState;
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  const onPlaybackError = jest.fn();

  try {
    render(
      <LiveTvVideoSurface
        source={{
          id: 'background-no-stall',
          url: 'https://stream.example/live.m3u8',
        }}
        onPlaybackError={onPlaybackError}
      />,
    );

    act(() => {
      mockListeners.get('playingChange')?.({ isPlaying: true });
    });

    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'background',
    });
    act(() => {
      appStateListener?.('background');
      mockListeners.get('playingChange')?.({ isPlaying: false });
      jest.advanceTimersByTime(LIVE_TV_STALL_TIMEOUT_MS);
    });

    expect(onPlaybackError).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: originalState,
    });
    addEventListenerSpy.mockRestore();
    jest.useRealTimers();
  }
});


test('uses Live TV sourceLoad audio payload when player tracks lag', () => {
  render(
    <LiveTvVideoSurface
      source={{
        id: 'payload-live',
        url: 'https://stream.example/play/opaque',
        contentType: 'application/vnd.apple.mpegurl',
      }}
      preferredAudioLanguages={['fr', 'en', 'de']}
    />,
  );

  const english = { id: 'en', language: 'en', label: 'English' };
  const french = { id: 'fr', language: 'fr', label: 'French' };
  mockPlayer.availableAudioTracks = [];

  act(() => {
    mockListeners.get('sourceLoad')?.({
      availableAudioTracks: [english, french],
      availableSubtitleTracks: [],
      availableVideoTracks: [],
      duration: 0,
    });
  });

  expect(mockPlayer.audioTrack).toBe(french);
});


test('uses Live TV track-change payload when player properties lag', () => {
  render(
    <LiveTvVideoSurface
      source={{
        id: 'late-payload-live',
        url: 'https://stream.example/play/opaque',
        contentType: 'application/vnd.apple.mpegurl',
      }}
      preferredAudioLanguages={['fr', 'en', 'de']}
    />,
  );

  const english = { id: 'en', language: 'en', label: 'English' };
  const french = { id: 'fr', language: 'fr', label: 'French' };
  mockPlayer.availableAudioTracks = [];

  act(() => {
    mockListeners.get('availableAudioTracksChange')?.({
      availableAudioTracks: [english, french],
    });
  });

  expect(mockPlayer.audioTrack).toBe(french);
});
