import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { StreamSource } from '@moviestv/core';
import type { PlaybackApi } from '../usePlayback';
import { PlaybackOverlay } from '../PlaybackOverlay';
import * as subtitleCueLoader from '../SubtitleCueLoader';

const mockRetry = jest.fn(async () => undefined);
const mockSelectSource = jest.fn(() => true);
const mockOpenSourceChooser = jest.fn();
const mockCloseSourceChooser = jest.fn();
const mockSelectSubtitle = jest.fn(() => true);
const mockOpenSubtitleChooser = jest.fn();
const mockCloseSubtitleChooser = jest.fn();
const mockClosePlayback = jest.fn();
const mockPlayNextEpisode = jest.fn(async () => true);
const mockResolveMovieSources = jest.fn(async () => []);
const mockResolveEpisodeSources = jest.fn(async () => []);
const mockSaveProgress = jest.fn(async (): Promise<void> => undefined);
const mockStartDownload = jest.fn(async () => 'download-1');
const mockDismissDownload = jest.fn();
let mockVideoSource: unknown;
let mockVideoSourceKey: string | undefined;
let mockVideoPlayer: any;
let mockVideoListeners: Record<string, (payload: any) => void> = {};
let mockAvailableSubtitleTracks: Array<Record<string, unknown>> = [];
let mockPlayback: PlaybackApi;
const mockPreferences = {
  appLocale: 'en',
  preferredAudioLanguages: ['en', 'fr', 'de'],
  preferredSubtitleLanguages: ['fr', 'en'],
  subtitlesEnabled: true,
  autoplay: true,
  favoriteChannelIds: [],
  myListItems: [],
};
const mockWatchProgressApi = {
  records: [],
  status: 'ready',
  save: mockSaveProgress,
  restart: jest.fn(async () => undefined),
  markCompleted: jest.fn(async () => undefined),
  forget: jest.fn(async () => undefined),
  forgetAll: jest.fn(async () => undefined),
};

jest.mock('../subtitleStyle', () => {
  const actual = jest.requireActual('../subtitleStyle');
  return {
    ...actual,
    readSubtitleStyle: jest.fn(async () => actual.DEFAULT_SUBTITLE_STYLE),
  };
});

jest.mock('expo-video', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
  const VideoView = ReactModule.forwardRef((props: Record<string, unknown>, ref: any) => {
    ReactModule.useImperativeHandle(ref, () => ({
      enterFullscreen: jest.fn(async () => undefined),
      exitFullscreen: jest.fn(async () => undefined),
    }));
    return ReactModule.createElement(View, { ...props, testID: 'native-video' });
  });
  return {
    useVideoPlayer: (source: unknown, setup?: (player: any) => void) => {
      mockVideoSource = source;
      const sourceKey = JSON.stringify(source);
      if (mockVideoPlayer && mockVideoSourceKey === sourceKey) return mockVideoPlayer;
      const player = {
        play: jest.fn(),
        pause: jest.fn(),
        replaceAsync: jest.fn(async () => undefined),
        seekBy: jest.fn(),
        playing: false,
        muted: false,
        currentTime: 0,
        duration: 100,
        timeUpdateEventInterval: 0,
        availableAudioTracks: [],
        availableSubtitleTracks: mockAvailableSubtitleTracks,
        addListener: jest.fn((event: string, callback: (payload: any) => void) => {
          mockVideoListeners[event] = callback;
          return {
            remove: jest.fn(() => {
              if (mockVideoListeners[event] === callback) {
                delete mockVideoListeners[event];
              }
            }),
          };
        }),
      };
      mockVideoSourceKey = sourceKey;
      mockVideoPlayer = player;
      setup?.(player);
      return player;
    },
    VideoView,
  };
});

jest.mock('../usePlayback', () => ({
  usePlayback: () => mockPlayback,
}));

jest.mock('../../downloads/useDownloadManager', () => ({
  useDownloadManager: () => ({
    jobs: [],
    startDownload: mockStartDownload,
    pause: jest.fn(async () => undefined),
    resume: jest.fn(async () => undefined),
    cancel: jest.fn(),
    dismiss: mockDismissDownload,
  }),
}));

jest.mock('../../preferences/usePreferences', () => ({
  usePreferences: () => ({
    preferences: mockPreferences,
  }),
}));

jest.mock('../../watch-progress/useWatchProgress', () => ({
  useWatchProgress: () => mockWatchProgressApi,
}));

const copy: Record<string, string> = {
  'common.cancel': 'Cancel',
  'common.retry': 'Retry',
  'playback.findingSources': 'Finding sources…',
  'playback.noSources': 'No playback sources found',
  'playback.failed': 'Playback failed',
  'playback.providersUnavailable': 'Playback providers are unavailable',
  'playback.close': 'Close',
  'playback.changeSource': 'Change source',
  'playback.sources': 'Sources',
  'playback.selected': 'Selected',
  'playback.download': 'Download',
  'playback.subtitles': 'Subtitles',
  'playback.embeddedSubtitles': 'Embedded subtitles',
  'playback.off': 'Off',
  'playback.subtitleFailed': 'Could not load subtitles',
  'playback.audio': 'Audio',
  'playback.nextEpisode': 'Next episode',
  'playback.manageProviders': 'Open providers',
  'common.loading': 'Loading',
};
const mockTranslate = (key: string) => copy[key] ?? key;

