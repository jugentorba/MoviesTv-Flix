import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { MediaDetails } from '@moviestv/catalog';
import { MediaDetailsScreen } from '../MediaDetailsScreen';
import { WatchProgressContext } from '../../watch-progress/useWatchProgress';

const mockGetDetails = jest.fn();
const mockSearch = jest.fn();
const mockGetSeason = jest.fn();
const mockPlayMovie = jest.fn();
const mockPlayEpisode = jest.fn();
const mockResolveMovieSources = jest.fn();
const mockResolveEpisodeSources = jest.fn();
const mockResumeProgress = jest.fn(async () => true);
const mockStartDownload = jest.fn(async () => 'download-1');
const mockSetMyListItems = jest.fn(async (_items: any[]): Promise<void> => undefined);
let mockMyListItems: any[] = [];
const mockCatalogService = { getDetails: mockGetDetails, search: mockSearch, getSeason: mockGetSeason };
const mockCopy: Record<string, string> = {
  'common.back': 'Back',
  'common.loading': 'Loading',
  'common.unavailable': 'Unavailable',
  'common.retry': 'Retry',
  'common.movie': 'Movie',
  'common.series': 'Series',
  'common.minutes': 'min',
  'common.seasons': 'seasons',
  'common.cast': 'Cast',
  'common.catalog': 'Catalog',
  'common.provider': 'Provider',
  'details.noOverview': 'No overview',
  'details.playUnavailable': 'Playback unavailable',
  'details.season': 'Season',
  'details.episode': 'Episode',
  'details.episodes': 'Episodes',
  'details.loadingEpisodes': 'Loading episodes',
  'details.noEpisodes': 'No episodes available',
  'details.loadEpisodesFailed': "Couldn't load episodes",
  'playback.play': 'Play',
  'playback.download': 'Download',
  'playback.noSources': 'No playback sources found',
  'playback.failed': 'Playback failed',
  'playback.sources': 'Sources',
  'playback.selected': 'Selected',
  'playback.close': 'Close',
  'mediaDetails.resume': 'Resume',
  'mediaDetails.addToMyList': 'My List',
  'mediaDetails.removeFromMyList': 'Remove from My List',
};
const mockTranslate = (key: string) => mockCopy[key] ?? key;

jest.mock('../useCatalog', () => ({
  useCatalog: () => ({ service: mockCatalogService }),
}));

jest.mock('../../playback/usePlayback', () => ({
  usePlayback: () => ({
    playMovie: mockPlayMovie,
    playEpisode: mockPlayEpisode,
    resolveMovieSources: mockResolveMovieSources,
    resolveEpisodeSources: mockResolveEpisodeSources,
    resumeProgress: mockResumeProgress,
  }),
}));

jest.mock('../../preferences/usePreferences', () => ({
  usePreferences: () => ({
    preferences: {
      appLocale: 'en',
      preferredAudioLanguages: ['en', 'fr', 'de'],
      preferredSubtitleLanguages: [],
      subtitlesEnabled: true,
      autoplay: true,
      favoriteChannelIds: [],
      myListItems: mockMyListItems,
    },
    ready: true,
    setMyListItems: mockSetMyListItems,
  }),
}));

jest.mock('../../downloads/useDownloadManager', () => ({
  useDownloadManager: () => ({
    jobs: [],
    startDownload: mockStartDownload,
    pause: jest.fn(async () => undefined),
    resume: jest.fn(async () => undefined),
    cancel: jest.fn(),
    dismiss: jest.fn(),
  }),
}));

jest.mock('../../i18n/useI18n', () => ({
  useI18n: () => ({ t: mockTranslate, locale: 'en' }),
}));

const movie: MediaDetails = {
  id: 'movie:550',
  kind: 'movie',
  title: 'Fight Club',
  providerId: 'tmdb',
  externalIds: { tmdb: '550', imdb: 'tt0137523' },
};

