import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { MediaDetails, SeriesEpisode } from '@moviestv/catalog';
import type { StreamSource, SubtitleTrack } from '@moviestv/core';
import { PlaybackProvider } from '../PlaybackProvider';
import { usePlayback } from '../usePlayback';

const mockGetSeason = jest.fn();
const mockGetDetails = jest.fn();
const mockSearch = jest.fn();
let mockUserId: string | null = 'user-1';

jest.mock('../../addons/useAddons', () => ({
  useAddons: () => ({ installed: [] }),
}));

jest.mock('../../auth/useAccount', () => ({
  useAccount: () => ({ userId: mockUserId }),
}));

jest.mock('../../catalog/useCatalog', () => ({
  useCatalog: () => ({
    service: {
      getSeason: mockGetSeason,
      getDetails: mockGetDetails,
      search: mockSearch,
    },
  }),
}));

jest.mock('../../preferences/usePreferences', () => ({
  usePreferences: () => ({
    preferences: {
      appLocale: 'en',
      preferredAudioLanguages: ['fr', 'en', 'de'],
      preferredSubtitleLanguages: [],
      subtitlesEnabled: true,
      autoplay: true,
      favoriteChannelIds: [],
      myListItems: [],
    },
  }),
}));

const movie: MediaDetails = {
  id: 'movie:550',
  kind: 'movie',
  title: 'Fight Club',
  providerId: 'tmdb',
  externalIds: { tmdb: '550', imdb: 'tt0137523' },
};

const series: MediaDetails = {
  id: 'tmdb:series:1399',
  kind: 'series',
  title: 'Game of Thrones',
  providerId: 'tmdb',
  externalIds: { tmdb: '1399', imdb: 'tt0944947' },
  seasons: [
    { id: 'season-1', seasonNumber: 1, name: 'Season 1' },
    { id: 'season-2', seasonNumber: 2, name: 'Season 2' },
  ],
};

const episode: SeriesEpisode = {
  id: 'tmdb:episode:63056',
  seriesId: 'tmdb:series:1399',
  seasonNumber: 1,
  episodeNumber: 1,
  title: 'Winter Is Coming',
};

const specialEpisode: SeriesEpisode = {
  id: 'tmdb:episode:special-1',
  seriesId: 'tmdb:series:1399',
  seasonNumber: 0,
  episodeNumber: 1,
  title: 'Special One',
};

const specialEpisodeTwo: SeriesEpisode = {
  id: 'tmdb:episode:special-2',
  seriesId: 'tmdb:series:1399',
  seasonNumber: 0,
  episodeNumber: 2,
  title: 'Special Two',
};

const episodeTwo: SeriesEpisode = {
  id: 'tmdb:episode:63057',
  seriesId: 'tmdb:series:1399',
  seasonNumber: 1,
  episodeNumber: 2,
  title: 'The Kingsroad',
};

const lateSeasonOneEpisode: SeriesEpisode = {
  id: 'tmdb:episode:season1-10',
  seriesId: 'tmdb:series:1399',
  seasonNumber: 1,
  episodeNumber: 10,
  title: 'Season Finale',
};

const seasonTwoEpisodeOne: SeriesEpisode = {
  id: 'tmdb:episode:season2-1',
  seriesId: 'tmdb:series:1399',
  seasonNumber: 2,
  episodeNumber: 1,
  title: 'The North Remembers',
};

const nativeMovie: MediaDetails = {
  id: 'stremio-custom:movie:custom%3A42',
  kind: 'movie',
  title: 'Native Movie',
  providerId: 'stremio-custom',
  externalIds: {},
};

const nativeSeries: MediaDetails = {
  id: 'stremio-custom:series:custom%3Ashow-42',
  kind: 'series',
  title: 'Native Series',
  providerId: 'stremio-custom',
  externalIds: {},
  seasons: [
    { id: 'native-season-1', seasonNumber: 1, name: 'Season 1' },
  ],
};

const nativeEpisode: SeriesEpisode = {
  id: 'custom:episode:1',
  seriesId: nativeSeries.id,
  seasonNumber: 1,
  episodeNumber: 1,
  title: 'Native Pilot',
};

