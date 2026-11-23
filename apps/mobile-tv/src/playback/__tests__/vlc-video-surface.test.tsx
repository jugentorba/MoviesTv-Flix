import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { VlcVideoSurface } from '../VlcVideoSurface.native';

let mockProps: any;
const mockPlayer = {
  play: jest.fn(),
  pause: jest.fn(),
  seek: jest.fn(),
  release: jest.fn(),
  getTracks: jest.fn(),
  selectAudioTrack: jest.fn(),
  selectSubtitleTrack: jest.fn(),
};

jest.mock('../../i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

jest.mock('@lunarr/vlc-player', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  const VLCPlayer = ReactModule.forwardRef((props: any, ref: any) => {
    mockProps = props;
    ReactModule.useImperativeHandle(ref, () => mockPlayer);
    return ReactModule.createElement(View, { testID: 'vlc-native' });
  });
  return { __esModule: true, default: VLCPlayer };
});

beforeEach(() => {
  mockProps = undefined;
  for (const fn of Object.values(mockPlayer)) fn.mockClear();
});

const source = {
  id: 'movie-mkv',
  url: 'https://cdn.example/movie.mkv',
  contentType: 'video/x-matroska',
};

test('seeks to the resume position and asks for tracks once loaded', () => {
  render(<VlcVideoSurface source={source} initialPositionSeconds={42} />);

  act(() => mockProps.onLoad({ duration: 100 }));

  expect(mockPlayer.seek).toHaveBeenCalledWith(42);
  expect(mockPlayer.getTracks).toHaveBeenCalled();
});

test('selects the preferred audio language and reports VLC track ids', () => {
  const onAudioTracksChange = jest.fn();
  render(
    <VlcVideoSurface
      source={source}
      preferredAudioLanguages={['fr']}
      onAudioTracksChange={onAudioTracksChange}
    />,
  );

  act(() => mockProps.onTracks({
    audio: [{ id: 1, name: 'English' }, { id: 2, name: 'French' }],
    audioIndex: 1,
    subtitle: [],
    subtitleIndex: -1,
  }));

  expect(mockPlayer.selectAudioTrack).toHaveBeenCalledWith(2);
  expect(onAudioTracksChange).toHaveBeenLastCalledWith(
    [
      { id: 'vlc-audio:1', language: 'en', label: 'English' },
      { id: 'vlc-audio:2', language: 'fr', label: 'French' },
    ],
    'vlc-audio:2',
  );
});

test('disables embedded subtitles unless the preference enables them', () => {
  const onEmbeddedSubtitleTracksChange = jest.fn();
  render(
    <VlcVideoSurface
      source={source}
      onEmbeddedSubtitleTracksChange={onEmbeddedSubtitleTracksChange}
    />,
  );

  act(() => mockProps.onTracks({
    audio: [],
    audioIndex: -1,
    subtitle: [{ id: 5, name: 'English' }],
    subtitleIndex: 5,
  }));

  expect(mockPlayer.selectSubtitleTrack).toHaveBeenCalledWith(-1);
  expect(onEmbeddedSubtitleTracksChange).toHaveBeenLastCalledWith(
    [{ id: 'vlc-subtitle:5', language: 'en', label: 'English' }],
    null,
  );
});

test('applies the preferred subtitle language when embedded subtitles are on', () => {
  const onEmbeddedSubtitleTracksChange = jest.fn();
  render(
    <VlcVideoSurface
      source={source}
      embeddedSubtitlesEnabled
      preferredSubtitleLanguages={['en']}
      onEmbeddedSubtitleTracksChange={onEmbeddedSubtitleTracksChange}
    />,
  );

  act(() => mockProps.onTracks({
    audio: [],
    audioIndex: -1,
    subtitle: [{ id: 5, name: 'English' }],
    subtitleIndex: -1,
  }));

  expect(mockPlayer.selectSubtitleTrack).toHaveBeenCalledWith(5);
  expect(onEmbeddedSubtitleTracksChange).toHaveBeenLastCalledWith(
    [{ id: 'vlc-subtitle:5', language: 'en', label: 'English' }],
    'vlc-subtitle:5',
  );
});

