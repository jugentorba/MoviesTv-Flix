import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { BackHandler, Modal } from 'react-native';
import type { AddonStateRecord } from '@moviestv/addons';
import { AddonsContext, type AddonsApi } from '../../addons/useAddons';
import { AccountContext } from '../../auth/useAccount';
import { I18nContext } from '../../i18n/useI18n';
import { PreferencesContext, type PreferencesApi } from '../../preferences/usePreferences';
import { LiveTvScreen } from '../LiveTvScreen';
import { LiveTvChannelService } from '../LiveTvChannelService';
import {
  liveTvGuideStorageKeysForUser,
} from '../LiveTvGuideRepository';
import { notifyLiveTvGuideChanged } from '../live-tv-guide-runtime';

jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({
    play: jest.fn(),
    replaceAsync: jest.fn(async () => undefined),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  }),
  VideoView: () => null,
}));

const t = (key: string) => ({
  'nav.liveTv': 'Live TV',
  'liveTv.searchChannels': 'Search channels',
  'liveTv.allCountries': 'All countries',
  'liveTv.refresh': 'Refresh',
  'liveTv.loadingChannels': 'Loading channels…',
  'liveTv.noProvider': 'No Live TV provider is installed',
  'liveTv.noChannels': 'No channels available',
  'liveTv.partialFailure': 'Some providers could not load',
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

function api(installed: AddonStateRecord[]): AddonsApi {
  return {
    installed, ready: true, syncStatus: 'local', error: null,
    refresh: async () => {}, inspectManifest: async () => { throw new Error('unused'); },
    install: async () => { throw new Error('unused'); }, configure: async () => { throw new Error('unused'); },
    setEnabled: async () => { throw new Error('unused'); }, move: async () => [], remove: async () => {},
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

function screenElement(
  installed: AddonStateRecord[],
  onOpenProviders = jest.fn(),
  mode: 'phone' | 'tv' = 'phone',
  preferences = preferenceApi(),
  userId: string | null = null,
) {
  return (
    <AccountContext.Provider value={{
        backendAvailable: false,
        userId,
        loading: false,
        signIn: async () => undefined,
        signUp: async () => undefined,
        signOut: async () => undefined,
      }}>
      <PreferencesContext.Provider value={preferences}>
      <I18nContext.Provider value={{ locale: 'en', direction: 'ltr', t, formatNumber: String, formatDate: String, languageName: String }}>
        <AddonsContext.Provider value={api(installed)}>
          <LiveTvScreen mode={mode} onOpenProviders={onOpenProviders} />
        </AddonsContext.Provider>
      </I18nContext.Provider>
      </PreferencesContext.Provider>
    </AccountContext.Provider>
  );
}

function renderScreen(
  installed: AddonStateRecord[],
  onOpenProviders = jest.fn(),
  mode: 'phone' | 'tv' = 'phone',
  preferences = preferenceApi(),
  userId: string | null = null,
) {
  return render(screenElement(
    installed,
    onOpenProviders,
    mode,
    preferences,
    userId,
  ));
}

function tvRecord(): AddonStateRecord {
  return {
    installed: { addonId: 'provider-a', manifestUrl: 'https://provider.example/manifest.json', sourceType: 'stremio-manifest', enabled: true, priority: 100, installedAt: '2026-09-18T00:00:00Z', updatedAt: '2026-09-18T00:00:00Z', setupIncomplete: false },
    safeConfig: {},
    descriptor: { id: 'provider-a', name: 'Provider A', version: '1.0.0', sourceType: 'stremio-manifest', manifestUrl: 'https://provider.example/manifest.json', capabilities: ['live-tv'], requiresConfiguration: false, configurationFields: [], supportedMediaKinds: [], liveTv: { catalogs: [{ type: 'channel', id: 'all', name: 'All' }], streamTypes: ['channel'] } },
  };
}

test('shows provider setup action without eligible providers', () => {
  const open = jest.fn();
  renderScreen([], open);
  expect(screen.getByText('No Live TV provider is installed')).toBeTruthy();
  fireEvent.press(screen.getByTestId('open-live-tv-providers'));
  expect(open).toHaveBeenCalledTimes(1);
});

test('unexpected channel loading failure exits the spinner safely', async () => {
  const loadSpy = jest.spyOn(
    LiveTvChannelService.prototype,
    'load',
  ).mockRejectedValueOnce(
    new Error('unexpected channel service failure'),
  );

  renderScreen([tvRecord()]);

  await waitFor(() => {
    expect(screen.getByText('All providers failed')).toBeTruthy();
  });
  expect(screen.queryByText('Loading channels…')).toBeNull();
  expect(screen.getByText('No channels available')).toBeTruthy();

  loadSpy.mockRestore();
});

test('unexpected refresh failure preserves the last known channel list', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async () => {
      const body = JSON.stringify({
        metas: [{
          type: 'channel',
          id: 'stable',
          name: 'STABLE CHANNEL',
        }],
      });
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  renderScreen([tvRecord()]);
  await screen.findByText('STABLE CHANNEL');

  const loadSpy = jest.spyOn(
    LiveTvChannelService.prototype,
    'load',
  ).mockRejectedValueOnce(
    new Error('unexpected refresh failure'),
  );
  fireEvent.press(screen.getByTestId('live-tv-refresh'));

  await waitFor(() => {
    expect(screen.getByText('All providers failed')).toBeTruthy();
  });
  expect(screen.getByText('STABLE CHANNEL')).toBeTruthy();

  loadSpy.mockRestore();
  fetchMock.mockRestore();
});

test('loads channels without auto-playing and filters locally', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
    const payload = String(url).includes('/catalog/')
      ? { metas: [
        { type: 'channel', id: 'rtk1', name: 'RTK 1', countryCode: 'XK' },
        { type: 'channel', id: 'france2', name: 'France 2', countryCode: 'FR' },
      ] }
      : { streams: [{ id: 'main', url: 'https://stream.example/live.m3u8' }] };
    const body = JSON.stringify(payload);
    return { ok: true, status: 200, headers: { get: () => String(body.length) }, text: async () => body } as any;
  });
  renderScreen([tvRecord()]);
  expect(screen.getByText('Loading channels…')).toBeTruthy();
  await waitFor(() => expect(screen.getByTestId('live-tv-channel-provider-a:channel:rtk1')).toBeTruthy());
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/stream/'))).toBe(false);
  fireEvent.changeText(screen.getByTestId('live-tv-search'), 'france');
  expect(screen.queryByText('RTK 1')).toBeNull();
  expect(screen.getByText('France 2')).toBeTruthy();
  fetchMock.mockRestore();
});

test('bounds large Live TV catalogs and reveals more channels incrementally', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async () => {
      const metas = Array.from({ length: 255 }, (_, index) => ({
        type: 'channel',
        id: `channel-${String(index).padStart(3, '0')}`,
        name: `Channel ${String(index).padStart(3, '0')}`,
        countryCode: 'AL',
      }));
      const body = JSON.stringify({ metas });
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  renderScreen([tvRecord()]);

  await screen.findByTestId(
    'live-tv-channel-provider-a:channel:channel-249',
  );
  expect(
    screen.queryByTestId(
      'live-tv-channel-provider-a:channel:channel-250',
    ),
  ).toBeNull();

  fireEvent.press(screen.getByText('Load more'));

  await screen.findByTestId(
    'live-tv-channel-provider-a:channel:channel-254',
  );

  fetchMock.mockRestore();
});

test('keeps the newest channel refresh visible when an older load finishes last', async () => {
  let resolveFirst!: (response: any) => void;
  let resolveSecond!: (response: any) => void;
  const first = new Promise<any>((resolve) => { resolveFirst = resolve; });
  const second = new Promise<any>((resolve) => { resolveSecond = resolve; });
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementationOnce(async () => first)
    .mockImplementationOnce(async () => second);
  const responseFor = (id: string, name: string) => {
    const body = JSON.stringify({
      metas: [{ type: 'channel', id, name }],
    });
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    } as any;
  };

  renderScreen([tvRecord()]);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByTestId('live-tv-refresh'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

  resolveSecond(responseFor('new', 'NEW CHANNEL'));
  await screen.findByText('NEW CHANNEL');

  resolveFirst(responseFor('old', 'OLD CHANNEL'));
  await act(async () => { await first; });

  expect(screen.getByText('NEW CHANNEL')).toBeTruthy();
  expect(screen.queryByText('OLD CHANNEL')).toBeNull();

  fetchMock.mockRestore();
});

test('phone opens the selected channel in the full-screen IPTV player', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
    const payload = String(url).includes('/catalog/')
      ? { metas: [{ type: 'channel', id: 'top', name: 'TOP CHANNEL' }] }
      : { streams: [{ id: 'main', url: 'https://stream.example/live.m3u8' }] };
    const body = JSON.stringify(payload);
    return { ok: true, status: 200, headers: { get: () => String(body.length) }, text: async () => body } as any;
  });

  renderScreen([tvRecord()]);
  const row = await screen.findByTestId('live-tv-channel-provider-a:channel:top');
  fireEvent.press(row);

  expect(screen.getByTestId('live-tv-phone-player-modal')).toBeTruthy();
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/stream/channel/top.json'))).toBe(true));
  expect(screen.getByTestId('live-tv-player-back')).toBeTruthy();

  fetchMock.mockRestore();
});