const request = {
  mediaId: 'movie:550',
  kind: 'movie' as const,
  externalIds: { tmdb: '550', imdb: 'tt0137523' },
};

const episodeRequest = {
  mediaId: 'tmdb:episode:63056',
  kind: 'episode' as const,
  externalIds: { tmdb: '1399', imdb: 'tt0944947' },
  seriesMediaId: series.id,
  seasonNumber: 1,
  episodeNumber: 1,
};

const english: StreamSource = {
  id: 'english',
  providerId: 'provider-a',
  url: 'https://cdn.example/en.mp4',
  language: 'en',
  quality: '1080p',
};

const french: StreamSource = {
  id: 'french',
  providerId: 'provider-b',
  url: 'https://cdn.example/fr.mp4',
  language: 'fr',
  quality: '720p',
};

function Probe() {
  const playback = usePlayback();
  const [resumeResult, setResumeResult] = React.useState('none');
  const [nextResult, setNextResult] = React.useState('none');
  return (
    <View>
      <Text testID="status">{playback.state.status}</Text>
      <Text testID="resume-result">{resumeResult}</Text>
      <Text testID="next-result">{nextResult}</Text>
      <Text testID="selected">{playback.selectedSource?.id ?? 'none'}</Text>
      <Text testID="chooser">{playback.sourceChooserOpen ? 'open' : 'closed'}</Text>
      <Text testID="subtitle">{playback.selectedSubtitle?.id ?? 'none'}</Text>
      <Text testID="next-episode">{playback.nextEpisode?.id ?? 'none'}</Text>
      <Pressable testID="play" onPress={() => { void playback.playMovie(movie); }} />
      <Pressable testID="play-native-movie" onPress={() => { void playback.playMovie(nativeMovie); }} />
      <Pressable testID="play-native-episode" onPress={() => { void playback.playEpisode(nativeSeries, nativeEpisode); }} />
      <Pressable testID="play-episode" onPress={() => { void playback.playEpisode(series, episode); }} />
      <Pressable testID="play-late-episode" onPress={() => { void playback.playEpisode(series, lateSeasonOneEpisode); }} />
      <Pressable testID="play-special" onPress={() => { void playback.playEpisode(series, specialEpisode); }} />
      <Pressable testID="play-episode-wrong-series" onPress={() => { void playback.playEpisode(series, { ...episode, seriesId: 'tmdb:series:999' }); }} />
      <Pressable testID="play-episode-zero" onPress={() => { void playback.playEpisode(series, { ...episode, episodeNumber: 0 }); }} />
      <Pressable testID="play-episode-movie-parent" onPress={() => { void playback.playEpisode(movie, episode); }} />
      <Pressable testID="retry" onPress={() => { void playback.retry(); }} />
      <Pressable testID="choose-english" onPress={() => playback.selectSource('english')} />
      <Pressable testID="open-chooser" onPress={playback.openSourceChooser} />
      <Pressable testID="subtitle-off" onPress={() => playback.selectSubtitle(null)} />
      <Pressable testID="play-next" onPress={() => { void playback.playNextEpisode(); }} />
      <Pressable
        testID="play-next-result"
        onPress={() => {
          void playback.playNextEpisode()
            .then((value) => setNextResult(String(value)));
        }}
      />
      <Pressable
        testID="resume-special"
        onPress={() => {
          void playback.resumeProgress({
            mediaId: specialEpisode.id,
            kind: 'episode',
            title: 'Game of Thrones · S0E1 · Special One',
            externalIds: series.externalIds,
            seriesId: series.id,
            seasonNumber: 0,
            episodeNumber: 1,
            positionSeconds: 120,
            durationSeconds: 1800,
            completed: false,
            updatedAt: '2026-09-21T16:30:00.000Z',
          });
        }}
      />
      <Pressable
        testID="resume-episode"
        onPress={() => {
          void playback.resumeProgress({
            mediaId: episode.id,
            kind: 'episode',
            title: 'Game of Thrones · S1E1 · Winter Is Coming',
            externalIds: series.externalIds,
            seriesId: series.id,
            seasonNumber: 1,
            episodeNumber: 1,
            positionSeconds: 300,
            durationSeconds: 3600,
            completed: false,
            updatedAt: '2026-09-19T18:20:00.000Z',
          });
        }}
      />
      <Pressable
        testID="resume-movie-result"
        onPress={() => {
          void playback.resumeProgress({
            mediaId: movie.id,
            kind: 'movie',
            title: movie.title,
            externalIds: movie.externalIds,
            positionSeconds: 300,
            durationSeconds: 3600,
            completed: false,
            updatedAt: '2026-09-19T18:20:00.000Z',
          }).then((value) => setResumeResult(String(value)));
        }}
      />
      <Pressable testID="close" onPress={playback.closePlayback} />
    </View>
  );
}