const series: MediaDetails = {
  id: 'series:1399',
  kind: 'series',
  title: 'Game of Thrones',
  providerId: 'tmdb',
  externalIds: { tmdb: '1399', imdb: 'tt0944947' },
  seasonCount: 8,
};

const playableSeries: MediaDetails = {
  ...series,
  id: 'tmdb:series:1399',
  seasons: [{ id: 'tmdb:season:3624', seasonNumber: 1, name: 'Season 1', episodeCount: 10 }],
};

beforeEach(() => {
  mockGetDetails.mockReset();
  mockSearch.mockReset();
  mockGetSeason.mockReset();
  mockPlayMovie.mockReset();
  mockPlayEpisode.mockReset();
  mockResolveMovieSources.mockReset();
  mockResolveEpisodeSources.mockReset();
  mockResumeProgress.mockReset();
  mockResumeProgress.mockResolvedValue(true);
  mockStartDownload.mockReset();
  mockStartDownload.mockResolvedValue('download-1');
  mockSetMyListItems.mockReset();
  mockSetMyListItems.mockResolvedValue(undefined);
  mockMyListItems = [];
});

test('enables movie playback when a usable external id is available', async () => {
  mockGetDetails.mockResolvedValueOnce(movie);
  render(<MediaDetailsScreen mediaId={movie.id} onBack={jest.fn()} />);

  const play = await screen.findByTestId('play-movie');
  fireEvent.press(play);

  expect(play).toBeTruthy();
  expect(mockPlayMovie).toHaveBeenCalledWith(movie);
});

test('derives stale My List recovery identity when navigation only provides the media id', async () => {
  const recovered: MediaDetails = {
    ...movie,
    id: 'cinemeta:movie:tt0137523',
    providerId: 'cinemeta',
  };
  mockMyListItems = [{
    mediaId: 'removed-provider:movie:550',
    kind: 'movie',
    title: 'Fight Club',
    providerId: 'removed-provider',
    externalIds: { tmdb: '550', imdb: 'tt0137523' },
  }];
  mockGetDetails
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(recovered);
  mockSearch.mockResolvedValueOnce({
    items: [{
      id: recovered.id,
      kind: recovered.kind,
      title: recovered.title,
      providerId: recovered.providerId,
      externalIds: recovered.externalIds,
    }],
  });

  render(
    <MediaDetailsScreen
      mediaId="removed-provider:movie:550"
      onBack={jest.fn()}
    />,
  );

  expect(await screen.findByText('Fight Club')).toBeTruthy();
  expect(mockSearch).toHaveBeenCalledWith('Fight Club');
  expect(mockGetDetails).toHaveBeenNthCalledWith(
    2,
    recovered.id,
  );
});

test('prefers recoverable progress identity over an older My List entry without external ids', async () => {
  const recovered: MediaDetails = {
    ...movie,
    id: 'cinemeta:movie:tt0137523',
    providerId: 'cinemeta',
  };
  mockMyListItems = [{
    mediaId: 'removed-provider:movie:550',
    kind: 'movie',
    title: 'Fight Club',
    providerId: 'removed-provider',
    externalIds: {},
  }];
  mockGetDetails
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(recovered);
  mockSearch.mockResolvedValueOnce({
    items: [{
      id: recovered.id,
      kind: recovered.kind,
      title: recovered.title,
      providerId: recovered.providerId,
      externalIds: recovered.externalIds,
    }],
  });

  render(
    <WatchProgressContext.Provider
      value={{
        userId: 'user-1',
        records: [{
          mediaId: 'removed-provider:movie:550',
          kind: 'movie',
          title: 'Fight Club',
          externalIds: recovered.externalIds,
          positionSeconds: 300,
          durationSeconds: 3600,
          completed: false,
          updatedAt: '2026-09-27T08:00:00.000Z',
        }],
        status: 'ready',
        save: jest.fn(async () => undefined),
        restart: jest.fn(async () => undefined),
        markCompleted: jest.fn(async () => undefined),
        forget: jest.fn(async () => undefined),
        forgetAll: jest.fn(async () => undefined),
      }}
    >
      <MediaDetailsScreen
        mediaId="removed-provider:movie:550"
        onBack={jest.fn()}
      />
    </WatchProgressContext.Provider>,
  );

  expect(await screen.findByText('Fight Club')).toBeTruthy();
  expect(mockSearch).toHaveBeenCalledWith('Fight Club');
});