jest.mock('../../i18n/useI18n', () => ({
  useI18n: () => ({
    t: mockTranslate,
    languageName: (tag: string) => tag,
  }),
}));

const request = {
  mediaId: 'movie:550',
  kind: 'movie' as const,
  externalIds: { imdb: 'tt0137523' },
};

const french: StreamSource = {
  id: 'french',
  providerId: 'provider-b',
  name: 'French 1080p',
  url: 'https://cdn.example/fr.m3u8',
  headers: { Referer: 'https://example.test/' },
  quality: '1080p',
  audioLanguages: ['fr', 'en'],
};

const english: StreamSource = {
  id: 'english',
  providerId: 'provider-a',
  name: 'English 720p',
  url: 'https://cdn.example/en.mp4',
  quality: '720p',
  language: 'en',
};

function setPlayback(
  status: PlaybackApi['state']['status'],
  overrides: Partial<PlaybackApi> = {},
) {
  mockPlayback = {
    state: {
      status,
      request: status === 'idle' ? null : request,
      sources: [],
      selectedSourceId: null,
      error: null,
    },
    selectedSource: null,
    activeMedia: null,
    subtitleTracks: [],
    selectedSubtitle: null,
    subtitleLoading: false,
    nextEpisode: null,
    nextEpisodeLoading: false,
    sourceChooserOpen: false,
    subtitleChooserOpen: false,
    playMovie: jest.fn(async () => undefined),
    resolveMovieSources: mockResolveMovieSources,
    resolveEpisodeSources: mockResolveEpisodeSources,
    playEpisode: jest.fn(async () => false),
    playNextEpisode: mockPlayNextEpisode,
    resumeProgress: jest.fn(async () => true),
    refreshSources: jest.fn(async () => false),
    retry: mockRetry,
    selectSource: mockSelectSource,
    selectSubtitle: mockSelectSubtitle,
    openSourceChooser: mockOpenSourceChooser,
    closeSourceChooser: mockCloseSourceChooser,
    openSubtitleChooser: mockOpenSubtitleChooser,
    closeSubtitleChooser: mockCloseSubtitleChooser,
    closePlayback: mockClosePlayback,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockVideoSource = undefined;
  mockVideoSourceKey = undefined;
  mockVideoPlayer = undefined;
  mockVideoListeners = {};
  mockAvailableSubtitleTracks = [];
  mockResolveMovieSources.mockClear();
  mockResolveEpisodeSources.mockClear();
  setPlayback('idle');
});

test('renders nothing while playback is idle', () => {
  render(<PlaybackOverlay />);
  expect(screen.queryByTestId('playback-overlay')).toBeNull();
});

test('shows resolving state and lets the user cancel', () => {
  setPlayback('resolving');
  render(<PlaybackOverlay />);

  expect(screen.getByText('Finding sources…')).toBeTruthy();
  fireEvent.press(screen.getByText('Cancel'));
  expect(mockClosePlayback).toHaveBeenCalledTimes(1);
});

test('shows no-source state and retries the existing request', () => {
  setPlayback('no-sources');
  render(<PlaybackOverlay />);

  expect(screen.getByText('No playback sources found')).toBeTruthy();
  fireEvent.press(screen.getByText('Retry'));
  expect(mockRetry).toHaveBeenCalledTimes(1);
});

test('keeps the no-source recovery UI usable when retry rejects', async () => {
  mockRetry.mockRejectedValueOnce(new Error('retry failed'));
  setPlayback('no-sources');
  render(<PlaybackOverlay />);

  fireEvent.press(screen.getByText('Retry'));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockRetry).toHaveBeenCalledTimes(1);
  expect(screen.getByText('No playback sources found')).toBeTruthy();
});


test('hides raw provider errors behind generic playback copy', () => {
  setPlayback('error', {
    state: {
      status: 'error',
      request,
      sources: [],
      selectedSourceId: null,
      error: 'provider secret exception details',
    },
  });
  render(<PlaybackOverlay />);

  expect(screen.getByText('Playback failed')).toBeTruthy();
  expect(screen.queryByText('provider secret exception details')).toBeNull();
});