test('TV controls are focusable and selecting a channel resolves playback', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
    const payload = String(url).includes('/catalog/')
      ? { metas: [
        { type: 'channel', id: 'alpha', name: 'Alpha', countryCode: 'XK' },
        { type: 'channel', id: 'rtk1', name: 'RTK 1', countryCode: 'XK' },
        { type: 'channel', id: 'zulu', name: 'Zulu', countryCode: 'XK' },
      ] }
      : { streams: [{ id: 'main', url: 'https://stream.example/live.m3u8' }] };
    const body = JSON.stringify(payload);
    return { ok: true, status: 200, headers: { get: () => String(body.length) }, text: async () => body } as any;
  });
  renderScreen([tvRecord()], jest.fn(), 'tv');
  expect(screen.getByTestId('live-tv-tv-channel-list-scroll')).toBeTruthy();
  const row = await screen.findByTestId('live-tv-channel-provider-a:channel:rtk1');
  expect(row.props.focusable).toBe(true);
  fireEvent.press(row);
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/stream/channel/rtk1.json'))).toBe(true));
  expect(screen.getByTestId('live-tv-tv-player-modal')).toBeTruthy();
  expect(screen.getByTestId('live-tv-previous').props.focusable).toBe(true);
  expect(screen.getByTestId('live-tv-next').props.focusable).toBe(true);
  fetchMock.mockRestore();
});


test('stops playback when refresh removes the active channel', async () => {
  let catalogRequests = 0;
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      const requestUrl = String(url);
      const payload = requestUrl.includes('/catalog/')
        ? {
          metas: catalogRequests++ === 0
            ? [{
              type: 'channel',
              id: 'top',
              name: 'TOP CHANNEL',
              countryCode: 'AL',
            }]
            : [{
              type: 'channel',
              id: 'other',
              name: 'OTHER CHANNEL',
              countryCode: 'AL',
            }],
        }
        : {
          streams: [{
            id: 'main',
            url: 'https://stream.example/live.m3u8',
          }],
        };
      const body = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  renderScreen([tvRecord()]);

  fireEvent.press(
    await screen.findByTestId(
      'live-tv-channel-provider-a:channel:top',
    ),
  );
  await waitFor(() => {
    expect(screen.getByTestId('live-tv-phone-player-modal')).toBeTruthy();
  });

  fireEvent.press(screen.getByTestId('live-tv-refresh'));

  await screen.findByTestId(
    'live-tv-channel-provider-a:channel:other',
  );
  await waitFor(() => {
    expect(
      screen.queryByTestId('live-tv-phone-player-modal'),
    ).toBeNull();
  });

  fetchMock.mockRestore();
});


test('removing the last provider does not resume the old stream when it returns', async () => {
  let streamRequests = 0;
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      const requestUrl = String(url);
      const payload = requestUrl.includes('/catalog/')
        ? {
          metas: [{
            type: 'channel',
            id: 'top',
            name: 'TOP CHANNEL',
            countryCode: 'AL',
          }],
        }
        : {
          streams: [{
            id: 'main',
            url: 'https://stream.example/live.m3u8',
          }],
        };
      if (requestUrl.includes('/stream/')) streamRequests += 1;
      const body = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  const preferences = preferenceApi();
  const openProviders = jest.fn();
  const provider = tvRecord();
  const view = renderScreen(
    [provider],
    openProviders,
    'phone',
    preferences,
  );

  fireEvent.press(
    await screen.findByTestId(
      'live-tv-channel-provider-a:channel:top',
    ),
  );
  await waitFor(() => {
    expect(screen.getByTestId('live-tv-phone-player-modal')).toBeTruthy();
  });
  expect(streamRequests).toBe(1);

  view.rerender(screenElement(
    [],
    openProviders,
    'phone',
    preferences,
  ));
  await screen.findByText('No Live TV provider is installed');

  view.rerender(screenElement(
    [provider],
    openProviders,
    'phone',
    preferences,
  ));
  await screen.findByTestId(
    'live-tv-channel-provider-a:channel:top',
  );

  expect(
    screen.queryByTestId('live-tv-phone-player-modal'),
  ).toBeNull();
  expect(streamRequests).toBe(1);

  fetchMock.mockRestore();
});


test('audio preference refresh keeps the active Live TV controller usable for zapping', async () => {
  const installed = [tvRecord()];
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      const requestUrl = String(url);
      const payload = requestUrl.includes('/catalog/')
        ? {
          metas: [
            {
              type: 'channel',
              id: 'alpha',
              name: 'Alpha',
              countryCode: 'AL',
            },
            {
              type: 'channel',
              id: 'beta',
              name: 'Beta',
              countryCode: 'AL',
            },
          ],
        }
        : {
          streams: [{
            id: 'main',
            url: `https://stream.example/${requestUrl.includes('/beta.json') ? 'beta' : 'alpha'}.m3u8`,
          }],
        };
      const body = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  const initialPreferences = preferenceApi();
  initialPreferences.preferences.preferredAudioLanguages = ['fr'];
  const view = renderScreen(
    installed,
    jest.fn(),
    'phone',
    initialPreferences,
  );

  fireEvent.press(
    await screen.findByTestId(
      'live-tv-channel-provider-a:channel:alpha',
    ),
  );
  await waitFor(() => {
    expect(screen.getByTestId('live-tv-phone-player-modal')).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([url]) => (
        String(url).includes('/stream/channel/alpha.json')
      )),
    ).toBe(true);
  });

  const updatedPreferences = preferenceApi();
  updatedPreferences.preferences.preferredAudioLanguages = ['de', 'en'];
  view.rerender(screenElement(
    installed,
    jest.fn(),
    'phone',
    updatedPreferences,
  ));

  expect(screen.getByTestId('live-tv-phone-player-modal')).toBeTruthy();
  fireEvent.press(screen.getByTestId('live-tv-next'));

  await waitFor(() => {
    expect(
      fetchMock.mock.calls.some(([url]) => (
        String(url).includes('/stream/channel/beta.json')
      )),
    ).toBe(true);
  });

  fetchMock.mockRestore();
});


test('account switch closes active Live TV playback immediately', async () => {
  const installed = [tvRecord()];
  const preferences = preferenceApi();
  const openProviders = jest.fn();
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      const payload = String(url).includes('/catalog/')
        ? {
          metas: [{
            type: 'channel',
            id: 'top',
            name: 'TOP CHANNEL',
            countryCode: 'AL',
          }],
        }
        : {
          streams: [{
            id: 'main',
            url: 'https://stream.example/live.m3u8',
          }],
        };
      const body = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  const view = renderScreen(
    installed,
    openProviders,
    'phone',
    preferences,
    'account-a',
  );

  fireEvent.press(
    await screen.findByTestId(
      'live-tv-channel-provider-a:channel:top',
    ),
  );
  await waitFor(() => {
    expect(screen.getByTestId('live-tv-phone-player-modal')).toBeTruthy();
  });

  view.rerender(screenElement(
    installed,
    openProviders,
    'phone',
    preferences,
    'account-b',
  ));

  await waitFor(() => {
    expect(
      screen.queryByTestId('live-tv-phone-player-modal'),
    ).toBeNull();
  });

  fetchMock.mockRestore();
});