test('derives parent-series recovery identity from synchronized episode progress', async () => {
  const recoveredSeries: MediaDetails = {
    ...series,
    id: 'cinemeta:series:tt0944947',
    providerId: 'cinemeta',
  };
  mockGetDetails
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(recoveredSeries);
  mockSearch.mockResolvedValueOnce({
    items: [{
      id: recoveredSeries.id,
      kind: 'series',
      title: recoveredSeries.title,
      providerId: recoveredSeries.providerId,
      externalIds: recoveredSeries.externalIds,
    }],
  });

  render(
    <WatchProgressContext.Provider
      value={{
        userId: 'user-1',
        records: [{
          mediaId: 'old-provider:episode:1',
          kind: 'episode',
          title: 'Game of Thrones · S1E1 · Winter Is Coming',
          externalIds: series.externalIds,
          seriesId: 'removed-provider:series:1399',
          seasonNumber: 1,
          episodeNumber: 1,
          positionSeconds: 300,
          durationSeconds: 3600,
          completed: false,
          updatedAt: '2026-09-27T08:00:00.000Z',
        }],
        status: 'ready',
        save: jest.fn(async () => undefined),
        restart: jest.fn(async () => undefined),
        markCompleted: jest.fn(async () => undefined),
        forget: jest.fn(async () => undefined),
        forgetAll: jest.fn(async () => undefined),
      }}
    >
      <MediaDetailsScreen
        mediaId="removed-provider:series:1399"
        onBack={jest.fn()}
      />
    </WatchProgressContext.Provider>,
  );

  expect(await screen.findByText('Game of Thrones')).toBeTruthy();
  expect(mockSearch).toHaveBeenCalledWith('Game of Thrones');
  expect(mockGetDetails).toHaveBeenNthCalledWith(
    2,
    recoveredSeries.id,
  );
});

test('recovers saved My List details from another catalog by external identity', async () => {
  const recovered: MediaDetails = {
    ...movie,
    id: 'cinemeta:movie:tt0137523',
    providerId: 'cinemeta',
  };
  mockGetDetails
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(recovered);
  mockSearch.mockResolvedValueOnce({
    items: [
      {
        id: 'removed-provider:movie:550',
        kind: 'movie',
        title: 'Fight Club',
        providerId: 'removed-provider',
        externalIds: recovered.externalIds,
      },
      {
        id: recovered.id,
        kind: recovered.kind,
        title: recovered.title,
        providerId: recovered.providerId,
        externalIds: recovered.externalIds,
      },
    ],
  });

  render(
    <MediaDetailsScreen
      mediaId="removed-provider:movie:550"
      fallbackIdentity={{
        mediaId: 'removed-provider:movie:550',
        kind: 'movie',
        title: 'Fight Club',
        externalIds: { tmdb: '550', imdb: 'tt0137523' },
      }}
      onBack={jest.fn()}
    />,
  );

  expect(await screen.findByText('Fight Club')).toBeTruthy();
  expect(mockSearch).toHaveBeenCalledWith('Fight Club');
  expect(mockGetDetails).toHaveBeenNthCalledWith(
    2,
    'cinemeta:movie:tt0137523',
  );
});