test('starts the selected source with its headers and exposes source controls', () => {
  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [french, english],
      selectedSourceId: french.id,
      error: null,
    },
    selectedSource: french,
  });
  render(<PlaybackOverlay />);

  expect(screen.getByTestId('native-video')).toBeTruthy();
  expect(screen.getByTestId('native-video').props.nativeControls).toBe(false);
  expect(screen.getByTestId('native-video-tap-surface')).toBeTruthy();
  expect(mockVideoSource).toEqual({
    uri: french.url,
    headers: french.headers,
    contentType: 'hls',
  });
  // Every player action is an icon in the control bar, so it is one tap.
  fireEvent.press(screen.getByTestId('player-source'));
  expect(mockOpenSourceChooser).toHaveBeenCalledTimes(1);
});

test('shows ranked sources in order and selects without resolving again', () => {
  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [french, english],
      selectedSourceId: french.id,
      error: null,
    },
    selectedSource: french,
    sourceChooserOpen: true,
  });
  render(<PlaybackOverlay />);

  expect(screen.getByText('Sources')).toBeTruthy();
  const labels = screen.getAllByTestId('source-label').map((node) => node.props.children);
  expect(labels[0]).toContain('French 1080p');
  expect(labels[1]).toContain('English 720p');

  fireEvent.press(screen.getByTestId('source-english'));
  expect(mockSelectSource).toHaveBeenCalledWith('english');
  expect(mockRetry).not.toHaveBeenCalled();
});


test('shows a next episode action when binge continuation is available', () => {
  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [english],
      selectedSourceId: english.id,
      error: null,
    },
    selectedSource: english,
    activeMedia: {
      mediaId: 'episode-1',
      kind: 'episode',
      title: 'Series · S1E1 · Pilot',
      seasonNumber: 1,
      episodeNumber: 1,
      externalIds: { imdb: 'tt1234567' },
    },
    nextEpisode: {
      id: 'episode-2',
      seriesId: 'series-1',
      seasonNumber: 1,
      episodeNumber: 2,
      title: 'Episode 2',
    },
  });

  render(<PlaybackOverlay />);

  fireEvent.press(screen.getByTestId('player-next-episode'));
  expect(mockPlayNextEpisode).toHaveBeenCalledTimes(1);
});


test('keeps playback usable when manual next-episode playback rejects', async () => {
  mockPlayNextEpisode.mockRejectedValueOnce(new Error('next episode failed'));
  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [english],
      selectedSourceId: english.id,
      error: null,
    },
    selectedSource: english,
    activeMedia: {
      mediaId: 'episode-1',
      kind: 'episode',
      title: 'Series · S1E1 · Pilot',
      seasonNumber: 1,
      episodeNumber: 1,
      externalIds: { imdb: 'tt1234567' },
    },
    nextEpisode: {
      id: 'episode-2',
      seriesId: 'series-1',
      seasonNumber: 1,
      episodeNumber: 2,
      title: 'Episode 2',
    },
  });

  render(<PlaybackOverlay />);
  fireEvent.press(screen.getByTestId('player-next-episode'));

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockPlayNextEpisode).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('playback-overlay')).toBeTruthy();
});