test('late channel load from a previous account cannot replace the current account list', async () => {
  let resolveAccountA!: (value: any) => void;
  let resolveAccountB!: (value: any) => void;
  const accountAResponse = new Promise<any>((resolve) => {
    resolveAccountA = resolve;
  });
  const accountBResponse = new Promise<any>((resolve) => {
    resolveAccountB = resolve;
  });

  const providerA = tvRecord();
  const providerB = tvRecord();
  providerB.installed = {
    ...providerB.installed,
    manifestUrl: 'https://account-b.example/manifest.json',
  };
  providerB.descriptor = {
    ...providerB.descriptor!,
    manifestUrl: 'https://account-b.example/manifest.json',
  };

  const response = (id: string, name: string) => {
    const body = JSON.stringify({
      metas: [{
        type: 'channel',
        id,
        name,
        countryCode: 'FR',
      }],
    });
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    } as any;
  };

  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => (
      String(url).includes('account-b.example')
        ? accountBResponse
        : accountAResponse
    ));

  const preferences = preferenceApi();
  const openProviders = jest.fn();
  const view = renderScreen(
    [providerA],
    openProviders,
    'phone',
    preferences,
    'account-a',
  );

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

  view.rerender(screenElement(
    [providerB],
    openProviders,
    'phone',
    preferences,
    'account-b',
  ));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

  resolveAccountB(response('b', 'ACCOUNT B CHANNEL'));
  await screen.findByText('ACCOUNT B CHANNEL');

  resolveAccountA(response('a', 'ACCOUNT A CHANNEL'));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.getByText('ACCOUNT B CHANNEL')).toBeTruthy();
  expect(screen.queryByText('ACCOUNT A CHANNEL')).toBeNull();

  fetchMock.mockRestore();
});


test('channel favorite writes the synced favorite-channel preference', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(async () => {
    const body = JSON.stringify({
      metas: [{ type: 'channel', id: 'top', name: 'TOP CHANNEL', countryCode: 'AL' }],
    });
    return { ok: true, status: 200, headers: { get: () => String(body.length) }, text: async () => body } as any;
  });
  const preferences = preferenceApi();
  preferences.setFavoriteChannelIds = jest.fn(async () => undefined);

  renderScreen([tvRecord()], jest.fn(), 'phone', preferences);
  const favorite = await screen.findByTestId('live-tv-favorite-provider-a:channel:top');
  fireEvent.press(favorite, { stopPropagation: jest.fn() });

  expect(preferences.setFavoriteChannelIds).toHaveBeenCalledWith([
    'live-tv-favorite:AL:top%20channel',
  ]);
  fetchMock.mockRestore();
});



test('rapid favorite taps preserve both channel changes before preferences rerender', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async () => {
      const body = JSON.stringify({
        metas: [
          {
            type: 'channel',
            id: 'top',
            name: 'TOP CHANNEL',
            countryCode: 'AL',
          },
          {
            type: 'channel',
            id: 'france2',
            name: 'France 2',
            countryCode: 'FR',
          },
        ],
      });
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });
  const preferences = preferenceApi();
  preferences.setFavoriteChannelIds = jest.fn(async () => undefined);

  renderScreen([tvRecord()], jest.fn(), 'phone', preferences);

  const topFavorite = await screen.findByTestId(
    'live-tv-favorite-provider-a:channel:top',
  );
  const franceFavorite = await screen.findByTestId(
    'live-tv-favorite-provider-a:channel:france2',
  );

  fireEvent.press(topFavorite, { stopPropagation: jest.fn() });
  fireEvent.press(franceFavorite, { stopPropagation: jest.fn() });

  expect(preferences.setFavoriteChannelIds).toHaveBeenNthCalledWith(1, [
    'live-tv-favorite:AL:top%20channel',
  ]);
  expect(preferences.setFavoriteChannelIds).toHaveBeenNthCalledWith(2, [
    'live-tv-favorite:AL:top%20channel',
    'live-tv-favorite:FR:france%202',
  ]);

  fetchMock.mockRestore();
});


test('phone player favorite writes the stable synced channel key', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      const payload = String(url).includes('/catalog/')
        ? {
          metas: [{
            type: 'channel',
            id: 'top',
            name: 'TOP CHANNEL',
            countryCode: 'AL',
          }],
        }
        : {
          streams: [{
            id: 'main',
            url: 'https://stream.example/live.m3u8',
          }],
        };
      const body = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  const preferences = preferenceApi();
  preferences.setFavoriteChannelIds = jest.fn(async () => undefined);

  renderScreen(
    [tvRecord()],
    jest.fn(),
    'phone',
    preferences,
  );

  fireEvent.press(
    await screen.findByTestId(
      'live-tv-channel-provider-a:channel:top',
    ),
  );
  await waitFor(() => {
    expect(screen.getByTestId('live-tv-phone-player-modal')).toBeTruthy();
  });

  fireEvent.press(
    screen.getByTestId('live-tv-player-favorite'),
    { stopPropagation: jest.fn() },
  );

  expect(preferences.setFavoriteChannelIds).toHaveBeenCalledWith([
    'live-tv-favorite:AL:top%20channel',
  ]);

  fetchMock.mockRestore();
});

test('phone zapping keeps its playback queue when drawer filters hide the current channel', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      const requestUrl = String(url);
      const payload = requestUrl.includes('/catalog/')
        ? {
          metas: [
            {
              type: 'channel',
              id: 'alpha',
              name: 'Alpha',
              countryCode: 'AL',
            },
            {
              type: 'channel',
              id: 'rtk1',
              name: 'RTK 1',
              countryCode: 'XK',
            },
            {
              type: 'channel',
              id: 'zulu',
              name: 'Zulu',
              countryCode: 'FR',
            },
          ],
        }
        : {
          streams: [{
            id: 'main',
            url: 'https://stream.example/live.m3u8',
          }],
        };
      const body = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  renderScreen([tvRecord()]);

  fireEvent.press(
    await screen.findByTestId(
      'live-tv-channel-provider-a:channel:rtk1',
    ),
  );
  await waitFor(() => {
    expect(screen.getByTestId('live-tv-phone-player-modal')).toBeTruthy();
  });

  fireEvent.press(screen.getByTestId('live-tv-player-channels'));
  const drawer = screen.getByTestId('live-tv-player-channel-drawer');
  fireEvent.press(within(drawer).getByTestId('live-tv-country-FR'));
  fireEvent.press(
    screen.getByTestId('live-tv-player-channel-drawer-close'),
  );

  expect(screen.getByTestId('live-tv-next').props.disabled).not.toBe(true);

  fireEvent.press(screen.getByTestId('live-tv-next'));

  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([url]) => (
      String(url).includes('/stream/channel/zulu.json')
    ))).toBe(true);
  });

  fetchMock.mockRestore();
});

test('selecting a filtered drawer channel keeps the original zap queue', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      const requestUrl = String(url);
      const payload = requestUrl.includes('/catalog/')
        ? {
          metas: [
            {
              type: 'channel',
              id: 'alpha',
              name: 'Alpha',
              countryCode: 'AL',
            },
            {
              type: 'channel',
              id: 'rtk1',
              name: 'RTK 1',
              countryCode: 'XK',
            },
            {
              type: 'channel',
              id: 'zulu',
              name: 'Zulu',
              countryCode: 'FR',
            },
          ],
        }
        : {
          streams: [{
            id: 'main',
            url: 'https://stream.example/live.m3u8',
          }],
        };
      const body = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  renderScreen([tvRecord()]);

  fireEvent.press(
    await screen.findByTestId(
      'live-tv-channel-provider-a:channel:rtk1',
    ),
  );
  await waitFor(() => {
    expect(screen.getByTestId('live-tv-phone-player-modal')).toBeTruthy();
  });

  fireEvent.press(screen.getByTestId('live-tv-player-channels'));
  const drawer = screen.getByTestId('live-tv-player-channel-drawer');
  fireEvent.press(within(drawer).getByTestId('live-tv-country-FR'));
  fireEvent.press(
    within(drawer).getByTestId('live-tv-channel-provider-a:channel:zulu'),
  );

  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([url]) => (
      String(url).includes('/stream/channel/zulu.json')
    ))).toBe(true);
  });

  expect(screen.getByTestId('live-tv-next').props.disabled).not.toBe(true);
  fireEvent.press(screen.getByTestId('live-tv-next'));

  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([url]) => (
      String(url).includes('/stream/channel/alpha.json')
    ))).toBe(true);
  });

  fetchMock.mockRestore();
});