test('tries later matching catalogs when the first recovered My List id is stale', async () => {
  const recovered: MediaDetails = {
    ...movie,
    id: 'working-provider:movie:tt0137523',
    providerId: 'working-provider',
  };
  mockGetDetails
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(recovered);
  mockSearch.mockResolvedValueOnce({
    items: [
      {
        id: 'stale-provider:movie:tt0137523',
        kind: 'movie',
        title: recovered.title,
        providerId: 'stale-provider',
        externalIds: recovered.externalIds,
      },
      {
        id: recovered.id,
        kind: 'movie',
        title: recovered.title,
        providerId: recovered.providerId,
        externalIds: recovered.externalIds,
      },
    ],
  });

  render(
    <MediaDetailsScreen
      mediaId="removed-provider:movie:550"
      fallbackIdentity={{
        mediaId: 'removed-provider:movie:550',
        kind: 'movie',
        title: 'Fight Club',
        externalIds: { tmdb: '550', imdb: 'tt0137523' },
      }}
      onBack={jest.fn()}
    />,
  );

  expect(await screen.findByText('Fight Club')).toBeTruthy();
  expect(mockGetDetails).toHaveBeenNthCalledWith(
    2,
    'stale-provider:movie:tt0137523',
  );
  expect(mockGetDetails).toHaveBeenNthCalledWith(
    3,
    'working-provider:movie:tt0137523',
  );
});

test('offers movie playback for catalog-native titles without IMDb/TMDB IDs', async () => {
  const nativeMovie: MediaDetails = {
    id: 'stremio-custom:movie:custom%3A42',
    kind: 'movie',
    title: 'Native Movie',
    providerId: 'stremio-custom',
    externalIds: {},
  };
  mockGetDetails.mockResolvedValueOnce(nativeMovie);

  render(
    <MediaDetailsScreen
      mediaId={nativeMovie.id}
      onBack={jest.fn()}
    />,
  );

  fireEvent.press(await screen.findByTestId('play-movie'));
  expect(mockPlayMovie).toHaveBeenCalledWith(nativeMovie);
  expect(screen.queryByText('Playback unavailable')).toBeNull();
});

test('offers episode browsing for catalog-native series without IMDb/TMDB IDs', async () => {
  const nativeSeries: MediaDetails = {
    id: 'stremio-custom:series:custom%3Ashow-42',
    kind: 'series',
    title: 'Native Series',
    providerId: 'stremio-custom',
    externalIds: {},
    seasons: [{
      id: 'native-season-1',
      seasonNumber: 1,
      name: 'Season 1',
      episodeCount: 1,
    }],
  };
  mockGetDetails.mockResolvedValueOnce(nativeSeries);
  mockGetSeason.mockResolvedValueOnce({
    seriesId: nativeSeries.id,
    seasonNumber: 1,
    name: 'Season 1',
    episodes: [{
      id: 'custom:show-42:1:1',
      seriesId: nativeSeries.id,
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Pilot',
    }],
  });

  render(
    <MediaDetailsScreen
      mediaId={nativeSeries.id}
      onBack={jest.fn()}
    />,
  );

  expect(await screen.findByTestId('season-1')).toBeTruthy();
  expect(await screen.findByTestId('episode-1-1')).toBeTruthy();
  expect(screen.queryByText('Playback unavailable')).toBeNull();
});

test('keeps series playback unavailable when real episode metadata is absent', async () => {
  mockGetDetails.mockResolvedValueOnce(series);
  render(<MediaDetailsScreen mediaId={series.id} onBack={jest.fn()} />);

  expect(await screen.findByText('Game of Thrones')).toBeTruthy();
  expect(screen.queryByTestId('play-movie')).toBeNull();
  expect(screen.getByText('Playback unavailable')).toBeTruthy();
});

test('renders the episode browser when a series has real season metadata', async () => {
  mockGetDetails.mockResolvedValueOnce(playableSeries);
  mockGetSeason.mockResolvedValueOnce({
    seriesId: playableSeries.id,
    seasonNumber: 1,
    name: 'Season 1',
    episodes: [],
  });
  render(<MediaDetailsScreen mediaId={playableSeries.id} onBack={jest.fn()} />);

  expect(await screen.findByTestId('season-1')).toBeTruthy();
  expect(screen.queryByText('Playback unavailable')).toBeNull();
});