test('the next episode starts after a countdown, and only once', async () => {
  jest.useFakeTimers();
  try {
  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [english],
      selectedSourceId: english.id,
      error: null,
    },
    selectedSource: english,
    activeMedia: {
      mediaId: 'episode-1',
      kind: 'episode',
      title: 'Series · S1E1 · Pilot',
      seasonNumber: 1,
      episodeNumber: 1,
      externalIds: { imdb: 'tt1234567' },
    },
    nextEpisode: {
      id: 'episode-2',
      seriesId: 'series-1',
      seasonNumber: 1,
      episodeNumber: 2,
      title: 'Episode 2',
    },
  });

    render(<PlaybackOverlay />);

    act(() => {
      mockVideoListeners.playToEnd?.({});
      mockVideoListeners.playToEnd?.({});
    });

    // Nothing starts while the countdown is running, and it can be cancelled.
    expect(mockPlayNextEpisode).not.toHaveBeenCalled();
    expect(screen.getByTestId('player-up-next')).toBeTruthy();

    // One tick per second: each tick re-renders and schedules the next one.
    for (let tick = 0; tick < 11; tick += 1) {
      act(() => { jest.advanceTimersByTime(1_000); });
    }

    await act(async () => { await Promise.resolve(); });
    expect(mockPlayNextEpisode).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test('delayed next-episode metadata still gets a countdown, not an instant jump', async () => {
  jest.useFakeTimers();
  try {
  const activeMedia = {
    mediaId: 'episode-1',
    kind: 'episode' as const,
    title: 'Series · S1E1 · Pilot',
    seriesId: 'series-1',
    seasonNumber: 1,
    episodeNumber: 1,
    externalIds: { imdb: 'tt1234567' },
  };
  const readyState = {
    status: 'ready' as const,
    request,
    sources: [english],
    selectedSourceId: english.id,
    error: null,
  };

  setPlayback('ready', {
    state: readyState,
    selectedSource: english,
    activeMedia,
    nextEpisode: null,
    nextEpisodeLoading: true,
  });

  const view = render(<PlaybackOverlay />);

  act(() => {
    mockVideoListeners.playToEnd?.({});
  });

  expect(mockPlayNextEpisode).not.toHaveBeenCalled();

  setPlayback('ready', {
    state: readyState,
    selectedSource: english,
    activeMedia,
    nextEpisodeLoading: false,
    nextEpisode: {
      id: 'episode-2',
      seriesId: 'series-1',
      seasonNumber: 1,
      episodeNumber: 2,
      title: 'Episode 2',
    },
  });
    view.rerender(<PlaybackOverlay />);

    expect(screen.getByTestId('player-up-next')).toBeTruthy();
    expect(mockPlayNextEpisode).not.toHaveBeenCalled();

    // One tick per second: each tick re-renders and schedules the next one.
    for (let tick = 0; tick < 11; tick += 1) {
      act(() => { jest.advanceTimersByTime(1_000); });
    }
    await act(async () => { await Promise.resolve(); });
    expect(mockPlayNextEpisode).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test('no-source recovery can open Movies/Series provider settings', () => {
  const openProviders = jest.fn();
  setPlayback('no-sources');

  render(<PlaybackOverlay onOpenStreamProviders={openProviders} />);

  expect(screen.getByText('No playback sources found')).toBeTruthy();
  expect(screen.queryByText('Playback providers are unavailable')).toBeNull();
  fireEvent.press(screen.getByText('Open providers'));
  expect(mockClosePlayback).toHaveBeenCalledTimes(1);
  expect(openProviders).toHaveBeenCalledTimes(1);
});

test('provider outage errors can open Movies/Series provider settings', () => {
  const openProviders = jest.fn();
  setPlayback('error', {
    state: {
      status: 'error',
      request,
      sources: [],
      selectedSourceId: null,
      error: 'Playback providers are unavailable',
    },
  });

  render(<PlaybackOverlay onOpenStreamProviders={openProviders} />);

  expect(screen.getByText('Playback providers are unavailable')).toBeTruthy();
  expect(screen.queryByText('Playback failed')).toBeNull();
  fireEvent.press(screen.getByText('Open providers'));
  expect(mockClosePlayback).toHaveBeenCalledTimes(1);
  expect(openProviders).toHaveBeenCalledTimes(1);
});

test('generic playback errors do not show the provider-setup recovery action', () => {
  setPlayback('error', {
    state: {
      status: 'error',
      request,
      sources: [],
      selectedSourceId: null,
      error: 'provider failed',
    },
  });

  render(<PlaybackOverlay onOpenStreamProviders={jest.fn()} />);

  expect(screen.queryByText('Open providers')).toBeNull();
});


test('shows embedded subtitle tracks even when no add-on subtitle provider returned tracks', async () => {
  mockAvailableSubtitleTracks = [
    { id: 'native-fr', language: 'fr', label: 'French' },
    { id: 'native-en', language: 'en', label: 'English' },
  ];
  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [english],
      selectedSourceId: english.id,
      error: null,
    },
    selectedSource: english,
    subtitleChooserOpen: true,
  });

  render(<PlaybackOverlay />);
  act(() => {
    mockVideoListeners.sourceLoad?.({});
  });

  expect(await screen.findByText('Embedded subtitles')).toBeTruthy();
  expect(screen.getByTestId('embedded-subtitle-embedded-subtitle:native-fr')).toBeTruthy();

  fireEvent.press(screen.getByTestId('embedded-subtitle-embedded-subtitle:native-en'));
  expect(mockSelectSubtitle).toHaveBeenCalledWith(null);
});

test('Off disables external subtitle selection from the merged chooser', async () => {
  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [english],
      selectedSourceId: english.id,
      error: null,
    },
    selectedSource: english,
    subtitleTracks: [
      { id: 'addon-fr', language: 'fr', label: 'French', url: 'https://subs.example/fr.vtt' },
    ],
    selectedSubtitle: {
      id: 'addon-fr',
      language: 'fr',
      label: 'French',
      url: 'https://subs.example/fr.vtt',
    },
    subtitleChooserOpen: true,
  });

  render(<PlaybackOverlay />);

  fireEvent.press(screen.getByTestId('subtitle-off'));
  expect(mockSelectSubtitle).toHaveBeenCalledWith(null);
});


test('automatically falls back when the preferred external subtitle fails', async () => {
  const broken = {
    id: 'addon-fr-broken',
    language: 'fr',
    label: 'French broken',
    url: 'https://subs.example/broken.vtt',
  };
  const backup = {
    id: 'addon-en-backup',
    language: 'en',
    label: 'English backup',
    url: 'https://subs.example/backup.vtt',
  };
  const loadSpy = jest.spyOn(subtitleCueLoader, 'loadSubtitleCues')
    .mockRejectedValueOnce(new Error('subtitle unavailable'));

  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [english],
      selectedSourceId: english.id,
      error: null,
    },
    selectedSource: english,
    subtitleTracks: [broken, backup],
    selectedSubtitle: broken,
  });

  render(<PlaybackOverlay />);

  await waitFor(() => {
    expect(mockSelectSubtitle).toHaveBeenCalledWith(backup.id);
  });
  expect(screen.queryByText('Could not load subtitles')).toBeNull();

  loadSpy.mockRestore();
});


