import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { MediaDetails, SeriesSeason } from '@moviestv/catalog';
import { SeriesEpisodeBrowser } from '../SeriesEpisodeBrowser';
import { WatchProgressContext } from '../../watch-progress/useWatchProgress';

const mockGetSeason = jest.fn();
const mockCatalogService = { getSeason: mockGetSeason };
const mockPlayEpisode = jest.fn();
const mockTranslate = (key: string) => ({
  'details.season': 'Season',
  'details.episode': 'Episode',
  'details.episodes': 'Episodes',
  'details.loadingEpisodes': 'Loading episodes',
  'details.noEpisodes': 'No episodes available',
  'details.loadEpisodesFailed': "Couldn't load episodes",
  'common.retry': 'Retry',
}[key] ?? key);

jest.mock('../useCatalog', () => ({
  useCatalog: () => ({ service: mockCatalogService }),
}));

jest.mock('../../playback/usePlayback', () => ({
  usePlayback: () => ({ playEpisode: mockPlayEpisode }),
}));

jest.mock('../../i18n/useI18n', () => ({
  useI18n: () => ({ t: mockTranslate }),
}));

const series: MediaDetails = {
  id: 'tmdb:series:1399',
  kind: 'series',
  title: 'Game of Thrones',
  providerId: 'tmdb',
  externalIds: { tmdb: '1399', imdb: 'tt0944947' },
  seasons: [
    { id: 'tmdb:season:3624', seasonNumber: 1, name: 'Season 1', episodeCount: 10 },
    { id: 'tmdb:season:3625', seasonNumber: 2, name: 'Season 2', episodeCount: 10 },
  ],
};

const seasonOne: SeriesSeason = {
  seriesId: series.id,
  seasonNumber: 1,
  name: 'Season 1',
  episodes: [{
    id: 'tmdb:episode:63056',
    seriesId: series.id,
    seasonNumber: 1,
    episodeNumber: 1,
    title: 'Winter Is Coming',
    runtimeMinutes: 62,
    stillUrl: 'https://image.tmdb.org/t/p/w500/e1.jpg',
  }],
};

const seasonTwo: SeriesSeason = {
  seriesId: series.id,
  seasonNumber: 2,
  name: 'Season 2',
  episodes: [{
    id: 'tmdb:episode:63070',
    seriesId: series.id,
    seasonNumber: 2,
    episodeNumber: 3,
    title: 'What Is Dead May Never Die',
  }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mockGetSeason.mockReset();
  mockPlayEpisode.mockReset();
});

test('loads the first real season and renders focusable episode controls with a still image', async () => {
  const pending = deferred<SeriesSeason | null>();
  mockGetSeason.mockReturnValueOnce(pending.promise);
  render(<SeriesEpisodeBrowser series={series} />);

  expect(mockGetSeason).toHaveBeenCalledWith(series.id, 1);
  expect(screen.getByText('Loading episodes')).toBeTruthy();
  expect(screen.getByTestId('season-1').props.focusable).toBe(true);
  expect(screen.getByTestId('season-2').props.focusable).toBe(true);

  await act(async () => { pending.resolve(seasonOne); });

  expect(await screen.findByText('Winter Is Coming')).toBeTruthy();
  expect(screen.getByTestId('episode-1-1').props.focusable).toBe(true);
  expect(screen.getByTestId('episode-still-1-1').props.source).toEqual({
    uri: 'https://image.tmdb.org/t/p/w500/e1.jpg',
  });
});

test('switches seasons and ignores a stale earlier response', async () => {
  const first = deferred<SeriesSeason | null>();
  const second = deferred<SeriesSeason | null>();
  mockGetSeason
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  render(<SeriesEpisodeBrowser series={series} />);

  fireEvent.press(screen.getByTestId('season-2'));
  expect(mockGetSeason).toHaveBeenLastCalledWith(series.id, 2);

  await act(async () => { second.resolve(seasonTwo); });
  expect(await screen.findByText('What Is Dead May Never Die')).toBeTruthy();

  await act(async () => { first.resolve(seasonOne); });
  expect(screen.queryByText('Winter Is Coming')).toBeNull();
  expect(screen.getByText('What Is Dead May Never Die')).toBeTruthy();
});