test('renders the episode browser for a special-only season zero series', async () => {
  const specialsOnly: MediaDetails = {
    ...series,
    id: 'tmdb:series:specials-only',
    seasons: [{
      id: 'tmdb:season:specials',
      seasonNumber: 0,
      name: 'Specials',
      episodeCount: 1,
    }],
  };
  mockGetDetails.mockResolvedValueOnce(specialsOnly);
  mockGetSeason.mockResolvedValueOnce({
    seriesId: specialsOnly.id,
    seasonNumber: 0,
    name: 'Specials',
    episodes: [{
      id: 'tmdb:episode:special-1',
      seriesId: specialsOnly.id,
      seasonNumber: 0,
      episodeNumber: 1,
      title: 'Special One',
    }],
  });

  render(
    <MediaDetailsScreen
      mediaId={specialsOnly.id}
      onBack={jest.fn()}
    />,
  );

  expect(await screen.findByTestId('season-0')).toBeTruthy();
  expect(screen.queryByText('Playback unavailable')).toBeNull();
  expect(await screen.findByTestId('episode-0-1')).toBeTruthy();
});

test('shows synchronized resume progress for a partially watched movie', async () => {
  mockGetDetails.mockResolvedValueOnce(movie);
  const progress = {
    mediaId: movie.id,
    kind: 'movie' as const,
    title: movie.title,
    externalIds: movie.externalIds,
    positionSeconds: 1800,
    durationSeconds: 3600,
    completed: false,
    updatedAt: '2026-09-19T14:00:00.000Z',
  };

  render(
    <WatchProgressContext.Provider value={{
      records: [progress],
      status: 'ready',
      save: jest.fn(async () => undefined),
      restart: jest.fn(async () => undefined),
      markCompleted: jest.fn(async () => undefined),
      forget: jest.fn(async () => undefined),
      forgetAll: jest.fn(async () => undefined),
    }}>
      <MediaDetailsScreen mediaId={movie.id} onBack={jest.fn()} />
    </WatchProgressContext.Provider>,
  );

  expect(await screen.findByText('▶  Resume · 50%')).toBeTruthy();
  expect(screen.getByTestId('movie-resume-progress')).toBeTruthy();

  fireEvent.press(screen.getByTestId('play-movie'));
  expect(mockPlayMovie).toHaveBeenCalledWith(movie);
});


test('series resume matches catalog-native series IDs without external IDs', async () => {
  const nativeSeries: MediaDetails = {
    id: 'stremio-custom:series:custom%3Ashow-42',
    kind: 'series',
    title: 'Native Series',
    providerId: 'stremio-custom',
    externalIds: {},
    seasons: [{
      id: 'native-season-1',
      seasonNumber: 1,
      name: 'Season 1',
      episodeCount: 1,
    }],
  };
  const progress = {
    mediaId: 'custom:show-42:1:1',
    kind: 'episode' as const,
    title: 'Native Series · S1E1 · Pilot',
    externalIds: {},
    seriesId: nativeSeries.id,
    seasonNumber: 1,
    episodeNumber: 1,
    positionSeconds: 900,
    durationSeconds: 1800,
    completed: false,
    updatedAt: '2026-09-22T14:40:00.000Z',
  };
  mockGetDetails.mockResolvedValueOnce(nativeSeries);
  mockGetSeason.mockResolvedValueOnce({
    seriesId: nativeSeries.id,
    seasonNumber: 1,
    name: 'Season 1',
    episodes: [],
  });

  render(
    <WatchProgressContext.Provider value={{
      records: [progress],
      status: 'ready',
      save: jest.fn(async () => undefined),
      restart: jest.fn(async () => undefined),
      markCompleted: jest.fn(async () => undefined),
      forget: jest.fn(async () => undefined),
      forgetAll: jest.fn(async () => undefined),
    }}>
      <MediaDetailsScreen
        mediaId={nativeSeries.id}
        onBack={jest.fn()}
      />
    </WatchProgressContext.Provider>,
  );

  expect(await screen.findByText('▶  Resume · S1E1')).toBeTruthy();
  fireEvent.press(screen.getByTestId('resume-series-episode'));
  expect(mockResumeProgress).toHaveBeenCalledWith(progress);
});

