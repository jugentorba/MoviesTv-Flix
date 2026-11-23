import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { VideoSurface, shouldPreferVlc, shouldRetryWithVlc } from '../VideoSurface.native';
import { NATIVE_FORMAT_PLAYBACK_ERROR } from '../playbackError';

let mockExpoProps: any;
let mockVlcProps: any;

jest.mock('../ExpoVideoSurface.native', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return {
    ExpoVideoSurface: (props: any) => {
      mockExpoProps = props;
      return ReactModule.createElement(View, { testID: 'expo-surface' });
    },
  };
});

jest.mock('../VlcVideoSurface.native', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  return {
    VlcVideoSurface: (props: any) => {
      mockVlcProps = props;
      return ReactModule.createElement(View, { testID: 'vlc-surface' });
    },
  };
});

beforeEach(() => {
  mockExpoProps = undefined;
  mockVlcProps = undefined;
});

const mp4Source = {
  id: 'movie-mp4',
  url: 'https://cdn.example/movie.mp4',
  contentType: 'video/mp4',
};

test('keeps normal HLS/MP4 on Expo until native playback fails', () => {
  const onPlaybackError = jest.fn();
  render(
    <VideoSurface
      source={mp4Source}
      onPlaybackError={onPlaybackError}
    />,
  );

  expect(screen.getByTestId('expo-surface')).toBeTruthy();
  expect(screen.queryByTestId('vlc-surface')).toBeNull();

  act(() => {
    mockExpoProps.onPlaybackError(NATIVE_FORMAT_PLAYBACK_ERROR);
  });

  expect(screen.getByTestId('vlc-surface')).toBeTruthy();
  expect(onPlaybackError).not.toHaveBeenCalled();

  act(() => {
    mockVlcProps.onPlaybackError('Video source failed');
  });

  expect(onPlaybackError).toHaveBeenCalledWith('Video source failed');
});

test('ordinary native errors stay on the existing provider failover path', () => {
  const onPlaybackError = jest.fn();
  render(
    <VideoSurface
      source={mp4Source}
      onPlaybackError={onPlaybackError}
    />,
  );

  act(() => {
    mockExpoProps.onPlaybackError('Network timeout');
  });

  expect(screen.getByTestId('expo-surface')).toBeTruthy();
  expect(screen.queryByTestId('vlc-surface')).toBeNull();
  expect(onPlaybackError).toHaveBeenCalledWith('Network timeout');
});

test('starts VLC directly for containers/codecs AVPlayer commonly rejects', () => {
  render(
    <VideoSurface
      source={{
        id: 'movie-mkv',
        url: 'https://cdn.example/movie.mkv',
        filename: 'movie.mkv',
        contentType: 'video/x-matroska',
      }}
    />,
  );

  expect(screen.getByTestId('vlc-surface')).toBeTruthy();
  expect(screen.queryByTestId('expo-surface')).toBeNull();
});

test('changing media resets a previous VLC fallback decision', () => {
  const view = render(<VideoSurface source={mp4Source} />);

  act(() => {
    mockExpoProps.onPlaybackError(NATIVE_FORMAT_PLAYBACK_ERROR);
  });
  expect(screen.getByTestId('vlc-surface')).toBeTruthy();

  act(() => {
    view.rerender(
      <VideoSurface
        source={{
          id: 'next-movie',
          url: 'https://cdn.example/next.mp4',
          contentType: 'video/mp4',
        }}
      />,
    );
  });

  expect(screen.getByTestId('expo-surface')).toBeTruthy();
});

test('VLC policy and retry classifier cover known native incompatibilities', () => {
  expect(shouldPreferVlc({
    id: 'dts',
    url: 'https://cdn.example/movie.mp4',
    audioCodec: 'dts',
  })).toBe(true);
  expect(shouldPreferVlc(mp4Source)).toBe(false);
  expect(shouldRetryWithVlc(NATIVE_FORMAT_PLAYBACK_ERROR)).toBe(true);
  expect(shouldRetryWithVlc('Video source failed')).toBe(false);
  expect(shouldRetryWithVlc('AVFoundationErrorDomain -11828')).toBe(false);
  expect(shouldRetryWithVlc('Network timeout')).toBe(false);
});

test('container detection ignores query strings and header case', () => {
  expect(shouldPreferVlc({
    id: 'signed',
    url: 'https://cdn.example/stream?file=movie.MKV&token=abc',
  })).toBe(false);
  expect(shouldPreferVlc({
    id: 'signed-path',
    url: 'https://cdn.example/movie.MKV?token=abc',
  })).toBe(true);
  expect(shouldPreferVlc({
    id: 'content-type',
    url: 'https://cdn.example/play',
    contentType: 'Video/X-Matroska; charset=binary',
  })).toBe(true);
  expect(shouldPreferVlc({
    id: 'filename',
    url: 'https://cdn.example/play',
    filename: 'Season 1/Episode 2.mkv',
  })).toBe(true);
});

test('keeps the recovered engine when a provider republishes the same source', () => {
  const view = render(<VideoSurface source={mp4Source} />);
  act(() => mockExpoProps.onPlaybackError(NATIVE_FORMAT_PLAYBACK_ERROR));

  view.rerender(<VideoSurface source={{ ...mp4Source }} />);

  expect(screen.getByTestId('vlc-surface')).toBeTruthy();
  expect(screen.queryByTestId('expo-surface')).toBeNull();
});

test('ignores late Expo errors once VLC has taken over the source', () => {
  const onPlaybackError = jest.fn();
  render(<VideoSurface source={mp4Source} onPlaybackError={onPlaybackError} />);
  const oldError = mockExpoProps.onPlaybackError;
  act(() => oldError(NATIVE_FORMAT_PLAYBACK_ERROR));
  act(() => oldError('Network timeout'));

  expect(onPlaybackError).not.toHaveBeenCalled();
  expect(screen.getByTestId('vlc-surface')).toBeTruthy();
});

test('ignores errors from a source replaced by the user', () => {
  const onPlaybackError = jest.fn();
  const view = render(<VideoSurface source={mp4Source} onPlaybackError={onPlaybackError} />);
  const oldError = mockExpoProps.onPlaybackError;
  view.rerender(<VideoSurface source={{ ...mp4Source, url: 'https://cdn.example/new.mp4' }} onPlaybackError={onPlaybackError} />);
  act(() => oldError(NATIVE_FORMAT_PLAYBACK_ERROR));

  expect(onPlaybackError).not.toHaveBeenCalled();
  expect(screen.getByTestId('expo-surface')).toBeTruthy();
  expect(screen.queryByTestId('vlc-surface')).toBeNull();
});
