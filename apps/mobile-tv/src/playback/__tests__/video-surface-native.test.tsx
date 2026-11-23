import React from 'react';
import { act, render } from '@testing-library/react-native';
import { AppState, StyleSheet } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { ExpoVideoSurface } from '../ExpoVideoSurface.native';

const mockListeners = new Map<string, (payload: any) => void>();
const mockListenerSets = new Map<string, Array<(payload: any) => void>>();
const mockPlayer: any = {
  play: jest.fn(),
  pause: jest.fn(),
  replaceAsync: jest.fn(async () => undefined),
  playing: false,
  muted: false,
  currentTime: 0,
  duration: 100,
  availableAudioTracks: [],
  availableSubtitleTracks: [],
  addListener: jest.fn((event: string, listener: (payload: any) => void) => {
    mockListeners.set(event, listener);
    const set = mockListenerSets.get(event) ?? [];
    set.push(listener);
    mockListenerSets.set(event, set);
    return {
      remove: jest.fn(() => {
        if (mockListeners.get(event) === listener) mockListeners.delete(event);
      }),
    };
  }),
};

jest.mock('../../i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => (
      key === 'playback.fullscreen' ? 'Fullscreen' : key
    ),
  }),
}));

jest.mock('expo-video', () => ({
  useVideoPlayer: (_source: unknown, setup?: (value: any) => void) => {
    setup?.(mockPlayer);
    return mockPlayer;
  },
  VideoView: () => null,
}));

beforeEach(() => {
  mockListeners.clear();
  mockListenerSets.clear();
  jest.clearAllMocks();
  mockPlayer.playing = false;
});

test('redacts signed native playback errors before exposing them to the UI', () => {
  const onPlaybackError = jest.fn();
  render(
    <ExpoVideoSurface
      source={{
        id: 'signed',
        providerId: 'provider',
        url: 'https://cdn.example/movie.m3u8?token=LOCAL-SECRET',
      }}
      onPlaybackError={onPlaybackError}
    />,
  );

  act(() => {
    mockListeners.get('statusChange')?.({
      status: 'error',
      error: {
        message: 'Failed https://cdn.example/movie.m3u8?token=LOCAL-SECRET',
      },
    });
  });

  expect(onPlaybackError).toHaveBeenCalledWith('Video source failed');
  expect(onPlaybackError.mock.calls[0]?.[0]).not.toContain('LOCAL-SECRET');
  expect(onPlaybackError.mock.calls[0]?.[0]).not.toContain('cdn.example');
});


test('replaces the native source when the transport signature changes', async () => {
  const first = {
    id: 'same',
    providerId: 'provider',
    url: 'https://cdn.example/play/opaque',
    headers: { Referer: 'https://first.example/' },
  };
  const rendered = render(
    <ExpoVideoSurface
      source={first}
      initialPositionSeconds={42}
    />,
  );

  rendered.rerender(
    <ExpoVideoSurface
      source={{
        ...first,
        headers: { Referer: 'https://second.example/' },
        contentType: 'application/vnd.apple.mpegurl',
      }}
      initialPositionSeconds={42}
    />,
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockPlayer.replaceAsync).toHaveBeenCalledWith({
    uri: first.url,
    headers: { Referer: 'https://second.example/' },
    contentType: 'hls',
  });
  expect(mockPlayer.currentTime).toBe(42);
  expect(mockPlayer.play).toHaveBeenCalled();
});


test('ignores a stale native status error after the source signature changes', async () => {
  const onPlaybackError = jest.fn();
  const first = {
    id: 'same',
    providerId: 'provider',
    url: 'https://cdn.example/old.m3u8',
  };
  const rendered = render(
    <ExpoVideoSurface
      source={first}
      onPlaybackError={onPlaybackError}
    />,
  );

  const staleStatusChange = mockListenerSets.get('statusChange')?.[0];
  expect(staleStatusChange).toBeDefined();

  rendered.rerender(
    <ExpoVideoSurface
      source={{
        ...first,
        url: 'https://cdn.example/new.m3u8',
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
      error: { message: 'old source failed late' },
    });
  });

  expect(onPlaybackError).not.toHaveBeenCalled();
});


test('resumes native movie playback after foreground only when it was playing', () => {
  let appStateListener: ((state: string) => void) | undefined;
  const addEventListenerSpy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(((_event: string, listener: (state: string) => void) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    }) as typeof AppState.addEventListener);

  mockPlayer.playing = true;
  render(
    <ExpoVideoSurface
      source={{
        id: 'resume',
        providerId: 'provider',
        url: 'https://cdn.example/movie.mp4',
      }}
    />,
  );
  mockPlayer.play.mockClear();
  mockPlayer.pause.mockClear();

  act(() => {
    appStateListener?.('background');
  });
  expect(mockPlayer.pause).toHaveBeenCalled();

  mockPlayer.playing = false;
  act(() => {
    appStateListener?.('active');
  });
  expect(mockPlayer.play).toHaveBeenCalled();

  addEventListenerSpy.mockRestore();
});