beforeEach(() => {
  mockUserId = 'user-1';
  mockGetSeason.mockReset();
  mockGetSeason.mockResolvedValue(null);
  mockGetDetails.mockReset();
  mockGetDetails.mockResolvedValue(null);
  mockSearch.mockReset();
  mockSearch.mockResolvedValue({ items: [] });
});

test('resolves a movie request, ranks sources from preferences, switches source and resets', async () => {
  const resolve = jest.fn(async () => [english, french]);

  const screen = render(
    <PlaybackProvider resolver={{ resolve }}>
      <Probe />
    </PlaybackProvider>,
  );

  fireEvent.press(screen.getByTestId('play'));

  await waitFor(() => expect(screen.getByTestId('status').props.children).toBe('ready'));
  expect(resolve).toHaveBeenCalledWith(request);
  expect(screen.getByTestId('selected').props.children).toBe('french');

  fireEvent.press(screen.getByTestId('open-chooser'));
  expect(screen.getByTestId('chooser').props.children).toBe('open');
  fireEvent.press(screen.getByTestId('choose-english'));
  expect(screen.getByTestId('selected').props.children).toBe('english');
  expect(screen.getByTestId('chooser').props.children).toBe('closed');

  fireEvent.press(screen.getByTestId('close'));
  expect(screen.getByTestId('status').props.children).toBe('idle');
  expect(screen.getByTestId('selected').props.children).toBe('none');
});

test('reports resume failure when no playback sources are available', async () => {
  const resolve = jest.fn(async () => []);

  const view = render(
    <PlaybackProvider resolver={{ resolve }}>
      <Probe />
    </PlaybackProvider>,
  );

  fireEvent.press(view.getByTestId('resume-movie-result'));

  await waitFor(() => {
    expect(view.getByTestId('resume-result').props.children).toBe('false');
    expect(view.getByTestId('status').props.children).toBe('no-sources');
  });
});

test('keeps active playback across resolver refresh and uses the newest resolver on retry', async () => {
  const firstResolve = jest.fn(async () => [english]);
  const secondResolve = jest.fn(async () => [french]);
  const firstResolver = { resolve: firstResolve };
  const secondResolver = { resolve: secondResolve };

  const view = render(
    <PlaybackProvider resolver={firstResolver}>
      <Probe />
    </PlaybackProvider>,
  );

  fireEvent.press(view.getByTestId('play'));
  await waitFor(() => {
    expect(view.getByTestId('status').props.children).toBe('ready');
    expect(view.getByTestId('selected').props.children).toBe('english');
  });

  view.rerender(
    <PlaybackProvider resolver={secondResolver}>
      <Probe />
    </PlaybackProvider>,
  );

  expect(view.getByTestId('status').props.children).toBe('ready');
  expect(view.getByTestId('selected').props.children).toBe('english');

  fireEvent.press(view.getByTestId('retry'));

  await waitFor(() => {
    expect(secondResolve).toHaveBeenCalledWith(request);
    expect(view.getByTestId('selected').props.children).toBe('french');
  });
  expect(firstResolve).toHaveBeenCalledTimes(1);
});

test('account switch closes active playback instead of carrying the old stream across identities', async () => {
  const resolve = jest.fn(async () => [english]);
  const resolver = { resolve };

  const view = render(
    <PlaybackProvider resolver={resolver}>
      <Probe />
    </PlaybackProvider>,
  );

  fireEvent.press(view.getByTestId('play'));
  await waitFor(() => {
    expect(view.getByTestId('status').props.children).toBe('ready');
    expect(view.getByTestId('selected').props.children).toBe('english');
  });

  mockUserId = 'user-2';
  view.rerender(
    <PlaybackProvider resolver={resolver}>
      <Probe />
    </PlaybackProvider>,
  );

  await waitFor(() => {
    expect(view.getByTestId('status').props.children).toBe('idle');
    expect(view.getByTestId('selected').props.children).toBe('none');
  });
});