test('retries a failed season load without exposing the raw error', async () => {
  mockGetSeason
    .mockRejectedValueOnce(new Error('TMDB secret upstream detail'))
    .mockResolvedValueOnce(seasonOne);
  render(<SeriesEpisodeBrowser series={series} />);

  expect(await screen.findByText("Couldn't load episodes")).toBeTruthy();
  expect(screen.queryByText('TMDB secret upstream detail')).toBeNull();

  fireEvent.press(screen.getByTestId('retry-season'));
  expect(await screen.findByText('Winter Is Coming')).toBeTruthy();
  expect(mockGetSeason).toHaveBeenCalledTimes(2);
});

test('plays the selected real episode through the existing playback API', async () => {
  mockGetSeason
    .mockResolvedValueOnce(seasonOne)
    .mockResolvedValueOnce(seasonTwo);
  render(<SeriesEpisodeBrowser series={series} />);

  fireEvent.press(screen.getByTestId('season-2'));
  const episodeRow = await screen.findByTestId('episode-2-3');
  fireEvent.press(episodeRow);

  await waitFor(() => expect(mockPlayEpisode).toHaveBeenCalledWith(series, seasonTwo.episodes[0]));
});


test('shows catalog-native episode progress by parent series identity', async () => {
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
  const nativeSeason: SeriesSeason = {
    seriesId: nativeSeries.id,
    seasonNumber: 1,
    name: 'Season 1',
    episodes: [{
      id: 'custom:new-episode-id',
      seriesId: nativeSeries.id,
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Pilot',
    }],
  };
  mockGetSeason.mockResolvedValueOnce(nativeSeason);

  render(
    <WatchProgressContext.Provider value={{
      records: [{
        mediaId: 'custom:old-episode-id',
        kind: 'episode',
        title: 'Native Series · S1E1 · Pilot',
        externalIds: {},
        seriesId: nativeSeries.id,
        seasonNumber: 1,
        episodeNumber: 1,
        positionSeconds: 450,
        durationSeconds: 1800,
        completed: false,
        updatedAt: '2026-09-23T08:00:00.000Z',
      }],
      status: 'ready',
      save: jest.fn(async () => undefined),
      restart: jest.fn(async () => undefined),
      markCompleted: jest.fn(async () => undefined),
      forget: jest.fn(async () => undefined),
      forgetAll: jest.fn(async () => undefined),
    }}>
      <SeriesEpisodeBrowser series={nativeSeries} />
    </WatchProgressContext.Provider>,
  );

  expect(await screen.findByText('Pilot')).toBeTruthy();
  expect(screen.getByTestId('episode-progress-1-1')).toBeTruthy();
  expect(screen.getByText('25%')).toBeTruthy();
});

test('shows synchronized episode progress and keeps episode playback clickable', async () => {
  mockGetSeason.mockResolvedValueOnce(seasonOne);
  const episode = seasonOne.episodes[0]!;

  render(
    <WatchProgressContext.Provider value={{
      records: [{
        mediaId: episode.id,
        kind: 'episode',
        title: episode.title,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        externalIds: series.externalIds,
        positionSeconds: 900,
        durationSeconds: 1800,
        completed: false,
        updatedAt: '2026-09-19T14:00:00.000Z',
      }],
      status: 'ready',
      save: jest.fn(async () => undefined),
      restart: jest.fn(async () => undefined),
      markCompleted: jest.fn(async () => undefined),
      forget: jest.fn(async () => undefined),
      forgetAll: jest.fn(async () => undefined),
    }}>
      <SeriesEpisodeBrowser series={series} />
    </WatchProgressContext.Provider>,
  );

  expect(await screen.findByText('Winter Is Coming')).toBeTruthy();
  expect(screen.getByTestId('episode-progress-1-1')).toBeTruthy();
  expect(screen.getByText('50%')).toBeTruthy();

  fireEvent.press(screen.getByTestId('episode-1-1'));
  expect(mockPlayEpisode).toHaveBeenCalledWith(series, episode);
});