test('redacts credential-bearing player errors after fallback refresh is exhausted', async () => {
  const refreshSources = jest.fn(async () => false);
  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [english],
      selectedSourceId: english.id,
      error: null,
    },
    selectedSource: english,
    activeMedia: {
      mediaId: request.mediaId,
      kind: 'movie',
      title: 'Fight Club',
      externalIds: request.externalIds,
    },
    refreshSources,
  });

  render(<PlaybackOverlay />);

  act(() => {
    mockVideoListeners.statusChange?.({
      status: 'error',
      error: {
        message: 'Failed https://cdn.example/movie.mp4?token=LOCAL-SECRET',
      },
    });
  });

  await waitFor(() => {
    expect(refreshSources).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Playback failed')).toBeTruthy();
  });
  expect(screen.queryByText(/LOCAL-SECRET/)).toBeNull();
  expect(screen.queryByText(/cdn\.example/)).toBeNull();
});

test('refresh recovery does not revisit URLs that already failed', async () => {
  const oldSource: StreamSource = {
    ...english,
    id: 'old-source',
    url: 'https://cdn.example/old.mp4',
  };
  const freshSource: StreamSource = {
    ...french,
    id: 'fresh-source',
    url: 'https://cdn.example/fresh.m3u8',
  };
  const refreshSources = jest.fn(async () => {
    mockPlayback.state = {
      status: 'ready',
      request,
      sources: [oldSource, freshSource],
      selectedSourceId: freshSource.id,
      error: null,
    };
    mockPlayback.selectedSource = freshSource;
    return true;
  });

  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [oldSource],
      selectedSourceId: oldSource.id,
      error: null,
    },
    selectedSource: oldSource,
    activeMedia: {
      mediaId: request.mediaId,
      kind: 'movie',
      title: 'Fight Club',
      externalIds: request.externalIds,
    },
    refreshSources,
  });

  const view = render(<PlaybackOverlay />);

  act(() => {
    mockVideoListeners.statusChange?.({
      status: 'error',
      error: { message: 'old URL expired' },
    });
  });

  await waitFor(() => {
    expect(refreshSources).toHaveBeenCalledTimes(1);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  view.rerender(<PlaybackOverlay />);

  act(() => {
    mockVideoListeners.statusChange?.({
      status: 'error',
      error: { message: 'fresh URL failed' },
    });
  });

  await waitFor(() => {
    expect(screen.getByText('fresh URL failed')).toBeTruthy();
  });

  expect(mockSelectSource).not.toHaveBeenCalledWith(oldSource.id);
});

test('contains background progress persistence failures during playback', async () => {
  mockSaveProgress.mockRejectedValueOnce(new Error('progress storage failed'));
  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [english],
      selectedSourceId: english.id,
      error: null,
    },
    selectedSource: english,
    activeMedia: {
      mediaId: request.mediaId,
      kind: 'movie',
      title: 'Fight Club',
      externalIds: request.externalIds,
    },
  });

  render(<PlaybackOverlay />);

  act(() => {
    mockVideoListeners.timeUpdate?.({ currentTime: 15 });
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockSaveProgress).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('playback-overlay')).toBeTruthy();
});


test('automatic source fallback does not wait for progress persistence', () => {
  mockSaveProgress.mockImplementation(() => new Promise<void>(() => {}));

  try {
    setPlayback('ready', {
      state: {
        status: 'ready',
        request,
        sources: [french, english],
        selectedSourceId: french.id,
        error: null,
      },
      selectedSource: french,
      activeMedia: {
        mediaId: request.mediaId,
        kind: 'movie',
        title: 'Fight Club',
        externalIds: request.externalIds,
      },
    });

    render(<PlaybackOverlay />);

    act(() => {
      mockVideoListeners.timeUpdate?.({ currentTime: 37 });
      mockVideoPlayer.currentTime = 37;
      mockVideoListeners.statusChange?.({
        status: 'error',
        error: { message: 'source failed' },
      });
    });

    expect(mockSaveProgress).toHaveBeenCalled();
    expect(mockSelectSource).toHaveBeenCalledWith(english.id);
  } finally {
    mockSaveProgress.mockImplementation(async () => undefined);
  }
});