test('selecting outside the current zap snapshot rebases to the visible drawer list', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      const requestUrl = String(url);
      const payload = requestUrl.includes('/catalog/')
        ? {
          metas: [
            {
              type: 'channel',
              id: 'alpha',
              name: 'Alpha',
              countryCode: 'AL',
            },
            {
              type: 'channel',
              id: 'rtk1',
              name: 'RTK 1',
              countryCode: 'XK',
            },
            {
              type: 'channel',
              id: 'zulu',
              name: 'Zulu',
              countryCode: 'FR',
            },
          ],
        }
        : {
          streams: [{
            id: 'main',
            url: 'https://stream.example/live.m3u8',
          }],
        };
      const body = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  renderScreen([tvRecord()]);

  await screen.findByTestId('live-tv-channel-provider-a:channel:zulu');
  fireEvent.press(screen.getByTestId('live-tv-country-FR'));
  fireEvent.press(
    screen.getByTestId('live-tv-channel-provider-a:channel:zulu'),
  );

  await waitFor(() => {
    expect(screen.getByTestId('live-tv-phone-player-modal')).toBeTruthy();
  });

  fireEvent.press(screen.getByTestId('live-tv-player-channels'));
  const drawer = screen.getByTestId('live-tv-player-channel-drawer');
  fireEvent.press(within(drawer).getByTestId('live-tv-country-all'));
  fireEvent.press(
    within(drawer).getByTestId('live-tv-channel-provider-a:channel:rtk1'),
  );

  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([url]) => (
      String(url).includes('/stream/channel/rtk1.json')
    ))).toBe(true);
  });

  expect(screen.getByTestId('live-tv-next').props.disabled).not.toBe(true);
  fireEvent.press(screen.getByTestId('live-tv-next'));

  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([url]) => (
      String(url).includes('/stream/channel/zulu.json')
    ))).toBe(true);
  });

  fetchMock.mockRestore();
});

test('phone player opens the channel drawer without leaving playback', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
    const payload = String(url).includes('/catalog/')
      ? { metas: [
        { type: 'channel', id: 'top', name: 'TOP CHANNEL', countryCode: 'AL' },
        { type: 'channel', id: 'france2', name: 'France 2', countryCode: 'FR' },
      ] }
      : { streams: [{ id: 'main', url: 'https://stream.example/live.m3u8' }] };
    const body = JSON.stringify(payload);
    return { ok: true, status: 200, headers: { get: () => String(body.length) }, text: async () => body } as any;
  });

  renderScreen([tvRecord()]);
  fireEvent.press(await screen.findByTestId('live-tv-channel-provider-a:channel:top'));
  await waitFor(() => expect(screen.getByTestId('live-tv-phone-player-modal')).toBeTruthy());

  fireEvent.press(screen.getByTestId('live-tv-player-channels'));
  const drawer = screen.getByTestId('live-tv-player-channel-drawer');
  expect(within(drawer).getByTestId('live-tv-country-AL')).toBeTruthy();
  expect(within(drawer).getByTestId('live-tv-country-FR')).toBeTruthy();

  fetchMock.mockRestore();
});


test('tapping the phone video opens the channel drawer like an IPTV player', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
    const payload = String(url).includes('/catalog/')
      ? { metas: [
        { type: 'channel', id: 'top', name: 'TOP CHANNEL', countryCode: 'AL' },
        { type: 'channel', id: 'france2', name: 'France 2', countryCode: 'FR' },
      ] }
      : { streams: [{ id: 'main', url: 'https://stream.example/live.m3u8' }] };
    const body = JSON.stringify(payload);
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    } as any;
  });

  renderScreen([tvRecord()]);
  fireEvent.press(await screen.findByTestId('live-tv-channel-provider-a:channel:top'));
  await waitFor(() => expect(screen.getByTestId('live-tv-phone-player-modal')).toBeTruthy());

  fireEvent.press(screen.getByTestId('live-tv-player-tap-surface'));
  const drawer = screen.getByTestId('live-tv-player-channel-drawer');
  expect(
    within(drawer).getByTestId('live-tv-channel-provider-a:channel:top'),
  ).toBeTruthy();
  expect(
    within(drawer).getByTestId('live-tv-channel-provider-a:channel:france2'),
  ).toBeTruthy();

  fetchMock.mockRestore();
});


test('Favorites clears an active country filter and shows favorites across countries', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(async () => {
    const body = JSON.stringify({
      metas: [
        { type: 'channel', id: 'top', name: 'TOP CHANNEL', countryCode: 'AL' },
        { type: 'channel', id: 'france2', name: 'France 2', countryCode: 'FR' },
      ],
    });
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    } as any;
  });

  const preferences = preferenceApi();
  preferences.preferences.favoriteChannelIds = ['provider-a:channel:top'];

  renderScreen([tvRecord()], jest.fn(), 'phone', preferences);
  await screen.findByTestId('live-tv-channel-provider-a:channel:top');

  fireEvent.press(screen.getByTestId('live-tv-country-FR'));
  expect(screen.getByText('France 2')).toBeTruthy();
  expect(screen.queryByText('TOP CHANNEL')).toBeNull();

  fireEvent.press(screen.getByTestId('live-tv-favorites-filter'));
  expect(screen.getByText('TOP CHANNEL')).toBeTruthy();
  expect(screen.queryByText('France 2')).toBeNull();

  fetchMock.mockRestore();
});


test('closing the phone player clears the active Live TV channel state', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
    const payload = String(url).includes('/catalog/')
      ? { metas: [{ type: 'channel', id: 'top', name: 'TOP CHANNEL', countryCode: 'AL' }] }
      : { streams: [{ id: 'main', url: 'https://stream.example/live.m3u8' }] };
    const body = JSON.stringify(payload);
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    } as any;
  });

  renderScreen([tvRecord()]);
  const row = await screen.findByTestId('live-tv-channel-provider-a:channel:top');
  fireEvent.press(row);
  await waitFor(() => expect(screen.getByTestId('live-tv-phone-player-modal')).toBeTruthy());

  fireEvent.press(screen.getByTestId('live-tv-player-back'));

  await waitFor(() => {
    expect(screen.queryByTestId('live-tv-phone-player-modal')).toBeNull();
  });

  const channel = screen.getByTestId('live-tv-channel-provider-a:channel:top');
  expect(channel.props.accessibilityState).toEqual({ selected: false });

  fetchMock.mockRestore();
});


test('TV player uses full-screen IPTV mode and OK opens the channel drawer', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
    const payload = String(url).includes('/catalog/')
      ? { metas: [
        { type: 'channel', id: 'top', name: 'TOP CHANNEL', countryCode: 'AL' },
        { type: 'channel', id: 'france2', name: 'France 2', countryCode: 'FR' },
      ] }
      : { streams: [{ id: 'main', url: 'https://stream.example/live.m3u8' }] };
    const body = JSON.stringify(payload);
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    } as any;
  });

  renderScreen([tvRecord()], jest.fn(), 'tv');
  fireEvent.press(await screen.findByTestId('live-tv-channel-provider-a:channel:top'));

  await waitFor(() => {
    expect(screen.getByTestId('live-tv-tv-player-modal')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/stream/channel/top.json'))).toBe(true);
  });

  fireEvent.press(screen.getByTestId('live-tv-player-tap-surface'));
  expect(screen.getByTestId('live-tv-tv-player-channel-drawer')).toBeTruthy();
  expect(
    screen.getByTestId('live-tv-channel-provider-a:channel:top')
      .props.hasTVPreferredFocus,
  ).toBe(true);
  expect(screen.getByTestId('live-tv-channel-provider-a:channel:france2')).toBeTruthy();

  fireEvent.press(screen.getByTestId('live-tv-channel-provider-a:channel:france2'));
  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/stream/channel/france2.json'))).toBe(true);
  });
  expect(screen.getByTestId('live-tv-tv-player-modal')).toBeTruthy();
  expect(screen.queryByTestId('live-tv-tv-player-channel-drawer')).toBeNull();

  fireEvent.press(screen.getByTestId('live-tv-tv-player-back'));
  await waitFor(() => {
    expect(screen.queryByTestId('live-tv-tv-player-modal')).toBeNull();
    expect(screen.getByTestId('live-tv-screen')).toBeTruthy();
  });

  fetchMock.mockRestore();
});


test('phone system Back closes the channel drawer before leaving playback', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      const payload = String(url).includes('/catalog/')
        ? {
          metas: [{
            type: 'channel',
            id: 'top',
            name: 'TOP CHANNEL',
            countryCode: 'AL',
          }],
        }
        : {
          streams: [{
            id: 'main',
            url: 'https://stream.example/live.m3u8',
          }],
        };
      const body = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  const rendered = renderScreen([tvRecord()]);
  fireEvent.press(
    await screen.findByTestId('live-tv-channel-provider-a:channel:top'),
  );
  await waitFor(() => {
    expect(screen.getByTestId('live-tv-phone-player-modal')).toBeTruthy();
  });

  fireEvent.press(screen.getByTestId('live-tv-player-channels'));
  expect(screen.getByTestId('live-tv-player-channel-drawer')).toBeTruthy();

  act(() => {
    rendered.UNSAFE_getByType(Modal).props.onRequestClose();
  });

  expect(screen.queryByTestId('live-tv-player-channel-drawer')).toBeNull();
  expect(screen.getByTestId('live-tv-phone-player-modal')).toBeTruthy();

  fetchMock.mockRestore();
});