test('resolves catalog-native movie and episode requests without external IDs', async () => {
  const resolve = jest.fn(async () => [english]);
  const screen = render(
    <PlaybackProvider resolver={{ resolve }}>
      <Probe />
    </PlaybackProvider>,
  );

  fireEvent.press(screen.getByTestId('play-native-movie'));
  await waitFor(() => expect(resolve).toHaveBeenCalledWith({
    mediaId: nativeMovie.id,
    kind: 'movie',
    externalIds: {},
  }));

  fireEvent.press(screen.getByTestId('play-native-episode'));
  await waitFor(() => expect(resolve).toHaveBeenCalledWith({
    mediaId: nativeEpisode.id,
    kind: 'episode',
    externalIds: {},
    seriesMediaId: nativeSeries.id,
    seasonNumber: 1,
    episodeNumber: 1,
  }));
});

test('resolves an episode with parent series external IDs and real season/episode numbers', async () => {
  const resolve = jest.fn(async () => [english]);
  const screen = render(
    <PlaybackProvider resolver={{ resolve }}>
      <Probe />
    </PlaybackProvider>,
  );

  fireEvent.press(screen.getByTestId('play-episode'));

  await waitFor(() => expect(screen.getByTestId('status').props.children).toBe('ready'));
  expect(resolve).toHaveBeenCalledWith(episodeRequest);
});

test('resolves a season zero special episode', async () => {
  const resolve = jest.fn(async () => [english]);
  const screen = render(
    <PlaybackProvider resolver={{ resolve }}>
      <Probe />
    </PlaybackProvider>,
  );

  fireEvent.press(screen.getByTestId('play-special'));

  await waitFor(() => {
    expect(screen.getByTestId('status').props.children).toBe('ready');
  });
  expect(resolve).toHaveBeenCalledWith({
    mediaId: specialEpisode.id,
    kind: 'episode',
    externalIds: series.externalIds,
    seriesMediaId: series.id,
    seasonNumber: 0,
    episodeNumber: 1,
  });
});

test('does not resolve invalid episode requests', async () => {
  const resolve = jest.fn(async () => [english]);
  const screen = render(
    <PlaybackProvider resolver={{ resolve }}>
      <Probe />
    </PlaybackProvider>,
  );

  fireEvent.press(screen.getByTestId('play-episode-wrong-series'));
  fireEvent.press(screen.getByTestId('play-episode-zero'));
  fireEvent.press(screen.getByTestId('play-episode-movie-parent'));

  await waitFor(() => expect(resolve).not.toHaveBeenCalled());
  expect(screen.getByTestId('status').props.children).toBe('idle');
});

test('retries the current playback request without rebuilding catalog metadata', async () => {
  const resolve = jest.fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([english]);

  const screen = render(
    <PlaybackProvider resolver={{ resolve }}>
      <Probe />
    </PlaybackProvider>,
  );

  fireEvent.press(screen.getByTestId('play'));
  await waitFor(() => expect(screen.getByTestId('status').props.children).toBe('no-sources'));
  expect(resolve).toHaveBeenCalledTimes(1);

  fireEvent.press(screen.getByTestId('retry'));
  await waitFor(() => expect(screen.getByTestId('status').props.children).toBe('ready'));

  expect(resolve).toHaveBeenCalledTimes(2);
  expect(resolve).toHaveBeenLastCalledWith(request);
  expect(screen.getByTestId('selected').props.children).toBe('english');
});