test('does not render invalid episode zero rows', async () => {
  mockGetSeason.mockResolvedValueOnce({
    seriesId: series.id,
    seasonNumber: 1,
    name: 'Season 1',
    episodes: [
      {
        id: 'tmdb:episode:zero',
        seriesId: series.id,
        seasonNumber: 1,
        episodeNumber: 0,
        title: 'Invalid Episode Zero',
      },
      seasonOne.episodes[0],
    ],
  } satisfies SeriesSeason);

  render(<SeriesEpisodeBrowser series={series} />);

  expect(await screen.findByText('Winter Is Coming')).toBeTruthy();
  expect(screen.queryByText('Invalid Episode Zero')).toBeNull();
  expect(screen.queryByTestId('episode-1-0')).toBeNull();
});

test('keeps season zero specials selectable without opening them by default', async () => {
  const specialsSeries: MediaDetails = {
    ...series,
    seasons: [
      { id: 'tmdb:season:specials', seasonNumber: 0, name: 'Specials', episodeCount: 1 },
      ...(series.seasons ?? []),
    ],
  };
  const specials: SeriesSeason = {
    seriesId: series.id,
    seasonNumber: 0,
    name: 'Specials',
    episodes: [{
      id: 'tmdb:episode:special-1',
      seriesId: series.id,
      seasonNumber: 0,
      episodeNumber: 1,
      title: 'Special One',
    }],
  };
  mockGetSeason
    .mockResolvedValueOnce(seasonOne)
    .mockResolvedValueOnce(specials);

  render(<SeriesEpisodeBrowser series={specialsSeries} />);

  expect(mockGetSeason).toHaveBeenCalledWith(series.id, 1);
  fireEvent.press(screen.getByTestId('season-0'));
  expect(mockGetSeason).toHaveBeenLastCalledWith(series.id, 0);

  const row = await screen.findByTestId('episode-0-1');
  fireEvent.press(row);

  expect(mockPlayEpisode).toHaveBeenCalledWith(
    specialsSeries,
    specials.episodes[0],
  );
});


test('shows the empty episode state when a season is unavailable', async () => {
  mockGetSeason.mockResolvedValueOnce(null);

  render(<SeriesEpisodeBrowser series={series} />);

  expect(await screen.findByText('No episodes available')).toBeTruthy();
  expect(screen.queryByTestId('retry-season')).toBeNull();
});


test('defaults to the first positive season while keeping specials selectable', async () => {
  const withSpecials: MediaDetails = {
    ...series,
    seasons: [
      { id: 'specials', seasonNumber: 0, name: 'Specials', episodeCount: 1 },
      { id: 'season-1', seasonNumber: 1, name: 'Season 1', episodeCount: 2 },
      { id: 'season-2', seasonNumber: 2, name: 'Season 2', episodeCount: 1 },
    ],
  };
  mockGetSeason.mockResolvedValue({
    seriesId: withSpecials.id,
    seasonNumber: 1,
    episodes: [{
      id: 'series:episode:1',
      seriesId: withSpecials.id,
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Pilot',
    }],
  });

  render(<SeriesEpisodeBrowser series={withSpecials} />);

  await waitFor(() => {
    expect(mockGetSeason).toHaveBeenCalledWith(withSpecials.id, 1);
  });
  expect(mockGetSeason).not.toHaveBeenCalledWith(withSpecials.id, 0);
  expect(screen.getByTestId('season-0')).toBeTruthy();
});


test('sorts provider season metadata numerically before choosing the default', async () => {
  const unordered: MediaDetails = {
    ...series,
    seasons: [
      { id: 'season-3', seasonNumber: 3, name: 'Season 3', episodeCount: 1 },
      { id: 'specials', seasonNumber: 0, name: 'Specials', episodeCount: 1 },
      { id: 'season-2', seasonNumber: 2, name: 'Season 2', episodeCount: 1 },
      { id: 'season-1', seasonNumber: 1, name: 'Season 1', episodeCount: 1 },
    ],
  };
  mockGetSeason.mockResolvedValueOnce(seasonOne);

  render(<SeriesEpisodeBrowser series={unordered} />);

  await waitFor(() => {
    expect(mockGetSeason).toHaveBeenCalledWith(unordered.id, 1);
  });
  expect(
    screen.getAllByText(/^(?:Specials|Season [1-3])$/)
      .map((node) => node.props.children),
  ).toEqual([
    'Specials',
    'Season 1',
    'Season 2',
    'Season 3',
  ]);
});