test('phone system Back closes the source chooser before leaving playback', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      const payload = String(url).includes('/catalog/')
        ? {
          metas: [{
            type: 'channel',
            id: 'top',
            name: 'TOP CHANNEL',
            countryCode: 'AL',
          }],
        }
        : {
          streams: [
            {
              id: 'main',
              name: 'Primary',
              url: 'https://stream.example/main.m3u8',
            },
            {
              id: 'alt',
              name: 'Backup',
              url: 'https://stream.example/backup.m3u8',
            },
          ],
        };
      const body = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  const rendered = renderScreen([tvRecord()]);
  fireEvent.press(
    await screen.findByTestId('live-tv-channel-provider-a:channel:top'),
  );
  await waitFor(() => {
    expect(screen.getByTestId('live-tv-change-source')).toBeTruthy();
  });

  fireEvent.press(screen.getByTestId('live-tv-change-source'));
  expect(screen.getByTestId('source-chooser')).toBeTruthy();

  act(() => {
    rendered.UNSAFE_getByType(Modal).props.onRequestClose();
  });

  expect(screen.queryByTestId('source-chooser')).toBeNull();
  expect(screen.getByTestId('live-tv-phone-player-modal')).toBeTruthy();

  fetchMock.mockRestore();
});


test('TV remote Back closes the channel drawer before leaving playback', async () => {
  const backSpy = jest.spyOn(BackHandler, 'addEventListener')
    .mockImplementation(() => ({ remove: jest.fn() } as any));
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      const payload = String(url).includes('/catalog/')
        ? {
          metas: [{
            type: 'channel',
            id: 'top',
            name: 'TOP CHANNEL',
            countryCode: 'AL',
          }],
        }
        : {
          streams: [{
            id: 'main',
            url: 'https://stream.example/live.m3u8',
          }],
        };
      const body = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  renderScreen([tvRecord()], jest.fn(), 'tv');
  fireEvent.press(
    await screen.findByTestId('live-tv-channel-provider-a:channel:top'),
  );
  await waitFor(() => {
    expect(screen.getByTestId('live-tv-tv-player-modal')).toBeTruthy();
  });

  fireEvent.press(screen.getByTestId('live-tv-tv-player-channels'));
  expect(
    screen.getByTestId('live-tv-tv-player-channel-drawer'),
  ).toBeTruthy();

  const backHandler = backSpy.mock.calls.at(-1)?.[1];
  act(() => {
    expect(backHandler?.()).toBe(true);
  });

  expect(
    screen.queryByTestId('live-tv-tv-player-channel-drawer'),
  ).toBeNull();
  expect(screen.getByTestId('live-tv-tv-player-modal')).toBeTruthy();

  fetchMock.mockRestore();
  backSpy.mockRestore();
});

test('TV remote Back closes the source chooser before leaving playback', async () => {
  const backSpy = jest.spyOn(BackHandler, 'addEventListener')
    .mockImplementation(() => ({ remove: jest.fn() } as any));
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      const payload = String(url).includes('/catalog/')
        ? {
          metas: [{
            type: 'channel',
            id: 'top',
            name: 'TOP CHANNEL',
            countryCode: 'AL',
          }],
        }
        : {
          streams: [
            {
              id: 'main',
              name: 'Primary',
              url: 'https://stream.example/main.m3u8',
            },
            {
              id: 'alt',
              name: 'Backup',
              url: 'https://stream.example/backup.m3u8',
            },
          ],
        };
      const body = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  renderScreen([tvRecord()], jest.fn(), 'tv');
  fireEvent.press(
    await screen.findByTestId('live-tv-channel-provider-a:channel:top'),
  );
  await waitFor(() => {
    expect(screen.getByTestId('live-tv-change-source')).toBeTruthy();
  });

  fireEvent.press(screen.getByTestId('live-tv-change-source'));
  expect(screen.getByTestId('source-chooser')).toBeTruthy();

  const backHandler = backSpy.mock.calls.at(-1)?.[1];
  act(() => {
    expect(backHandler?.()).toBe(true);
  });

  expect(screen.queryByTestId('source-chooser')).toBeNull();
  expect(screen.getByTestId('live-tv-tv-player-modal')).toBeTruthy();

  fetchMock.mockRestore();
  backSpy.mockRestore();
});


test('phone Live TV player lets the user manually switch between resolved sources', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
    const payload = String(url).includes('/catalog/')
      ? { metas: [{ type: 'channel', id: 'top', name: 'TOP CHANNEL', countryCode: 'AL' }] }
      : {
        streams: [
          { id: 'main', name: 'Primary', url: 'https://stream.example/main.m3u8' },
          { id: 'alt', name: 'Backup', url: 'https://stream.example/backup.m3u8' },
        ],
      };
    const body = JSON.stringify(payload);
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    } as any;
  });

  renderScreen([tvRecord()]);
  fireEvent.press(await screen.findByTestId('live-tv-channel-provider-a:channel:top'));

  await waitFor(() => {
    expect(screen.getByTestId('live-tv-change-source')).toBeTruthy();
  });

  fireEvent.press(screen.getByTestId('live-tv-change-source'));
  expect(screen.getByTestId('source-chooser')).toBeTruthy();
  expect(screen.getByText('Primary')).toBeTruthy();
  expect(screen.getByText('Backup')).toBeTruthy();

  fireEvent.press(screen.getByTestId('source-provider-a:alt'));
  await waitFor(() => {
    expect(screen.queryByTestId('source-chooser')).toBeNull();
  });

  fetchMock.mockRestore();
});


test('TV Live TV player exposes manual source switching', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
    const payload = String(url).includes('/catalog/')
      ? { metas: [{ type: 'channel', id: 'top', name: 'TOP CHANNEL', countryCode: 'AL' }] }
      : {
        streams: [
          { id: 'main', name: 'Primary', url: 'https://stream.example/main.m3u8' },
          { id: 'alt', name: 'Backup', url: 'https://stream.example/backup.m3u8' },
        ],
      };
    const body = JSON.stringify(payload);
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    } as any;
  });

  renderScreen([tvRecord()], jest.fn(), 'tv');
  fireEvent.press(await screen.findByTestId('live-tv-channel-provider-a:channel:top'));

  await waitFor(() => {
    expect(screen.getByTestId('live-tv-change-source')).toBeTruthy();
  });

  fireEvent.press(screen.getByTestId('live-tv-change-source'));
  expect(screen.getByTestId('source-chooser')).toBeTruthy();
  expect(screen.getByText('Backup')).toBeTruthy();

  fetchMock.mockRestore();
});


test('Live TV auto-selects the preferred audio-language stream before provider order', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(async (url: any) => {
    const payload = String(url).includes('/catalog/')
      ? { metas: [{ type: 'channel', id: 'top', name: 'TOP CHANNEL', countryCode: 'FR' }] }
      : {
        streams: [
          {
            id: 'english',
            name: 'English',
            language: 'en',
            url: 'https://stream.example/english.m3u8',
          },
          {
            id: 'french',
            name: 'French',
            language: 'fr',
            url: 'https://stream.example/french.m3u8',
          },
        ],
      };
    const body = JSON.stringify(payload);
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    } as any;
  });

  const preferences = preferenceApi();
  preferences.preferences.preferredAudioLanguages = ['fr', 'en'];

  renderScreen([tvRecord()], jest.fn(), 'phone', preferences);
  fireEvent.press(await screen.findByTestId('live-tv-channel-provider-a:channel:top'));

  await waitFor(() => {
    expect(screen.getByTestId('live-tv-change-source')).toBeTruthy();
  });
  fireEvent.press(screen.getByTestId('live-tv-change-source'));

  const frenchSource = screen.getByTestId('source-provider-a:french');
  expect(within(frenchSource).getByText('✓ Selected')).toBeTruthy();

  fetchMock.mockRestore();
});