test('series resume matches IMDb identity case-insensitively', async () => {
  mockGetDetails.mockResolvedValueOnce(playableSeries);
  mockGetSeason.mockResolvedValueOnce({
    seriesId: playableSeries.id,
    seasonNumber: 1,
    name: 'Season 1',
    episodes: [],
  });
  const progress = {
    mediaId: 'tmdb:episode:case-insensitive',
    kind: 'episode' as const,
    title: 'Game of Thrones · S1E3 · Lord Snow',
    externalIds: {
      imdb: playableSeries.externalIds.imdb?.toUpperCase(),
    },
    seasonNumber: 1,
    episodeNumber: 3,
    positionSeconds: 900,
    durationSeconds: 3600,
    completed: false,
    updatedAt: '2026-09-19T14:40:00.000Z',
  };

  render(
    <WatchProgressContext.Provider value={{
      records: [progress],
      status: 'ready',
      save: jest.fn(async () => undefined),
      restart: jest.fn(async () => undefined),
      markCompleted: jest.fn(async () => undefined),
      forget: jest.fn(async () => undefined),
      forgetAll: jest.fn(async () => undefined),
    }}>
      <MediaDetailsScreen
        mediaId={playableSeries.id}
        onBack={jest.fn()}
      />
    </WatchProgressContext.Provider>,
  );

  expect(await screen.findByText('▶  Resume · S1E3')).toBeTruthy();
  fireEvent.press(screen.getByTestId('resume-series-episode'));
  expect(mockResumeProgress).toHaveBeenCalledWith(progress);
});

test('series resume ignores a matching IMDb id when TMDB identity conflicts', async () => {
  mockGetDetails.mockResolvedValueOnce(playableSeries);
  mockGetSeason.mockResolvedValueOnce({
    seriesId: playableSeries.id,
    seasonNumber: 1,
    name: 'Season 1',
    episodes: [],
  });
  const progress = {
    mediaId: 'other-provider:episode:conflict',
    kind: 'episode' as const,
    title: 'Different Series · S1E3',
    externalIds: {
      imdb: playableSeries.externalIds.imdb,
      tmdb: '999999',
    },
    seasonNumber: 1,
    episodeNumber: 3,
    positionSeconds: 900,
    durationSeconds: 3600,
    completed: false,
    updatedAt: '2026-09-19T14:40:00.000Z',
  };

  render(
    <WatchProgressContext.Provider value={{
      records: [progress],
      status: 'ready',
      save: jest.fn(async () => undefined),
      restart: jest.fn(async () => undefined),
      markCompleted: jest.fn(async () => undefined),
      forget: jest.fn(async () => undefined),
      forgetAll: jest.fn(async () => undefined),
    }}>
      <MediaDetailsScreen
        mediaId={playableSeries.id}
        onBack={jest.fn()}
      />
    </WatchProgressContext.Provider>,
  );

  await screen.findByText(playableSeries.title);
  expect(screen.queryByTestId('resume-series-episode')).toBeNull();
  expect(mockResumeProgress).not.toHaveBeenCalled();
});

test('series details resumes the latest synchronized episode directly', async () => {
  mockGetDetails.mockResolvedValueOnce(playableSeries);
  mockGetSeason.mockResolvedValueOnce({
    seriesId: playableSeries.id,
    seasonNumber: 1,
    name: 'Season 1',
    episodes: [],
  });
  const progress = {
    mediaId: 'tmdb:episode:123',
    kind: 'episode' as const,
    title: 'Game of Thrones · S1E4 · Cripples, Bastards, and Broken Things',
    externalIds: playableSeries.externalIds,
    seasonNumber: 1,
    episodeNumber: 4,
    positionSeconds: 1200,
    durationSeconds: 3600,
    completed: false,
    updatedAt: '2026-09-19T14:30:00.000Z',
  };

  render(
    <WatchProgressContext.Provider value={{
      records: [progress],
      status: 'ready',
      save: jest.fn(async () => undefined),
      restart: jest.fn(async () => undefined),
      markCompleted: jest.fn(async () => undefined),
      forget: jest.fn(async () => undefined),
      forgetAll: jest.fn(async () => undefined),
    }}>
      <MediaDetailsScreen mediaId={playableSeries.id} onBack={jest.fn()} />
    </WatchProgressContext.Provider>,
  );

  const resume = await screen.findByTestId('resume-series-episode');
  expect(screen.getByText('▶  Resume · S1E4')).toBeTruthy();

  fireEvent.press(resume);
  expect(mockResumeProgress).toHaveBeenCalledWith(progress);
});