test('resolves preferred subtitles alongside video and can turn them off without restarting', async () => {
  const resolve = jest.fn(async () => [english]);
  const frenchSubtitle: SubtitleTrack = {
    id: 'subs:fr',
    language: 'fr',
    label: 'French',
    url: 'https://subs.example/fr.vtt',
  };
  const englishSubtitle: SubtitleTrack = {
    id: 'subs:en',
    language: 'en',
    label: 'English',
    url: 'https://subs.example/en.vtt',
  };
  const subtitleResolve = jest.fn(async () => [frenchSubtitle, englishSubtitle]);

  const screen = render(
    <PlaybackProvider
      resolver={{ resolve }}
      subtitleResolver={{ resolve: subtitleResolve }}
    >
      <Probe />
    </PlaybackProvider>,
  );

  fireEvent.press(screen.getByTestId('play'));
  await waitFor(() => expect(screen.getByTestId('status').props.children).toBe('ready'));
  await waitFor(() => expect(screen.getByTestId('subtitle').props.children).toBe('subs:fr'));

  expect(subtitleResolve).toHaveBeenCalledWith(request, []);
  expect(resolve).toHaveBeenCalledTimes(1);

  fireEvent.press(screen.getByTestId('subtitle-off'));
  expect(screen.getByTestId('subtitle').props.children).toBe('none');
  expect(resolve).toHaveBeenCalledTimes(1);
});


test('discovers and plays the next real episode in the current season', async () => {
  const resolve = jest.fn(async () => [english]);
  mockGetSeason.mockResolvedValue({
    seriesId: series.id,
    seasonNumber: 1,
    episodes: [episode, episodeTwo],
  });

  const screen = render(
    <PlaybackProvider resolver={{ resolve }}>
      <Probe />
    </PlaybackProvider>,
  );

  fireEvent.press(screen.getByTestId('play-episode'));

  await waitFor(() => {
    expect(screen.getByTestId('next-episode').props.children).toBe(episodeTwo.id);
  });

  fireEvent.press(screen.getByTestId('play-next'));

  await waitFor(() => {
    expect(resolve).toHaveBeenCalledWith({
      mediaId: episodeTwo.id,
      kind: 'episode',
      externalIds: series.externalIds,
      seriesMediaId: series.id,
      seasonNumber: 1,
      episodeNumber: 2,
    });
  });
});

test('reports next-episode failure when the next episode has no sources', async () => {
  let calls = 0;
  const resolve = jest.fn(async () => {
    calls += 1;
    return calls === 1 ? [english] : [];
  });
  mockGetSeason.mockResolvedValue({
    seriesId: series.id,
    seasonNumber: 1,
    episodes: [episode, episodeTwo],
  });

  const view = render(
    <PlaybackProvider resolver={{ resolve }}>
      <Probe />
    </PlaybackProvider>,
  );

  fireEvent.press(view.getByTestId('play-episode'));
  await waitFor(() => {
    expect(view.getByTestId('next-episode').props.children)
      .toBe(episodeTwo.id);
  });

  fireEvent.press(view.getByTestId('play-next-result'));

  await waitFor(() => {
    expect(view.getByTestId('next-result').props.children).toBe('false');
    expect(view.getByTestId('status').props.children).toBe('no-sources');
  });
});

test('finds the next season after a high episode number', async () => {
  const resolve = jest.fn(async () => [english]);
  mockGetSeason.mockImplementation(
    async (_seriesId: string, seasonNumber: number) => {
      if (seasonNumber === 1) {
        return {
          seriesId: series.id,
          seasonNumber: 1,
          episodes: [lateSeasonOneEpisode],
        };
      }
      if (seasonNumber === 2) {
        return {
          seriesId: series.id,
          seasonNumber: 2,
          episodes: [seasonTwoEpisodeOne],
        };
      }
      return null;
    },
  );

  const screen = render(
    <PlaybackProvider resolver={{ resolve }}>
      <Probe />
    </PlaybackProvider>,
  );

  fireEvent.press(screen.getByTestId('play-late-episode'));

  await waitFor(() => {
    expect(screen.getByTestId('next-episode').props.children)
      .toBe(seasonTwoEpisodeOne.id);
  });
  expect(mockGetSeason).toHaveBeenCalledWith(series.id, 2);
});