test('programme guide shows Now and Next without resolving a stream', async () => {
  const now = Date.now();
  await AsyncStorage.setItem(
    liveTvGuideStorageKeysForUser(null).config,
    JSON.stringify({
      configured: true,
      sourceRevision: 1,
      secure: false,
      publicUrl: 'https://guide.example/epg.xml',
    }),
  );
  await AsyncStorage.setItem(
    liveTvGuideStorageKeysForUser(null).cache,
    JSON.stringify({
      sourceRevision: 1,
      fetchedAtMs: now,
      channels: [{
        id: 'top',
        displayNames: ['TOP CHANNEL'],
        countryCode: 'AL',
      }],
      programmes: [
        {
          channelId: 'top',
          title: 'Evening News',
          startAtMs: now - 10 * 60 * 1000,
          endAtMs: now + 20 * 60 * 1000,
        },
        {
          channelId: 'top',
          title: 'Prime Time Film',
          startAtMs: now + 20 * 60 * 1000,
          endAtMs: now + 2 * 60 * 60 * 1000,
        },
      ],
    }),
  );

  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async () => {
      const body = JSON.stringify({
        metas: [{
          type: 'channel',
          id: 'top',
          name: 'TOP CHANNEL',
          countryCode: 'AL',
        }],
      });
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  renderScreen([tvRecord()]);

  await waitFor(() => {
    expect(screen.getByText(/Evening News/)).toBeTruthy();
    expect(screen.getByText(/Prime Time Film/)).toBeTruthy();
  });
  expect(
    fetchMock.mock.calls.some(([url]) => String(url).includes('/stream/')),
  ).toBe(false);

  fireEvent.press(
    screen.getByTestId('live-tv-guide-provider-a:channel:top'),
    { stopPropagation: jest.fn() },
  );

  expect(screen.getByTestId('live-tv-guide-timeline')).toBeTruthy();
  expect(screen.getByText('Evening News')).toBeTruthy();
  expect(
    fetchMock.mock.calls.some(([url]) => String(url).includes('/stream/')),
  ).toBe(false);

  fetchMock.mockRestore();
  await AsyncStorage.removeItem(liveTvGuideStorageKeysForUser(null).config);
  await AsyncStorage.removeItem(liveTvGuideStorageKeysForUser(null).cache);
});

test('keeps the newest programme guide when overlapping reloads finish out of order', async () => {
  const now = Date.now();
  const stamp = (value: number) => {
    const date = new Date(value);
    const part = (number: number) => String(number).padStart(2, '0');
    return [
      date.getUTCFullYear(),
      part(date.getUTCMonth() + 1),
      part(date.getUTCDate()),
      part(date.getUTCHours()),
      part(date.getUTCMinutes()),
      part(date.getUTCSeconds()),
    ].join('') + ' +0000';
  };
  const guideXml = (title: string) => `
    <tv>
      <channel id="top">
        <display-name>TOP CHANNEL</display-name>
        <country>AL</country>
      </channel>
      <programme
        channel="top"
        start="${stamp(now - 10 * 60 * 1000)}"
        stop="${stamp(now + 50 * 60 * 1000)}"
      >
        <title>${title}</title>
      </programme>
    </tv>
  `;
  const response = (body: string) => ({
    ok: true,
    status: 200,
    headers: { get: () => String(body.length) },
    text: async () => body,
  } as any);

  await AsyncStorage.setItem(
    liveTvGuideStorageKeysForUser(null).config,
    JSON.stringify({
      configured: true,
      sourceRevision: 1,
      secure: false,
      publicUrl: 'https://guide.example/epg.xml',
    }),
  );
  await AsyncStorage.setItem(
    liveTvGuideStorageKeysForUser(null).cache,
    JSON.stringify({
      sourceRevision: 1,
      fetchedAtMs: now,
      channels: [{
        id: 'top',
        displayNames: ['TOP CHANNEL'],
        countryCode: 'AL',
      }],
      programmes: [{
        channelId: 'top',
        title: 'Initial News',
        startAtMs: now - 10 * 60 * 1000,
        endAtMs: now + 50 * 60 * 1000,
      }],
    }),
  );

  let resolveFirstGuide!: (value: any) => void;
  let resolveSecondGuide!: (value: any) => void;
  const firstGuide = new Promise<any>((resolve) => {
    resolveFirstGuide = resolve;
  });
  const secondGuide = new Promise<any>((resolve) => {
    resolveSecondGuide = resolve;
  });
  let guideRequests = 0;

  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      if (String(url).includes('guide.example/epg.xml')) {
        guideRequests += 1;
        return guideRequests === 1 ? firstGuide : secondGuide;
      }

      const body = JSON.stringify({
        metas: [{
          type: 'channel',
          id: 'top',
          name: 'TOP CHANNEL',
          countryCode: 'AL',
        }],
      });
      return response(body);
    });

  renderScreen([tvRecord()]);
  await screen.findByText(/Initial News/);
  await AsyncStorage.removeItem(
    liveTvGuideStorageKeysForUser(null).cache,
  );

  act(() => {
    notifyLiveTvGuideChanged();
    notifyLiveTvGuideChanged();
  });
  await waitFor(() => expect(guideRequests).toBe(2));

  resolveSecondGuide(response(guideXml('Newest News')));
  await screen.findByText(/Newest News/);

  resolveFirstGuide(response(guideXml('Older News')));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(screen.getByText(/Newest News/)).toBeTruthy();
  expect(screen.queryByText(/Older News/)).toBeNull();

  fetchMock.mockRestore();
  await AsyncStorage.removeItem(liveTvGuideStorageKeysForUser(null).config);
  await AsyncStorage.removeItem(liveTvGuideStorageKeysForUser(null).cache);
});

test('phone system Back closes the programme guide before leaving Live TV', async () => {
  const backSpy = jest.spyOn(BackHandler, 'addEventListener')
    .mockImplementation(() => ({ remove: jest.fn() } as any));
  const now = Date.now();
  await AsyncStorage.setItem(
    liveTvGuideStorageKeysForUser(null).config,
    JSON.stringify({
      configured: true,
      sourceRevision: 1,
      secure: false,
      publicUrl: 'https://guide.example/epg.xml',
    }),
  );
  await AsyncStorage.setItem(
    liveTvGuideStorageKeysForUser(null).cache,
    JSON.stringify({
      sourceRevision: 1,
      fetchedAtMs: now,
      channels: [{
        id: 'top',
        displayNames: ['TOP CHANNEL'],
        countryCode: 'AL',
      }],
      programmes: [{
        channelId: 'top',
        title: 'Evening News',
        startAtMs: now - 10 * 60 * 1000,
        endAtMs: now + 20 * 60 * 1000,
      }],
    }),
  );

  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async () => {
      const body = JSON.stringify({
        metas: [{
          type: 'channel',
          id: 'top',
          name: 'TOP CHANNEL',
          countryCode: 'AL',
        }],
      });
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  renderScreen([tvRecord()]);
  await waitFor(() => {
    expect(
      screen.getByTestId('live-tv-guide-provider-a:channel:top'),
    ).toBeTruthy();
  });
  fireEvent.press(
    screen.getByTestId('live-tv-guide-provider-a:channel:top'),
    { stopPropagation: jest.fn() },
  );
  expect(screen.getByTestId('live-tv-guide-timeline')).toBeTruthy();

  const backHandler = backSpy.mock.calls.at(-1)?.[1];
  act(() => {
    expect(backHandler?.()).toBe(true);
  });

  expect(screen.queryByTestId('live-tv-guide-timeline')).toBeNull();
  expect(screen.getByTestId('live-tv-screen')).toBeTruthy();

  fetchMock.mockRestore();
  backSpy.mockRestore();
  await AsyncStorage.removeItem(liveTvGuideStorageKeysForUser(null).config);
  await AsyncStorage.removeItem(liveTvGuideStorageKeysForUser(null).cache);
});


test('Favorites keeps a station favorited through cross-provider merging', async () => {
  const providerB = tvRecord();
  providerB.installed = {
    ...providerB.installed,
    addonId: 'provider-b',
    manifestUrl: 'https://provider-b.example/manifest.json',
    priority: 50,
  };
  providerB.descriptor = {
    ...providerB.descriptor!,
    id: 'provider-b',
    manifestUrl: 'https://provider-b.example/manifest.json',
  };

  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      const providerBRequest = String(url).includes('provider-b.example');
      const payload = String(url).includes('/catalog/')
        ? {
          metas: [{
            type: 'channel',
            id: providerBRequest ? 'top-backup' : 'top',
            name: 'TOP CHANNEL',
            countryCode: 'AL',
          }],
        }
        : {
          streams: [{
            id: 'main',
            url: 'https://stream.example/live.m3u8',
          }],
        };
      const body = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  const preferences = preferenceApi();
  preferences.preferences.favoriteChannelIds = [
    'provider-b:channel:top-backup',
  ];

  renderScreen(
    [tvRecord(), providerB],
    jest.fn(),
    'phone',
    preferences,
  );

  await waitFor(() => {
    expect(
      screen.getAllByText('TOP CHANNEL'),
    ).toHaveLength(1);
  });

  fireEvent.press(screen.getByTestId('live-tv-favorites-filter'));

  expect(screen.getByText('TOP CHANNEL')).toBeTruthy();
  expect(
    screen.getByTestId('live-tv-favorite-provider-a:channel:top')
      .props.accessibilityLabel,
  ).toBe('Remove favorite');

  fetchMock.mockRestore();
});


test('merged Live TV channel automatically falls back to backup provider', async () => {
  const providerB = tvRecord();
  providerB.installed = {
    ...providerB.installed,
    addonId: 'provider-b',
    manifestUrl: 'https://provider-b.example/manifest.json',
    priority: 50,
  };
  providerB.descriptor = {
    ...providerB.descriptor!,
    id: 'provider-b',
    manifestUrl: 'https://provider-b.example/manifest.json',
  };

  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      const requestUrl = String(url);
      let payload: unknown;

      if (requestUrl.includes('/catalog/')) {
        payload = {
          metas: [{
            type: 'channel',
            id: requestUrl.includes('provider-b.example')
              ? 'top-backup'
              : 'top',
            name: 'TOP CHANNEL',
            countryCode: 'AL',
          }],
        };
      } else if (requestUrl.includes('provider-b.example')) {
        payload = {
          streams: [{
            id: 'backup',
            name: 'Backup',
            url: 'https://stream.example/backup.m3u8',
          }],
        };
      } else {
        payload = { streams: [] };
      }

      const body = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  renderScreen([tvRecord(), providerB]);

  await waitFor(() => {
    expect(screen.getAllByText('TOP CHANNEL')).toHaveLength(1);
  });

  fireEvent.press(
    screen.getByTestId('live-tv-channel-provider-a:channel:top'),
  );

  await waitFor(() => {
    expect(screen.getByTestId('live-tv-phone-player-modal')).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([url]) => (
        String(url).includes('provider-b.example')
        && String(url).includes('/stream/channel/top-backup.json')
      )),
    ).toBe(true);
  });

  fetchMock.mockRestore();
});