test('series resume is deterministic when synchronized timestamps tie', async () => {
  mockGetDetails.mockResolvedValueOnce(playableSeries);
  mockGetSeason.mockResolvedValueOnce({
    seriesId: playableSeries.id,
    seasonNumber: 1,
    name: 'Season 1',
    episodes: [],
  });
  const tiedAt = '2026-09-19T14:30:00.000Z';
  const earlierTieKey = {
    mediaId: 'a:episode:1',
    kind: 'episode' as const,
    title: 'Game of Thrones · S1E1 · Winter Is Coming',
    externalIds: playableSeries.externalIds,
    seasonNumber: 1,
    episodeNumber: 1,
    positionSeconds: 600,
    durationSeconds: 3600,
    completed: false,
    updatedAt: tiedAt,
  };
  const laterTieKey = {
    ...earlierTieKey,
    mediaId: 'z:episode:2',
    title: 'Game of Thrones · S1E2 · The Kingsroad',
    episodeNumber: 2,
  };

  render(
    <WatchProgressContext.Provider value={{
      records: [earlierTieKey, laterTieKey],
      status: 'ready',
      save: jest.fn(async () => undefined),
      restart: jest.fn(async () => undefined),
      markCompleted: jest.fn(async () => undefined),
      forget: jest.fn(async () => undefined),
      forgetAll: jest.fn(async () => undefined),
    }}>
      <MediaDetailsScreen mediaId={playableSeries.id} onBack={jest.fn()} />
    </WatchProgressContext.Provider>,
  );

  const resume = await screen.findByTestId('resume-series-episode');
  expect(screen.getByText('▶  Resume · S1E2')).toBeTruthy();

  fireEvent.press(resume);
  expect(mockResumeProgress).toHaveBeenCalledWith(laterTieKey);
});

test('downloads a movie directly from details without opening playback', async () => {
  const source = {
    id: 'download-source',
    url: 'https://cdn.example/fight-club.mp4',
    providerId: 'torrentio',
    name: 'Fight Club 1080p',
    quality: '1080p',
    language: 'en',
    sizeBytes: 4_000_000_000,
  };
  mockGetDetails.mockResolvedValueOnce(movie);
  mockResolveMovieSources.mockResolvedValueOnce([source]);

  render(<MediaDetailsScreen mediaId={movie.id} onBack={jest.fn()} />);

  fireEvent.press(await screen.findByTestId('download-movie'));
  const choice = await screen.findByTestId('source-download-source');
  fireEvent.press(choice);

  expect(mockPlayMovie).not.toHaveBeenCalled();
  expect(mockResolveMovieSources).toHaveBeenCalledWith(movie);
  expect(mockStartDownload).toHaveBeenCalledWith(
    source,
    movie.title,
    expect.objectContaining({
      mediaId: movie.id,
      kind: 'movie',
      title: movie.title,
      externalIds: movie.externalIds,
    }),
  );
});


