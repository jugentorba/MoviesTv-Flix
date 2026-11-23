import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import type { AddonStateRecord } from '@moviestv/addons';
import type {
  LiveTvChannel,
  LiveTvProviderDescriptor,
} from '@moviestv/live-tv';
import { AddonsContext, type AddonsApi } from '../../addons/useAddons';
import { AccountContext } from '../../auth/useAccount';
import { I18nContext } from '../../i18n/useI18n';
import {
  PreferencesContext,
  type PreferencesApi,
} from '../../preferences/usePreferences';
import { LiveTvScreen } from '../LiveTvScreen';

jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({
    play: jest.fn(),
    replaceAsync: jest.fn(async () => undefined),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  }),
  VideoView: () => null,
}));

interface PlaylistState {
  providers: LiveTvProviderDescriptor[];
  channels: LiveTvChannel[];
  listeners: Set<() => void>;
  truncated: string[];
}

jest.mock('../m3u-playlist-runtime', () => {
  const state: PlaylistState = {
    providers: [],
    channels: [],
    listeners: new Set(),
    truncated: [],
  };
  return {
    __state: state,
    m3uPlaylistStoreFor: () => ({
      subscribe: (listener: () => void) => {
        state.listeners.add(listener);
        return () => { state.listeners.delete(listener); };
      },
    }),
    m3uLiveTvAdapterFor: () => ({
      providers: async () => [...state.providers],
      listChannels: async (provider: LiveTvProviderDescriptor) => (
        state.channels.filter(
          (channel) => channel.providerId === provider.addonId,
        )
      ),
      truncatedProviderIds: () => [...state.truncated],
      resolveChannel: async (
        provider: LiveTvProviderDescriptor,
        channel: LiveTvChannel,
      ) => [{
        id: `${provider.addonId}:${channel.id}`,
        providerId: provider.addonId,
        url: channel.directStreamUrl ?? 'https://stream.example/live.m3u8',
      }],
    }),
  };
});

const playlistRuntime = jest.requireMock('../m3u-playlist-runtime') as {
  __state: PlaylistState;
};

const t = (key: string) => ({
  'nav.liveTv': 'Live TV',
  'liveTv.searchChannels': 'Search channels',
  'liveTv.allCountries': 'All countries',
  'liveTv.refresh': 'Refresh',
  'liveTv.loadingChannels': 'Loading channels…',
  'liveTv.noProvider': 'No Live TV provider is installed',
  'liveTv.noChannels': 'No channels available',
  'liveTv.partialFailure': 'Some providers could not load',
  'liveTv.playlistTruncated': 'Only the first 5000 channels of a playlist are listed',
  'liveTv.allProvidersFailed': 'All providers failed',
  'liveTv.channelUnavailable': 'Channel unavailable',
  'liveTv.retry': 'Retry',
  'liveTv.previousChannel': 'Previous channel',
  'liveTv.nextChannel': 'Next channel',
  'liveTv.favorites': 'Favorites',
  'liveTv.addFavorite': 'Add favorite',
  'liveTv.removeFavorite': 'Remove favorite',
  'liveTv.channels': 'Channels',
  'liveTv.autoProvider': 'Auto',
  'liveTv.activeProvider': 'Active',
  'liveTv.providerFallback': 'Use this provider first and fall back automatically.',
  'playback.changeSource': 'Change source',
  'playback.sources': 'Sources',
  'playback.close': 'Close',
  'playback.selected': 'Selected',
  'common.provider': 'Providers',
  'search.loadMore': 'Load more',
}[key] ?? key);

function addonsApi(installed: AddonStateRecord[]): AddonsApi {
  return {
    installed,
    ready: true,
    syncStatus: 'local',
    error: null,
    refresh: async () => {},
    inspectManifest: async () => { throw new Error('unused'); },
    install: async () => { throw new Error('unused'); },
    configure: async () => { throw new Error('unused'); },
    setEnabled: async () => { throw new Error('unused'); },
    move: async () => [],
    remove: async () => {},
    hasSavedSecret: async () => false,
  };
}

function preferenceApi(): PreferencesApi {
  return {
    preferences: {
      appLocale: 'en',
      preferredAudioLanguages: [],
      preferredSubtitleLanguages: [],
      subtitlesEnabled: true,
      autoplay: true,
      favoriteChannelIds: [],
      myListItems: [],
    },
    ready: true,
    setAppLocale: async () => undefined,
    setPreferredAudioLanguages: async () => undefined,
    setPreferredSubtitleLanguages: async () => undefined,
    setSubtitlesEnabled: async () => undefined,
    setAutoplay: async () => undefined,
    setFavoriteChannelIds: async () => undefined,
    setMyListItems: async () => undefined,
  };
}