test('does not skip a missing season when series metadata has a gap', async () => {
  const resolve = jest.fn(async () => [english]);
  const gappedSeries: MediaDetails = {
    ...series,
    seasons: [
      { id: 'season-1', seasonNumber: 1, name: 'Season 1' },
      { id: 'season-3', seasonNumber: 3, name: 'Season 3' },
    ],
  };
  const seasonThreeEpisodeOne: SeriesEpisode = {
    id: 'tmdb:episode:season3-1',
    seriesId: gappedSeries.id,
    seasonNumber: 3,
    episodeNumber: 1,
    title: 'Season Three Premiere',
  };

  mockGetSeason.mockImplementation(
    async (_seriesId: string, seasonNumber: number) => {
      if (seasonNumber === 1) {
        return {
          seriesId: gappedSeries.id,
          seasonNumber: 1,
          episodes: [lateSeasonOneEpisode],
        };
      }
      if (seasonNumber === 3) {
        return {
          seriesId: gappedSeries.id,
          seasonNumber: 3,
          episodes: [seasonThreeEpisodeOne],
        };
      }
      return null;
    },
  );

  function GappedSeasonProbe() {
    const playback = usePlayback();
    return (
      <View>
        <Text testID="gapped-next">
          {playback.nextEpisode?.id ?? 'none'}
        </Text>
        <Pressable
          testID="play-gapped-season"
          onPress={() => {
            void playback.playEpisode(
              gappedSeries,
              lateSeasonOneEpisode,
            );
          }}
        />
      </View>
    );
  }

  const screen = render(
    <PlaybackProvider resolver={{ resolve }}>
      <GappedSeasonProbe />
    </PlaybackProvider>,
  );

  fireEvent.press(screen.getByTestId('play-gapped-season'));

  await waitFor(() => {
    expect(resolve).toHaveBeenCalled();
    expect(screen.getByTestId('gapped-next').props.children).toBe('none');
  });

  expect(mockGetSeason).toHaveBeenCalledWith(gappedSeries.id, 1);
  expect(mockGetSeason).not.toHaveBeenCalledWith(gappedSeries.id, 3);
});

test('continues into the first episode of the next real season', async () => {
  const resolve = jest.fn(async () => [english]);
  mockGetSeason.mockImplementation(async (_seriesId: string, seasonNumber: number) => {
    if (seasonNumber === 1) {
      return {
        seriesId: series.id,
        seasonNumber: 1,
        episodes: [episode],
      };
    }
    if (seasonNumber === 2) {
      return {
        seriesId: series.id,
        seasonNumber: 2,
        episodes: [seasonTwoEpisodeOne],
      };
    }
    return null;
  });

  const screen = render(
    <PlaybackProvider resolver={{ resolve }}>
      <Probe />
    </PlaybackProvider>,
  );

  fireEvent.press(screen.getByTestId('play-episode'));

  await waitFor(() => {
    expect(screen.getByTestId('next-episode').props.children).toBe(seasonTwoEpisodeOne.id);
  });
});


test('resumes synchronized season zero special progress', async () => {
  const resolve = jest.fn(async () => [english]);
  const specialsSeries: MediaDetails = {
    ...series,
    seasons: [
      { id: 'season-0', seasonNumber: 0, name: 'Specials' },
      ...(series.seasons ?? []),
    ],
  };
  mockGetDetails.mockResolvedValue(specialsSeries);
  mockGetSeason.mockResolvedValue({
    seriesId: series.id,
    seasonNumber: 0,
    episodes: [specialEpisode, specialEpisodeTwo],
  });

  const screen = render(
    <PlaybackProvider resolver={{ resolve }}>
      <Probe />
    </PlaybackProvider>,
  );

  fireEvent.press(screen.getByTestId('resume-special'));

  await waitFor(() => {
    expect(screen.getByTestId('status').props.children).toBe('ready');
  });
  expect(mockGetDetails).toHaveBeenCalledWith(series.id);
  await waitFor(() => {
    expect(screen.getByTestId('next-episode').props.children)
      .toBe(specialEpisodeTwo.id);
  });
  expect(resolve).toHaveBeenCalledWith({
    mediaId: specialEpisode.id,
    kind: 'episode',
    externalIds: series.externalIds,
    seriesMediaId: series.id,
    seasonNumber: 0,
    episodeNumber: 1,
  });
});