test('does not auto-resume a native movie that was already paused before background', () => {
  let appStateListener: ((state: string) => void) | undefined;
  const addEventListenerSpy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(((_event: string, listener: (state: string) => void) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    }) as typeof AppState.addEventListener);

  mockPlayer.playing = false;
  render(
    <ExpoVideoSurface
      source={{
        id: 'paused',
        providerId: 'provider',
        url: 'https://cdn.example/movie.mp4',
      }}
    />,
  );
  mockPlayer.play.mockClear();
  mockPlayer.pause.mockClear();

  act(() => {
    appStateListener?.('background');
    appStateListener?.('active');
  });

  expect(mockPlayer.pause).not.toHaveBeenCalled();
  expect(mockPlayer.play).not.toHaveBeenCalled();

  addEventListenerSpy.mockRestore();
});


test('defers native source replacement playback until foreground when backgrounded', async () => {
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

  const first = {
    id: 'same',
    providerId: 'provider',
    url: 'https://cdn.example/old.m3u8',
  };
  const rendered = render(<ExpoVideoSurface source={first} />);

  mockPlayer.play.mockClear();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'background',
  });

  rendered.rerender(
    <ExpoVideoSurface
      source={{
        ...first,
        url: 'https://cdn.example/new.m3u8',
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


test('starts a movie on foreground after mounting while backgrounded', () => {
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
    <ExpoVideoSurface
      source={{
        id: 'background-mount',
        providerId: 'provider',
        url: 'https://cdn.example/movie.mp4',
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

describe('audio track reporting', () => {
  const english = { id: 'audio-en', language: 'en', label: 'English' };
  const french = { id: 'audio-fr', language: 'fr', label: 'French' };

  // Earlier tests leave nested `AppState.addEventListener` spies installed;
  // restoring them leaves the property returning undefined, which breaks the
  // surface's unmount cleanup. Install a working stub explicitly.
  let appStateSpy: jest.SpyInstance | undefined;

  beforeEach(() => {
    jest.restoreAllMocks();
    appStateSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((() => ({ remove: jest.fn() })) as never);
    mockPlayer.availableAudioTracks = [];
    mockPlayer.availableSubtitleTracks = [];
    mockPlayer.audioTrack = null;
  });

  afterEach(() => {
    appStateSpy?.mockRestore();
  });

  test('reports tracks that only become available after readyToPlay', () => {
    const onAudioTracksChange = jest.fn();
    render(
      <ExpoVideoSurface
        source={{
          id: 'late-tracks',
          providerId: 'provider',
          url: 'https://cdn.example/movie.mp4',
        }}
        onAudioTracksChange={onAudioTracksChange}
      />,
    );

    // AVPlayer resolves media selection groups after the item reports ready,
    // so sourceLoad can arrive with no tracks at all.
    act(() => {
      mockListeners.get('sourceLoad')?.({ duration: 100, availableAudioTracks: [] });
    });
    expect(onAudioTracksChange).toHaveBeenLastCalledWith([], null);

    mockPlayer.availableAudioTracks = [english, french];
    act(() => {
      mockListeners.get('statusChange')?.({ status: 'readyToPlay' });
    });

    expect(onAudioTracksChange).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({ id: 'embedded-audio:audio-en' }),
        expect.objectContaining({ id: 'embedded-audio:audio-fr' }),
      ],
      'embedded-audio:audio-en',
    );
    expect(mockPlayer.audioTrack).toBe(english);
  });

  test('an empty sourceLoad payload does not hide tracks the player already exposes', () => {
    const onAudioTracksChange = jest.fn();
    mockPlayer.availableAudioTracks = [english, french];
    render(
      <ExpoVideoSurface
        source={{
          id: 'known-tracks',
          providerId: 'provider',
          url: 'https://cdn.example/movie.mp4',
        }}
        onAudioTracksChange={onAudioTracksChange}
      />,
    );

    act(() => {
      mockListeners.get('sourceLoad')?.({ duration: 100, availableAudioTracks: [] });
    });

    expect(onAudioTracksChange).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({ id: 'embedded-audio:audio-en' }),
        expect.objectContaining({ id: 'embedded-audio:audio-fr' }),
      ],
      'embedded-audio:audio-en',
    );
  });
});

test('keeps the picture clear of a punch-hole camera in portrait', () => {
  // Earlier tests leave nested `AppState.addEventListener` spies installed.
  const appStateStub = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((() => ({ remove: jest.fn() })) as never);
  const view = render(
    <SafeAreaInsetsContext.Provider value={{ top: 34, right: 0, bottom: 0, left: 0 }}>
      <ExpoVideoSurface source={{ id: 'movie', url: 'https://cdn.example/movie.mp4' }} testID="native-video" />
    </SafeAreaInsetsContext.Provider>,
  );

  const frame = StyleSheet.flatten(
    view.getByTestId('native-video-safe-frame').props.style,
  );
  expect(frame.paddingTop).toBe(34);
  appStateStub.mockRestore();
});
