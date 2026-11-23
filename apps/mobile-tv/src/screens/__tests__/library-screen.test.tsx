import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { LibraryScreen } from '../LibraryScreen';

const mockResumeProgress = jest.fn(async () => true);
const mockClosePlayback = jest.fn();
const mockOpenDownloads = jest.fn();
const mockMediaDetailsProps = jest.fn();

jest.mock('../../preferences/usePreferences', () => ({
  usePreferences: () => ({
    preferences: {
      appLocale: 'en',
      preferredAudioLanguages: ['en'],
      preferredSubtitleLanguages: [],
      subtitlesEnabled: true,
      autoplay: true,
      favoriteChannelIds: [],
      myListItems: [{
        mediaId: 'movie:550',
        kind: 'movie',
        title: 'Fight Club',
        providerId: 'cinemeta',
        externalIds: { imdb: 'tt0137523', tmdb: '550' },
        year: 1999,
      }],
    },
  }),
}));

jest.mock('../../watch-progress/useWatchProgress', () => ({
  useWatchProgress: () => ({
    records: [
      {
        mediaId: 'movie:27205',
        kind: 'movie',
        title: 'Inception',
        externalIds: { imdb: 'tt1375666', tmdb: '27205' },
        positionSeconds: 1800,
        durationSeconds: 3600,
        completed: false,
        updatedAt: '2026-09-19T20:00:00.000Z',
      },
      {
        mediaId: 'episode:special-1',
        kind: 'episode',
        title: 'Series · S0E1 · Special One',
        externalIds: { imdb: 'tt0944947' },
        seriesId: 'series:tt0944947',
        seasonNumber: 0,
        episodeNumber: 1,
        positionSeconds: 120,
        durationSeconds: 1800,
        completed: false,
        updatedAt: '2026-09-21T16:40:00.000Z',
      },
      {
        mediaId: 'custom:episode:1',
        kind: 'episode',
        title: 'Native Series · S1E1 · Pilot',
        externalIds: {},
        seriesId: 'stremio-custom:series:custom%3Ashow-42',
        seasonNumber: 1,
        episodeNumber: 1,
        positionSeconds: 180,
        durationSeconds: 1800,
        completed: false,
        updatedAt: '2026-09-22T16:40:00.000Z',
      },
    ],
    status: 'ready',
    save: jest.fn(async () => undefined),
    restart: jest.fn(async () => undefined),
    markCompleted: jest.fn(async () => undefined),
    forget: jest.fn(async () => undefined),
    forgetAll: jest.fn(async () => undefined),
  }),
}));

jest.mock('../../playback/usePlayback', () => ({
  usePlayback: () => ({
    resumeProgress: mockResumeProgress,
    closePlayback: mockClosePlayback,
  }),
}));

jest.mock('../../catalog/MediaDetailsScreen', () => ({
  MediaDetailsScreen: (props: {
    mediaId: string;
    fallbackIdentity?: unknown;
    onBack(): void;
  }) => {
    mockMediaDetailsProps(props);
    const ReactModule = require('react');
    const { Pressable, Text } = require('react-native');
    return ReactModule.createElement(
      Pressable,
      {
        testID: `mock-media-details-${props.mediaId}`,
        onPress: props.onBack,
      },
      ReactModule.createElement(Text, null, 'Back from details'),
    );
  },
}));

jest.mock('../../i18n/useI18n', () => {
  const { APP_RESOURCES } = require('../../i18n/resources');
  const { translateFrom } = require('../../i18n/translate');
  return {
    useI18n: () => ({
      locale: 'en',
      t: (key: string, params?: Record<string, string | number>) => (
        translateFrom(APP_RESOURCES.en, APP_RESOURCES.en, key, params)
      ),
      languageName: (tag: string) => tag,
    }),
  };
});

test('Library opens the parent series when episode resume cannot start', async () => {
  mockMediaDetailsProps.mockClear();
  mockClosePlayback.mockClear();
  mockResumeProgress.mockResolvedValueOnce(false);

  render(
    <LibraryScreen
      onBack={jest.fn()}
      onOpenDownloads={jest.fn()}
    />,
  );

  fireEvent.press(
    screen.getByTestId('continue-watching-custom:episode:1'),
  );

  expect(
    await screen.findByTestId(
      'mock-media-details-stremio-custom:series:custom%3Ashow-42',
    ),
  ).toBeTruthy();
  expect(mockClosePlayback).toHaveBeenCalledTimes(1);
  expect(mockMediaDetailsProps).toHaveBeenLastCalledWith(
    expect.objectContaining({
      fallbackIdentity: {
        mediaId: 'stremio-custom:series:custom%3Ashow-42',
        kind: 'series',
        title: 'Native Series',
        externalIds: {},
      },
    }),
  );
});