test('automatic source fallback resumes from the exact latest playback position', async () => {
  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [french, english],
      selectedSourceId: french.id,
      error: null,
    },
    selectedSource: french,
    activeMedia: {
      mediaId: request.mediaId,
      kind: 'movie',
      title: 'Fight Club',
      externalIds: request.externalIds,
    },
  });

  const view = render(<PlaybackOverlay />);

  mockVideoListeners.timeUpdate?.({ currentTime: 42 });
  mockVideoPlayer.currentTime = 42;
  mockVideoListeners.statusChange?.({
    status: 'error',
    error: { message: 'source failed' },
  });

  await waitFor(() => {
    expect(mockSelectSource).toHaveBeenCalledWith(english.id);
  });

  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [french, english],
      selectedSourceId: english.id,
      error: null,
    },
    selectedSource: english,
    activeMedia: {
      mediaId: request.mediaId,
      kind: 'movie',
      title: 'Fight Club',
      externalIds: request.externalIds,
    },
  });

  view.rerender(<PlaybackOverlay />);

  expect(mockVideoPlayer.currentTime).toBe(42);
});


test('ignores a stale playback error after the same source id moves to a new URL', async () => {
  const first: StreamSource = {
    ...english,
    id: 'provider-a:main',
    url: 'https://cdn.example/old.mp4',
  };
  const refreshed: StreamSource = {
    ...english,
    id: 'provider-a:main',
    url: 'https://cdn.example/new.mp4',
  };

  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [first],
      selectedSourceId: first.id,
      error: null,
    },
    selectedSource: first,
    activeMedia: {
      mediaId: request.mediaId,
      kind: 'movie',
      title: 'Fight Club',
      externalIds: request.externalIds,
    },
  });

  const view = render(<PlaybackOverlay />);
  const staleStatusChange = mockVideoListeners.statusChange;
  expect(staleStatusChange).toBeDefined();

  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [refreshed],
      selectedSourceId: refreshed.id,
      error: null,
    },
    selectedSource: refreshed,
    activeMedia: {
      mediaId: request.mediaId,
      kind: 'movie',
      title: 'Fight Club',
      externalIds: request.externalIds,
    },
  });

  view.rerender(<PlaybackOverlay />);

  staleStatusChange?.({
    status: 'error',
    error: { message: 'old stream failed late' },
  });

  await act(async () => {
    await Promise.resolve();
  });

  expect(mockSelectSource).not.toHaveBeenCalled();
  expect(screen.queryByText('old stream failed late')).toBeNull();
});

test('native fallback treats same URL with different headers as a fresh source', async () => {
  const first: StreamSource = {
    ...english,
    id: 'first-header-source',
    url: 'https://cdn.example/shared.m3u8',
    headers: { Referer: 'https://first.example/' },
  };
  const second: StreamSource = {
    ...english,
    id: 'second-header-source',
    url: 'https://cdn.example/shared.m3u8',
    headers: { Referer: 'https://second.example/' },
  };
  const third: StreamSource = {
    ...english,
    id: 'third-source',
    url: 'https://cdn.example/third.m3u8',
  };

  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [first, second, third],
      selectedSourceId: first.id,
      error: null,
    },
    selectedSource: first,
    activeMedia: {
      mediaId: request.mediaId,
      kind: 'movie',
      title: 'Fight Club',
      externalIds: request.externalIds,
    },
  });

  const view = render(<PlaybackOverlay />);

  act(() => {
    mockVideoListeners.statusChange?.({
      status: 'error',
      error: { message: 'first failed' },
    });
  });

  await waitFor(() => {
    expect(mockSelectSource).toHaveBeenCalledWith(second.id);
  });

  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [first, second, third],
      selectedSourceId: second.id,
      error: null,
    },
    selectedSource: second,
    activeMedia: {
      mediaId: request.mediaId,
      kind: 'movie',
      title: 'Fight Club',
      externalIds: request.externalIds,
    },
  });

  view.rerender(<PlaybackOverlay />);

  act(() => {
    mockVideoListeners.statusChange?.({
      status: 'error',
      error: { message: 'second failed' },
    });
  });

  await waitFor(() => {
    expect(mockSelectSource).toHaveBeenCalledWith(third.id);
  });
});

test('automatic fallback skips a duplicate broken stream fingerprint', async () => {
  const duplicate: StreamSource = {
    ...french,
    id: 'provider-b:duplicate',
  };

  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [french, duplicate, english],
      selectedSourceId: french.id,
      error: null,
    },
    selectedSource: french,
    activeMedia: {
      mediaId: request.mediaId,
      kind: 'movie',
      title: 'Fight Club',
      externalIds: request.externalIds,
    },
  });

  render(<PlaybackOverlay />);

  mockVideoListeners.statusChange?.({
    status: 'error',
    error: { message: 'source failed' },
  });

  await waitFor(() => {
    expect(mockSelectSource).toHaveBeenCalledWith(english.id);
  });
  expect(mockSelectSource).not.toHaveBeenCalledWith(duplicate.id);
});