test('downloads a series episode directly without starting episode playback', async () => {
  const episode = {
    id: 'tmdb:episode:101',
    seriesId: playableSeries.id,
    seasonNumber: 1,
    episodeNumber: 1,
    title: 'Winter Is Coming',
    stillUrl: 'https://images.example/winter.jpg',
  };
  const source = {
    id: 'episode-download',
    url: 'https://cdn.example/got-s01e01.mp4',
    providerId: 'torrentio',
    name: 'Game of Thrones S01E01 1080p',
    quality: '1080p',
    language: 'en',
  };

  mockGetDetails.mockResolvedValueOnce(playableSeries);
  mockGetSeason.mockResolvedValueOnce({
    seriesId: playableSeries.id,
    seasonNumber: 1,
    name: 'Season 1',
    episodes: [episode],
  });
  mockResolveEpisodeSources.mockResolvedValueOnce([source]);

  render(<MediaDetailsScreen mediaId={playableSeries.id} onBack={jest.fn()} />);

  const download = await screen.findByTestId('download-episode-1-1');
  const stopPropagation = jest.fn();
  fireEvent.press(download, { stopPropagation });
  expect(stopPropagation).toHaveBeenCalledTimes(1);
  const choice = await screen.findByTestId('source-episode-download');
  fireEvent.press(choice);

  expect(mockPlayEpisode).not.toHaveBeenCalled();
  expect(mockResolveEpisodeSources).toHaveBeenCalledWith(playableSeries, episode);
  expect(mockStartDownload).toHaveBeenCalledWith(
    source,
    'Game of Thrones · S1E1 · Winter Is Coming',
    expect.objectContaining({
      mediaId: episode.id,
      kind: 'episode',
      seriesId: playableSeries.id,
      seasonNumber: 1,
      episodeNumber: 1,
      externalIds: playableSeries.externalIds,
    }),
  );
});


test('adds a movie to My List from details', async () => {
  mockGetDetails.mockResolvedValueOnce(movie);
  render(<MediaDetailsScreen mediaId={movie.id} onBack={jest.fn()} />);

  const toggle = await screen.findByTestId('toggle-my-list');
  fireEvent.press(toggle);

  expect(mockSetMyListItems).toHaveBeenCalledWith([
    expect.objectContaining({
      mediaId: movie.id,
      kind: 'movie',
      title: movie.title,
      providerId: movie.providerId,
      externalIds: movie.externalIds,
    }),
  ]);
});

test('rapid My List toggles use the latest optimistic list state', async () => {
  mockGetDetails.mockResolvedValueOnce(movie);
  render(<MediaDetailsScreen mediaId={movie.id} onBack={jest.fn()} />);

  const toggle = await screen.findByTestId('toggle-my-list');
  fireEvent.press(toggle);
  fireEvent.press(toggle);

  expect(mockSetMyListItems).toHaveBeenCalledTimes(2);
  expect(mockSetMyListItems.mock.calls[0]?.[0]).toEqual([
    expect.objectContaining({ mediaId: movie.id }),
  ]);
  expect(mockSetMyListItems.mock.calls[1]?.[0]).toEqual([]);
});

test('recognizes and removes a My List movie saved from another catalog provider', async () => {
  mockMyListItems = [{
    mediaId: 'provider-a:movie:550',
    kind: 'movie',
    title: movie.title,
    providerId: 'provider-a',
    externalIds: {
      imdb: 'tt0137523',
      tmdb: '550',
    },
  }];
  mockGetDetails.mockResolvedValueOnce(movie);

  render(
    <MediaDetailsScreen
      mediaId={movie.id}
      onBack={jest.fn()}
    />,
  );

  const toggle = await screen.findByTestId('toggle-my-list');
  expect(screen.getByText('✓  Remove from My List')).toBeTruthy();

  fireEvent.press(toggle);

  expect(mockSetMyListItems).toHaveBeenCalledWith([]);
});

test('removes an existing movie from My List', async () => {
  mockMyListItems = [{
    mediaId: movie.id,
    kind: 'movie',
    title: movie.title,
    providerId: movie.providerId,
    externalIds: movie.externalIds,
  }];
  mockGetDetails.mockResolvedValueOnce(movie);

  render(<MediaDetailsScreen mediaId={movie.id} onBack={jest.fn()} />);
  fireEvent.press(await screen.findByTestId('toggle-my-list'));

  expect(mockSetMyListItems).toHaveBeenCalledWith([]);
});