function renderScreen() {
  return render(
    <AccountContext.Provider value={{
      backendAvailable: false,
      userId: null,
      loading: false,
      signIn: async () => undefined,
      signUp: async () => undefined,
      signOut: async () => undefined,
    }}>
      <PreferencesContext.Provider value={preferenceApi()}>
        <I18nContext.Provider value={{
          locale: 'en',
          direction: 'ltr',
          t,
          formatNumber: String,
          formatDate: String,
          languageName: String,
        }}>
          <AddonsContext.Provider value={addonsApi([])}>
            <LiveTvScreen mode="phone" onOpenProviders={jest.fn()} />
          </AddonsContext.Provider>
        </I18nContext.Provider>
      </PreferencesContext.Provider>
    </AccountContext.Provider>,
  );
}

function playlistProvider(id: string, name: string): LiveTvProviderDescriptor {
  return {
    addonId: `m3u:${id}`,
    name,
    manifestUrl: '',
    priority: 10,
    liveTv: { catalogs: [], streamTypes: ['channel'] },
    kind: 'playlist',
  };
}

function playlistChannel(
  provider: LiveTvProviderDescriptor,
  id: string,
  title: string,
): LiveTvChannel {
  return {
    id,
    providerId: provider.addonId,
    remoteId: id,
    resourceType: 'channel',
    title,
    directStreamUrl: 'http://iptv.example:8080/live/user/pass/12.ts',
  };
}

function resetPlaylistState() {
  playlistRuntime.__state.providers = [];
  playlistRuntime.__state.channels = [];
  playlistRuntime.__state.listeners.clear();
  playlistRuntime.__state.truncated = [];
}

beforeEach(resetPlaylistState);

test('lists channels from an imported playlist without an add-on', async () => {
  const provider = playlistProvider('one', 'My Playlist');
  playlistRuntime.__state.providers = [provider];
  playlistRuntime.__state.channels = [
    playlistChannel(provider, 'm3u:news.fr', 'France Info'),
  ];

  renderScreen();

  // The playlist is read through an async secure-store adapter; polling for it
  // is load-sensitive, so allow more than the 1 s default rather than flake.
  await waitFor(() => {
    expect(screen.getByTestId('live-tv-channel-m3u:news.fr')).toBeTruthy();
  }, { timeout: 5_000 });
  expect(screen.queryByText('No Live TV provider is installed')).toBeNull();
});

test('picks up a playlist added while Live TV is open', async () => {
  renderScreen();
  await waitFor(() => {
    expect(screen.getByText('No Live TV provider is installed')).toBeTruthy();
  });

  const provider = playlistProvider('two', 'Second Playlist');
  await act(async () => {
    playlistRuntime.__state.providers = [provider];
    playlistRuntime.__state.channels = [
      playlistChannel(provider, 'm3u:sport.fr', 'Sport One'),
    ];
    for (const listener of [...playlistRuntime.__state.listeners]) listener();
  });

  await waitFor(() => {
    expect(screen.getByTestId('live-tv-channel-m3u:sport.fr')).toBeTruthy();
  });
});

test('drops playlist channels when the playlist is removed', async () => {
  const provider = playlistProvider('three', 'Temp Playlist');
  playlistRuntime.__state.providers = [provider];
  playlistRuntime.__state.channels = [
    playlistChannel(provider, 'm3u:temp.fr', 'Temporary'),
  ];

  renderScreen();
  await waitFor(() => {
    expect(screen.getByTestId('live-tv-channel-m3u:temp.fr')).toBeTruthy();
  });

  await act(async () => {
    playlistRuntime.__state.providers = [];
    playlistRuntime.__state.channels = [];
    for (const listener of [...playlistRuntime.__state.listeners]) listener();
  });

  await waitFor(() => {
    expect(screen.getByText('No Live TV provider is installed')).toBeTruthy();
  });
});

test('warns when a playlist was cut at the channel cap', async () => {
  const provider = playlistProvider('big', 'Big Playlist');
  playlistRuntime.__state.providers = [provider];
  playlistRuntime.__state.channels = [
    playlistChannel(provider, 'm3u:big.fr', 'Big Channel'),
  ];
  playlistRuntime.__state.truncated = [provider.addonId];

  renderScreen();

  await waitFor(() => {
    expect(screen.getByTestId('live-tv-channel-m3u:big.fr')).toBeTruthy();
  });
  expect(screen.getByTestId('live-tv-truncated-warning')).toBeTruthy();
  expect(screen.getByText('Only the first 5000 channels of a playlist are listed'))
    .toBeTruthy();
});

test('shows no truncation warning for a playlist that fits', async () => {
  const provider = playlistProvider('small', 'Small Playlist');
  playlistRuntime.__state.providers = [provider];
  playlistRuntime.__state.channels = [
    playlistChannel(provider, 'm3u:small.fr', 'Small Channel'),
  ];

  renderScreen();

  await waitFor(() => {
    expect(screen.getByTestId('live-tv-channel-m3u:small.fr')).toBeTruthy();
  });
  expect(screen.queryByTestId('live-tv-truncated-warning')).toBeNull();
});