test('restores next-episode context after resuming synchronized episode progress', async () => {
  const resolve = jest.fn(async () => [english]);
  mockGetDetails.mockResolvedValue(series);
  mockGetSeason.mockResolvedValue({
    seriesId: series.id,
    seasonNumber: 1,
    episodes: [episode, episodeTwo],
  });

  const screen = render(
    <PlaybackProvider resolver={{ resolve }}>
      <Probe />
    </PlaybackProvider>,
  );

  fireEvent.press(screen.getByTestId('resume-episode'));

  await waitFor(() => {
    expect(screen.getByTestId('status').props.children).toBe('ready');
  });
  await waitFor(() => {
    expect(screen.getByTestId('next-episode').props.children).toBe(episodeTwo.id);
  });

  expect(mockGetDetails).toHaveBeenCalledWith(series.id);
});


test('recovers next-episode context after the original series provider is removed', async () => {
  const resolve = jest.fn(async () => [english]);
  const recoveredSeries: MediaDetails = {
    ...series,
    id: 'cinemeta:series:tt0944947',
    providerId: 'cinemeta',
  };
  const recoveredEpisodeTwo: SeriesEpisode = {
    ...episodeTwo,
    id: 'cinemeta:episode:2',
    seriesId: recoveredSeries.id,
  };

  mockGetDetails
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(recoveredSeries);
  mockSearch.mockResolvedValueOnce({
    items: [
      {
        id: series.id,
        kind: 'series',
        title: series.title,
        providerId: 'removed-provider',
        externalIds: series.externalIds,
      },
      {
        id: recoveredSeries.id,
        kind: 'series',
        title: recoveredSeries.title,
        providerId: recoveredSeries.providerId,
        externalIds: recoveredSeries.externalIds,
      },
    ],
  });
  mockGetSeason.mockResolvedValue({
    seriesId: recoveredSeries.id,
    seasonNumber: 1,
    episodes: [
      {
        ...episode,
        id: 'cinemeta:episode:1',
        seriesId: recoveredSeries.id,
      },
      recoveredEpisodeTwo,
    ],
  });

  const view = render(
    <PlaybackProvider resolver={{ resolve }}>
      <Probe />
    </PlaybackProvider>,
  );

  fireEvent.press(view.getByTestId('resume-episode'));

  await waitFor(() => {
    expect(view.getByTestId('status').props.children).toBe('ready');
    expect(view.getByTestId('next-episode').props.children)
      .toBe(recoveredEpisodeTwo.id);
  });

  expect(mockSearch).toHaveBeenCalledWith('Game of Thrones');
  expect(mockGetDetails).toHaveBeenNthCalledWith(
    2,
    recoveredSeries.id,
  );
});

test('tries later matching catalogs when resumed-series recovery hits a stale alternate', async () => {
  const resolve = jest.fn(async () => [english]);
  const recoveredSeries: MediaDetails = {
    ...series,
    id: 'working-provider:series:tt0944947',
    providerId: 'working-provider',
  };
  const recoveredEpisodeTwo: SeriesEpisode = {
    ...episodeTwo,
    id: 'working-provider:episode:2',
    seriesId: recoveredSeries.id,
  };

  mockGetDetails
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(recoveredSeries);
  mockSearch.mockResolvedValueOnce({
    items: [
      {
        id: 'stale-provider:series:tt0944947',
        kind: 'series',
        title: recoveredSeries.title,
        providerId: 'stale-provider',
        externalIds: recoveredSeries.externalIds,
      },
      {
        id: recoveredSeries.id,
        kind: 'series',
        title: recoveredSeries.title,
        providerId: recoveredSeries.providerId,
        externalIds: recoveredSeries.externalIds,
      },
    ],
  });
  mockGetSeason.mockResolvedValue({
    seriesId: recoveredSeries.id,
    seasonNumber: 1,
    episodes: [
      {
        ...episode,
        id: 'working-provider:episode:1',
        seriesId: recoveredSeries.id,
      },
      recoveredEpisodeTwo,
    ],
  });

  const view = render(
    <PlaybackProvider resolver={{ resolve }}>
      <Probe />
    </PlaybackProvider>,
  );

  fireEvent.press(view.getByTestId('resume-episode'));

  await waitFor(() => {
    expect(view.getByTestId('next-episode').props.children)
      .toBe(recoveredEpisodeTwo.id);
  });

  expect(mockGetDetails).toHaveBeenNthCalledWith(
    2,
    'stale-provider:series:tt0944947',
  );
  expect(mockGetDetails).toHaveBeenNthCalledWith(
    3,
    recoveredSeries.id,
  );
});