test('merged Live TV channels preserve favorites saved under an alternate provider id', async () => {
  const backupRecord: AddonStateRecord = {
    installed: {
      addonId: 'provider-b',
      manifestUrl: 'https://backup-provider.example/manifest.json',
      sourceType: 'stremio-manifest',
      enabled: true,
      priority: 50,
      installedAt: '2026-09-18T00:00:00Z',
      updatedAt: '2026-09-18T00:00:00Z',
      setupIncomplete: false,
    },
    safeConfig: {},
    descriptor: {
      id: 'provider-b',
      name: 'Provider B',
      version: '1.0.0',
      sourceType: 'stremio-manifest',
      capabilities: ['live-tv'],
      requiresConfiguration: false,
      configurationFields: [],
      supportedMediaKinds: [],
      manifestUrl: 'https://backup-provider.example/manifest.json',
      liveTv: {
        catalogs: [{ type: 'channel', id: 'all', name: 'All' }],
        streamTypes: ['channel'],
      },
    },
  };

  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      const requestUrl = String(url);
      const backup = requestUrl.includes('backup-provider.example');
      const payload = requestUrl.includes('/catalog/')
        ? {
          metas: [{
            type: 'channel',
            id: backup ? 'top-backup' : 'top',
            name: backup ? 'TÓP-CHANNEL' : 'TOP CHANNEL',
            countryCode: 'AL',
          }],
        }
        : {
          streams: [{
            id: 'main',
            url: backup
              ? 'https://backup-stream.example/live.m3u8'
              : 'https://stream.example/live.m3u8',
          }],
        };
      const body = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  const preferences = preferenceApi();
  preferences.preferences.favoriteChannelIds = [
    'provider-b:channel:top-backup',
  ];
  preferences.setFavoriteChannelIds = jest.fn(async () => undefined);

  renderScreen(
    [tvRecord(), backupRecord],
    jest.fn(),
    'phone',
    preferences,
  );

  const primaryRow = await screen.findByTestId(
    'live-tv-channel-provider-a:channel:top',
  );
  expect(primaryRow).toBeTruthy();
  expect(
    screen.queryByTestId('live-tv-channel-provider-b:channel:top-backup'),
  ).toBeNull();

  fireEvent.press(screen.getByTestId('live-tv-favorites-filter'));
  expect(
    screen.getByTestId('live-tv-channel-provider-a:channel:top'),
  ).toBeTruthy();

  fireEvent.press(
    screen.getByTestId('live-tv-favorite-provider-a:channel:top'),
    { stopPropagation: jest.fn() },
  );
  expect(preferences.setFavoriteChannelIds).toHaveBeenCalledWith([]);

  fetchMock.mockRestore();
});


test('stable favorite key matches the same station from a different provider', async () => {
  const providerB = tvRecord();
  providerB.installed = {
    ...providerB.installed,
    addonId: 'provider-b',
    manifestUrl: 'https://provider-b.example/manifest.json',
  };
  providerB.descriptor = {
    ...providerB.descriptor!,
    id: 'provider-b',
    manifestUrl: 'https://provider-b.example/manifest.json',
  };

  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async () => {
      const body = JSON.stringify({
        metas: [{
          type: 'channel',
          id: 'top-backup',
          name: 'TOP CHANNEL',
          countryCode: 'AL',
        }],
      });
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  const preferences = preferenceApi();
  preferences.preferences.favoriteChannelIds = [
    'live-tv-favorite:AL:top%20channel',
  ];

  renderScreen(
    [providerB],
    jest.fn(),
    'phone',
    preferences,
  );

  await screen.findByTestId(
    'live-tv-channel-provider-b:channel:top-backup',
  );
  fireEvent.press(screen.getByTestId('live-tv-favorites-filter'));

  expect(screen.getByText('TOP CHANNEL')).toBeTruthy();
  expect(
    screen.getByTestId(
      'live-tv-favorite-provider-b:channel:top-backup',
    ).props.accessibilityLabel,
  ).toBe('Remove favorite');

  fetchMock.mockRestore();
});



test('countryless favorite survives same-provider metadata enrichment', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async () => {
      const body = JSON.stringify({
        metas: [
          {
            type: 'channel',
            id: 'fr2',
            name: 'France 2',
          },
          {
            type: 'channel',
            id: 'fr2',
            name: 'Duplicate France 2',
            countryCode: 'FR',
          },
        ],
      });
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  const preferences = preferenceApi();
  preferences.preferences.favoriteChannelIds = [
    'live-tv-favorite:--:france%202',
  ];
  preferences.setFavoriteChannelIds = jest.fn(async () => undefined);

  renderScreen(
    [tvRecord()],
    jest.fn(),
    'phone',
    preferences,
  );

  await screen.findByTestId(
    'live-tv-channel-provider-a:channel:fr2',
  );

  await waitFor(() => {
    expect(preferences.setFavoriteChannelIds).toHaveBeenCalledWith([
      'live-tv-favorite:FR:france%202',
    ]);
  });

  fireEvent.press(screen.getByTestId('live-tv-favorites-filter'));
  expect(screen.getByText('France 2')).toBeTruthy();

  fetchMock.mockRestore();
});

test('countryless stable favorite migrates when another provider identifies the country', async () => {
  const providerB = tvRecord();
  providerB.installed = {
    ...providerB.installed,
    addonId: 'provider-b',
    manifestUrl: 'https://provider-b.example/manifest.json',
    priority: 50,
  };
  providerB.descriptor = {
    ...providerB.descriptor!,
    id: 'provider-b',
    name: 'Provider B',
    manifestUrl: 'https://provider-b.example/manifest.json',
  };

  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      const requestUrl = String(url);
      const backup = requestUrl.includes('provider-b.example');
      const body = JSON.stringify({
        metas: [{
          type: 'channel',
          id: backup ? 'fr2-backup' : 'fr2',
          name: backup ? 'Fránce-2' : 'France 2',
          ...(backup ? { countryCode: 'FR' } : {}),
        }],
      });
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  const preferences = preferenceApi();
  preferences.preferences.favoriteChannelIds = [
    'live-tv-favorite:--:france%202',
  ];
  preferences.setFavoriteChannelIds = jest.fn(async () => undefined);

  renderScreen(
    [tvRecord(), providerB],
    jest.fn(),
    'phone',
    preferences,
  );

  await screen.findByTestId(
    'live-tv-channel-provider-a:channel:fr2',
  );

  await waitFor(() => {
    expect(preferences.setFavoriteChannelIds).toHaveBeenCalledWith([
      'live-tv-favorite:FR:france%202',
    ]);
  });

  fetchMock.mockRestore();
});


test('failed favorite migration is not retried in a rollback loop', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async () => {
      const body = JSON.stringify({
        metas: [{
          type: 'channel',
          id: 'top',
          name: 'TOP CHANNEL',
          countryCode: 'AL',
        }],
      });
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  const preferences = preferenceApi();
  preferences.preferences.favoriteChannelIds = [
    'provider-a:channel:top',
  ];
  const setFavoriteChannelIds = jest.fn(async () => {
    throw new Error('local preference write failed');
  });
  preferences.setFavoriteChannelIds = setFavoriteChannelIds;
  const installed = [tvRecord()];
  const openProviders = jest.fn();
  const view = renderScreen(
    installed,
    openProviders,
    'phone',
    preferences,
  );

  await screen.findByTestId(
    'live-tv-channel-provider-a:channel:top',
  );
  await waitFor(() => {
    expect(setFavoriteChannelIds).toHaveBeenCalledTimes(1);
  });

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  // Simulate the preferences provider rolling the optimistic migration back
  // to the same durable legacy favorite after the failed write.
  preferences.preferences.favoriteChannelIds = [
    'provider-a:channel:top',
  ];
  view.rerender(screenElement(
    installed,
    openProviders,
    'phone',
    preferences,
  ));

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(setFavoriteChannelIds).toHaveBeenCalledTimes(1);
  fetchMock.mockRestore();
});


test('legacy provider-specific favorite migrates to the stable channel key', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async () => {
      const body = JSON.stringify({
        metas: [{
          type: 'channel',
          id: 'top',
          name: 'TOP CHANNEL',
          countryCode: 'AL',
        }],
      });
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  const preferences = preferenceApi();
  preferences.preferences.favoriteChannelIds = [
    'provider-a:channel:top',
  ];
  preferences.setFavoriteChannelIds = jest.fn(async () => undefined);

  renderScreen(
    [tvRecord()],
    jest.fn(),
    'phone',
    preferences,
  );

  await screen.findByTestId(
    'live-tv-channel-provider-a:channel:top',
  );

  await waitFor(() => {
    expect(preferences.setFavoriteChannelIds).toHaveBeenCalledWith([
      'live-tv-favorite:AL:top%20channel',
    ]);
  });

  fetchMock.mockRestore();
});


test('account switch reloads channels even when the provider endpoint is unchanged', async () => {
  let catalogRequests = 0;
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      const requestUrl = String(url);
      const isCatalog = requestUrl.includes('/catalog/');
      const requestNumber = isCatalog ? ++catalogRequests : catalogRequests;
      const payload = isCatalog
        ? {
          metas: [{
            type: 'channel',
            id: requestNumber === 1 ? 'account-a' : 'account-b',
            name: requestNumber === 1
              ? 'ACCOUNT A CHANNEL'
              : 'ACCOUNT B CHANNEL',
            countryCode: 'FR',
          }],
        }
        : { streams: [] };
      const body = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  const installed = [tvRecord()];
  const preferences = preferenceApi();
  const openProviders = jest.fn();
  const view = renderScreen(
    installed,
    openProviders,
    'phone',
    preferences,
    'account-a',
  );

  await screen.findByText('ACCOUNT A CHANNEL');
  expect(catalogRequests).toBe(1);

  view.rerender(screenElement(
    installed,
    openProviders,
    'phone',
    preferences,
    'account-b',
  ));

  await screen.findByText('ACCOUNT B CHANNEL');
  expect(catalogRequests).toBe(2);
  expect(screen.queryByText('ACCOUNT A CHANNEL')).toBeNull();

  fetchMock.mockRestore();
});


test('channel playback failure can open Live TV provider settings', async () => {
  const openProviders = jest.fn();
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      const payload = String(url).includes('/catalog/')
        ? {
          metas: [{
            type: 'channel',
            id: 'top',
            name: 'TOP CHANNEL',
            countryCode: 'AL',
          }],
        }
        : { streams: [] };
      const body = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  renderScreen([tvRecord()], openProviders);

  fireEvent.press(
    await screen.findByTestId('live-tv-channel-provider-a:channel:top'),
  );

  await screen.findByText('Channel unavailable');
  fireEvent.press(screen.getByTestId('live-tv-player-providers'));

  expect(openProviders).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('live-tv-phone-player-modal')).toBeNull();

  fetchMock.mockRestore();
});