test('a different media item never inherits the previous source-switch position', () => {
  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [french],
      selectedSourceId: french.id,
      error: null,
    },
    selectedSource: french,
    activeMedia: {
      mediaId: request.mediaId,
      kind: 'movie',
      title: 'Fight Club',
      externalIds: request.externalIds,
    },
  });

  const view = render(<PlaybackOverlay />);
  mockVideoListeners.timeUpdate?.({ currentTime: 42 });
  mockVideoPlayer.currentTime = 42;

  const nextRequest = {
    ...request,
    mediaId: 'movie:551',
  };
  setPlayback('ready', {
    state: {
      status: 'ready',
      request: nextRequest,
      sources: [english],
      selectedSourceId: english.id,
      error: null,
    },
    selectedSource: english,
    activeMedia: {
      mediaId: nextRequest.mediaId,
      kind: 'movie',
      title: 'Another movie',
      externalIds: nextRequest.externalIds,
    },
  });

  view.rerender(<PlaybackOverlay />);

  expect(mockVideoPlayer.currentTime).toBe(0);
});


test('automatic fallback advances from the current source before wrapping to earlier sources', async () => {
  const german: StreamSource = {
    ...english,
    id: 'german',
    url: 'https://cdn.example/german.mp4',
    language: 'de',
  };

  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [french, english, german],
      selectedSourceId: english.id,
      error: null,
    },
    selectedSource: english,
    activeMedia: {
      mediaId: request.mediaId,
      kind: 'movie',
      title: 'Fight Club',
      externalIds: request.externalIds,
    },
  });

  render(<PlaybackOverlay />);

  mockVideoListeners.statusChange?.({
    status: 'error',
    error: { message: 'middle source failed' },
  });

  await waitFor(() => {
    expect(mockSelectSource).toHaveBeenCalledWith(german.id);
  });
});


test('source refresh provider outage yields to the provider recovery state', async () => {
  const refreshSources = jest.fn(async () => {
    mockPlayback = {
      ...mockPlayback,
      state: {
        status: 'error',
        request,
        sources: [],
        selectedSourceId: null,
        error: 'Playback providers are unavailable',
      },
      selectedSource: null,
    };
    return false;
  });

  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [english],
      selectedSourceId: english.id,
      error: null,
    },
    selectedSource: english,
    activeMedia: {
      mediaId: request.mediaId,
      kind: 'movie',
      title: 'Fight Club',
      externalIds: request.externalIds,
    },
    refreshSources,
  });

  render(<PlaybackOverlay />);

  act(() => {
    mockVideoListeners.statusChange?.({
      status: 'error',
      error: { message: 'source stalled' },
    });
  });

  await waitFor(() => {
    expect(refreshSources).toHaveBeenCalledTimes(1);
  });

  expect(screen.queryByText('source stalled')).toBeNull();
});


test('falls back from exhausted external subtitles to embedded tracks', async () => {
  mockAvailableSubtitleTracks = [
    { id: 'native-fr', language: 'fr', label: 'French embedded' },
    { id: 'native-en', language: 'en', label: 'English embedded' },
  ];
  const broken = {
    id: 'addon-fr-broken',
    language: 'fr',
    label: 'French broken',
    url: 'https://subs.example/broken.vtt',
  };
  const loadSpy = jest.spyOn(subtitleCueLoader, 'loadSubtitleCues')
    .mockRejectedValueOnce(new Error('subtitle unavailable'));

  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [english],
      selectedSourceId: english.id,
      error: null,
    },
    selectedSource: english,
    subtitleTracks: [broken],
    selectedSubtitle: broken,
  });

  render(<PlaybackOverlay />);
  act(() => {
    mockVideoListeners.sourceLoad?.({});
  });

  await waitFor(() => {
    expect(mockSelectSubtitle).toHaveBeenCalledWith(null);
  });
  expect(screen.queryByText('Could not load subtitles')).toBeNull();

  loadSpy.mockRestore();
});


test('applies preferred native tracks when HLS track lists arrive late', () => {
  const opaqueHls: StreamSource = {
    id: 'opaque-hls',
    providerId: 'provider',
    url: 'https://cdn.example/play/opaque',
    contentType: 'application/vnd.apple.mpegurl',
  };
  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [opaqueHls],
      selectedSourceId: opaqueHls.id,
      error: null,
    },
    selectedSource: opaqueHls,
  });

  render(<PlaybackOverlay />);

  const englishAudio = { id: 'a-en', language: 'en', label: 'English' };
  const frenchAudio = { id: 'a-fr', language: 'fr', label: 'French' };
  mockVideoPlayer.availableAudioTracks = [frenchAudio, englishAudio];

  act(() => {
    mockVideoListeners.availableAudioTracksChange?.({
      availableAudioTracks: [frenchAudio, englishAudio],
    });
  });

  expect(mockVideoPlayer.audioTrack).toBe(englishAudio);

  const englishSubtitle = { id: 's-en', language: 'en', label: 'English' };
  const frenchSubtitle = { id: 's-fr', language: 'fr', label: 'French' };
  mockVideoPlayer.availableSubtitleTracks = [
    englishSubtitle,
    frenchSubtitle,
  ];

  act(() => {
    mockVideoListeners.availableSubtitleTracksChange?.({
      availableSubtitleTracks: [englishSubtitle, frenchSubtitle],
    });
  });

  expect(mockVideoPlayer.subtitleTrack).toBe(frenchSubtitle);
});