test('Library passes movie progress identity when resume has no source', async () => {
  mockMediaDetailsProps.mockClear();
  mockClosePlayback.mockClear();
  mockResumeProgress.mockResolvedValueOnce(false);

  render(
    <LibraryScreen
      onBack={jest.fn()}
      onOpenDownloads={jest.fn()}
    />,
  );

  fireEvent.press(screen.getByTestId('continue-watching-movie:27205'));

  expect(
    await screen.findByTestId('mock-media-details-movie:27205'),
  ).toBeTruthy();
  expect(mockClosePlayback).toHaveBeenCalledTimes(1);
  expect(mockMediaDetailsProps).toHaveBeenLastCalledWith(
    expect.objectContaining({
      fallbackIdentity: {
        mediaId: 'movie:27205',
        kind: 'movie',
        title: 'Inception',
        externalIds: {
          imdb: 'tt1375666',
          tmdb: '27205',
        },
      },
    }),
  );
});

test('Library passes My List identity for cross-provider detail recovery', async () => {
  mockMediaDetailsProps.mockClear();

  render(
    <LibraryScreen
      onBack={jest.fn()}
      onOpenDownloads={jest.fn()}
    />,
  );

  fireEvent.press(screen.getByText('Fight Club'));

  expect(
    await screen.findByTestId('mock-media-details-movie:550'),
  ).toBeTruthy();
  expect(mockMediaDetailsProps).toHaveBeenLastCalledWith(
    expect.objectContaining({
      mediaId: 'movie:550',
      fallbackIdentity: {
        mediaId: 'movie:550',
        kind: 'movie',
        title: 'Fight Club',
        externalIds: {
          imdb: 'tt0137523',
          tmdb: '550',
        },
      },
    }),
  );
});

test('Library combines My List, Continue Watching and Downloads', () => {
  render(
    <LibraryScreen
      onBack={jest.fn()}
      onOpenDownloads={mockOpenDownloads}
    />,
  );

  expect(screen.getByTestId('library-screen')).toBeTruthy();
  expect(screen.getByText('Library')).toBeTruthy();
  expect(screen.getByText('My List')).toBeTruthy();
  expect(screen.getByText('Fight Club')).toBeTruthy();
  expect(screen.getByText('Continue Watching')).toBeTruthy();
  expect(screen.getByText('Inception')).toBeTruthy();
  expect(screen.getByText('Series · S0E1 · Special One')).toBeTruthy();
  expect(screen.getByText('Native Series · S1E1 · Pilot')).toBeTruthy();

  fireEvent.press(screen.getByTestId('continue-watching-episode:special-1'));
  expect(mockResumeProgress).toHaveBeenCalledWith(expect.objectContaining({
    mediaId: 'episode:special-1',
    seasonNumber: 0,
    episodeNumber: 1,
  }));

  fireEvent.press(screen.getByTestId('continue-watching-custom:episode:1'));
  expect(mockResumeProgress).toHaveBeenCalledWith(expect.objectContaining({
    mediaId: 'custom:episode:1',
    seriesId: 'stremio-custom:series:custom%3Ashow-42',
    seasonNumber: 1,
    episodeNumber: 1,
  }));

  fireEvent.press(screen.getByTestId('continue-watching-movie:27205'));
  expect(mockResumeProgress).toHaveBeenCalledWith(expect.objectContaining({
    mediaId: 'movie:27205',
  }));

  fireEvent.press(screen.getByTestId('library-downloads'));
  expect(mockOpenDownloads).toHaveBeenCalledTimes(1);
});

test('Library keeps its list mounted while details is open', async () => {
  render(
    <LibraryScreen
      onBack={jest.fn()}
      onOpenDownloads={jest.fn()}
    />,
  );

  fireEvent.press(screen.getByText('Fight Club'));

  const details = await screen.findByTestId(
    'mock-media-details-movie:550',
  );
  expect(screen.queryByTestId('library-screen')).toBeNull();
  expect(screen.getByTestId('library-screen', { includeHiddenElements: true })).toBeTruthy();

  fireEvent.press(details);

  expect(screen.queryByTestId('mock-media-details-movie:550')).toBeNull();
  expect(screen.getByTestId('library-screen')).toBeTruthy();
  expect(screen.getByText('Fight Club')).toBeTruthy();
});


test('Library opens and closes the watch history screen', () => {
  render(
    <LibraryScreen
      onBack={jest.fn()}
      onOpenDownloads={jest.fn()}
    />,
  );

  fireEvent.press(screen.getByTestId('library-history'));

  expect(screen.getByTestId('watch-history-screen')).toBeTruthy();
  expect(screen.queryByTestId('library-screen')).toBeNull();
  expect(screen.getByText('Inception')).toBeTruthy();
  // The history lists every record, including the episode rows that Continue
  // Watching keeps in the same data.
  expect(screen.getByTestId('watch-history-row-custom:episode:1')).toBeTruthy();

  fireEvent.press(screen.getByTestId('watch-history-back'));

  expect(screen.queryByTestId('watch-history-screen')).toBeNull();
  expect(screen.getByTestId('library-screen')).toBeTruthy();
});