test('does not skip over a missing episode when loaded season metadata has a gap', async () => {
  const resolve = jest.fn(async () => [english]);
  const countedSeries: MediaDetails = {
    ...series,
    seasons: [
      {
        id: 'season-1',
        seasonNumber: 1,
        name: 'Season 1',
        episodeCount: 2,
      },
      {
        id: 'season-2',
        seasonNumber: 2,
        name: 'Season 2',
        episodeCount: 1,
      },
    ],
  };
  const episodeThree: SeriesEpisode = {
    id: 'tmdb:episode:season1-3',
    seriesId: countedSeries.id,
    seasonNumber: 1,
    episodeNumber: 3,
    title: 'Episode Three',
  };

  mockGetSeason.mockImplementation(
    async (_seriesId: string, seasonNumber: number) => {
      if (seasonNumber === 1) {
        return {
          seriesId: countedSeries.id,
          seasonNumber: 1,
          episodes: [episode, episodeThree],
        };
      }
      if (seasonNumber === 2) {
        return {
          seriesId: countedSeries.id,
          seasonNumber: 2,
          episodes: [seasonTwoEpisodeOne],
        };
      }
      return null;
    },
  );

  const screen = render(
    <PlaybackProvider resolver={{ resolve }}>
      <Probe />
    </PlaybackProvider>,
  );

  fireEvent.press(screen.getByTestId('play-episode'));

  await waitFor(() => {
    expect(resolve).toHaveBeenCalled();
    expect(screen.getByTestId('next-episode').props.children).toBe('none');
  });

  expect(mockGetSeason).toHaveBeenCalledWith(countedSeries.id, 1);
  expect(mockGetSeason).not.toHaveBeenCalledWith(countedSeries.id, 2);
});

test('does not skip into the next season when current season metadata is partial', async () => {
  const resolve = jest.fn(async () => [english]);
  const countedSeries: MediaDetails = {
    ...series,
    seasons: [
      {
        id: 'season-1',
        seasonNumber: 1,
        name: 'Season 1',
        episodeCount: 10,
      },
      {
        id: 'season-2',
        seasonNumber: 2,
        name: 'Season 2',
        episodeCount: 10,
      },
    ],
  };
  const episodeThree: SeriesEpisode = {
    id: 'tmdb:episode:season1-3',
    seriesId: countedSeries.id,
    seasonNumber: 1,
    episodeNumber: 3,
    title: 'Episode Three',
  };

  mockGetSeason.mockImplementation(
    async (_seriesId: string, seasonNumber: number) => {
      if (seasonNumber === 1) {
        return {
          seriesId: countedSeries.id,
          seasonNumber: 1,
          episodes: [
            episode,
            episodeTwo,
            episodeThree,
          ],
        };
      }
      if (seasonNumber === 2) {
        return {
          seriesId: countedSeries.id,
          seasonNumber: 2,
          episodes: [seasonTwoEpisodeOne],
        };
      }
      return null;
    },
  );

  function PartialSeasonProbe() {
    const playback = usePlayback();
    return (
      <View>
        <Text testID="partial-next">
          {playback.nextEpisode?.id ?? 'none'}
        </Text>
        <Pressable
          testID="play-partial-last"
          onPress={() => {
            void playback.playEpisode(
              countedSeries,
              episodeThree,
            );
          }}
        />
      </View>
    );
  }

  const screen = render(
    <PlaybackProvider resolver={{ resolve }}>
      <PartialSeasonProbe />
    </PlaybackProvider>,
  );

  fireEvent.press(screen.getByTestId('play-partial-last'));

  await waitFor(() => {
    expect(resolve).toHaveBeenCalled();
    expect(screen.getByTestId('partial-next').props.children)
      .toBe('none');
  });

  expect(mockGetSeason).toHaveBeenCalledWith(
    countedSeries.id,
    1,
  );
  expect(mockGetSeason).not.toHaveBeenCalledWith(
    countedSeries.id,
    2,
  );
});