test('uses sourceLoad track payload when player track properties lag', () => {
  const opaqueHls: StreamSource = {
    id: 'payload-hls',
    providerId: 'provider',
    url: 'https://cdn.example/play/opaque',
    contentType: 'application/vnd.apple.mpegurl',
  };
  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [opaqueHls],
      selectedSourceId: opaqueHls.id,
      error: null,
    },
    selectedSource: opaqueHls,
  });

  render(<PlaybackOverlay />);

  const englishAudio = { id: 'a-en', language: 'en', label: 'English' };
  const frenchAudio = { id: 'a-fr', language: 'fr', label: 'French' };
  const englishSubtitle = { id: 's-en', language: 'en', label: 'English' };
  const frenchSubtitle = { id: 's-fr', language: 'fr', label: 'French' };

  mockVideoPlayer.availableAudioTracks = [];
  mockVideoPlayer.availableSubtitleTracks = [];

  act(() => {
    mockVideoListeners.sourceLoad?.({
      availableAudioTracks: [frenchAudio, englishAudio],
      availableSubtitleTracks: [englishSubtitle, frenchSubtitle],
      duration: 120,
    });
  });

  expect(mockVideoPlayer.audioTrack).toBe(englishAudio);
  expect(mockVideoPlayer.subtitleTrack).toBe(frenchSubtitle);
});


test('uses late native track-change payloads when player properties lag', () => {
  const opaqueHls: StreamSource = {
    id: 'late-payload-hls',
    providerId: 'provider',
    url: 'https://cdn.example/play/opaque',
    contentType: 'application/vnd.apple.mpegurl',
  };
  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [opaqueHls],
      selectedSourceId: opaqueHls.id,
      error: null,
    },
    selectedSource: opaqueHls,
  });

  render(<PlaybackOverlay />);

  const englishAudio = { id: 'a-en', language: 'en', label: 'English' };
  const frenchAudio = { id: 'a-fr', language: 'fr', label: 'French' };
  mockVideoPlayer.availableAudioTracks = [];

  act(() => {
    mockVideoListeners.availableAudioTracksChange?.({
      availableAudioTracks: [frenchAudio, englishAudio],
    });
  });

  expect(mockVideoPlayer.audioTrack).toBe(englishAudio);

  const englishSubtitle = { id: 's-en', language: 'en', label: 'English' };
  const frenchSubtitle = { id: 's-fr', language: 'fr', label: 'French' };
  mockVideoPlayer.availableSubtitleTracks = [];

  act(() => {
    mockVideoListeners.availableSubtitleTracksChange?.({
      availableSubtitleTracks: [englishSubtitle, frenchSubtitle],
    });
  });

  expect(mockVideoPlayer.subtitleTrack).toBe(frenchSubtitle);
});

test('locking the player hides the header, and one tap brings it back', () => {
  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [english],
      selectedSourceId: english.id,
      error: null,
    },
    selectedSource: english,
  });

  render(<PlaybackOverlay />);
  expect(screen.getByTestId('player-close')).toBeTruthy();

  fireEvent.press(screen.getByTestId('player-lock'));
  expect(screen.queryByTestId('player-close')).toBeNull();
  expect(screen.getByTestId('player-chrome-unlock')).toBeTruthy();

  fireEvent.press(screen.getByTestId('player-chrome-unlock'));
  expect(screen.getByTestId('player-close')).toBeTruthy();
});

test('a subtitle style chosen in Settings applies to the next film', async () => {
  // The overlay is mounted for the whole session, so the style must be re-read
  // when a film starts rather than only on mount.
  const subtitleStyle = jest.requireMock('../subtitleStyle') as {
    readSubtitleStyle: jest.Mock;
  };
  subtitleStyle.readSubtitleStyle.mockClear();

  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [english],
      selectedSourceId: english.id,
      error: null,
    },
    selectedSource: english,
  });
  const view = render(<PlaybackOverlay />);
  await act(async () => { await Promise.resolve(); });
  const firstCallCount = subtitleStyle.readSubtitleStyle.mock.calls.length;
  expect(firstCallCount).toBeGreaterThan(0);

  // A different source id means a new film.
  setPlayback('ready', {
    state: {
      status: 'ready',
      request,
      sources: [french],
      selectedSourceId: french.id,
      error: null,
    },
    selectedSource: french,
  });
  view.rerender(<PlaybackOverlay />);
  await act(async () => { await Promise.resolve(); });

  expect(subtitleStyle.readSubtitleStyle.mock.calls.length)
    .toBeGreaterThan(firstCallCount);
});