test('merged Live TV channel lets the user prefer a provider manually', async () => {
  const providerB = tvRecord();
  providerB.installed = {
    ...providerB.installed,
    addonId: 'provider-b',
    manifestUrl: 'https://provider-b.example/manifest.json',
    priority: 50,
  };
  providerB.descriptor = {
    ...providerB.descriptor!,
    id: 'provider-b',
    name: 'Provider B',
    manifestUrl: 'https://provider-b.example/manifest.json',
  };

  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      const requestUrl = String(url);
      const backup = requestUrl.includes('provider-b.example');
      const payload = requestUrl.includes('/catalog/')
        ? {
          metas: [{
            type: 'channel',
            id: backup ? 'top-backup' : 'top',
            name: 'TOP CHANNEL',
            countryCode: 'AL',
          }],
        }
        : {
          streams: [{
            id: backup ? 'backup-source' : 'primary-source',
            name: backup ? 'Backup' : 'Primary',
            url: backup
              ? 'https://stream.example/backup.m3u8'
              : 'https://stream.example/primary.m3u8',
          }],
        };
      const body = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  renderScreen([tvRecord(), providerB]);

  fireEvent.press(
    await screen.findByTestId(
      'live-tv-channel-provider-a:channel:top',
    ),
  );

  await screen.findByTestId('live-tv-phone-player-modal');
  await screen.findByTestId('live-tv-change-provider');
  fireEvent.press(screen.getByTestId('live-tv-change-provider'));

  expect(screen.getByTestId('live-tv-provider-chooser')).toBeTruthy();
  expect(screen.getByTestId('live-tv-provider-auto')).toBeTruthy();
  fireEvent.press(screen.getByTestId('live-tv-provider-option-1'));

  await waitFor(() => {
    expect(
      fetchMock.mock.calls.some(([url]) => (
        String(url).includes('provider-b.example')
        && String(url).includes(
          '/stream/channel/top-backup.json',
        )
      )),
    ).toBe(true);
  });
  expect(
    screen.queryByTestId('live-tv-provider-chooser'),
  ).toBeNull();

  fetchMock.mockRestore();
});


test('account switch clears the manual Live TV provider preference', async () => {
  const providerB = tvRecord();
  providerB.installed = {
    ...providerB.installed,
    addonId: 'provider-b',
    manifestUrl: 'https://provider-b.example/manifest.json',
    priority: 50,
  };
  providerB.descriptor = {
    ...providerB.descriptor!,
    id: 'provider-b',
    name: 'Provider B',
    manifestUrl: 'https://provider-b.example/manifest.json',
  };

  const streamRequests: string[] = [];
  const fetchMock = jest.spyOn(globalThis, 'fetch' as any)
    .mockImplementation(async (url: any) => {
      const requestUrl = String(url);
      const backup = requestUrl.includes('provider-b.example');
      if (requestUrl.includes('/stream/')) streamRequests.push(requestUrl);
      const payload = requestUrl.includes('/catalog/')
        ? {
          metas: [{
            type: 'channel',
            id: backup ? 'top-backup' : 'top',
            name: 'TOP CHANNEL',
            countryCode: 'AL',
          }],
        }
        : {
          streams: [{
            id: backup ? 'backup-source' : 'primary-source',
            url: backup
              ? 'https://stream.example/backup.m3u8'
              : 'https://stream.example/primary.m3u8',
          }],
        };
      const body = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      } as any;
    });

  const installed = [tvRecord(), providerB];
  const preferences = preferenceApi();
  const view = renderScreen(
    installed,
    jest.fn(),
    'phone',
    preferences,
    'account-a',
  );

  fireEvent.press(
    await screen.findByTestId(
      'live-tv-channel-provider-a:channel:top',
    ),
  );
  await screen.findByTestId('live-tv-change-provider');
  fireEvent.press(screen.getByTestId('live-tv-change-provider'));
  fireEvent.press(screen.getByTestId('live-tv-provider-option-1'));

  await waitFor(() => {
    expect(
      streamRequests.some((url) => url.includes('provider-b.example')),
    ).toBe(true);
  });

  streamRequests.length = 0;
  view.rerender(screenElement(
    installed,
    jest.fn(),
    'phone',
    preferences,
    'account-b',
  ));

  await waitFor(() => {
    expect(screen.queryByTestId('live-tv-phone-player-modal')).toBeNull();
  });

  fireEvent.press(
    await screen.findByTestId(
      'live-tv-channel-provider-a:channel:top',
    ),
  );

  await waitFor(() => {
    expect(streamRequests.length).toBeGreaterThan(0);
  });
  expect(streamRequests[0]).toContain('provider.example');
  expect(streamRequests[0]).not.toContain('provider-b.example');

  fetchMock.mockRestore();
});