test('forwards progress, end and errors to the playback overlay', () => {
  const onProgress = jest.fn();
  const onEnded = jest.fn();
  const onPlaybackError = jest.fn();
  render(
    <VlcVideoSurface
      source={source}
      onProgress={onProgress}
      onEnded={onEnded}
      onPlaybackError={onPlaybackError}
    />,
  );

  act(() => mockProps.onProgress({ currentTime: 12, duration: 100 }));
  expect(onProgress).toHaveBeenCalledWith(12, 100);

  act(() => mockProps.onEnd({ duration: 100 }));
  expect(onEnded).toHaveBeenCalled();

  // The first failure retries with a conservative buffer instead of giving up,
  // so the overlay only hears about it once the retry also fails.
  act(() => mockProps.onError());
  expect(onPlaybackError).not.toHaveBeenCalled();

  act(() => mockProps.onError());
  expect(onPlaybackError).toHaveBeenCalledWith('Video source failed');
});

test('forwards request identity without leaking credential headers', () => {
  render(
    <VlcVideoSurface
      source={{
        ...source,
        headers: {
          'User-Agent': 'Agent/1.0',
          Referer: 'https://ref.example/',
          Authorization: 'Bearer LOCAL-SECRET',
          Cookie: 'session=LOCAL-SECRET',
        },
      }}
    />,
  );

  const options: string[] = mockProps.source.mediaOptions;
  expect(options).toContain('http-user-agent=Agent/1.0');
  expect(options).toContain('http-referrer=https://ref.example/');
  expect(options.join(' ')).not.toContain('LOCAL-SECRET');
  expect(mockProps.source.uri).toBe(source.url);
});

test('releases the native player when the surface unmounts', () => {
  const view = render(<VlcVideoSurface source={source} />);

  view.unmount();

  expect(mockPlayer.release).toHaveBeenCalled();
});

/*
 * Regression: the library's useImperativeHandle has no dependency array, so
 * React re-applies the ref on every render (ref(null), then the new handle).
 * Releasing on that transient null destroyed the libvlc player on the first
 * re-render, so no load/progress event ever arrived.
 */
test('keeps the native player alive across re-renders', () => {
  const view = render(<VlcVideoSurface source={source} />);

  view.rerender(<VlcVideoSurface source={source} />);
  view.rerender(<VlcVideoSurface source={source} />);

  expect(mockPlayer.release).not.toHaveBeenCalled();
});

test('does not release the player when a progress event re-renders the surface', () => {
  render(<VlcVideoSurface source={source} />);

  act(() => mockProps.onLoad({ duration: 100 }));
  act(() => mockProps.onProgress({ currentTime: 5, duration: 100 }));

  expect(mockPlayer.release).not.toHaveBeenCalled();
});

test('stops reporting progress after unmount', () => {
  const onProgress = jest.fn();
  const view = render(
    <VlcVideoSurface source={source} onProgress={onProgress} />,
  );

  act(() => mockProps.onLoad({ duration: 100 }));
  act(() => mockProps.onProgress({ currentTime: 3, duration: 100 }));

  expect(onProgress).toHaveBeenCalledWith(3, 100);

  view.unmount();

  expect(mockPlayer.release).toHaveBeenCalledTimes(1);
});

test('keeps the picture clear of the Dynamic Island when held in landscape', () => {
  // On a notched iPhone in landscape the island is reported as a side inset.
  const view = render(
    <SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom: 21, left: 59 }}>
      <VlcVideoSurface source={source} testID="native-video" />
    </SafeAreaInsetsContext.Provider>,
  );

  const frame = StyleSheet.flatten(
    view.getByTestId('native-video-safe-frame').props.style,
  );
  expect(frame.paddingLeft).toBe(59);
  expect(frame.paddingBottom).toBe(21);
});
